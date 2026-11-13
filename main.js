// Electron main process: the window, repo/GitHub commands, the Claude Code instances (PTYs) and the hook server.
const { app, BrowserWindow, Menu, Tray, ipcMain, dialog, shell, clipboard, nativeImage, net } = require('electron');
const { execFile, execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const pty = require('node-pty');
const { autoUpdater } = require('electron-updater');
const lib = require('./lib');
const cpu = require('./cpu');
const boxes = require('./containers');

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

const run = (cmd, args, cwd, timeout) => new Promise((resolve, reject) =>
  execFile(cmd, args, { cwd, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
    err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout)));
// The same for a command that reads what it works on from its input.
const runInput = (cmd, args, input, opts) => new Promise((resolve, reject) => {
  const child = execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout, stderr) =>
    err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout));
  child.stdin.on('error', () => { /* it ended before reading: execFile reports why */ });
  child.stdin.end(input);
});

// Where a program is: `claude`, and `docker` for the sessions that run in containers.
function findExe(name) {
  try {
    const found = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
    // ponytail: node-pty starts real executables only, so on Windows this needs claude.exe (the native
    // install); an npm .cmd shim is not supported. Add a cmd.exe wrapper with argument escaping if needed.
    return process.platform === 'win32' ? found.find(f => /\.exe$/i.test(f)) : found[0];
  } catch { return undefined; }
}

// ---------- state ----------

const dataDir = app.getPath('userData');
const stateFile = path.join(dataDir, 'state.json');
// settings.mode: 'worktree' or 'docker', where sessions are started (see spawnInstance). Not there until the
// owner has picked one, which the window asks for.
let saved = { repoPath: null, usage: null, templates: {}, sessions: [], settings: { mergeMethod: 'squash', timedMinutes: 5, cpuCeiling: 100, cpuShare: false, boxPorts: '3000, 5173, 8000, 8080', boxMemoryGb: lib.BOX_MEMORY_GB } };
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

let win, claudeBin, dockerBin, hookPort;
const hookToken = crypto.randomBytes(16).toString('hex');
let repo = null;          // the folder the app is pointed at
let account = null;       // `claude auth status`
let sessions = [];        // `claude agents --json`: every live Claude Code session on this machine
const instances = new Map();
// What was open when the app last stopped, until each is resumed or forgotten (see "sessions on disk").
let interrupted = Array.isArray(saved.sessions) ? saved.sessions : [];
const queue = [];         // dispatched issues waiting for a pool slot or for their blockers
let poolLimit = 1;
const notifications = []; // what the bell lists, newest last (see notify)
let tray = null;          // the tray icon; the window draws its picture (see rpc.tray)
const claudeCode = { version: null, latest: null, updating: false };   // Claude Code itself (see checkClaude)
const CORES = os.cpus().length;
const procUsage = new Map();   // root pid -> CPU and memory of that session's process tree

const send = (channel, ...args) => { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args); };
let pushTimer;
const push = () => { clearTimeout(pushTimer); pushTimer = setTimeout(() => send('state', snapshot()), 30); };
// A session in a container is not on that list: its own container is asked (see pollBox).
const sessionOf = inst => (inst.box ? inst.boxSession : sessions.find(s => s.pid === inst.pid));
// Where on this computer `gh` is run for a session. One in a container has no folder here: its `cwd` is a path
// inside the container, and GitHub is asked from the folder it was cloned from.
const hostDir = inst => (inst.box ? inst.root : inst.cwd);
// A card's title: for a session in a container its own name, else the worktree's or the folder's (lib.labelFor).
const labelOf = (inst, worktrees) => (inst.box ? { worktree: null, label: inst.name } : lib.labelFor(inst.root, inst.cwd, worktrees));
const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };

// Sessions started outside the app (another terminal, the desktop app) inside this repo: visible, not attachable.
function externalSessions() {
  if (!repo) return [];
  const mine = new Set([...instances.values()].map(i => i.pid));
  return sessions.filter(s => !mine.has(s.pid) && s.cwd && (lib.isInside(repo.path, s.cwd) || repo.worktrees.some(w => lib.isInside(w.path, s.cwd))));
}

// Where a session's issue is on GitHub. A session sent after an issue keeps the address GitHub gave for it.
// One on record from 0.6.0 or older has the number alone: its address is made from the open folder's
// repository, and only while that is the folder the session belongs to.
const issueLink = x => (!x.issue ? null : x.issueUrl || (repo && repo.github && lib.samePath(repo.path, x.root) ? lib.issueUrl(repo.github, x.issue) : null));

function snapshot() {
  const worktrees = repo ? repo.worktrees : [];
  return {
    version: app.getVersion(), claudeFound: !!claudeBin, repo, account, usage: saved.usage, settings: saved.settings, cores: CORES,
    cpuMechanism: cpu.mechanism, cpuError: cpu.error, docker: { ...dock, boxCpus: lib.BOX_CPUS, boxGb: saved.settings.boxMemoryGb, recipe: boxes.recipe },
    totals: totals(),
    notifications: notifications.slice(-100),
    // latest: only when it is newer than what is installed
    claude: { version: claudeCode.version, latest: lib.newerVersion(claudeCode.latest, claudeCode.version) ? claudeCode.latest : null, updating: claudeCode.updating },
    update: selfUpdate.latest ? { ...selfUpdate } : null,   // a newer release of the app itself
    // Not the ones whose conversation is live again somewhere (resumed by hand in a terminal, say).
    resumable: interrupted.filter(r => !sessions.some(s => s.sessionId && s.sessionId === r.sessionId)).map(r => ({
      id: r.id, label: r.box ? r.name : r.worktree || path.basename(r.root), worktree: r.worktree, box: !!r.box,
      dir: r.box ? r.box.name || 'a container' : r.worktree ? path.join(r.root, '.claude', 'worktrees', r.worktree) : r.root,
      issue: r.issue, issueUrl: issueLink(r), model: r.model, effort: r.effort, level: r.level, autonomy: lib.autonomyOf(r), group: r.group || null, savedAt: r.savedAt,
      // A conversation in a container is in a volume, which is not looked into from here: startBox does.
      conversation: r.box ? !!r.sessionId : !!r.transcript && fs.existsSync(r.transcript),
    })),
    instances: [...instances.values()].map(i => {
      const s = sessionOf(i) || {};
      return {
        id: i.id, kind: i.kind, issue: i.issue, issueUrl: issueLink(i), model: i.model, effort: i.effort, level: i.level, autonomy: i.autonomy, untold: untold(i),
        startedAt: i.startedAt, exited: i.exited, exitCode: i.exitCode, cwd: i.cwd, ...labelOf(i, worktrees),
        // Its container: the number, and the ports of it that have a port on this computer.
        box: i.box && { name: i.box.name, n: boxes.numberOf(i.box.name), ports: i.ports || [] },
        status: i.status, session: { status: s.status || s.state, waitingFor: s.waitingFor, name: s.name },
        pending: i.pending.map(p => p.view), pr: i.pr, merge: i.merge, procs: i.exited ? undefined : i.box ? i.usage : procUsage.get(i.pid),
        weight: i.weight, limit: i.box ? lib.BOX_CPUS / CORES : i.limited && !i.exited ? cpu.limit(i.id) : 1, group: i.group, starting: i.starting && !i.exited,
        done: i.done && !i.exited, background: i.exited ? null : i.background, auditRev: i.auditRev,
      };
    }),
    external: externalSessions().map(s => ({
      id: s.id || String(s.pid), name: s.name, kind: s.kind, cwd: s.cwd, startedAt: s.startedAt, status: s.status || s.state,
      waitingFor: s.waitingFor, procs: procUsage.get(s.pid), ...lib.labelFor(repo.path, s.cwd, worktrees),
    })),
    queue: queue.map(j => ({ number: j.number, title: j.title, waitingOn: j.waitingOn, group: j.group, box: !!j.box })),
  };
}

// ---------- instances ----------

function userStatusLine() { return readJson(path.join(configDir(), 'settings.json')).statusLine; }

// resume + transcript: continue that conversation instead of starting one (see "sessions on disk").
// group: the name of the group it belongs to, if any (see lib.groupName).
// audit: the input requests on record for a session that is being resumed.
// autonomy: who merges its pull request (see lib.AUTONOMY). autoMerge: what an older record has in its place.
// mayMerge: the session has been told that it may merge its pull request itself (see mergeNote).
// issue, issueUrl: the number of the issue it was sent after, and that issue's page on GitHub.
// box: the session works in a Docker container instead of a worktree (see containers.js). `true` asks for a
// new one, which `worktree` then names, as it names its branch. { name, key, work } is a container that
// exists: of a session that is resumed, or one that was kept when its card was closed.
function spawnInstance({ cwd, worktree, box = null, resume, transcript, model, effort, prompt, level = 'manual', autonomy, autoMerge, mayMerge = false, kind = 'instance', issue = null, issueUrl = null, pooled = false, weight = 'normal', group = null, audit = [] }) {
  if (!claudeBin) throw new Error('Claude Code CLI (claude) was not found on PATH.');
  const root = cwd || repo.path;
  const id = crypto.randomBytes(4).toString('hex');
  if (worktree === true) worktree = `${box ? 'box' : 'wt'}-${id}`;
  if (box === true) box = { name: null, key: id, work: lib.boxWork(path.basename(root)) };
  const wt = worktree && !box ? path.join(root, '.claude', 'worktrees', worktree) : null;   // where `claude -w` puts it
  // A container sees its instance's folder as /claudinho. The container outlives the app, so its folder goes
  // by a key that stays when the session is resumed, and is kept for as long as the container is.
  const dir = box ? path.join(dataDir, 'boxes', box.key) : path.join(dataDir, 'instances', id);
  fs.mkdirSync(dir, { recursive: true });
  const settingsFile = path.join(dir, 'settings.json'), statusFile = path.join(dir, 'status.json');
  fs.rmSync(statusFile, { force: true });   // in a container's folder: what the session before this one left
  fs.writeFileSync(settingsFile, JSON.stringify(lib.instanceSettings(box
    ? { statusFile: '/claudinho/status.json', hookUrl: `http://host.docker.internal:${hookPort}/${hookToken}/${id}`, userStatusLine: userStatusLine(), curl: true }
    : { statusFile, hookUrl: `http://127.0.0.1:${hookPort}/${hookToken}/${id}`, userStatusLine: userStatusLine() })));
  const env = lib.childEnv(process.env);
  const limits = { ceiling: saved.settings.cpuCeiling / 100, weight: lib.WEIGHTS[weight] };
  let proc = null, limited = false;
  if (!box) {
    const [file, args] = cpu.command(id, claudeBin, lib.claudeArgs({ settingsFile, model, effort, worktree, prompt, resume }), limits);
    // A new session is taken into its worktree by `claude -w`; a resumed one is started inside it.
    proc = pty.spawn(file, args, { name: 'xterm-256color', cols: 110, rows: 30, cwd: resume && wt ? wt : root, env });
    // On Windows this puts the new process into its job before it can start anything of its own.
    limited = cpu.attach(id, proc.pid, limits);
  }
  const inst = {
    id, kind, issue, issueUrl, pooled, model, effort, level, autonomy: lib.autonomyOf({ autonomy, autoMerge }), mayMerge: !!mayMerge,
    root, wt, box, name: box ? worktree : null, prompt, proc, env, dir, statusFile, pid: proc && proc.pid, startedAt: Date.now(),
    cwd: box ? box.work : wt || root, sessionId: resume || null, transcript: transcript || null, group: lib.groupName(group),
    // A new worktree with a first prompt: until that prompt has gone in, the session is still running its
    // SessionStart hooks, where a repository sets a fresh worktree up (see onHook and pump). A new container
    // is starting from the moment it is asked for, which its card says and nothing waits for.
    starting: !!((wt || box) && prompt && !resume),
    // done: its last turn has ended with nothing it started still running, and no prompt has gone in since.
    // background: what was still running when its last turn ended (see onStop). audit: every input request (see onHook).
    done: false, background: null, audit: Array.isArray(audit) ? audit : [], auditRev: 0,
    status: null, pending: [], pr: null, merge: null, finished: false, exited: false, weight, limited,
    // Auto-merge (see mergeWhenReady): what the session wrote last, the follow-ups it got since the last prompt
    // of the owner's, that prompt, and the review that is under way.
    said: null, asked: [], lastPrompt: null, reviewing: null,
  };
  instances.set(id, inst);
  if (proc) attach(inst, proc); else startBox(inst, { model, effort, prompt, resume });
  if (resume) lookForPr(inst);   // its branch may have had a pull request for days
  saveSessions(); push();
  syncSampler();
  return id;
}

// An instance's terminal: what it prints goes to its card, and when it ends the instance has ended.
function attach(inst, proc) {
  inst.proc = proc; inst.pid = proc.pid;
  proc.onData(d => send('pty-data', inst.id, d));
  proc.onExit(({ exitCode }) => {
    inst.exited = true; inst.exitCode = exitCode; inst.exitedAt = Date.now();
    inst.pending.slice().forEach(p => p.settle('terminal'));
    cpu.detach(inst.id);
    push(); pump();
  });
}

// ---------- sessions in containers ----------

// Docker, as the window shows it: whether it answers, and how many containers there may be and are.
const dock = { ok: null, error: null, limit: 0, used: 0, building: null, at: 0 };
async function checkDocker() {
  dock.at = Date.now();
  try { Object.assign(dock, await boxes.info(), { ok: true, error: null }); dock.used = (await boxes.list()).length; }
  catch (e) { Object.assign(dock, { ok: false, error: dockerBin ? e.message.split('\n')[0] : 'Docker was not found on PATH.' }); }
  push();
}
// Whether a container is still to be had: of those Docker may have, less the ones there are, less the sessions
// that have asked for one and not got it yet, since several are started side by side. Without an answer from
// Docker: no.
const freeBox = () => Promise.all([boxes.info(), boxes.list()])
  .then(([d, rows]) => rows.length + [...instances.values()].filter(i => i.box && !i.box.name && !i.exited).length < d.limit, () => false);

// One container is made at a time, so that no two sessions take the same number.
let boxLine = Promise.resolve();
function makeBox(inst, image, memory) {
  const made = boxLine.then(async () => {
    const { limit } = await boxes.info();
    const n = lib.freeSlot((await boxes.list()).map(r => r.n), limit);
    if (!n) throw new Error(`All ${limit} containers are taken. Close a session, or remove a container that was kept: they are on the Containers tab.`);
    return boxes.create({ n, image, root: inst.root, name: inst.name, work: inst.box.work, key: inst.box.key, dir: inst.dir, ports: lib.portList(saved.settings.boxPorts), memory, memoryGb: saved.settings.boxMemoryGb });
  });
  boxLine = made.catch(() => {});
  return made;
}

// A session in a container. The container is made and filled, or started again where the session has one
// already, and then Claude Code is started in it, in the card's terminal. Until then the card says what is
// going on, and why it failed if it did.
async function startBox(inst, { model, effort, prompt, resume }) {
  const b = inst.box, id = inst.id;
  const say = text => send('pty-data', id, `\x1b[2m${text}\x1b[0m\r\n`);
  const open = () => instances.get(id) === inst;   // its card has not been closed meanwhile
  const term = argv => pty.spawn(dockerBin, argv, { name: 'xterm-256color', cols: inst.cols || 110, rows: inst.rows || 30, cwd: inst.root, env: { ...inst.env, DOCKER_CLI_HINTS: 'false' } });
  // Started again from its first prompt, a session knows of merging what that prompt says (see rpc.resume).
  const again = () => { resume = undefined; inst.sessionId = null; inst.mayMerge = lib.toldToMerge(prompt); inst.starting = !!prompt; };
  try {
    if (!dockerBin) throw new Error('Docker was not found on PATH. Sessions in containers need Docker Desktop.');
    if (b.name && !await boxes.exists(b.name)) {
      say(`${b.name} is gone, and what was in it. This session starts again in a new container.`);
      b.name = null; again();
    }
    if (b.name) {
      await boxes.start(b.name);
      await boxes.ready(b.name);
      // The terminal on this side ending does not end Claude Code inside (measured with Docker 29.9): after a
      // crash of the app the session before this one may still be running there.
      await boxes.inBox(b.name, ['pkill', '-x', 'claude']).catch(() => { /* none was */ });
      if (resume && !await boxes.inBox(b.name, ['test', '-f', inst.transcript || '/nowhere']).then(() => true, () => false)) again();   // Claude Code had saved no conversation yet
    } else {
      const github = lib.parseGitHub(await git(['remote', 'get-url', 'origin'], inst.root).catch(() => ''));
      if (!github) throw new Error('This folder has no GitHub remote. A session in a container works on a clone of the folder, and its work leaves the container by `git push`.');
      say('Getting a container ready…');
      // Asked for at every start: it is there already unless the folder's tools, the recipe or Claude Code changed.
      const image = await boxes.image(claudeCode.version || 'latest', inst.root, line => { dock.building = line; say(line); push(); }).finally(() => { dock.building = null; push(); });
      inst.fresh = true;   // until its session has started, nothing in it is worth keeping (see closeBox)
      // The repository's memory on this computer, which is that of its main checkout whichever folder of it is
      // open here. The container gets it where Claude Code looks inside.
      const main = lib.parseWorktrees(await git(['worktree', 'list', '--porcelain'], inst.root).catch(() => '')).find(w => w.main);
      const memory = lib.memoryDir(configDir(), main ? main.path : inst.root);
      fs.mkdirSync(memory, { recursive: true });
      b.name = await makeBox(inst, image, memory);
      if (!open()) { await boxes.remove(b.name).catch(() => {}); return; }   // closed before it had a container to close
      saveSessions(); checkDocker();
      await boxes.ready(b.name);
      if (!await boxes.signedIn(b.name)) {
        say('GitHub has no login in the containers yet. Sign in here, once for all of them: press Enter, open the address it then shows in your browser, and type the code in there.');
        await new Promise(resolve => {
          inst.proc = term(boxes.terminal(b.name, null, ['gh', 'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web']));
          inst.proc.onData(d => send('pty-data', id, d));
          inst.proc.onExit(() => { inst.proc = null; resolve(); });
        });
      }
      const identity = [];
      for (const key of ['user.name', 'user.email']) { const v = await git(['config', key], inst.root).catch(() => ''); if (v) identity.push([key, v]); }
      await boxes.fill(b.name, { root: inst.root, work: b.work, branch: inst.name, origin: `https://github.com/${github.owner}/${github.name}.git`, identity, configDir: configDir(), say });
    }
    inst.ports = await boxes.ports(b.name);
    if (!open()) return;
    inst.fresh = false;
    attach(inst, term(boxes.terminal(b.name, b.work, ['claude', ...lib.claudeArgs({ settingsFile: '/claudinho/settings.json', model, effort, prompt, resume, note: lib.boxNote(b.work) })])));
    push();
  } catch (e) {
    if (!open()) return;   // closed while it was being set up: closeBox has dealt with the container
    send('pty-data', id, `\x1b[31m${e.message}\x1b[0m\r\n`);
    inst.exited = true; inst.exitCode = 1; inst.exitedAt = Date.now(); inst.starting = false;
    push(); pump();
  }
}

// A session in a container is not on this computer's list of sessions: its own container is asked, and at the
// same time which branch its clone is on, for the pull request that goes with it.
async function pollBox(inst) {
  let out;
  try { out = await boxes.inBox(inst.box.name, ['sh', '-c', 'git branch --show-current 2>/dev/null; claude agents --json'], { cwd: inst.box.work, timeout: 10000 }); } catch { return; }   // keep what was read last
  const at = out.indexOf('[');   // a branch's name cannot hold one
  let list = [];
  try { list = JSON.parse(out.slice(at)); } catch { return; }
  inst.boxSession = list.find(s => s.sessionId && s.sessionId === inst.sessionId) || list.find(s => s.cwd === inst.box.work) || list[0] || null;
  const branch = out.slice(0, at).trim() || null;
  if (branch !== inst.branch) { inst.branch = branch; inst.prLooked = 0; lookForPr(inst); }
}

// CPU and memory of the containers, for the cards. `docker stats` takes two seconds to answer.
let sampling = false;
async function sampleBoxes() {
  const live = [...instances.values()].filter(i => i.box && i.pid && !i.exited);
  if (sampling || !live.length) return;
  sampling = true;
  try {
    const stats = await boxes.stats(live.map(i => i.box.name));
    for (const i of live) {
      const u = stats.get(i.box.name);
      if (u) i.usage = { cpu: u.cpus / CORES, mem: u.mem, memLimit: u.memLimit, count: u.count, top: [], more: 0, hist: [...((i.usage || {}).hist || []), u.cpus / CORES].slice(-20) };
    }
    push();
  } catch { /* Docker did not answer: the cards keep the last reading */ }
  sampling = false;
}

// The folder under the app's data that a container sees as /claudinho. The key is read from the container's
// label, which is not the app's own word: only what the app writes there is taken for a folder's name.
const boxDir = key => (/^[0-9a-f]{8}$/.test(key || '') ? path.join(dataDir, 'boxes', key) : null);
// What a container's clone holds that is nowhere else. r: a row of boxes.list(). Nothing is known of a
// container that is stopped and has no record, or that this app did not make.
async function boxHeld(r) {
  if (r.running && r.work) return boxes.state(r.box, r.work);
  const { branch, changed, unique, last, error } = boxDir(r.key) ? readJson(path.join(boxDir(r.key), 'kept.json')) : {};
  return { branch, changed, unique, last, error };
}

// Closing a session in a container, with `remove` as for a worktree. A container that is not removed is stopped:
// it keeps what is in it, runs nothing, and is on the Containers tab with what it held when it was stopped.
// Returns { removed, name, box }, or { kept: row } when removing it was not safe.
async function closeBox(inst, remove) {
  const b = inst.box;
  if (!b.name) return;   // not made yet: startBox removes it as soon as it is
  const gone = () => { fs.rmSync(inst.dir, { recursive: true, force: true }); return { removed: true, name: inst.name, box: b.name }; };
  if (inst.fresh) { await boxes.remove(b.name); return gone(); }   // still being filled: nothing of the session's is in it
  const row = { name: inst.name, box: b.name, ...await boxes.state(b.name, b.work) };
  if (remove === 'force' || (remove && !row.error && !row.changed && !row.unique)) { await boxes.remove(b.name); return gone(); }
  await boxes.stop([b.name]);
  fs.writeFileSync(path.join(inst.dir, 'kept.json'), JSON.stringify(row));
  return remove ? { kept: row } : undefined;
}

// remove: 'safe' also removes the instance's worktree if nothing in it would be lost; 'force' removes it
// whatever is in it. Returns what became of the worktree (see removeWorktree).
async function closeInstance(id, remove) {
  const inst = instances.get(id);
  if (!inst) return;
  instances.delete(id);
  const gone = inst.exited || !inst.proc ? null : new Promise(resolve => { inst.proc.onExit(resolve); setTimeout(resolve, 5000); });
  if (gone) { try { inst.proc.kill(); } catch { /* already gone */ } }
  if (inst.box) { saveSessions(); push(); return closeBox(inst, remove).finally(() => { checkDocker(); pump(); disk.at = 0; }); }   // a queued issue may be waiting for its container
  // With its worktree going too, nothing the instance started may stay behind in it (see cpu.stop). What serves
  // the whole machine is left running all the same (see lib.sparedPids), and named should it hold the folder.
  const procs = lastProcs || new Map();
  const left = remove && inst.wt ? cpu.stop(id, lib.sparedPids(procs)) : [];
  const spared = [...new Set(left.filter(pid => !left.includes(procs.get(pid).ppid)).map(pid => procs.get(pid).name.replace(/\.exe$/i, '')))];
  fs.rmSync(inst.dir, { recursive: true, force: true });
  cpu.detach(id);
  saveSessions(); push(); pump();
  if (!remove || !inst.wt) return;
  await gone;   // Windows does not let go of a folder while a process still sits in it
  return removeWorktree(inst.root, inst.wt, remove === 'force', inst.pid).catch(e => {
    if (e.stuck && spared.length) e.message += ` Left running, as other sessions may be using it: ${spared.join(', ')}. Started by this session, it may be what holds the folder.`;
    throw e;
  });
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
    branch: inst.box ? inst.branch : st.worktree && st.worktree.branch,
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
  await Promise.all([...instances.values()].filter(i => i.box && i.pid && !i.exited).map(pollBox));
  for (const inst of instances.values()) if (!inst.exited) { readStatus(inst); dropAnswered(inst); }
  sampleBoxes();
  if (saved.settings.mode === 'docker' && Date.now() - dock.at > 15000) checkDocker();
  if (Date.now() - disk.at > 10 * 60000) measureDisk();
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
  id: i.id, root: i.root, worktree: i.wt && path.basename(i.wt), box: i.box, name: i.name, kind: i.kind, issue: i.issue, issueUrl: i.issueUrl, pooled: i.pooled, model: i.model, effort: i.effort,
  level: i.level, autonomy: i.autonomy, mayMerge: i.mayMerge, weight: i.weight, group: i.group, prompt: i.prompt, sessionId: i.sessionId, transcript: i.transcript, savedAt: Date.now(),
  audit: i.audit,
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
  const all = [...[...instances.values()].filter(i => !i.exited && !i.box), ...sessions];   // a container's paths are not this computer's
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
  disk.at = 0;   // measured again with the next look
  if (stuck) throw Object.assign(new Error(`Could not delete ${dir}: a program still has files open in it (${stuck.code}). Close that program, then remove the folder from the Worktrees tab.`), { stuck: true });
  return { removed: true, name: row.name, branch: row.branch };
}

// ---------- CPU and memory of each session's process tree ----------

let sampler = null, samplerFailed = false, lastProcs = null, lastSampleAt = 0;

function onSample(lines) {
  const now = Date.now(), procs = lib.parseProcs(lines);
  const seconds = lastProcs ? (now - lastSampleAt) / 1000 : 0;
  const mine = new Map([...instances.values()].filter(i => !i.exited && !i.box).map(i => [i.pid, i.id]));   // a container is measured by Docker (see sampleBoxes)
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
  cpu.balance(cpuSettings(), new Map([...instances.values()].filter(i => !i.exited && !i.box).map(i => [i.id, lib.WEIGHTS[i.weight]])), listing === true);
}
setInterval(balanceCpu, 1000);

// The lister (see lib.samplerCommand) runs only while there is a session to measure.
function syncSampler() {
  const wanted = [...instances.values()].some(i => !i.exited && !i.box) || externalSessions().length > 0;
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

// ---------- what all of it takes: the three figures in the bar ----------

// CPU and memory are added up from what the cards show: every instance of the app with what it started, on
// this computer or in its container. Sessions started outside the app are not the app's and are left out.
function totals() {
  const sum = { cpu: 0, mem: 0, boxCpu: 0, boxMem: 0, dockerMem: dock.mem || 0, disk: { boxes: disk.boxes, worktrees: disk.worktrees, capped: disk.capped, at: disk.measured } };
  for (const i of instances.values()) {
    const u = !i.exited && (i.box ? i.usage : procUsage.get(i.pid));
    if (!u) continue;
    sum.cpu += u.cpu; sum.mem += u.mem;
    if (i.box) { sum.boxCpu += u.cpu; sum.boxMem += u.mem; }
  }
  return sum;
}

// The size of a folder: every file in it, links not followed. It is counted by a helper process, the app's own
// binary run as plain Node, as cpu.js does: a worktree with its dependencies installed has a hundred thousand
// files, and going through them in this process would be in the way of every terminal it serves.
// ponytail: it gives up after 400,000 entries, saying so, and it is still a process that reads the disk for
// some seconds. Ask the system's own tool if that is too much.
const SIZER = `const fs = require('fs'), path = require('path');
let bytes = 0, seen = 0;
const stack = [process.argv[1]];
while (stack.length && seen < 400000) {
  const dir = stack.pop();
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
  for (const e of entries) {
    seen++;
    if (e.isDirectory()) stack.push(path.join(dir, e.name));
    else if (e.isFile()) { try { bytes += fs.statSync(path.join(dir, e.name)).size; } catch {} }
  }
}
console.log(JSON.stringify({ bytes, capped: stack.length > 0 }));`;
// Resolves to { bytes, capped }, or to null when the helper did not answer.
const dirSize = dir => new Promise(resolve => execFile(process.execPath, ['-e', SIZER, dir], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 300000, windowsHide: true },
  (_err, stdout) => { try { resolve(JSON.parse(stdout)); } catch { resolve(null); } }));

// Disk: what the open folder's worktrees hold, and what the containers, their volumes and their image take in
// Docker. Both take seconds to measure, so they are measured every ten minutes, and after a close.
// Docker is only asked where containers are chosen, or were at some time, which the folder the app keeps for
// them says: nobody else's Docker is touched. at: when it was last begun; measured: when it last came back.
const disk = { boxes: null, worktrees: null, capped: false, at: 0, measured: 0, busy: false };
const usedDocker = () => saved.settings.mode === 'docker' || fs.existsSync(path.join(dataDir, 'boxes'));
async function measureDisk() {
  if (disk.busy) return;
  disk.busy = true; disk.at = Date.now();
  try {
    const base = repo && path.join(repo.path, '.claude', 'worktrees');
    const [w, b] = await Promise.all([
      base && fs.existsSync(base) ? dirSize(base) : null,
      usedDocker() ? boxes.disk().catch(() => null) : null,
    ]);
    disk.worktrees = w ? w.bytes : null; disk.capped = !!(w && w.capped); disk.boxes = b; disk.measured = Date.now();
  } finally { disk.busy = false; push(); }
}

// ---------- hooks: input levels and "finished" ----------

function startHookServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const [, token, id, tail] = req.url.split('/');
      const inst = instances.get(id);
      if (req.method !== 'POST' || token !== hookToken || !inst) { res.writeHead(404); return res.end(); }
      // Every tool call of the session reports here when it has run (see lib.instanceSettings). Its body, which
      // holds the tool's whole result, is only worth reading while an input request is still without an answer,
      // or while the session is owed a note (see mergeNote).
      if (tail === 'after') lookForPr(inst);
      if (tail === 'after' && !inst.audit.some(e => !e.picked) && !untold(inst)) { req.resume(); res.writeHead(200); return res.end(); }
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

// With semi-auto the session itself merges, so it has to know. It reads it in its first prompt: an issue's, or
// the one from the start dialog (see `spawn`). One started without a prompt, or whose card was set to something
// else since, is told here: the note is the hook's answer to its next prompt or tool call, which Claude Code
// puts next to that prompt or tool result. Only a change of the session's own part is told, to semi-auto or
// away from it: with the two others the owner or the app merges, whatever the session knows.
// A note is not the owner's own words. Measured on Claude Code 2.1.322: a session in auto mode that had the
// sentence from a note only was refused the merge by auto mode ("Merge Without Review") and left its pull
// request open; with the sentence in its prompt it merged.
// ponytail: an idle session hears of it with its next prompt, and nothing confirms that a note arrived. Should
// a session have to act on it at once, answer its Stop hook with the note, as a follow-up is.
function untold(inst) { return inst.mayMerge !== (inst.autonomy === 'semi'); }
function mergeNote(inst, ev) {
  if (ev.agent_id || !untold(inst)) return;   // a subagent's tool call: the note would go to the subagent
  inst.mayMerge = inst.autonomy === 'semi';
  push();
  return { hookSpecificOutput: { hookEventName: ev.hook_event_name, additionalContext: lib.mergeNote(inst.autonomy, saved.settings.mergeMethod) } };
}

function onHook(inst, ev, res) {
  // An empty 200 means "no opinion": Claude Code carries on and shows its own dialog in the terminal.
  const reply = out => {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(out ? JSON.stringify(out) : '');
  };
  if (ev.cwd) inst.cwd = ev.cwd;
  if (ev.hook_event_name === 'Stop') {
    // With auto-merge on, the hook is answered only when the app knows what the end of this turn means. That
    // takes a review, and can take as long as the pull request's checks; the answer may be a follow-up, which
    // keeps the session going (see mergeWhenReady). Dropped unanswered, the owner has interrupted in the terminal.
    if (inst.autonomy !== 'full') reply();
    onStop(inst, ev, () => res.destroyed && !res.writableEnded).then(reply, () => reply());
    return;
  }
  if (ev.hook_event_name === 'UserPromptSubmit') {
    reply(mergeNote(inst, ev));
    inst.done = false; inst.background = null;   // a new turn begins; what still runs is reported again at its end
    // With a prompt of the owner's, what the app was settling starts over, and the review is told what the owner
    // asked for last. What wakes a session comes as a prompt too (see lib.ownPrompt) and changes neither.
    if (lib.ownPrompt(ev.prompt)) { inst.asked = []; inst.reviewing = null; inst.lastPrompt = ev.prompt || null; }
    // A request still open when a prompt goes into an idle session was dismissed with Escape, which ends a turn
    // without a Stop. In a busy session the prompt is a message sent along the way, and an approved tool may
    // still be running: that one is left open until its turn ends.
    if ((sessionOf(inst) || {}).status !== 'busy') closeAudit(inst);
    if (inst.starting) { inst.starting = false; pump(); }   // its start hooks are done: the next worktree may come
    push();
    return;
  }
  if (ev.hook_event_name === 'PostToolUse' || ev.hook_event_name === 'PostToolUseFailure') { reply(mergeNote(inst, ev)); answeredElsewhere(inst, ev); return; }
  const kind = lib.inputKind(ev);
  if (!kind) return reply();
  // On record from here on: what was asked, what was on offer and what the app would pick. What was picked,
  // and how, is added when the request is settled.
  const asked = lib.auditEntries(ev, kind).map(e => ({ ...e, at: Date.now(), picked: null, how: null }));
  inst.audit.push(...asked);
  inst.audit.splice(0, Math.max(0, inst.audit.length - 300));   // ponytail: the last 300 per session; write them to a file of their own if more are wanted
  inst.auditRev++;
  const what = asked.map(e => e.ask).join(' | ');
  if (inst.level === 'manual') {   // answered in the terminal: see answeredElsewhere
    notify('input', `needs input: ${what}`, inst);
    return reply();
  }
  if (inst.level === 'auto') {
    settleAudit(inst, asked, 'recommended', 'auto');
    notify('auto', `answered for itself: ${what} → ${asked.map(e => e.picked).join(' | ')}`, inst);
    return reply(lib.hookReply(ev, 'recommended'));
  }
  // timed: hold the request, show it on the card, take the recommended choice at the deadline.
  const ms = saved.settings.timedMinutes * 60000;
  notify('input', `needs input within ${saved.settings.timedMinutes} min: ${what}`, inst);
  const p = {
    view: {
      id: crypto.randomBytes(4).toString('hex'), kind, deadline: Date.now() + ms,
      ...(kind === 'question'
        ? { questions: ev.tool_input.questions.map(q => ({ question: q.question, multiSelect: !!q.multiSelect, options: q.options, recommended: lib.pickRecommended(q) })) }
        : { tool: ev.tool_name, detail: lib.permissionSummary(ev) }),
    },
    // how: 'manual' when the owner chose on the card, 'timed' when the wait ran out.
    settle(choice, how = 'manual') {
      clearTimeout(p.timer);
      inst.pending = inst.pending.filter(x => x !== p);
      if (choice !== 'terminal') settleAudit(inst, asked, choice, how);   // 'terminal': the answer is given there
      reply(lib.hookReply(ev, choice));
      push();
    },
  };
  p.timer = setTimeout(() => p.settle('recommended', 'timed'), ms);
  res.on('close', () => { if (!res.writableEnded) p.settle('terminal'); }); // Claude Code dropped the hook (Esc, exit)
  inst.pending.push(p);
  push();
}

function settleAudit(inst, entries, choice, how) {
  for (const e of entries) { e.picked = lib.auditPick(e, choice); e.how = how; }
  inst.auditRev++;
  push();
}

// An input request was answered where the app could not see it, in the terminal or on another device. No hook
// reports that answer. It shows in what the tool call did next: the result of a question holds the answers,
// and a tool that ran had been approved. (Measured on Claude Code 2.1.322; see the build history.)
function answeredElsewhere(inst, ev) {
  const open = inst.audit.filter(e => !e.picked);
  if (ev.tool_name === 'AskUserQuestion') {
    const answers = (ev.tool_response && ev.tool_response.answers) || {};
    const mine = open.filter(e => e.key === ev.tool_use_id && answers[e.ask] != null);
    if (mine.length) settleAudit(inst, mine, { answers }, 'manual');
    return;
  }
  const entry = open.find(e => e.key === lib.toolKey(ev));
  if (entry) settleAudit(inst, [entry], 'recommended', 'manual');
}

// The turn ended, or a new prompt went in, with a request still open: it was refused or dismissed. Claude Code
// reports neither, so this is read from the tool never having run.
function closeAudit(inst) {
  const open = inst.audit.filter(e => !e.picked);
  for (const e of open) { e.picked = e.kind === 'permission' ? 'deny' : 'dismissed'; e.how = 'manual'; }
  if (open.length) { inst.auditRev++; push(); }
}

// What the owner may want to know without watching every card: a session asks for input, has answered for
// itself, or is done; a newer Claude Code is out. Kept in memory, newest last.
function notify(kind, text, inst) {
  notifications.push({
    id: crypto.randomBytes(4).toString('hex'), at: Date.now(), kind, text, seen: false,
    inst: inst ? inst.id : null, label: inst ? labelOf(inst, repo ? repo.worktrees : []).label : null,
  });
  notifications.splice(0, Math.max(0, notifications.length - 200));
  push();
}

// The turn has ended. Resolves to what the Stop hook answers: nothing, or a follow-up for the session.
async function onStop(inst, ev, gone) {
  if (inst.kind === 'generator') {   // it may have written a skill, an agent, or the folder's mise.toml
    if (repo && lib.samePath(repo.path, inst.root)) repo.tools = readTools(repo.path);
    send('config-changed');
  }
  inst.said = ev.last_assistant_message || '';
  // A turn can end with what the session started still running: a shell in the background, a subagent, a
  // monitor. Then it has only paused. Claude Code wakes it when one of them ends or reports (that comes as a
  // prompt), and the turn that follows ends here again. Nothing is closed, judged or announced until the end
  // that leaves nothing running: a subagent may still be waiting for an answer of the owner's.
  // ponytail: this is only read at the end of a turn. Should something end without Claude Code waking the
  // session (not seen so far), it stays on the card until the session's next turn. While something runs,
  // `claude agents --json` reports the session as busy (measured on 2.1.322): idle there would be the sign to
  // go by, if that turns out to matter.
  inst.background = lib.backgroundWork(ev.background_tasks);
  if (inst.background) { await readPr(inst); push(); return; }   // the card still shows its pull request
  inst.pending.slice().forEach(p => p.settle('terminal'));   // the turn is over: nothing can still be waiting
  closeAudit(inst);
  const followUp = await checkPr(inst, gone);
  // Handed to the session as feedback from the hook: it carries on, and its next Stop comes back here.
  if (followUp) return { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: followUp } };
  inst.done = true;
  notify('done', inst.pr ? `is done: pull request #${inst.pr.number}${inst.merge ? ` (${inst.merge})` : ''}` : 'is done', inst);
  push(); pump();
}

// "Finished" = the agent ended its turn and its branch has an open PR. That frees its pool slot. With
// auto-merge on, what the session wrote decides what happens to the PR; a follow-up for it is returned.
async function checkPr(inst, gone, canAsk) {
  const pr = await readPr(inst);
  const action = lib.prAction(pr, inst.autonomy === 'full');
  if (action === 'review') return mergeWhenReady(inst, pr, gone, canAsk);
  if (action !== 'none') inst.finished = true;
}

// The pull request of the instance's branch as GitHub has it now, kept for the card: its number, whether it is
// still a draft, and whether it is open, merged or closed. Null when the branch has none.
async function readPr(inst) {
  let pr = null;
  // gh reads the branch from the folder. A session in a container has no folder here, so its branch is named.
  if (inst.box && !inst.branch) return null;   // its container has not said yet which one it is on
  try { pr = JSON.parse(await run('gh', ['pr', 'view', ...(inst.box ? [inst.branch] : []), '--json', 'number,state,url,isDraft,title,body,additions,deletions'], hostDir(inst), GH_WAIT)); } catch { /* no PR on this branch */ }
  if (!pr) return null;
  inst.pr = { number: pr.number, url: pr.url, draft: !!pr.isDraft, state: pr.state };
  if (pr.state === 'MERGED' && !/^merged/.test(inst.merge || '')) inst.merge = 'merged';
  return pr;
}

// A card has its pull request button once the pull request is known, and readPr is otherwise asked only when a
// turn ends or the Diff tab is opened. So a session that is resumed, which starts without a turn, is looked
// up when it starts, and one at work whenever a tool call of its has run: its pull request may just have been
// opened, turns before its turn ends.
// ponytail: one look in half a minute per session, and none once a pull request is known: what becomes of it later
// (merged or closed on GitHub) shows when the next turn ends. Look on a timer if a card must follow that too.
function lookForPr(inst) {
  if (inst.pr || inst.exited || Date.now() - (inst.prLooked || 0) < 30000) return;
  inst.prLooked = Date.now();
  readPr(inst).then(pr => { if (pr) push(); });
}

// What a session's folder holds beyond the default branch, for a branch that has no pull request yet: the
// commits on it, what is not committed, and the files git does not know yet. That is about what a pull request
// opened now would show, with the work that is not committed on top.
// Read with git's plumbing, which only reads. `git diff` is not used: where a file was only touched it brings
// the index up to date and writes it (diff.autoRefreshIndex; seen on git 2.49 with --no-optional-locks too),
// and a session can be in the middle of its own `git add` at that moment.
// ponytail: the default branch is the one origin's HEAD names, else main or master. Ask GitHub for it where a
// repository's default is called something else and its clone does not say so.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';   // git's name for a folder with nothing in it
const NEW_FILES = 200, NEW_FILE_BYTES = 1024 * 1024, NEW_BYTES = 8 * 1024 * 1024;   // unknown files: how many are listed, how large a one is read, and how much in all
// box: the folder is inside that container, and git and the files are read there.
async function localDiff(dir, box) {
  const git = args => (box ? boxes.inBox(box, ['git', '-c', 'core.quotePath=false', ...args], { cwd: dir, timeout: 30000 }) : run('git', ['-c', 'core.quotePath=false', ...args], dir, 30000));
  const has = ref => git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).then(() => true, () => false);
  if (!await git(['rev-parse', '--is-inside-work-tree']).then(s => s.trim() === 'true', () => false)) return { local: true, git: false, additions: 0, deletions: 0, files: [] };
  // against: what the folder is compared with. A branch's name, 'HEAD' where no default branch was found (then
  // only what is not committed shows), or '' in a repository without a commit.
  let against = '', base = EMPTY_TREE;
  if (await has('HEAD')) {
    against = base = 'HEAD';
    for (const ref of ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']) {
      if (!await has(ref)) continue;
      const common = await git(['merge-base', ref, 'HEAD']).then(s => s.trim(), () => '');
      if (common) { base = common; against = await git(['rev-parse', '--abbrev-ref', ref]).then(s => s.trim() || ref, () => ref); }
      break;
    }
  }
  // The prefixes are named so that no setting of the owner's (diff.noprefix, diff.mnemonicPrefix) can take them
  // away: lib.patchFiles reads the names behind them.
  const rows = lib.patchFiles(await git(['diff-index', '-p', '-M', '--full-index', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', base]));
  const others = (await git(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(f => f && !f.endsWith('/'));
  let read = 0;
  for (const f of others.slice(0, NEW_FILES)) {
    let buf = null;
    // ponytail: one `docker exec` for each unknown file of a container, a tenth of a second apiece. Read them
    // in one go, as a tar, if sessions leave hundreds.
    if (box) {
      if (read < NEW_BYTES) buf = await boxes.inBox(box, ['sh', '-c', `[ -f "$1" ] || exit 3; [ "$(stat -c %s "$1")" -le ${NEW_FILE_BYTES} ] && cat "$1"`, 'sh', f], { cwd: dir, encoding: 'buffer', timeout: 30000 }).catch(e => e.code);
      if (buf === 3) continue;   // gone since it was listed
      if (!Buffer.isBuffer(buf)) buf = null; else read += buf.length;
      rows.push(lib.untrackedRow(f, buf));
      continue;
    }
    try {
      const st = await fs.promises.stat(path.join(dir, f));
      if (!st.isFile()) continue;
      if (st.size <= NEW_FILE_BYTES && read + st.size <= NEW_BYTES) { buf = await fs.promises.readFile(path.join(dir, f)); read += buf.length; }
    } catch { continue; }   // gone since it was listed
    rows.push(lib.untrackedRow(f, buf));
  }
  rows.sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));   // by name, as git and GitHub list them
  const sum = k => rows.reduce((n, f) => n + f[k], 0);
  const totals = { additions: sum('additions'), deletions: sum('deletions') };
  return { local: true, git: true, against, more: Math.max(0, others.length - NEW_FILES), ...totals, ...lib.mapDiff(rows, totals) };
}

const REVIEW_MODEL = 'sonnet';
const MAX_FOLLOW_UPS = 3;   // per prompt of the owner's; after that the pull request waits for the owner
// A session with auto-merge on waits in its Stop hook for these calls, so none of them may hang for good.
const GH_WAIT = 60000;

// Auto-merge: merging is the app's job, once the session says its pull request is ready. A review reads what
// the session wrote (lib.reviewPrompt) and gives a verdict.
//   merge      the app marks a draft as ready, waits for the checks and merges
//   follow_up  the session raised something to settle first: the returned text goes back to it as the Stop
//              hook's answer, it carries on, and its next Stop is reviewed again
//   hold       left to the owner, with the reason on the card
// What GitHub then refuses (a failed check, a conflict) also goes back to the session, to be repaired.
// gone(): the hook was dropped unanswered. canAsk: a hook is open to answer; without one a follow-up cannot be sent.
async function mergeWhenReady(inst, pr, gone = () => false, canAsk = true) {
  const mine = inst.reviewing = {};
  // The owner has taken over (a new prompt, an interrupt, another autonomy on its card) or the session is gone.
  const stale = () => inst.reviewing !== mine || inst.exited || inst.autonomy !== 'full' || gone();
  const state = text => { inst.merge = text; push(); };
  const ask = text => {
    inst.asked.push(text);
    state(`follow-up ${inst.asked.length} of ${MAX_FOLLOW_UPS}`);
    notify('merge', `was told: ${text}`, inst);
    return text;
  };
  state('reviewing');
  let v;
  try { v = await review(inst, pr); } catch (e) { v = { verdict: 'hold', message: `the review failed: ${e.message}` }; }
  if (stale()) return state(null);
  if (v.verdict === 'follow_up') {
    if (canAsk && inst.asked.length < MAX_FOLLOW_UPS) return ask(v.message);
    v = { verdict: 'hold', message: canAsk ? `not settled after ${MAX_FOLLOW_UPS} follow-ups` : `to settle first: ${v.message}` };
  }
  inst.finished = true; pump();   // from here on it only waits, so its place in the pool is free
  if (v.verdict === 'hold') return state(`not merged: ${v.message}`);
  const n = String(pr.number);
  let problem;
  try {
    if (pr.isDraft) await run('gh', ['pr', 'ready', n], hostDir(inst), GH_WAIT);
    state('waiting for checks');
    problem = await lib.waitForChecks(async () => JSON.parse(await run('gh', ['pr', 'view', n, '--json', 'statusCheckRollup'], hostDir(inst), GH_WAIT)).statusCheckRollup, { stale });
    if (!problem) await run('gh', ['pr', 'merge', n, `--${saved.settings.mergeMethod}`], hostDir(inst), GH_WAIT);
  } catch (e) { problem = { why: e.message, owner: false }; }
  await readPr(inst);   // what the card says of the pull request: no longer a draft, and merged or not
  if (!problem) return state(v.message ? `merged: ${v.message}` : 'merged');
  if (inst.reviewing !== mine) return;   // a newer turn is under review: that one speaks for the card
  if (!problem.owner && canAsk && !stale() && inst.asked.length < MAX_FOLLOW_UPS) {
    inst.finished = false;
    return ask(`The pull request could not be merged: ${problem.why}.\nRepair that, push, and say when the pull request is ready for merge.`);
  }
  state(`not merged: ${problem.why}`);
}

// One Claude run without tools: it reads and judges, nothing else. It runs on the subscription like the
// instances do, and in the app's own folder, so that no project's settings, hooks or CLAUDE.md come into it.
async function review(inst, pr) {
  let issue = null;
  if (inst.issue) { try { issue = JSON.parse(await run('gh', ['issue', 'view', String(inst.issue), '--json', 'number,title,body'], hostDir(inst), GH_WAIT)); } catch { /* judged without it */ } }
  const out = await runInput(claudeBin, [
    '-p', '--model', REVIEW_MODEL, '--output-format', 'json', '--json-schema', JSON.stringify(lib.REVIEW_SCHEMA), '--tools', '',
    '--system-prompt', lib.REVIEW_SYSTEM, '--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands',
    '--settings', '{"disableAllHooks":true}',
  ], lib.reviewPrompt({ task: inst.prompt, latest: inst.lastPrompt, issue, pr, asked: inst.asked, said: inst.said }), { cwd: dataDir, env: lib.childEnv(process.env), timeout: 5 * 60000 });
  return lib.reviewVerdict(out);
}

// ---------- Claude Code itself: the version installed, and whether a newer one is out ----------

// Where the official installer reads the newest version from: one line of text per release channel.
// CLAUDINHO_RELEASES points a test at an address of its own.
const RELEASES = process.env.CLAUDINHO_RELEASES || 'https://downloads.claude.ai/claude-code-releases';
async function checkClaude() {
  if (!claudeBin) return;
  try { claudeCode.version = lib.parseVersion(await run(claudeBin, ['--version'])); } catch { /* keep what was read before */ }
  try {
    const channel = readJson(path.join(configDir(), 'settings.json')).autoUpdatesChannel === 'stable' ? 'stable' : 'latest';
    const res = await net.fetch(`${RELEASES}/${channel}`);
    const latest = res.ok ? lib.parseVersion(await res.text()) : null;
    // One notification per version, not one per check.
    if (latest && latest !== claudeCode.latest && lib.newerVersion(latest, claudeCode.version)) notify('update', `Claude Code ${latest} is out; ${claudeCode.version} is installed. Press to run \`claude update\`.`);
    if (latest) claudeCode.latest = latest;
  } catch { /* offline: the next check may get through */ }
  push();
}
setInterval(checkClaude, 3600 * 1000);   // every hour: `claude --version`, and one line of text from that address

// ---------- the app itself: a newer release ----------

// electron-updater reads the newest release of the repository named under `build.publish` in package.json and
// puts it in this copy's place: on Windows it runs the new installer silently, on Linux it replaces the
// AppImage, on macOS it goes through Squirrel, which takes only an app signed like this one. Nothing is
// downloaded until the owner asks for it: installing restarts the app, and that stops every session.
const selfUpdate = { latest: null, state: null };   // state: null, 'downloading …', or 'failed: …'
let installing = false;                             // the app is closing to be replaced: the window does not ask
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
// CLAUDINHO_UPDATES points a test at a folder of release files served over HTTP, also for a copy run from source.
if (process.env.CLAUDINHO_UPDATES) { autoUpdater.setFeedURL({ provider: 'generic', url: process.env.CLAUDINHO_UPDATES }); autoUpdater.forceDevUpdateConfig = true; }
autoUpdater.on('update-available', info => {
  // One notification per version, not one per check.
  if (info.version !== selfUpdate.latest) notify('app', `claudinho ${info.version} is out; this is ${app.getVersion()}. Press to install it and restart.`);
  selfUpdate.latest = info.version; push();
});
autoUpdater.on('download-progress', p => { selfUpdate.state = `downloading ${Math.round(p.percent)}%`; push(); });
autoUpdater.on('update-downloaded', () => { installing = true; autoUpdater.quitAndInstall(true, true); });   // silently, and start again afterwards
// A check that fails (offline, no release yet) says nothing; a download the owner asked for says why it failed.
autoUpdater.on('error', e => { if (selfUpdate.state) { selfUpdate.state = `failed: ${String(e && e.message).split('\n')[0]}`; push(); } });
const checkSelf = () => { if (app.isPackaged || process.env.CLAUDINHO_UPDATES) autoUpdater.checkForUpdates().catch(() => {}); };
// Every hour. A check is three small requests to github.com's pages (the feed of releases, the newest release,
// its latest*.yml). electron-updater keeps away from GitHub's API there, so the API's hourly limit for callers
// without a login does not come into it.
setInterval(checkSelf, 3600 * 1000);

// ---------- issue dispatch pool ----------

let pumping = false, pumpAgain = false;
async function pump() {
  if (pumping) { pumpAgain = true; return; }
  pumping = true;
  try {
    for (const job of [...queue]) {
      // One worktree at a time. The next is created only when the session in the one before has finished its
      // SessionStart hooks, so two worktrees are never being set up side by side. Containers do not wait, for
      // each other or for a worktree: each is set up where nothing of another's can be in its way.
      if (!job.box && [...instances.values()].some(i => i.starting && !i.exited && !i.box)) continue;
      const active = [...instances.values()].filter(i => i.pooled && !i.exited && !i.finished).length;
      if (job.pooled && active >= poolLimit) continue;
      try {
        job.waitingOn = lib.openBlockers(JSON.parse(await run('gh', ['api', `repos/{owner}/{repo}/issues/${job.number}/dependencies/blocked_by`], job.root)));
      } catch { job.waitingOn = ['?']; }   // gh failed: like claude_worktree, wait and retry
      // A container is asked about last: nothing is awaited between Docker's answer and the start, so a session
      // that is started has its place, also when several are started in one go (see freeBox).
      if (!job.waitingOn.length && job.box && !await freeBox()) job.waitingOn = ['box'];   // every container is taken
      if (job.waitingOn.length || !queue.includes(job)) continue;
      queue.splice(queue.indexOf(job), 1);
      spawnInstance({
        cwd: job.root, worktree: lib.worktreeName(job.number, job.title), box: job.box || null, model: job.model, effort: job.effort, level: job.level,
        autonomy: job.autonomy, mayMerge: job.autonomy === 'semi', issue: job.number, issueUrl: job.url, pooled: job.pooled, group: job.group,
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

// The folder's .worktreeinclude: the local files that a clone or a new worktree does not bring and that are
// copied into it all the same (a .env, say), as patterns in .gitignore syntax. Claude Code reads the file for
// a new worktree, and containers.js for a new container.
// Read with one kind of line ending, so that a list the owner has not touched in the settings compares as the same.
const readInclude = dir => { try { return fs.readFileSync(path.join(dir, '.worktreeinclude'), 'utf8').replace(/\r\n/g, '\n').trim(); } catch { return ''; } };
// The tools the folder names for its containers, for the window to say before a session starts: in which
// files, and which tools. The image itself is built from the files (see boxes.image).
function readTools(dir) {
  const files = boxes.toolFiles(dir).filter(([name]) => name !== 'mise.lock');
  return { files: files.map(([name]) => name), names: lib.toolNames(files.map(([name, text]) => [name, text.toString('utf8')])) };
}

async function openRepo(dir) {
  const git = args => run('git', args, dir).then(s => s.trim(), () => '');
  const isGit = (await git(['rev-parse', '--is-inside-work-tree'])) === 'true';
  repo = {
    path: dir, name: path.basename(dir), isGit,
    github: isGit ? lib.parseGitHub(await git(['remote', 'get-url', 'origin'])) : null,
    worktrees: isGit ? lib.parseWorktrees(await git(['worktree', 'list', '--porcelain'])) : [],
    // The default prompt for issue worktrees.
    // ponytail: prompts saved before 0.1.0 wrote the issue number as {n}, so every load turns a literal {n}
    // into the placeholder. Drop the replaceAll once no state file from before 0.1.0 is around.
    template: (saved.templates[dir] || lib.defaultTemplate(dir)).replaceAll('{n}', '{{ issue_id }}'),
    include: readInclude(dir),
    tools: readTools(dir),
  };
  disk.at = 0;   // another folder, other worktrees
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

  // box: true for a session in a new container, or the name of a container that was kept, to start one in it.
  async spawn(o) {
    // Semi-auto with a first prompt: the sentence goes into that prompt, as it does for an issue (see mergeNote).
    const semi = o.autonomy === 'semi' && !!o.prompt;
    const prompt = semi ? `${o.prompt}\n\n${lib.mergeInstruction('semi', saved.settings.mergeMethod)}` : o.prompt;
    const launch = { worktree: o.worktree, box: o.box === true || null, model: o.model, effort: o.effort, prompt, level: o.level, autonomy: o.autonomy, mayMerge: semi, kind: o.kind };
    if (typeof o.box === 'string') {
      const kept = (await boxes.list()).find(r => r.box === o.box);
      if (!kept || !boxDir(kept.key) || !kept.work) throw new Error(`${o.box} is not a container this app made.`);
      if ([...instances.values()].some(i => i.box && i.box.name === kept.box)) throw new Error(`A session is already open in ${kept.box}.`);
      Object.assign(launch, { cwd: kept.root, worktree: kept.name, box: { name: kept.box, key: kept.key, work: kept.work } });
    }
    return spawnInstance(launch);
  },
  // What closing would do to the instance's worktree, for the dialog that asks first.
  async closeInfo(id) {
    const inst = instances.get(id);
    // Its container, with what the clone in it holds. None while it is still being made or filled: that one
    // goes without a question.
    if (inst && inst.box) return { worktree: null, box: inst.box.name && !inst.fresh ? { name: inst.name, box: inst.box.name, ...await boxes.state(inst.box.name, inst.box.work) } : null };
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
  // Every container of this app, for the Containers tab: whose it is, and what its clone holds that is nowhere
  // else. A running one is asked. For one the app stopped, what it held then is on record (see closeBox).
  async boxes() {
    return Promise.all((await boxes.list()).map(async r => {
      const inst = [...instances.values()].find(i => i.box && i.box.name === r.box);
      return { box: r.box, n: r.n, running: r.running, root: r.root, name: r.name, inst: inst ? inst.id : null, ...await boxHeld(r) };
    }));
  },
  // Removes a container from that tab. Without `force` only when it is known that nothing would be lost with it.
  async removeBox(name, force) {
    const r = (await boxes.list()).find(x => x.box === name);
    if (!r) return;
    if ([...instances.values()].some(i => i.box && i.box.name === name)) throw new Error('A session is open in that container. Closing its card removes it.');
    const row = { name: r.name, box: name, ...await boxHeld(r) };
    if (force !== true && (row.changed == null || row.error || row.changed || row.unique)) return { kept: row };
    await boxes.remove(name);
    if (boxDir(r.key)) fs.rmSync(boxDir(r.key), { recursive: true, force: true });
    checkDocker(); pump(); disk.at = 0;   // a queued issue may have been waiting for it
    return { removed: true, name: r.name, box: name };
  },
  resume(id) {
    const r = interrupted.find(x => x.id === id);
    if (!r) return;
    // Its conversation, if Claude Code has one on disk; otherwise it starts again the way it was started.
    // One in a container has it in a volume: startBox looks there, as it looks for the container itself.
    const resume = r.box ? r.sessionId || undefined : r.sessionId && r.transcript && fs.existsSync(r.transcript) ? r.sessionId : undefined;
    const dir = resume && r.worktree ? path.join(r.root, '.claude', 'worktrees', r.worktree) : r.root;
    if (!fs.existsSync(dir)) throw new Error(`${dir} no longer exists.`);
    // Started again, it knows of merging what its first prompt says, whatever its card was set to since: where
    // the two differ, it is owed a note (see mergeNote).
    const started = spawnInstance({ ...r, cwd: r.root, worktree: r.box ? r.name : r.worktree, resume, mayMerge: resume ? r.mayMerge : lib.toldToMerge(r.prompt) });
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
    if (lib.AUTONOMY.includes(patch.autonomy)) {
      inst.autonomy = patch.autonomy;
      // Full-auto chosen after the session already went idle: judged by what it wrote last. No hook is open
      // then, so a follow-up cannot be sent and shows on the card as the reason instead.
      if (inst.autonomy === 'full' && (sessionOf(inst) || {}).status === 'idle') checkPr(inst, undefined, false).then(push);
    }
    push();
  },
  // The owner's own word on a session's pull request, from its card: mark a draft as ready for review, or merge
  // it. GitHub's refusal (a conflict, a rule of the branch) comes back as the error.
  async prAct(id, action) {
    const inst = instances.get(id);
    if (!inst || !inst.pr) return;
    const n = String(inst.pr.number);
    try { await run('gh', action === 'ready' ? ['pr', 'ready', n] : ['pr', 'merge', n, `--${saved.settings.mergeMethod}`], hostDir(inst), GH_WAIT); }
    finally { await readPr(inst); push(); }
  },
  // What the Diff tab shows. Where the instance's branch has a pull request: that pull request with its files
  // and their diffs, as GitHub lists them under "Files changed" (what has been pushed, against the merge
  // base). Where it has none yet: the folder's own diff (see localDiff). Null when GitHub does not answer for a
  // pull request the card knows of. Read-only either way.
  // ponytail: what GitHub's list of files gives, which is less than its page can load: 3000 files at most, and
  // no diff for a file once its own diff or the pull request's is too large. The tab then links to GitHub. For
  // more, diff in the worktree with git, which has the commits.
  async prDiff(id) {
    const inst = instances.get(id);
    if (!inst) return null;
    const pr = await readPr(inst);   // the branch may have got its pull request since the last turn ended
    if (!pr) return inst.pr ? null : inst.box ? localDiff(inst.box.work, inst.box.name) : localDiff(inst.cwd);
    push();
    const rows = [];
    for (let page = 1; page <= 30; page++) {
      const more = JSON.parse(await run('gh', ['api', `repos/{owner}/{repo}/pulls/${pr.number}/files?per_page=100&page=${page}`], hostDir(inst), GH_WAIT));
      rows.push(...more);
      if (more.length < 100) break;
    }
    return { number: pr.number, title: pr.title, url: pr.url, state: pr.state, draft: !!pr.isDraft, additions: pr.additions, deletions: pr.deletions, ...lib.mapDiff(rows, pr) };
  },
  // The syntax colours of one file of a diff. The tab asks when it first draws the file, one file a call: the
  // work is done here, where a whole pull request in one go would hold up every terminal. Measured: 8 µs a
  // line, 25 ms for the slowest of 700 files.
  diffColours: (file, hunks) => lib.colourHunks(String(file), hunks),
  answer(id, requestId, choice) {
    const inst = instances.get(id);
    const p = inst && inst.pending.find(x => x.view.id === requestId);
    if (p) p.settle(choice);
  },
  // Every input request of the session, oldest first: what was asked, the options, the recommended one, the one
  // picked and how (manual, timed, auto). `picked` is null while the answer is still out.
  audit(id) {
    const inst = instances.get(id);
    return inst ? inst.audit.map(({ at, kind, ask, options, recommended, picked, how }) => ({ at, kind, ask, options, recommended, picked, how })) : [];
  },
  // The bell's list was opened: nothing in it is new any more.
  seen() { for (const n of notifications) n.seen = true; push(); },
  // The tray icon. The window draws it, with the number of new notifications on it, because the main process
  // has nothing to draw text with. images: [[scale factor, PNG data URL], ...]
  tray(images, count) {
    const image = nativeImage.createEmpty();
    for (const [scaleFactor, dataURL] of images) {
      if (typeof scaleFactor !== 'number' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataURL)) throw new Error('Not a tray picture.');
      image.addRepresentation({ scaleFactor, dataURL });
    }
    if (!tray) {
      tray = new Tray(image);
      tray.on('click', () => { if (win.isMinimized()) win.restore(); win.show(); win.focus(); });
    } else tray.setImage(image);
    const n = Math.max(0, Math.floor(Number(count)) || 0);
    tray.setToolTip(n ? `claudinho: ${n} new notification${n === 1 ? '' : 's'}` : 'claudinho');
  },
  // `claude update` installs the newest version of the release channel. Sessions that are running keep the
  // version they started with; what is started afterwards gets the new one.
  async updateClaude() {
    if (!claudeBin) throw new Error('Claude Code CLI (claude) was not found on PATH.');
    if (claudeCode.updating) return null;
    claudeCode.updating = true; push();
    try { return (await run(claudeBin, ['update'])).trim().split(/\r?\n/).pop(); }
    finally { claudeCode.updating = false; await checkClaude(); }
  },
  // Downloads the newer release of the app and installs it. The app then closes and starts again by itself.
  updateApp() {
    if (!selfUpdate.latest || /^downloading/.test(selfUpdate.state || '')) return;
    selfUpdate.state = 'downloading'; push();
    autoUpdater.downloadUpdate().catch(() => { /* reported through the 'error' event */ });
  },
  async env(id) {
    const inst = instances.get(id);
    if (!inst) return [];
    // In a container: what a program started there finds. The variables of this computer do not reach it.
    if (inst.box) {
      const out = inst.box.name && inst.pid ? await boxes.inBox(inst.box.name, ['env'], { cwd: inst.box.work }).catch(() => '') : '';
      return out.split('\n').filter(l => l.includes('=')).map(l => ({ name: l.slice(0, l.indexOf('=')), value: l.slice(l.indexOf('=') + 1), source: 'process' })).sort((a, b) => a.name.localeCompare(b.name));
    }
    // What the process was started with, plus the `env` blocks Claude Code applies from settings files.
    const fromSettings = Object.assign({}, ...[path.join(configDir(), 'settings.json'), path.join(inst.cwd, '.claude', 'settings.json'), path.join(inst.cwd, '.claude', 'settings.local.json')].map(f => readJson(f).env || {}));
    return Object.entries({ ...inst.env, ...fromSettings }).map(([name, value]) => ({ name, value: String(value), source: name in fromSettings ? 'settings' : 'process' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async issues(state) {
    const out = [];
    let cursor;
    // ponytail: stops at 1000 issues (10 pages of 100), the newest; add server-side search if a repo outgrows that.
    for (let page = 0; page < 10; page++) {
      const args = ['api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}', '-f', `query=${lib.issuesQuery(state)}`];
      if (cursor) args.push('-f', `cursor=${cursor}`);
      const data = JSON.parse(await run('gh', args, repo.path)).data.repository.issues;
      out.push(...data.nodes.map(lib.mapIssue));
      if (!data.pageInfo.hasNextPage) break;
      cursor = data.pageInfo.endCursor;
    }
    return out.sort(lib.byNumber);
  },
  // box: each issue's session works in a container of its own instead of a worktree.
  dispatch({ issues, model, effort, level, parallel, autonomy, template, group, box }) {
    if (!claudeBin) throw new Error('Claude Code CLI (claude) was not found on PATH.');
    lib.issuePrompt(template, issues[0]);   // a prompt that cannot be filled in is refused here, before anything is queued
    const pooled = issues.length > 1;
    group = lib.groupName(group);
    if (pooled && !group) throw new Error('Issues started together are a group: give it a name.');
    if (pooled) poolLimit = Math.min(box ? Math.max(1, dock.limit) : 4, Math.max(1, Number(parallel) || 1));
    for (const is of issues) {
      if (queue.some(j => j.number === is.number)) continue;
      queue.push({ number: is.number, title: is.title, url: is.url, root: repo.path, model, effort, level, autonomy, template, pooled, group, box: !!box, waitingOn: [] });
    }
    pump();
  },
  unqueue(number) { const i = queue.findIndex(j => j.number === number); if (i >= 0) queue.splice(i, 1); push(); },
  // The open pull requests of the folder's repository, drafts included, in number order like the issues.
  // ponytail: the newest 200. Page through them with `gh api graphql`, as `issues` does, if a repo outgrows that.
  async prs() {
    return JSON.parse(await run('gh', ['pr', 'list', '--state', 'open', '--limit', '200', '--json', lib.PR_FIELDS], repo.path)).map(lib.mapPr).sort(lib.byNumber);
  },

  // Paths starting with "~/" are in the home config folder, the rest in the open folder.
  configList: () => ({ ...lib.scanConfig(repo.path), home: { dir: configDir(), files: lib.scanHome(configDir()).map(f => `~/${f}`) } }),
  configRead: rel => fs.readFileSync(configFile(rel), 'utf8'),
  configWrite(rel, text) {
    fs.writeFileSync(configFile(rel), text);
    if (lib.ROOT_FILES.includes(rel)) { repo.include = readInclude(repo.path); repo.tools = readTools(repo.path); push(); }   // what the window says of the folder
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
    if (typeof patch.boxPorts === 'string') saved.settings.boxPorts = lib.portList(patch.boxPorts).join(', ');
    if (['worktree', 'docker'].includes(patch.mode)) { saved.settings.mode = patch.mode; if (patch.mode === 'docker') checkDocker(); disk.at = 0; }
    // The memory ceiling counts for the containers there are as well: a session that has reached it is the
    // reason to raise it.
    const gb = Math.min(64, Math.max(1, Math.round(Number(patch.boxMemoryGb)) || 0));
    if (patch.boxMemoryGb && gb !== saved.settings.boxMemoryGb) {
      saved.settings.boxMemoryGb = gb;
      boxes.list().then(rows => boxes.resize(rows.map(r => r.box), gb)).catch(() => { /* Docker did not answer, or one is using more than that */ });
    }
    // The local files to copy into a new container or worktree: the folder's .worktreeinclude, written only
    // when it was changed here, and removed when the list was emptied.
    if (typeof patch.include === 'string' && repo && patch.include.trim() !== repo.include) {
      const file = path.join(repo.path, '.worktreeinclude');
      if (patch.include.trim()) fs.writeFileSync(file, `${patch.include.trim()}\n`); else fs.rmSync(file, { force: true });
      repo.include = readInclude(repo.path);
    }
    balanceCpu();
    save(); push();
  },
  clipRead: () => clipboard.readText(),
  clipWrite: text => clipboard.writeText(String(text)),
  // What a session asked its terminal to put on the clipboard (see lib.clipText).
  clipOsc: data => { const text = lib.clipText(data); if (text) clipboard.writeText(text); },
  // https, or a port of this computer that stands for a container's port.
  openUrl: url => { if (/^https:\/\//.test(url) || /^http:\/\/localhost:\d+\/$/.test(url)) shell.openExternal(url); },
};

ipcMain.handle('rpc', (_e, name, ...args) => {
  if (!Object.hasOwn(rpc, name)) throw new Error(`Unknown call: ${name}`);
  return rpc[name](...args);
});
ipcMain.on('pty-write', (_e, id, data) => { const i = instances.get(id); if (i && !i.exited && i.proc) i.proc.write(data); });
ipcMain.on('pty-resize', (_e, id, cols, rows) => {
  const i = instances.get(id);
  if (!i || i.exited) return;
  i.cols = cols; i.rows = rows;   // for a terminal that is started later (see startBox)
  if (i.proc) { try { i.proc.resize(cols, rows); } catch { /* exited meanwhile */ } }
});

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
    if (!live || installing) return;   // installing: the owner was asked before the update was downloaded
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Stop them and quit', 'Cancel'], defaultId: 1, cancelId: 1,
      message: `${live} Claude Code instance${live > 1 ? 's are' : ' is'} still running.`,
      detail: 'Quitting stops them. The next start offers to resume each one where it left off.',
    });
    if (choice === 1) e.preventDefault();
  });
}

app.whenReady().then(async () => {
  claudeBin = findExe('claude');
  dockerBin = findExe('docker');
  await startHookServer();
  createWindow();
  if (claudeBin) run(claudeBin, ['auth', 'status']).then(out => { account = JSON.parse(out); push(); }, () => {});
  checkClaude();
  checkSelf();
  const arg = process.argv.slice(app.isPackaged ? 1 : 2).find(a => !a.startsWith('-'));
  const start = arg && fs.existsSync(arg) ? path.resolve(arg) : saved.repoPath;
  if (start && fs.existsSync(start)) await openRepo(start);
  tick();
});

app.on('window-all-closed', () => {
  saveSessions();   // before anything is stopped: what is open now is what the next start offers to resume
  if (sampler) sampler.kill();
  cpu.shutdown();   // lifts every limit; nothing stays paused or capped behind us
  for (const inst of instances.values()) if (!inst.exited && inst.proc) { try { inst.proc.kill(); } catch { /* already gone */ } }
  // A container goes on without its terminal. Stopped, it runs nothing and keeps what is in it for the resume.
  boxes.stopBehind([...instances.values()].filter(i => i.box && i.box.name && !i.exited).map(i => i.box.name));
  save();
  fs.rmSync(path.join(dataDir, 'instances'), { recursive: true, force: true });
  if (tray) tray.destroy();   // or its icon stays in the tray until the mouse passes over it
  app.quit();
});
