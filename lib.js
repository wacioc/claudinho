// Pure helpers. No Electron imports, so `node test.js` can exercise them.
const fs = require('fs');
const path = require('path');

// ---------- issue dispatch (port of the claude_worktree PowerShell helper) ----------

// "<n>-<title minus its 'TYPE | ' prefix, slugified>", cut to whole words within 64 chars (the `claude -w` cap).
function worktreeName(number, title) {
  const slug = String(title).replace(/^[^|]*\| */, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${number}-${slug}`.replace(/^(.{1,64})(?=-|$).*/, '$1').replace(/-+$/, '');
}

// A blocker stops counting only once it is closed as completed (REST: dependencies/blocked_by).
const openBlockers = blockers => blockers.filter(b => b.state_reason !== 'completed').map(b => b.number);

function defaultTemplate(repoPath) {
  return fs.existsSync(path.join(repoPath, 'docs', 'PROCESS.md'))
    ? 'Implement #{{ issue_id }} following docs/PROCESS.md'
    : "Implement GitHub issue #{{ issue_id }}. Read it with `gh issue view {{ issue_id }} --comments`, implement it, run the project's checks, then commit, push and open a pull request that closes #{{ issue_id }}.";
}

// The prompt is a Jinja2 template, of which one construct is supported: the {{ variable }} placeholder.
// ponytail: no {% %} blocks, {# #} comments or | filters. They are refused, so that none reaches Claude as
// plain text; swap this function for nunjucks when a prompt needs them.
function renderTemplate(template, vars) {
  if (/\{%|\{#/.test(template)) throw new Error('The prompt may only use {{ variable }} placeholders: {% %} blocks and {# #} comments are not supported.');
  if (template.replace(/\{\{.*?\}\}/gs, '').includes('{{')) throw new Error('The prompt has a {{ that is never closed with }}.');
  // One pass: a value goes in as it is and is never read again as template text (issue titles are not ours).
  return template.replace(/\{\{(.*?)\}\}/gs, (_, expr) => {
    const name = expr.trim();
    if (!Object.hasOwn(vars, name)) throw new Error(`The prompt uses {{ ${name} }}, which does not exist. There are: ${Object.keys(vars).map(v => `{{ ${v} }}`).join(', ')}.`);
    return String(vars[name]);
  });
}

// issue: { number, title, url }
// autonomy: 'manual' | 'semi' | 'full' | undefined (single issue without auto-merge: the repo's own process decides)
function issuePrompt(template, issue, autonomy, mergeMethod = 'squash') {
  const tail = {
    manual: 'Do not merge the pull request; a human will review and merge it.',
    semi: `After opening the pull request, decide whether it is safe to merge without human review (checks green, change small and low-risk). If it is, merge it yourself with \`gh pr merge --${mergeMethod}\`; if not, leave it open and say why.`,
    full: 'Do not merge the pull request yourself; it is merged automatically as soon as you finish.',
  }[autonomy];
  const base = renderTemplate(template, { issue_id: issue.number, issue_title: issue.title || '', issue_url: issue.url || '' });
  return tail ? `${base}\n\n${tail}` : base;
}

// What to do with an instance's PR once the agent ends a turn. pr = `gh pr view --json number,state,url,isDraft`.
function prAction(pr, autoMerge) {
  if (!pr) return 'none';
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state === 'OPEN' && !pr.isDraft) return autoMerge ? 'merge' : 'finished';
  return 'none';
}

// ---------- GitHub issues ----------

function issuesQuery(state) {
  const states = state === 'ALL' ? '' : `, states: [${state === 'CLOSED' ? 'CLOSED' : 'OPEN'}]`;
  return `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, after: $cursor${states}, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title state url updatedAt
        author { login }
        labels(first: 10) { nodes { name color } }
        assignees(first: 5) { nodes { login } }
        blockedBy(first: 20) { nodes { number title url stateReason } }
      }
    }
  }
}`;
}

function mapIssue(n) {
  const blockedBy = n.blockedBy.nodes.map(b => ({ number: b.number, title: b.title, url: b.url, done: b.stateReason === 'COMPLETED' }));
  const labels = n.labels.nodes;
  return {
    number: n.number, title: n.title, state: n.state, url: n.url, updatedAt: n.updatedAt,
    author: n.author ? n.author.login : '', labels, assignees: n.assignees.nodes.map(a => a.login), blockedBy,
    // Native dependencies first; a plain "blocked" label still counts, it just has no number to show.
    blocked: blockedBy.some(b => !b.done) || labels.some(l => /^blocked$/i.test(l.name)),
  };
}

function parseGitHub(remoteUrl) {
  // ponytail: github.com only; loosen the host match when GitHub Enterprise matters.
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\s*$/.exec(remoteUrl || '');
  return m ? { owner: m[1], name: m[2] } : null;
}

// ---------- input requests (hooks) ----------

// "Auto" picks the option labelled "(Recommended)", else the first one.
function pickRecommended(question) {
  const opts = question.options || [];
  return (opts.find(o => /\(recommended\)/i.test(o.label)) || opts[0] || {}).label || '';
}

// Which hook events are "Claude needs input from you".
function inputKind(ev) {
  const q = ev.tool_input && ev.tool_input.questions;
  if (ev.hook_event_name === 'PreToolUse' && ev.tool_name === 'AskUserQuestion' && q && q.length) return 'question';
  // AskUserQuestion / ExitPlanMode need a real answer, not a bare "allow": those dialogs stay in the terminal.
  if (ev.hook_event_name === 'PermissionRequest' && !['AskUserQuestion', 'ExitPlanMode'].includes(ev.tool_name)) return 'permission';
  return null;
}

function permissionSummary(ev) {
  const i = ev.tool_input || {};
  return String(i.command || i.file_path || i.url || i.pattern || JSON.stringify(i)).slice(0, 300);
}

// Hook reply for an input request. choice: 'recommended' | 'deny' | 'terminal' | { answers }
// null means "reply with an empty body", which makes Claude Code show its own dialog in the terminal.
function hookReply(ev, choice) {
  if (choice === 'terminal') return null;
  if (ev.hook_event_name === 'PreToolUse') {
    const answers = (choice && choice.answers) || Object.fromEntries(ev.tool_input.questions.map(q => [q.question, pickRecommended(q)]));
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...ev.tool_input, answers } } };
  }
  const decision = choice === 'deny' ? { behavior: 'deny', message: 'Denied from the claudinho dashboard.' } : { behavior: 'allow' };
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
}

// ---------- launching claude ----------

// Status line wrapper: save the JSON Claude Code pipes in (cost, context, rate limits), then hand it to the
// user's own status line so the terminal looks the same.
// ponytail: POSIX shell syntax. Claude Code runs status lines through Git Bash on Windows; without Git Bash
// (PowerShell fallback) the metrics stay empty. Add a PowerShell variant if that setup shows up.
function statusLineCommand(file, original) {
  const quoted = "'" + file.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'";
  return original ? `tee ${quoted} | ( ${original} )` : `cat > ${quoted}`;
}

// Per-instance settings passed with --settings: they sit above user/project settings for that session only.
function instanceSettings({ statusFile, hookUrl, userStatusLine }) {
  const hook = [{ type: 'http', url: hookUrl, timeout: 7200 }]; // a "timed" request may be held for up to an hour
  return {
    statusLine: { ...userStatusLine, type: 'command', command: statusLineCommand(statusFile, userStatusLine && userStatusLine.command) },
    hooks: {
      PreToolUse: [{ matcher: 'AskUserQuestion', hooks: hook }],
      PermissionRequest: [{ hooks: hook }],
      Stop: [{ hooks: hook }],
    },
  };
}

// `--` keeps a prompt starting with "-" from being read as a flag.
// resume: the id of a conversation to continue. It already has its worktree and its first prompt.
function claudeArgs({ settingsFile, model, effort, worktree, prompt, resume }) {
  const a = ['--settings', settingsFile];
  if (model) a.push('--model', model);
  if (effort) a.push('--effort', effort);
  if (resume) return a.concat('--resume', resume);
  if (worktree) a.push('--worktree', worktree);
  if (prompt) a.push('--', prompt);
  return a;
}

// Instances must bill the Claude subscription, never an API key.
const API_AUTH = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
// Started from inside a Claude Code session (its shells set CLAUDECODE), the app inherits that session's
// private wiring: session id, messaging socket, entrypoint... Instances are new top-level sessions, so drop it.
// ponytail: that also drops CLAUDE* variables you set yourself at OS level, in this nested case only;
// keep those in settings.json `env`, which Claude Code applies to every instance anyway.
const HOST_SESSION = /^CLAUDE(?!_CONFIG_DIR$)/i;   // everything CLAUDE*, except which account/profile to use
function childEnv(env) {
  const nested = Object.keys(env).some(k => k.toUpperCase() === 'CLAUDECODE');
  const out = { ...env, COLORTERM: 'truecolor' };
  for (const k of Object.keys(out)) if (API_AUTH.includes(k.toUpperCase()) || (nested && HOST_SESSION.test(k))) delete out[k];
  return out;
}

// ---------- CPU and memory of a process tree ----------

const SAMPLE_SECONDS = 2;

// A long-running lister: one process per line, then "END", every SAMPLE_SECONDS. It ends by itself when the
// app is gone, so a crash cannot leave it spinning.
//   Windows (PowerShell + CIM):  pid ppid workingSetBytes cpuIn100ns startTicks name
//   Linux (/proc):               "H clockTicks pageSize", then each /proc/<pid>/stat line as it is
//   macOS and others (ps):       pid ppid pgid rssKiB cpuTime command
function samplerCommand(platform, appPid) {
  if (platform === 'linux') {
    // /proc counts CPU in 10 ms ticks. `ps` on Linux prints whole seconds only, which is far too coarse to
    // steer a duty cycle by (and made the display jump in steps).
    return ['sh', ['-c', `T=$(getconf CLK_TCK); P=$(getconf PAGESIZE); while kill -0 $PPID 2>/dev/null; do echo "H $T $P"; for f in /proc/[0-9]*/stat; do read -r line < "$f" && echo "$line"; done 2>/dev/null; echo END; sleep ${SAMPLE_SECONDS}; done`]];
  }
  if (platform !== 'win32') {
    return ['sh', ['-c', `while kill -0 $PPID 2>/dev/null; do ps -A -o pid= -o ppid= -o pgid= -o rss= -o time= -o comm=; echo END; sleep ${SAMPLE_SECONDS}; done`]];
  }
  const script = `$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
while (Get-Process -Id ${appPid}) {
  $sb = New-Object Text.StringBuilder
  foreach ($p in Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize,KernelModeTime,UserModeTime,CreationDate,Name) {
    $null = $sb.Append($p.ProcessId).Append(' ').Append($p.ParentProcessId).Append(' ').Append($p.WorkingSetSize).Append(' ').Append($p.KernelModeTime + $p.UserModeTime).Append(' ').Append($p.CreationDate.Ticks).Append(' ').AppendLine($p.Name)
  }
  [Console]::Out.Write($sb.ToString() + 'END' + [char]10)
  Start-Sleep -Seconds ${SAMPLE_SECONDS}
}`;
  // -EncodedCommand (base64 of UTF-16) sidesteps every command-line quoting rule.
  return ['powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]];
}

// ps prints CPU time as "MM:SS.ss" (macOS, with the decimal mark of the user's locale) or "[DD-]HH:MM:SS" (Linux).
function cpuSeconds(text) {
  const [clock, days] = text.split('-').reverse();
  return (Number(days) || 0) * 86400 + clock.split(':').reduce((sum, part) => sum * 60 + Number(part.replace(/\D/, '.')), 0);
}

// Sampler lines -> Map(pid -> { pid, ppid, pgid, mem: bytes, cpu: seconds used since it started, start, name }).
// Lines that do not fit (a system process with a field missing) are skipped.
function parseProcs(lines, platform = process.platform) {
  const procs = new Map();
  let ticks = 100, page = 4096;
  for (const line of lines) {
    if (platform === 'linux') {
      if (line.startsWith('H ')) { [, ticks, page] = line.split(' ').map(Number); continue; }
      // pid (comm) state ppid pgrp ... utime stime ... rss; comm may itself hold spaces and brackets, so
      // split around the LAST closing bracket. After it: state is field 0, utime 11, stime 12, rss 21.
      const open = line.indexOf('('), close = line.lastIndexOf(')');
      const f = line.slice(close + 2).split(' ');
      if (open < 1 || close < open || f.length < 22) continue;
      const pid = +line.slice(0, open - 1);
      procs.set(pid, { pid, ppid: +f[1], pgid: +f[2], mem: +f[21] * page, cpu: (+f[11] + +f[12]) / ticks, start: 0, name: line.slice(open + 1, close) });
    } else if (platform === 'win32') {
      const m = /^(\d+) (\d+) (\d+) (\d+) (\d+) (.+)$/.exec(line);
      if (m) procs.set(+m[1], { pid: +m[1], ppid: +m[2], pgid: 0, mem: +m[3], cpu: +m[4] / 1e7, start: +m[5], name: m[6] });
    } else {
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*\S)\s*$/.exec(line);
      if (m) procs.set(+m[1], { pid: +m[1], ppid: +m[2], pgid: +m[3], mem: +m[4] * 1024, cpu: cpuSeconds(m[5]), start: 0, name: m[6].split('/').pop() });
    }
  }
  return procs;
}

// The root process plus everything it started, found through parent pids.
// ponytail: a listing is a sample. A process that starts and exits between two listings is never seen, and a
// child whose parent has already exited no longer points into the tree.
function treeOf(procs, rootPid) {
  const kids = new Map();
  for (const p of procs.values()) {
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(p);
  }
  const seen = new Set(), list = [], stack = procs.has(rootPid) ? [procs.get(rootPid)] : [];
  while (stack.length) {
    const p = stack.pop();
    if (seen.has(p.pid)) continue;
    seen.add(p.pid);
    list.push(p);
    // Windows recycles pids, so a stale parent pid can point at one of ours: a real child is never older.
    stack.push(...(kids.get(p.pid) || []).filter(k => k.start >= p.start));
  }
  return list;
}

// CPU and memory of that tree, with CPU measured since `prev` (the listing taken `seconds` earlier).
// cpu is in cores (1 = one core fully busy), mem in bytes.
function treeUsage(procs, rootPid, prev, seconds) {
  const list = treeOf(procs, rootPid).map(p => {
    const before = prev && prev.get(p.pid);
    // Not in the previous listing (or its pid was reused): all the CPU it has used falls in this interval.
    const used = before && p.cpu >= before.cpu ? p.cpu - before.cpu : p.cpu;
    return { pid: p.pid, name: p.name, mem: p.mem, cpu: seconds > 0 ? used / seconds : 0 };
  });
  list.sort((a, b) => b.cpu - a.cpu || b.mem - a.mem);
  return { cpu: list.reduce((s, p) => s + p.cpu, 0), mem: list.reduce((s, p) => s + p.mem, 0), procs: list };
}

// Same-named processes folded together (sixteen workers read better as one line), busiest first.
function byName(procs) {
  const groups = new Map();
  for (const p of procs) {
    const g = groups.get(p.name) || { name: p.name, n: 0, cpu: 0, mem: 0 };
    g.n++; g.cpu += p.cpu; g.mem += p.mem;
    groups.set(p.name, g);
  }
  return [...groups.values()].sort((a, b) => b.cpu - a.cpu || b.mem - a.mem);
}

// ---------- CPU limits: the sharing policy ----------

// How instances weigh against each other when they compete for the CPU.
const WEIGHTS = { low: 0.5, normal: 1, high: 2 };
const MIN_SHARE = 0.01;   // an instance is never throttled to nothing
const OUTSIDE_CLAIM = 0.1;   // see shareCpu

// Decide each instance's CPU limit for the next interval. Every number is a share of the whole machine (0..1).
//   insts: [{ weight, ceiling, used, was, limit }]
//                                               used    = share it consumed over the last interval
//                                               was     = the same for the interval before (undefined at first)
//                                               limit   = the limit that was in force during it
//                                               ceiling = the most it may ever have (1 = no ceiling)
//   used:  what the instances consumed between them over that interval (the readings as measured)
//   idle:  the share of the machine that nobody used over the same interval
// Returns the new limits, in the same order.
//
// While there is enough for everyone, nobody is held below its ceiling. Under contention the instances split
// what they have between them in proportion to their weights (weighted max-min fairness): whoever needs less
// than its share keeps what it needs, the rest is divided among the others, and nobody is ever limited below
// its proportional share, so an instance that wakes up can take its share at once.
//
// This is for systems whose kernel cannot be trusted to share by weight (Windows, macOS): the result is
// enforced as a kernel cap or a duty cycle, once per interval. Linux control groups do all of it natively.
function shareCpu(insts, used, idle) {
  // What the instances have between them: what they used, what nobody used, and a tenth of what processes
  // outside the app used. That tenth lets them win ground back from outside load. A limited instance cannot
  // show that it wants more, and a busy outsider takes up whatever it leaves, so no idle time would ever
  // appear to grow into: each dip in an instance's use would be lost to the outsider for good.
  // With nothing else running the tenth is nothing, and the shares are exact.
  const total = Math.min(1, used + idle + OUTSIDE_CLAIM * Math.max(0, 1 - used - idle));
  // What an instance could use next: anything up to its ceiling if it is pressing against its limit; otherwise
  // what it uses now plus room to grow, generous while its use is still rising and slim once it is steady, so
  // that little is held back from the others.
  const want = insts.map(i => {
    if (i.used >= 0.9 * i.limit) return i.ceiling;
    const rising = i.was === undefined || i.used > i.was * 1.05;
    return Math.min(i.ceiling, i.used * (rising ? 1.5 : 1.05) + MIN_SHARE);
  });
  const alloc = insts.map(() => 0);
  let left = total, open = insts.map((_, k) => k);
  while (open.length) {
    const weight = open.reduce((s, k) => s + insts[k].weight, 0);
    const fits = open.filter(k => want[k] <= left * insts[k].weight / weight);
    if (!fits.length) { for (const k of open) alloc[k] = left * insts[k].weight / weight; break; }
    for (const k of fits) { alloc[k] = want[k]; left -= want[k]; }
    open = open.filter(k => !fits.includes(k));
  }
  if (insts.every((i, k) => alloc[k] >= want[k] - 1e-9)) return insts.map(i => i.ceiling);   // enough for everyone
  const weights = insts.reduce((s, i) => s + i.weight, 0);
  return insts.map((i, k) => Math.min(i.ceiling, Math.max(MIN_SHARE, alloc[k], total * i.weight / weights)));
}

// ---------- CPU limits: what each mechanism needs ----------

// Linux: one transient systemd scope per instance; the kernel enforces the quota and the weight on its whole tree.
const scopeUnit = id => `claudinho-${id}.scope`;
// limit is a share of the machine (1 = none). CPUQuota is in percent of ONE cpu: half of 16 cores is 800%.
// An empty CPUQuota= removes the quota.
function scopeProps(limit, weight, cores) {
  return [`CPUWeight=${Math.max(1, Math.round(100 * weight))}`, limit < 0.995 ? `CPUQuota=${Math.max(1, Math.round(limit * cores * 100))}%` : 'CPUQuota='];
}
// systemd-run --scope moves itself into the new scope and then execs the command: same pid, same terminal.
function scopeCommand(id, props, file, args) {
  return ['systemd-run', ['--user', '--scope', '--quiet', '--collect', '--unit', scopeUnit(id), ...props.filter(p => !p.endsWith('=')).flatMap(p => ['-p', p]), '--', file, ...args]];
}

// Pause-and-resume throttling (systems with no kernel CPU limit): who to signal for one instance.
// A whole process group is signalled when every member belongs to the tree, which also reaches processes
// started since the listing; the rest are signalled one by one. The root, Claude Code itself, is never
// paused: its terminal has to stay alive, and a paused TUI redraws itself on every resume.
function throttleTargets(procs, rootPid) {
  const tree = treeOf(procs, rootPid), root = procs.get(rootPid);
  if (!root) return { groups: [], pids: [] };
  const inTree = new Set(tree.map(p => p.pid)), members = new Map();
  for (const p of procs.values()) {
    if (!members.has(p.pgid)) members.set(p.pgid, []);
    members.get(p.pgid).push(p.pid);
  }
  const groups = [...new Set(tree.map(p => p.pgid))].filter(g => g > 1 && g !== root.pgid && members.get(g).every(pid => inTree.has(pid)));
  return { groups, pids: tree.filter(p => p.pid !== rootPid && !groups.includes(p.pgid)).map(p => p.pid) };
}

// The duty cycle for the next interval: the fraction of each period the tree may run so that its average use
// meets `target`. `used` was measured while it ran `duty` of the time (both are shares of the machine).
function nextDuty(duty, used, target) {
  if (target >= 0.995) return 1;
  // Use scales with the time it is allowed to run, so this would be exactly right at once. Opening up is
  // held to a doubling per step, because a low reading may just be a quiet moment.
  const exact = Math.min(duty * 2, duty * target / Math.max(used, 1e-6));
  return Math.min(1, Math.max(0.02, duty + 0.85 * (exact - duty)));   // most of the way: measurements jitter
}

// ---------- repo ----------

const normPath = p => { const r = path.resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
const isInside = (dir, p) => { const d = normPath(dir), x = normPath(p); return x === d || x.startsWith(d + path.sep); };
// One folder can be spelled several ways (through a symlink, in another case, as a Windows short name), and
// git prints its own spelling: compare what the paths resolve to.
const realPath = p => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };   // gone: as given
const samePath = (a, b) => normPath(realPath(a)) === normPath(realPath(b));

function parseWorktrees(porcelain) {
  return porcelain.split(/\r?\n\r?\n/).map(b => b.trim()).filter(Boolean).map((b, i) => ({
    path: path.normalize((/^worktree (.+)$/m.exec(b) || [])[1] || ''),
    branch: (/^branch refs\/heads\/(.+)$/m.exec(b) || [])[1] || null,
    main: i === 0,
  })).filter(w => w.path !== '.');
}

// Card title: the worktree's name, or the folder name when the instance runs in the main folder.
function labelFor(repoPath, cwd, worktrees = []) {
  const m = /[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/.exec(cwd || '');
  if (m && isInside(repoPath, cwd)) return { worktree: m[1], label: m[1] };
  const wt = worktrees.find(w => !w.main && isInside(w.path, cwd || ''));
  if (wt) return { worktree: path.basename(wt.path), label: path.basename(wt.path) };
  return { worktree: null, label: path.basename(repoPath) };
}

// ---------- .claude / .github scan ----------

const ROOT_FILES = ['CLAUDE.md', 'CLAUDE.local.md', '.mcp.json', '.worktreeinclude'];
const SKIP_DIRS = new Set(['worktrees', 'node_modules', '.git']); // .claude/worktrees holds whole checkouts

function walk(root, rel, out, depth = 0) {
  let entries;
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && depth < 6) walk(root, r, out, depth + 1); }
    else if (e.isFile()) out.push(r); // symlinks are skipped on purpose: never follow one out of the repo
  }
  return out;
}

function scanConfig(root) {
  const files = [...ROOT_FILES.filter(f => fs.existsSync(path.join(root, f))), ...walk(root, '.claude', []), ...walk(root, '.github', [])].sort();
  const count = re => files.filter(f => re.test(f)).length;
  const hasHooks = ['.claude/settings.json', '.claude/settings.local.json'].some(f => {
    try { return Object.keys(JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')).hooks || {}).length > 0; } catch { return false; }
  });
  return {
    files,
    summary: {
      claude: count(/^\.claude\//) > 0 || files.includes('CLAUDE.md'),
      github: count(/^\.github\//) > 0,
      skills: count(/^\.claude\/skills\/[^/]+\/SKILL\.md$/i),
      agents: count(/^\.claude\/agents\/.+\.md$/i),
      commands: count(/^\.claude\/commands\/.+\.md$/i),
      settings: count(/^\.claude\/settings(\.local)?\.json$/),
      hooks: hasHooks,
      mcp: files.includes('.mcp.json'),
      memory: files.includes('CLAUDE.md'),
      workflows: count(/^\.github\/workflows\/.+\.ya?ml$/i),
      issueTemplates: count(/^\.github\/ISSUE_TEMPLATE\/./i),
      prTemplate: count(/^\.github\/pull_request_template/i) > 0,
      codeowners: count(/^\.github\/CODEOWNERS$/) > 0,
    },
  };
}

// Trust boundary for the editor: only paths the scan could list may be read or written.
function configPath(root, rel) {
  const abs = path.resolve(root, rel);
  const norm = path.relative(path.resolve(root), abs).split(path.sep).join('/');
  if (!(ROOT_FILES.includes(norm) || /^\.(claude|github)\/./.test(norm))) throw new Error(`Not a config file: ${rel}`);
  return abs;
}

// ---------- the home config folder (~/.claude) ----------

// What a person edits there. The same folder holds credentials, transcripts and history, which the editor
// must never reach: these two lists are the trust boundary for it.
const HOME_FILES = ['CLAUDE.md', 'settings.json', 'keybindings.json'];
const HOME_DIRS = ['agents', 'commands', 'output-styles', 'rules', 'skills'];

// Paths relative to the home config folder.
// ponytail: like the project scan, this skips symlinks, so a skill linked in from a dotfiles repo is not
// listed. Follow links that stay inside the folder if that setup shows up.
function scanHome(home) {
  // A personal skill is skills/<name>/SKILL.md. Whatever else sits in skills/ (bundles synced by the desktop
  // app, its trash) is not the user's to edit.
  let skills = [];
  try {
    skills = fs.readdirSync(path.join(home, 'skills'), { withFileTypes: true })
      .filter(e => e.isDirectory() && fs.existsSync(path.join(home, 'skills', e.name, 'SKILL.md'))).map(e => `skills/${e.name}`);
  } catch { /* no skills folder */ }
  return [...HOME_FILES.filter(f => fs.existsSync(path.join(home, f))), ...[...HOME_DIRS.filter(d => d !== 'skills'), ...skills].flatMap(d => walk(home, d, []))].sort();
}

function homePath(home, rel) {
  const abs = path.resolve(home, rel);
  const norm = path.relative(path.resolve(home), abs).split(path.sep).join('/');
  if (!(HOME_FILES.includes(norm) || HOME_DIRS.some(d => norm.startsWith(`${d}/`)))) throw new Error(`Not a config file: ~/${rel}`);
  return abs;
}

module.exports = {
  worktreeName, openBlockers, defaultTemplate, renderTemplate, issuePrompt, prAction, issuesQuery, mapIssue, parseGitHub,
  pickRecommended, inputKind, permissionSummary, hookReply, statusLineCommand, instanceSettings, claudeArgs,
  childEnv, isInside, realPath, samePath, parseWorktrees, labelFor, scanConfig, configPath, ROOT_FILES, scanHome, homePath,
  SAMPLE_SECONDS, samplerCommand, cpuSeconds, parseProcs, treeOf, treeUsage, byName,
  WEIGHTS, MIN_SHARE, shareCpu, scopeUnit, scopeProps, scopeCommand, throttleTargets, nextDuty,
};
