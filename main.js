// Electron main process: the window, repo/GitHub commands, the Claude Code instances (PTYs) and the hook server.
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard } = require('electron');
const { execFile, execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const pty = require('node-pty');
const lib = require('./lib');
const cpu = require('./cpu');

// A GUI launch on macOS/Linux does not inherit the login shell's PATH, so claude/gh/git would not be found.
if (process.platform !== 'win32') {
  try {
    const env = execFileSync(process.env.SHELL || '/bin/sh', ['-ilc', 'env'], { encoding: 'utf8', timeout: 5000 });
    const m = /^PATH=(.+)$/m.exec(env);
    if (m) process.env.PATH = m[1];
  } catch { /* keep the PATH we have */ }
}

// node-pty 1.1.0 publishes its macOS spawn-helper without the executable bit (mode 644 in the npm tarball);
// left alone, every pty.spawn on macOS fails with "posix_spawnp failed".
if (process.platform === 'darwin') {
  try { fs.chmodSync(path.join(path.dirname(require.resolve('node-pty')), '..', 'prebuilds', `darwin-${process.arch}`, 'spawn-helper'), 0o755); } catch { /* built from source: no prebuild to fix */ }
}

const run = (cmd, args, cwd) => new Promise((resolve, reject) =>
  execFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
    err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout)));

function findClaude() {
  try {
    const found = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['claude'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
    // ponytail: node-pty starts real executables only, so on Windows this needs claude.exe (the native
    // install); an npm .cmd shim is not supported. Add a cmd.exe wrapper with argument escaping if needed.
    return process.platform === 'win32' ? found.find(f => /\.exe$/i.test(f)) : found[0];
  } catch { return undefined; }
}

// ---------- state ----------

const dataDir = app.getPath('userData');
const stateFile = path.join(dataDir, 'state.json');
let saved = { repoPath: null, usage: null, templates: {}, sessions: [], settings: { mergeMethod: 'squash', timedMinutes: 5, cpuCeiling: 100, cpuShare: false } };
try {
  const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  saved = { ...saved, ...s, settings: { ...saved.settings, ...s.settings } };
} catch { /* first run */ }
// Written to the side, flushed to the disk, then renamed over the old file: a power cut leaves the old state
// or the new one, never half a file.
// ponytail: one running copy per data folder. Two copies overwrite each other's state; give the second its
// own --user-data-dir, or a file per copy if running several becomes a habit.
let written = '';
const save = () => {
  const text = JSON.stringify(saved, null, 2);
  if (text === written) return;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(`${stateFile}.tmp`, text, { flush: true });
  fs.renameSync(`${stateFile}.tmp`, stateFile);
  written = text;
};

let win, claudeBin, hookPort;
const hookToken = crypto.randomBytes(16).toString('hex');
let repo = null;          // the folder the app is pointed at
let account = null;       // `claude auth status`
let sessions = [];        // `claude agents --json`: every live Claude Code session on this machine
const instances = new Map();
// What was open when the app last stopped, until each is resumed or forgotten (see "sessions on disk").
let interrupted = Array.isArray(saved.sessions) ? saved.sessions : [];
const queue = [];         // dispatched issues waiting for a pool slot or for their blockers
let poolLimit = 1;
const CORES = os.cpus().length;
const procUsage = new Map();   // root pid -> CPU and memory of that session's process tree

const send = (channel, ...args) => { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args); };
let pushTimer;
const push = () => { clearTimeout(pushTimer); pushTimer = setTimeout(() => send('state', snapshot()), 30); };
const sessionOf = inst => sessions.find(s => s.pid === inst.pid);
const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };

// Sessions started outside the app (another terminal, the desktop app) inside this repo: visible, not attachable.
function externalSessions() {
  if (!repo) return [];
  const mine = new Set([...instances.values()].map(i => i.pid));
  return sessions.filter(s => !mine.has(s.pid) && s.cwd && (lib.isInside(repo.path, s.cwd) || repo.worktrees.some(w => lib.isInside(w.path, s.cwd))));
}

function snapshot() {
  const worktrees = repo ? repo.worktrees : [];
  return {
    version: app.getVersion(), claudeFound: !!claudeBin, repo, account, usage: saved.usage, settings: saved.settings, cores: CORES,
    cpuMechanism: cpu.mechanism, cpuError: cpu.error,
    // Not the ones whose conversation is live again somewhere (resumed by hand in a terminal, say).
    resumable: interrupted.filter(r => !sessions.some(s => s.sessionId && s.sessionId === r.sessionId)).map(r => ({
      id: r.id, label: r.worktree || path.basename(r.root), worktree: r.worktree, dir: r.worktree ? path.join(r.root, '.claude', 'worktrees', r.worktree) : r.root,
      issue: r.issue, model: r.model, effort: r.effort, level: r.level, autoMerge: r.autoMerge, group: r.group || null, savedAt: r.savedAt,
      conversation: !!r.transcript && fs.existsSync(r.transcript),
    })),
    instances: [...instances.values()].map(i => {
      const s = sessionOf(i) || {};
      return {
        id: i.id, kind: i.kind, issue: i.issue, model: i.model, effort: i.effort, level: i.level, autoMerge: i.autoMerge,
        startedAt: i.startedAt, exited: i.exited, exitCode: i.exitCode, cwd: i.cwd, ...lib.labelFor(i.root, i.cwd, worktrees),
        status: i.status, session: { status: s.status || s.state, waitingFor: s.waitingFor, name: s.name },
        pending: i.pending.map(p => p.view), pr: i.pr, merge: i.merge, procs: i.exited ? undefined : procUsage.get(i.pid),
        weight: i.weight, limit: i.limited && !i.exited ? cpu.limit(i.id) : 1, group: i.group, starting: i.starting && !i.exited,
      };
    }),
    external: externalSessions().map(s => ({
      id: s.id || String(s.pid), name: s.name, kind: s.kind, cwd: s.cwd, startedAt: s.startedAt, status: s.status || s.state,
      waitingFor: s.waitingFor, procs: procUsage.get(s.pid), ...lib.labelFor(repo.path, s.cwd, worktrees),
    })),
    queue: queue.map(j => ({ number: j.number, title: j.title, waitingOn: j.waitingOn, group: j.group })),
  };
}

// ---------- instances ----------

function userStatusLine() { return readJson(path.join(configDir(), 'settings.json')).statusLine; }

// resume + transcript: continue that conversation instead of starting one (see "sessions on disk").
// group: the name of the group it belongs to, if any (see lib.groupName).
function spawnInstance({ cwd, worktree, resume, transcript, model, effort, prompt, level = 'manual', autoMerge = false, kind = 'instance', issue = null, pooled = false, weight = 'normal', group = null }) {
  if (!claudeBin) throw new Error('Claude Code CLI (claude) was not found on PATH.');
  const root = cwd || repo.path;
  const id = crypto.randomBytes(4).toString('hex');
  if (worktree === true) worktree = `wt-${id}`;
  const wt = worktree ? path.join(root, '.claude', 'worktrees', worktree) : null;   // where `claude -w` puts it
  const dir = path.join(dataDir, 'instances', id);
  fs.mkdirSync(dir, { recursive: true });
  const settingsFile = path.join(dir, 'settings.json'), statusFile = path.join(dir, 'status.json');
  fs.writeFileSync(settingsFile, JSON.stringify(lib.instanceSettings({
    statusFile, hookUrl: `http://127.0.0.1:${hookPort}/${hookToken}/${id}`, userStatusLine: userStatusLine(),
  })));
  const env = lib.childEnv(process.env);
  const limits = { ceiling: saved.settings.cpuCeiling / 100, weight: lib.WEIGHTS[weight] };
  const [file, args] = cpu.command(id, claudeBin, lib.claudeArgs({ settingsFile, model, effort, worktree, prompt, resume }), limits);
  // A new session is taken into its worktree by `claude -w`; a resumed one is started inside it.
  const proc = pty.spawn(file, args, { name: 'xterm-256color', cols: 110, rows: 30, cwd: resume && wt ? wt : root, env });
  // On Windows this puts the new process into its job before it can start anything of its own.
  const limited = cpu.attach(id, proc.pid, limits);
  const inst = {
    id, kind, issue, pooled, model, effort, level, autoMerge, root, wt, prompt, proc, env, dir, statusFile, pid: proc.pid, startedAt: Date.now(),
    cwd: wt || root, sessionId: resume || null, transcript: transcript || null, group: lib.groupName(group),
    // A new worktree with a first prompt: until that prompt has gone in, the session is still running its
    // SessionStart hooks, where a repository sets a fresh worktree up (see onHook and pump).
    starting: !!(wt && prompt && !resume),
    status: null, pending: [], pr: null, merge: null, finished: false, exited: false, weight, limited,
  };
  instances.set(id, inst);
  proc.onData(d => send('pty-data', id, d));
  proc.onExit(({ exitCode }) => {
    inst.exited = true; inst.exitCode = exitCode; inst.exitedAt = Date.now();
    inst.pending.slice().forEach(p => p.settle('terminal'));
    cpu.detach(id);
    push(); pump();
  });
  saveSessions(); push();
  syncSampler();
  return id;
}

// remove: 'safe' also removes the instance's worktree if nothing in it would be lost; 'force' removes it
// whatever is in it. Returns what became of the worktree (see removeWorktree).
async function closeInstance(id, remove) {
  const inst = instances.get(id);
  if (!inst) return;
  instances.delete(id);
  const gone = inst.exited ? null : new Promise(resolve => { inst.proc.onExit(resolve); setTimeout(resolve, 5000); });
  if (gone) { try { inst.proc.kill(); } catch { /* already gone */ } }
  // With its worktree going too, nothing the instance started may stay behind in it (see cpu.stop).
  if (remove && inst.wt) cpu.stop(id);
  fs.rmSync(inst.dir, { recursive: true, force: true });
  cpu.detach(id);
  saveSessions(); push(); pump();
  if (!remove || !inst.wt) return;
  await gone;   // Windows does not let go of a folder while a process still sits in it
  return removeWorktree(inst.root, inst.wt, remove === 'force', inst.pid);
}

// The status line tee (see lib.statusLineCommand) leaves Claude Code's own numbers in a file per instance.
function readStatus(inst) {
  let st;
  try { st = JSON.parse(fs.readFileSync(inst.statusFile, 'utf8')); } catch { return; } // not written yet, or mid-write
  const cw = st.context_window || {}, cu = cw.current_usage || {}, cost = st.cost || {};
  inst.status = {
    model: st.model && st.model.display_name, effort: st.effort && st.effort.level, sessionId: st.session_id,
    cost: cost.total_cost_usd, added: cost.total_lines_added, removed: cost.total_lines_removed,
    ctxPct: cw.used_percentage, ctxSize: cw.context_window_size,
    ctxTokens: (cu.input_tokens || 0) + (cu.cache_creation_input_tokens || 0) + (cu.cache_read_input_tokens || 0),
    branch: st.worktree && st.worktree.branch,
  };
  // The conversation this instance is in now (it changes with /clear and /resume), and where Claude Code keeps it.
  if (st.session_id) { inst.sessionId = st.session_id; inst.transcript = st.transcript_path || null; }
  if (st.cwd) inst.cwd = (st.worktree && st.worktree.path) || st.cwd;
  if (st.rate_limits) saved.usage = { ...st.rate_limits, at: Date.now() };
}

// A held permission request is also on screen as Claude Code's own dialog (and on Remote Control devices).
// Answered there, Claude Code moves on without closing our hook request, so let go of it ourselves: no
// dialog can be open once the session has reported busy or idle on two polls in a row.
function dropAnswered(inst) {
  const status = (sessionOf(inst) || {}).status;
  for (const p of inst.pending.slice()) {
    if (p.view.kind !== 'permission') continue;
    p.quiet = status === 'busy' || status === 'idle' ? (p.quiet || 0) + 1 : 0;
    if (p.quiet >= 2) p.settle('terminal');
  }
}

async function tick() {
  if (claudeBin) { try { sessions = JSON.parse(await run(claudeBin, ['agents', '--json'])); } catch { /* keep the last list */ } }
  for (const inst of instances.values()) if (!inst.exited) { readStatus(inst); dropAnswered(inst); }
  push();
  syncSampler();
  // `claude agents` costs a process start each time: ease off when nothing runs here and nobody is looking.
  const watched = (win && !win.isDestroyed() && win.isFocused()) || [...instances.values()].some(i => !i.exited);
  setTimeout(tick, watched ? 3000 : 15000);
}

// ---------- sessions on disk: what a restart needs to bring each instance back ----------

// Claude Code keeps every conversation on disk as it goes. What a power cut would take is what the app knows
// on top of that: which instances were open, where, and with which settings. That is written out every ten
// seconds, and whenever an instance comes or goes.
const sessionRecord = i => ({
  id: i.id, root: i.root, worktree: i.wt && path.basename(i.wt), kind: i.kind, issue: i.issue, pooled: i.pooled, model: i.model, effort: i.effort,
  level: i.level, autoMerge: i.autoMerge, weight: i.weight, group: i.group, prompt: i.prompt, sessionId: i.sessionId, transcript: i.transcript, savedAt: Date.now(),
});
function saveSessions() {
  // An instance that ended stays on record for a moment longer: when the machine shuts down, Claude Code may
  // be stopped a little before the app is, and those are the sessions to bring back.
  const open = [...instances.values()].filter(i => !i.exited || Date.now() - i.exitedAt < 15000);
  saved.sessions = [...interrupted, ...open.map(sessionRecord)];
  try { save(); } catch { /* the disk said no: the next round tries again */ }
}
setInterval(saveSessions, 10000);

// ---------- worktrees under .claude/worktrees ----------

const git = (args, cwd) => run('git', args, cwd).then(s => s.trim());
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// Sessions at work inside a folder: this app's instances and every other live Claude Code session.
function sessionsIn(dir, skipPid) {
  const all = [...[...instances.values()].filter(i => !i.exited), ...sessions];
  return all.filter(s => s.pid && s.pid !== skipPid && s.cwd && lib.isInside(dir, s.cwd) && alive(s.pid));
}

// The folders under <root>/.claude/worktrees (or just `only`): the worktrees git knows there, each with what
// removing it would lose, and folders git no longer knows (left behind by a removal that could not finish).
async function worktreeRows(root, only) {
  const base = path.join(root, '.claude', 'worktrees');
  const known = lib.parseWorktrees(await git(['worktree', 'list', '--porcelain'], root)).filter(w => !w.main && lib.isInside(lib.realPath(base), lib.realPath(w.path)));
  let folders = [];
  try { folders = fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(base, e.name)); } catch { /* no worktree yet */ }
  const all = [...known, ...folders.filter(f => !known.some(w => lib.samePath(w.path, f))).map(f => ({ path: f, leftover: true }))];
  return Promise.all(all.filter(w => !only || lib.samePath(w.path, only)).map(async w => {
    const row = { name: path.basename(w.path), path: w.path, branch: w.branch || null, leftover: !!w.leftover };
    if (w.leftover) return row;
    if (!fs.existsSync(w.path)) return { ...row, error: 'its folder is gone' };
    try {
      row.changed = (await git(['status', '--porcelain'], w.path)).split('\n').filter(Boolean).length;
      // Commits that would be on no branch and no remote once this worktree and its branch are gone.
      row.unique = Number(await git(['rev-list', '--count', 'HEAD', '--not', ...(w.branch ? [`--exclude=${w.branch}`] : []), '--branches', '--remotes'], w.path));
      row.last = await git(['log', '-1', '--format=%cr%x09%s'], w.path);
    } catch (e) { row.error = e.message.split('\n')[0]; }
    return row;
  }));
}

// Remove a worktree: its folder, git's record of it, and its branch. Without `force` only when nothing would
// be lost with it. skipPid: the instance being closed along with it.
// Returns { removed, name, branch }, { kept: row } when it was not safe, or undefined when there was nothing.
async function removeWorktree(root, dir, force, skipPid) {
  if (sessionsIn(dir, skipPid).length) throw new Error('Another session is running in that worktree, so it stays.');
  const [row] = await worktreeRows(root, dir);
  if (!row) return;
  if (!force && (row.leftover || row.error || row.changed || row.unique)) return { kept: row };
  // --force twice: once for an unclean tree (settled above), once for the lock a stopped session can leave.
  // On Windows git gives up at the first file something still holds, so the folder is finished off by hand.
  if (!row.leftover) await git(['worktree', 'remove', '--force', '--force', dir], root).catch(() => {});
  const stuck = await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).then(() => null, e => e);
  if (!row.leftover) {
    await git(['worktree', 'prune'], root);
    // With the folder stuck, git may or may not have let go of the branch; either way it is not the news here.
    if (row.branch) await git(['branch', '-D', row.branch], root).catch(e => { if (!stuck) throw e; });
  }
  if (repo && repo.path === root) { repo.worktrees = lib.parseWorktrees(await git(['worktree', 'list', '--porcelain'], root)); push(); }
  if (stuck) throw new Error(`Could not delete ${dir}: a program still has files open in it (${stuck.code}). Close that program, then remove the folder from the Worktrees tab.`);
  return { removed: true, name: row.name, branch: row.branch };
}

// ---------- CPU and memory of each session's process tree ----------

let sampler = null, samplerFailed = false, lastProcs = null, lastSampleAt = 0;

function onSample(lines) {
  const now = Date.now(), procs = lib.parseProcs(lines);
  const seconds = lastProcs ? (now - lastSampleAt) / 1000 : 0;
  const mine = new Map([...instances.values()].filter(i => !i.exited).map(i => [i.pid, i.id]));
  const roots = [...mine.keys()].concat(externalSessions().map(s => s.pid).filter(Boolean));
  for (const pid of roots) {
    const u = lib.treeUsage(procs, pid, lastProcs, seconds);
    const share = u.cpu / CORES;   // share of the whole machine, as Task Manager shows it
    // Every instance gets a reading from every listing, also one that is not in it (a reading of nothing):
    // the sharing waits until all of them have one.
    if (mine.has(pid)) cpu.observe(mine.get(pid), procs, share);
    if (!u.procs.length) { procUsage.delete(pid); continue; }
    const groups = lib.byName(u.procs);
    procUsage.set(pid, {
      cpu: share, mem: u.mem, count: u.procs.length,
      top: groups.slice(0, 8).map(g => ({ ...g, cpu: g.cpu / CORES })), more: Math.max(0, groups.length - 8),
      hist: [...((procUsage.get(pid) || {}).hist || []), share].slice(-20),
    });
  }
  for (const pid of procUsage.keys()) if (!roots.includes(pid)) procUsage.delete(pid);
  lastProcs = procs; lastSampleAt = now;
  balanceCpu(true);   // on the readings just taken: where the limits go by the listing, this is their step
  push();
}

// CPU ceiling and weighted sharing (see cpu.js): once a second, and with each process listing.
const cpuSettings = () => ({ ceiling: saved.settings.cpuCeiling / 100, share: saved.settings.cpuShare });
function balanceCpu(listing) {
  cpu.balance(cpuSettings(), new Map([...instances.values()].filter(i => !i.exited).map(i => [i.id, lib.WEIGHTS[i.weight]])), listing === true);
}
setInterval(balanceCpu, 1000);

// The lister (see lib.samplerCommand) runs only while there is a session to measure.
function syncSampler() {
  const wanted = [...instances.values()].some(i => !i.exited) || externalSessions().length > 0;
  if (!wanted) { if (sampler) sampler.kill(); return; }
  if (sampler || samplerFailed) return;
  const [cmd, args] = lib.samplerCommand(process.platform, process.pid);
  const child = sampler = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  let rest = '', lines = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    const parts = (rest + chunk).split(/\r?\n/);
    rest = parts.pop();
    for (const line of parts) {
      if (line === 'END') { onSample(lines); lines = []; } else lines.push(line);
    }
  });
  child.on('error', () => { samplerFailed = true; sampler = null; });   // no PowerShell / ps: cards show no usage
  child.on('exit', () => { if (sampler === child) sampler = null; lastProcs = null; });
}

// ---------- hooks: input levels and "finished" ----------

function startHookServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const [, token, id] = req.url.split('/');
      const inst = instances.get(id);
      if (req.method !== 'POST' || token !== hookToken || !inst) { res.writeHead(404); return res.end(); }
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        let ev;
        try { ev = JSON.parse(body); } catch { res.writeHead(400); return res.end(); }
        onHook(inst, ev, res);
      });
    });
    server.listen(0, '127.0.0.1', () => { hookPort = server.address().port; resolve(); });
  });
}

function onHook(inst, ev, res) {
  // An empty 200 means "no opinion": Claude Code carries on and shows its own dialog in the terminal.
  const reply = out => {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(out ? JSON.stringify(out) : '');
  };
  if (ev.cwd) inst.cwd = ev.cwd;
  if (ev.hook_event_name === 'Stop') { reply(); onStop(inst); return; }
  if (ev.hook_event_name === 'UserPromptSubmit') {
    reply();
    if (inst.starting) { inst.starting = false; push(); pump(); }   // its start hooks are done: the next worktree may come
    return;
  }
  const kind = lib.inputKind(ev);
  if (!kind || inst.level === 'manual') return reply();
  if (inst.level === 'auto') return reply(lib.hookReply(ev, 'recommended'));
  // timed: hold the request, show it on the card, take the recommended choice at the deadline.
  const ms = saved.settings.timedMinutes * 60000;
  const p = {
    view: {
      id: crypto.randomBytes(4).toString('hex'), kind, deadline: Date.now() + ms,
      ...(kind === 'question'
        ? { questions: ev.tool_input.questions.map(q => ({ question: q.question, multiSelect: !!q.multiSelect, options: q.options, recommended: lib.pickRecommended(q) })) }
        : { tool: ev.tool_name, detail: lib.permissionSummary(ev) }),
    },
    settle(choice) {
      clearTimeout(p.timer);
      inst.pending = inst.pending.filter(x => x !== p);
      reply(lib.hookReply(ev, choice));
      push();
    },
  };
  p.timer = setTimeout(() => p.settle('recommended'), ms);
  res.on('close', () => { if (!res.writableEnded) p.settle('terminal'); }); // Claude Code dropped the hook (Esc, exit)
  inst.pending.push(p);
  push();
}

async function onStop(inst) {
  inst.pending.slice().forEach(p => p.settle('terminal'));   // the turn is over: nothing can still be waiting
  if (inst.kind === 'generator') send('config-changed');
  await checkPr(inst);
  push(); pump();
}

// "Finished" = the agent ended its turn and its branch has an open PR. That frees its pool slot and,
// with auto-merge on, merges the PR.
async function checkPr(inst) {
  if (inst.merge === 'merged') return;
  let pr = null;
  try { pr = JSON.parse(await run('gh', ['pr', 'view', '--json', 'number,state,url,isDraft'], inst.cwd)); } catch { /* no PR on this branch */ }
  const action = lib.prAction(pr, inst.autoMerge);
  if (action === 'none') return;
  inst.pr = { number: pr.number, url: pr.url };
  inst.finished = true;
  if (action === 'merged') inst.merge = 'merged';
  if (action === 'merge' && inst.merge !== 'queued') {   // queued: GitHub already holds the auto-merge
    try {
      // --auto: merge now when GitHub allows it, otherwise as soon as the required checks pass.
      await run('gh', ['pr', 'merge', String(pr.number), `--${saved.settings.mergeMethod}`, '--auto'], inst.cwd);
      const after = JSON.parse(await run('gh', ['pr', 'view', String(pr.number), '--json', 'state'], inst.cwd));
      inst.merge = after.state === 'MERGED' ? 'merged' : 'queued';
    } catch (e) { inst.merge = `failed: ${e.message}`; }
  }
}

// ---------- issue dispatch pool ----------

let pumping = false, pumpAgain = false;
async function pump() {
  if (pumping) { pumpAgain = true; return; }
  pumping = true;
  try {
    for (const job of [...queue]) {
      // One worktree at a time. The next is created only when the session in the one before has finished its
      // SessionStart hooks, so two worktrees are never being set up side by side.
      if ([...instances.values()].some(i => i.starting && !i.exited)) break;
      const active = [...instances.values()].filter(i => i.pooled && !i.exited && !i.finished).length;
      if (job.pooled && active >= poolLimit) continue;
      try {
        job.waitingOn = lib.openBlockers(JSON.parse(await run('gh', ['api', `repos/{owner}/{repo}/issues/${job.number}/dependencies/blocked_by`], job.root)));
      } catch { job.waitingOn = ['?']; }   // gh failed: like claude_worktree, wait and retry
      if (job.waitingOn.length || !queue.includes(job)) continue;
      queue.splice(queue.indexOf(job), 1);
      spawnInstance({
        cwd: job.root, worktree: lib.worktreeName(job.number, job.title), model: job.model, effort: job.effort, level: job.level,
        autoMerge: job.autoMerge, issue: job.number, pooled: job.pooled, group: job.group,
        prompt: lib.issuePrompt(job.template, job, job.autonomy, saved.settings.mergeMethod),
      });
    }
  } finally {
    pumping = false; push();
    if (pumpAgain) { pumpAgain = false; pump(); }
  }
}
setInterval(pump, 5 * 60 * 1000);   // blockers are re-checked every 5 minutes, as claude_worktree does

// ---------- repo ----------

async function openRepo(dir) {
  const git = args => run('git', args, dir).then(s => s.trim(), () => '');
  const isGit = (await git(['rev-parse', '--is-inside-work-tree'])) === 'true';
  repo = {
    path: dir, name: path.basename(dir), isGit,
    github: isGit ? lib.parseGitHub(await git(['remote', 'get-url', 'origin'])) : null,
    worktrees: isGit ? lib.parseWorktrees(await git(['worktree', 'list', '--porcelain'])) : [],
    setup: lib.scanConfig(dir).summary,
    // The default prompt for issue worktrees.
    // ponytail: prompts saved before 0.1.0 wrote the issue number as {n}, so every load turns a literal {n}
    // into the placeholder. Drop the replaceAll once no state file from before 0.1.0 is around.
    template: (saved.templates[dir] || lib.defaultTemplate(dir)).replaceAll('{n}', '{{ issue_id }}'),
  };
  saved.repoPath = dir; save(); push();
  return repo;
}

// ---------- calls from the renderer ----------

const configFile = rel => (rel.startsWith('~/') ? lib.homePath(configDir(), rel.slice(2)) : lib.configPath(repo.path, rel));

const rpc = {
  state: snapshot,
  async pickFolder() {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  },
  openRepo,
  refreshRepo: () => openRepo(repo.path),
  async clone(spec, parent) {
    if (!/^[\w.@:/-]+$/.test(spec) || spec.startsWith('-')) throw new Error('Use owner/repo or a repository URL.');
    const dest = path.join(parent, spec.replace(/\.git$/, '').split(/[/:]/).filter(Boolean).pop());
    await run('gh', ['repo', 'clone', spec, dest]);
    return openRepo(dest);
  },

  spawn: o => spawnInstance({ worktree: o.worktree, model: o.model, effort: o.effort, prompt: o.prompt, level: o.level, autoMerge: !!o.autoMerge, kind: o.kind }),
  // What closing would do to the instance's worktree, for the dialog that asks first.
  async closeInfo(id) {
    const inst = instances.get(id);
    const [row] = inst && inst.wt ? await worktreeRows(inst.root, inst.wt).catch(() => []) : [];
    return { worktree: row ? { ...row, shared: sessionsIn(inst.wt, inst.pid).length > 0 } : null };
  },
  close: closeInstance,
  worktrees: () => worktreeRows(repo.path),
  removeWorktree(dir, force) {
    const base = path.join(repo.path, '.claude', 'worktrees');
    if (!lib.isInside(base, dir) || lib.samePath(base, dir)) throw new Error('Not a worktree of this folder.');
    return removeWorktree(repo.path, dir, force === true);
  },
  resume(id) {
    const r = interrupted.find(x => x.id === id);
    if (!r) return;
    // Its conversation, if Claude Code has one on disk; otherwise it starts again the way it was started.
    const resume = r.sessionId && r.transcript && fs.existsSync(r.transcript) ? r.sessionId : undefined;
    const dir = resume && r.worktree ? path.join(r.root, '.claude', 'worktrees', r.worktree) : r.root;
    if (!fs.existsSync(dir)) throw new Error(`${dir} no longer exists.`);
    const started = spawnInstance({ ...r, cwd: r.root, resume });
    interrupted = interrupted.filter(x => x !== r);
    saveSessions(); push();
    return started;
  },
  forget(id) { interrupted = interrupted.filter(r => r.id !== id); saveSessions(); push(); },
  setInstance(id, patch) {
    const inst = instances.get(id);
    if (!inst) return;
    if (['manual', 'timed', 'auto'].includes(patch.level)) inst.level = patch.level;
    if (Object.hasOwn(lib.WEIGHTS, patch.weight)) inst.weight = patch.weight;
    if (typeof patch.group === 'string') inst.group = lib.groupName(patch.group);   // '' takes it out of its group
    if (typeof patch.autoMerge === 'boolean') {
      inst.autoMerge = patch.autoMerge;
      // Ticked after the agent already went idle: its work is finished, so merge now.
      if (inst.autoMerge && (sessionOf(inst) || {}).status === 'idle') checkPr(inst).then(push);
    }
    push();
  },
  answer(id, requestId, choice) {
    const inst = instances.get(id);
    const p = inst && inst.pending.find(x => x.view.id === requestId);
    if (p) p.settle(choice);
  },
  env(id) {
    const inst = instances.get(id);
    if (!inst) return [];
    // What the process was started with, plus the `env` blocks Claude Code applies from settings files.
    const fromSettings = Object.assign({}, ...[path.join(configDir(), 'settings.json'), path.join(inst.cwd, '.claude', 'settings.json'), path.join(inst.cwd, '.claude', 'settings.local.json')].map(f => readJson(f).env || {}));
    return Object.entries({ ...inst.env, ...fromSettings }).map(([name, value]) => ({ name, value: String(value), source: name in fromSettings ? 'settings' : 'process' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async issues(state) {
    const out = [];
    let cursor;
    // ponytail: stops at 1000 issues (10 pages of 100); add server-side search if a repo outgrows that.
    for (let page = 0; page < 10; page++) {
      const args = ['api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}', '-f', `query=${lib.issuesQuery(state)}`];
      if (cursor) args.push('-f', `cursor=${cursor}`);
      const data = JSON.parse(await run('gh', args, repo.path)).data.repository.issues;
      out.push(...data.nodes.map(lib.mapIssue));
      if (!data.pageInfo.hasNextPage) break;
      cursor = data.pageInfo.endCursor;
    }
    return out;
  },
  dispatch({ issues, model, effort, level, autoMerge, parallel, autonomy, template, group }) {
    if (!claudeBin) throw new Error('Claude Code CLI (claude) was not found on PATH.');
    lib.issuePrompt(template, issues[0]);   // a prompt that cannot be filled in is refused here, before anything is queued
    const pooled = issues.length > 1;
    group = lib.groupName(group);
    if (pooled && !group) throw new Error('Issues started together are a group: give it a name.');
    if (pooled) poolLimit = Math.min(4, Math.max(1, Number(parallel) || 1));
    else autonomy = autoMerge ? 'full' : undefined;
    for (const is of issues) {
      if (queue.some(j => j.number === is.number)) continue;
      queue.push({ number: is.number, title: is.title, url: is.url, root: repo.path, model, effort, level, autonomy, template, pooled, group, autoMerge: autonomy === 'full', waitingOn: [] });
    }
    pump();
  },
  unqueue(number) { const i = queue.findIndex(j => j.number === number); if (i >= 0) queue.splice(i, 1); push(); },
  // The open pull requests of the folder's repository, drafts included.
  // ponytail: the first 200. Page through them with `gh api graphql`, as `issues` does, if a repo outgrows that.
  async prs() {
    return JSON.parse(await run('gh', ['pr', 'list', '--state', 'open', '--limit', '200', '--json', lib.PR_FIELDS], repo.path)).map(lib.mapPr);
  },

  // Paths starting with "~/" are in the home config folder, the rest in the open folder.
  configList: () => ({ ...lib.scanConfig(repo.path), home: { dir: configDir(), files: lib.scanHome(configDir()).map(f => `~/${f}`) } }),
  configRead: rel => fs.readFileSync(configFile(rel), 'utf8'),
  configWrite(rel, text) {
    fs.writeFileSync(configFile(rel), text);
    repo.setup = lib.scanConfig(repo.path).summary; push();
  },
  async gitChanges() {
    if (!repo.isGit) return null;
    const out = await run('git', ['status', '--porcelain', '-uall', '--', '.claude', '.github', ...lib.ROOT_FILES], repo.path);
    const files = out.split('\n').filter(Boolean).map(l => l.slice(3).split(' -> ').pop().replace(/^"|"$/g, '')).filter(f => !f.startsWith('.claude/worktrees/'));
    if (!files.length) return null;
    return { files, branch: (await run('git', ['branch', '--show-current'], repo.path)).trim(), hasRemote: !!(await run('git', ['remote'], repo.path)).trim() };
  },
  async commit(files, message, pushToo) {
    files.forEach(f => lib.configPath(repo.path, f));
    if (!String(message).trim()) throw new Error('A commit message is required.');
    await run('git', ['add', '--', ...files], repo.path);
    await run('git', ['commit', '-m', message, '--', ...files], repo.path);
    if (pushToo) await run('git', ['push', '-u', 'origin', 'HEAD'], repo.path);
  },

  setSettings(patch) {
    if (typeof patch.template === 'string' && repo) {   // the default prompt for issue worktrees, kept per folder
      const template = patch.template.trim();
      if (template) lib.issuePrompt(template, { number: 1 });   // refused here if it cannot be filled in
      if (template) saved.templates[repo.path] = template; else delete saved.templates[repo.path];   // cleared: the built-in one again
      repo.template = template || lib.defaultTemplate(repo.path);
    }
    if (['squash', 'merge', 'rebase'].includes(patch.mergeMethod)) saved.settings.mergeMethod = patch.mergeMethod;
    if (patch.timedMinutes) saved.settings.timedMinutes = Math.min(60, Math.max(1, Number(patch.timedMinutes) || 5));
    if (patch.cpuCeiling) saved.settings.cpuCeiling = Math.min(100, Math.max(5, Math.round(Number(patch.cpuCeiling)) || 100));
    if (typeof patch.cpuShare === 'boolean') saved.settings.cpuShare = patch.cpuShare;
    balanceCpu();
    save(); push();
  },
  clipRead: () => clipboard.readText(),
  clipWrite: text => clipboard.writeText(String(text)),
  openUrl: url => { if (/^https:\/\//.test(url)) shell.openExternal(url); },
};

ipcMain.handle('rpc', (_e, name, ...args) => {
  if (!Object.hasOwn(rpc, name)) throw new Error(`Unknown call: ${name}`);
  return rpc[name](...args);
});
ipcMain.on('pty-write', (_e, id, data) => { const i = instances.get(id); if (i && !i.exited) i.proc.write(data); });
ipcMain.on('pty-resize', (_e, id, cols, rows) => { const i = instances.get(id); if (i && !i.exited) { try { i.proc.resize(cols, rows); } catch { /* exited meanwhile */ } } });

// ---------- window ----------

function createWindow() {
  // The default menu's accelerators (Ctrl+R, Ctrl+W, Ctrl+C...) would swallow keys meant for the terminals.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1500, height: 950, backgroundColor: '#0b0e14', title: 'claudinho',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('close', e => {
    const live = [...instances.values()].filter(i => !i.exited).length;
    if (!live) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Stop them and quit', 'Cancel'], defaultId: 1, cancelId: 1,
      message: `${live} Claude Code instance${live > 1 ? 's are' : ' is'} still running.`,
      detail: 'Quitting stops them. The next start offers to resume each one where it left off.',
    });
    if (choice === 1) e.preventDefault();
  });
}

app.whenReady().then(async () => {
  claudeBin = findClaude();
  await startHookServer();
  createWindow();
  if (claudeBin) run(claudeBin, ['auth', 'status']).then(out => { account = JSON.parse(out); push(); }, () => {});
  const arg = process.argv.slice(app.isPackaged ? 1 : 2).find(a => !a.startsWith('-'));
  const start = arg && fs.existsSync(arg) ? path.resolve(arg) : saved.repoPath;
  if (start && fs.existsSync(start)) await openRepo(start);
  tick();
});

app.on('window-all-closed', () => {
  saveSessions();   // before anything is stopped: what is open now is what the next start offers to resume
  if (sampler) sampler.kill();
  cpu.shutdown();   // lifts every limit; nothing stays paused or capped behind us
  for (const inst of instances.values()) if (!inst.exited) { try { inst.proc.kill(); } catch { /* already gone */ } }
  save();
  fs.rmSync(path.join(dataDir, 'instances'), { recursive: true, force: true });
  app.quit();
});
