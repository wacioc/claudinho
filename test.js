// node test.js — the one self-check for the logic in lib.js (no framework, no Electron).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib');

// claude_worktree naming rule
assert.strictEqual(lib.worktreeName(12, 'FEAT | Add login page!'), '12-add-login-page');
assert.strictEqual(lib.worktreeName(7, 'No prefix here'), '7-no-prefix-here');
const long = lib.worktreeName(274, 'CHORE | ' + 'delegate from calls and tell the owner the result '.repeat(3));
assert.ok(long.length <= 64 && !long.endsWith('-') && long.startsWith('274-delegate-from-calls'), long);

// blockers: only "closed as completed" unblocks
assert.deepStrictEqual(lib.openBlockers([{ number: 1, state_reason: 'completed' }, { number: 2, state_reason: null }, { number: 3, state_reason: 'not_planned' }]), [2, 3]);

// prompt: a Jinja2 template of which only the {{ variable }} placeholder is supported
const is5 = { number: 5, title: 'Fix {{ issue_url }} & <b>', url: 'https://x/5' };
assert.strictEqual(lib.issuePrompt('Implement issue #{{issue_id}}, closes #{{ issue_id }}', is5), 'Implement issue #5, closes #5');
// a value is neither read again as template text nor escaped; a lone }} is plain text
assert.strictEqual(lib.issuePrompt('{{ issue_title }} ({{issue_url}}) }}', is5), 'Fix {{ issue_url }} & <b> (https://x/5) }}');
assert.throws(() => lib.issuePrompt('#{{ issue }}', is5), /\{\{ issue \}\}, which does not exist/);
assert.throws(() => lib.issuePrompt('#{{ issue_id | upper }}', is5), /does not exist/);   // a filter
assert.throws(() => lib.issuePrompt('{% if issue_id %}x{% endif %}', is5), /not supported/);
assert.throws(() => lib.issuePrompt('#{{ issue_id }', is5), /never closed/);
assert.strictEqual(lib.issuePrompt(lib.defaultTemplate(os.tmpdir()), is5).includes('{'), false);
// autonomy
assert.match(lib.issuePrompt('x {{ issue_id }}', is5, 'semi', 'rebase'), /^x 5\n\n.*gh pr merge --rebase/);
assert.match(lib.issuePrompt('x {{ issue_id }}', is5, 'manual'), /Do not merge/);

// what happens to a PR when the agent stops
assert.strictEqual(lib.prAction(null, true), 'none');
assert.strictEqual(lib.prAction({ state: 'OPEN', isDraft: false }, true), 'merge');
assert.strictEqual(lib.prAction({ state: 'OPEN', isDraft: false }, false), 'finished');
assert.strictEqual(lib.prAction({ state: 'OPEN', isDraft: true }, true), 'none');
assert.strictEqual(lib.prAction({ state: 'MERGED' }, false), 'merged');
assert.strictEqual(lib.prAction({ state: 'CLOSED' }, true), 'none');

// issues
const issue = lib.mapIssue({
  number: 9, title: 't', state: 'OPEN', url: 'u', updatedAt: 'd', author: null, labels: { nodes: [] }, assignees: { nodes: [{ login: 'a' }] },
  blockedBy: { nodes: [{ number: 4, title: 'x', url: 'u4', stateReason: 'COMPLETED' }, { number: 5, title: 'y', url: 'u5', stateReason: null }] },
});
assert.strictEqual(issue.blocked, true);
assert.deepStrictEqual(issue.blockedBy.map(b => [b.number, b.done]), [[4, true], [5, false]]);
assert.strictEqual(lib.mapIssue({ ...issue, labels: { nodes: [{ name: 'Blocked' }] }, assignees: { nodes: [] }, blockedBy: { nodes: [] } }).blocked, true);
assert.ok(lib.issuesQuery('OPEN').includes('states: [OPEN]') && !lib.issuesQuery('ALL').includes('states'));
assert.deepStrictEqual(lib.parseGitHub('git@github.com:acme/widgets.git'), { owner: 'acme', name: 'widgets' });
assert.deepStrictEqual(lib.parseGitHub('https://github.com/acme/widgets\n'), { owner: 'acme', name: 'widgets' });
assert.strictEqual(lib.parseGitHub('https://gitlab.com/a/b.git'), null);

// input requests
const q = { question: 'Which?', options: [{ label: 'Blue' }, { label: 'Red (Recommended)' }] };
assert.strictEqual(lib.pickRecommended(q), 'Red (Recommended)');
assert.strictEqual(lib.pickRecommended({ options: [{ label: 'A' }, { label: 'B' }] }), 'A');
const ask = { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [q] } };
const perm = { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' } };
assert.strictEqual(lib.inputKind(ask), 'question');
assert.strictEqual(lib.inputKind(perm), 'permission');
assert.strictEqual(lib.inputKind({ ...perm, tool_name: 'AskUserQuestion' }), null);
assert.strictEqual(lib.inputKind({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} }), null);
assert.deepStrictEqual(lib.hookReply(ask, 'recommended').hookSpecificOutput.updatedInput, { questions: [q], answers: { 'Which?': 'Red (Recommended)' } });
assert.deepStrictEqual(lib.hookReply(ask, { answers: { 'Which?': 'Blue' } }).hookSpecificOutput.updatedInput.answers, { 'Which?': 'Blue' });
assert.strictEqual(lib.hookReply(perm, 'recommended').hookSpecificOutput.decision.behavior, 'allow');
assert.strictEqual(lib.hookReply(perm, 'deny').hookSpecificOutput.decision.behavior, 'deny');
assert.strictEqual(lib.hookReply(perm, 'terminal'), null);
assert.strictEqual(lib.permissionSummary(perm), 'npm test');

// launching
assert.strictEqual(lib.statusLineCommand("C:\\Users\\o'brien\\s.json", 'bash ~/x.sh'), "tee 'C:/Users/o'\\''brien/s.json' | ( bash ~/x.sh )");
assert.strictEqual(lib.statusLineCommand('/tmp/s.json'), "cat > '/tmp/s.json'");
assert.deepStrictEqual(lib.claudeArgs({ settingsFile: 's', model: 'opus', effort: 'high', worktree: 'w', prompt: '-x' }), ['--settings', 's', '--model', 'opus', '--effort', 'high', '--worktree', 'w', '--', '-x']);
assert.deepStrictEqual(lib.claudeArgs({ settingsFile: 's' }), ['--settings', 's']);
// resuming: the conversation already has its worktree and its first prompt
assert.deepStrictEqual(lib.claudeArgs({ settingsFile: 's', model: 'opus', worktree: 'w', prompt: 'again', resume: 'abc' }), ['--settings', 's', '--model', 'opus', '--resume', 'abc']);
const settings = lib.instanceSettings({ statusFile: '/tmp/s.json', hookUrl: 'http://127.0.0.1:1/t/i', userStatusLine: { type: 'command', command: 'mine', padding: 2 } });
assert.strictEqual(settings.statusLine.padding, 2);
assert.strictEqual(settings.hooks.PreToolUse[0].matcher, 'AskUserQuestion');
// normal launch: only API credentials are removed
assert.deepStrictEqual(lib.childEnv({ PATH: 'p', Anthropic_Api_Key: 'k', ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_GIT_BASH_PATH: 'b', CLAUDE_CONFIG_DIR: 'd' }),
  { PATH: 'p', CLAUDE_CODE_GIT_BASH_PATH: 'b', CLAUDE_CONFIG_DIR: 'd', COLORTERM: 'truecolor' });
// launched from inside a Claude Code session: that session's own variables go too
assert.deepStrictEqual(lib.childEnv({ PATH: 'p', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_CODE_ENTRYPOINT: 'e', CLAUDE_AGENT_SDK_VERSION: 'v', CLAUDE_PID: '1', CLAUDE_EFFORT: 'max', CLAUDE_CONFIG_DIR: 'd', ANTHROPIC_BASE_URL: 'u' }),
  { PATH: 'p', CLAUDE_CONFIG_DIR: 'd', ANTHROPIC_BASE_URL: 'u', COLORTERM: 'truecolor' });

// CPU / memory of a process tree
assert.strictEqual(lib.cpuSeconds('12:34.56'), 754.56);
assert.strictEqual(lib.cpuSeconds('12:34,56'), 754.56);   // a locale with a decimal comma
assert.strictEqual(lib.cpuSeconds('01:02:03'), 3723);
assert.strictEqual(lib.cpuSeconds('2-01:02:03'), 2 * 86400 + 3723);
const winProcs = lib.parseProcs(['100 1 1000000 20000000 500 claude.exe', '101 100 2000000 0 600 My App.exe', '4 0  0 0 System', 'garbage'], 'win32');
assert.deepStrictEqual([...winProcs.keys()], [100, 101]);   // the line with a missing field is skipped, not misread
assert.deepStrictEqual(winProcs.get(101), { pid: 101, ppid: 100, pgid: 0, mem: 2000000, cpu: 0, start: 600, name: 'My App.exe' });
assert.strictEqual(winProcs.get(100).cpu, 2);
const nixProcs = lib.parseProcs(['  501   1   501  2048   0:01.50 /usr/local/bin/node', '  502 501   502   512 00:00:07 ruff'], 'darwin');
assert.deepStrictEqual(nixProcs.get(501), { pid: 501, ppid: 1, pgid: 501, mem: 2048 * 1024, cpu: 1.5, start: 0, name: 'node' });
assert.strictEqual(nixProcs.get(502).cpu, 7);
// Linux: raw /proc/<pid>/stat lines, a header with the clock tick and page size; names may hold spaces and brackets
const stat = (pid, comm, ppid, pgrp, utime, stime, rss) => `${pid} (${comm}) S ${ppid} ${pgrp} ${pgrp} 0 -1 4194304 100 0 0 0 ${utime} ${stime} 0 0 20 0 1 0 12345 1000000 ${rss} 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 3 0 0 0 0 0`;
const linuxProcs = lib.parseProcs(['H 100 4096', stat(700, 'node', 1, 700, 150, 25, 2000), stat(701, 'tmux: server (1)', 700, 701, 7, 3, 10), 'truncated (line', ''], 'linux');
assert.deepStrictEqual(linuxProcs.get(700), { pid: 700, ppid: 1, pgid: 700, mem: 2000 * 4096, cpu: 1.75, start: 0, name: 'node' });
assert.deepStrictEqual([linuxProcs.size, linuxProcs.get(701).name, linuxProcs.get(701).ppid, linuxProcs.get(701).cpu], [2, 'tmux: server (1)', 700, 0.1]);
assert.strictEqual(lib.parseProcs(['H 250 16384', stat(9, 'x', 1, 9, 250, 250, 3)], 'linux').get(9).mem, 3 * 16384);   // other page sizes and tick rates
assert.strictEqual(lib.parseProcs(['H 250 16384', stat(9, 'x', 1, 9, 250, 250, 3)], 'linux').get(9).cpu, 2);
assert.ok(lib.samplerCommand('linux', 1)[1][1].includes('/proc/[0-9]*/stat') && lib.samplerCommand('darwin', 1)[1][1].includes('ps -A -o pid= -o ppid= -o pgid= -o rss= -o time= -o comm=;'));
// 100 -> 101 -> 102 and a new 103; 200 only looks like a child (stale parent pid, older than 100); 300 is unrelated
const P = (pid, ppid, cpu, start, mem = 10) => [pid, { pid, ppid, cpu, start, mem, name: `p${pid}` }];
const before = new Map([P(100, 1, 10, 500), P(101, 100, 4, 600), P(102, 101, 50, 700), P(300, 1, 0, 100)]);
const after = new Map([P(100, 1, 11, 500), P(101, 100, 4, 600), P(102, 101, 53, 700), P(103, 101, 6, 800), P(200, 100, 999, 50), P(300, 1, 99, 100)]);
const tree = lib.treeUsage(after, 100, before, 2);
assert.deepStrictEqual(tree.procs.map(p => [p.pid, p.cpu]), [[103, 3], [102, 1.5], [100, 0.5], [101, 0]]);
assert.deepStrictEqual([tree.cpu, tree.mem], [5, 40]);
assert.strictEqual(lib.treeUsage(after, 100, null, 0).cpu, 0);                 // first listing: nothing to compare with
assert.strictEqual(lib.treeUsage(after, 999, before, 2).procs.length, 0);      // root gone
assert.strictEqual(lib.treeUsage(new Map([P(0, 0, 1, 0)]), 0, null, 0).procs.length, 1);   // a self-parent does not loop
assert.strictEqual(lib.treeUsage(new Map([P(100, 1, 2, 500)]), 100, new Map([P(100, 1, 10, 400)]), 2).cpu, 1);   // reused pid
assert.deepStrictEqual(lib.byName([{ name: 'ruff', cpu: 2, mem: 5 }, { name: 'claude', cpu: 0.5, mem: 300 }, { name: 'ruff', cpu: 3, mem: 5 }]),
  [{ name: 'ruff', n: 2, cpu: 5, mem: 10 }, { name: 'claude', n: 1, cpu: 0.5, mem: 300 }]);
const [samplerCmd, samplerArgs] = lib.samplerCommand('win32', 1234);
assert.ok(samplerCmd === 'powershell.exe' && Buffer.from(samplerArgs.pop(), 'base64').toString('utf16le').includes('Get-Process -Id 1234'));
assert.strictEqual(lib.samplerCommand('linux', 1)[0], 'sh');

// CPU limits: the sharing policy. Every number is a share of the whole machine.
const near = (got, want, msg) => assert.ok(got.length === want.length && got.every((g, k) => Math.abs(g - want[k]) < 0.006), `${msg}: got ${got.map(x => x.toFixed(3))}, want ${want}`);
const inst = (used, limit = 1, weight = 1, ceiling = 1, was = used) => ({ used, was, limit, weight, ceiling });
const share = (insts, idle) => lib.shareCpu(insts, insts.reduce((s, i) => s + i.used, 0), idle);
// Where use and idle do not add up to 1, the rest is load outside the app, and the instances may claim a tenth of it.
near(share([], 1), [], 'no instances');
near(share([inst(0.1), inst(0.2)], 0.7), [1, 1], 'enough for everyone: nobody is limited');
near(share([inst(0.44, 0.45), inst(0.43, 0.45)], 0.02), [0.4505, 0.4505], 'two hogs at their limits split evenly');
near(share([inst(0.5, 0.5, 2), inst(0.25, 0.25, 1)], 0), [0.5167, 0.2583], 'weights 2:1');
near(share([inst(0.4, 0.4, 2), inst(0.2, 0.2, 1), inst(0.2, 0.2, 1)], 0), [0.41, 0.205, 0.205], 'weights 2:1:1');
near(share([inst(0.69), inst(0.22)], 0), [0.678, 0.4595], 'unfair start: the big one is cut, the small one may take its share');
near(share([inst(0.69), inst(0.22, 1, 1, 1, 0.1)], 0), [0.579, 0.4595], 'the same while the small one is still rising: more room for it');
near(share([inst(0.9), inst(0.05)], 0.05), [0.9375, 0.5], 'a light instance keeps what it needs, the hog gets the rest');
near(share([inst(0.95), inst(0)], 0.05), [0.99, 0.5], 'an idle instance costs a hog one percent');
near(share([inst(0.25, 0.25, 1, 0.25)], 0.5), [0.25], 'a ceiling alone is not contention');
near(share([inst(0.25, 0.25, 1, 0.25), inst(0.6)], 0), [0.25, 0.615], 'never above the ceiling');
// The policy in a loop against a toy kernel that hands out CPU unfairly (as Windows was measured to do).
function toyKernel(allowed, bias) {   // split the whole machine in proportion to bias, never above `allowed`
  const used = allowed.map(() => 0);
  let cap = 1, open = allowed.map((_, k) => k);
  while (open.length && cap > 1e-9) {
    const b = open.reduce((s, k) => s + bias[k], 0);
    const full = open.filter(k => allowed[k] <= cap * bias[k] / b + 1e-12);
    if (!full.length) { for (const k of open) used[k] = cap * bias[k] / b; break; }
    for (const k of full) { used[k] = allowed[k]; cap -= allowed[k]; }
    open = open.filter(k => !full.includes(k));
  }
  return used;
}
// outside: the bias of a process outside the app that takes all it can get (0 = there is none);
// start: the limits the instances begin with.
function simulate(demand, weights, bias, ceiling = 1, outside = 0, start = ceiling) {
  let limits = demand.map(() => start), used, was = demand.map(() => undefined);
  for (let tick = 0; tick < 30; tick++) {
    const all = toyKernel([...demand.map((d, k) => Math.min(d, limits[k])), ...(outside ? [1] : [])], [...bias, ...(outside ? [outside] : [])]);
    used = all.slice(0, demand.length);
    limits = lib.shareCpu(used.map((u, k) => ({ used: u, was: was[k], limit: limits[k], weight: weights[k], ceiling })), used.reduce((x, y) => x + y, 0), Math.max(0, 1 - all.reduce((x, y) => x + y, 0)));
    was = used;
  }
  return used;
}
near(simulate([1, 1], [1, 1], [3, 1]), [0.5, 0.5], 'two hogs end up even although the kernel favours one 3:1');
near(simulate([1, 1], [2, 1], [1, 3]), [0.667, 0.333], 'weights 2:1 against a kernel that favours the other');
near(simulate([1, 1, 1], [2, 1, 1], [1, 1, 5]), [0.5, 0.25, 0.25], 'three hogs 2:1:1');
near(simulate([1, 0.125], [1, 1], [3, 1]), [0.859, 0.125], 'a light instance keeps all it needs');
near(simulate([1, 1], [1, 1], [3, 1], 0.3), [0.3, 0.3], 'a ceiling holds for everyone');
near(simulate([0.2, 0.3], [1, 1], [1, 1]), [0.2, 0.3], 'no contention: nothing is taken away');
near(simulate([1, 1], [1, 1], [1, 1], 1, 1), [0.333, 0.333], 'beside a hog outside the app, the instances keep what the kernel gives them');
near(simulate([1, 1], [1, 1], [1, 1], 1, 1, 0.05), [0.333, 0.333], 'instances that were held down win their share back from that hog');
near(simulate([1], [1], [1], 1, 3, 0.05), [0.25], 'and so does a single instance');

// CPU limits: what the mechanisms are told
assert.deepStrictEqual(lib.scopeProps(0.5, 1, 16), ['CPUWeight=100', 'CPUQuota=800%']);       // half of 16 cores, in percent of one
assert.deepStrictEqual(lib.scopeProps(1, 2, 16), ['CPUWeight=200', 'CPUQuota=']);            // an empty value removes the quota
assert.deepStrictEqual(lib.scopeProps(0.001, 0.001, 16), ['CPUWeight=1', 'CPUQuota=2%']);
assert.deepStrictEqual(lib.scopeCommand('ab12', lib.scopeProps(1, 0.5, 16), '/usr/bin/claude', ['--model', 'x', '--', 'a b']),
  ['systemd-run', ['--user', '--scope', '--quiet', '--collect', '--unit', 'claudinho-ab12.scope', '-p', 'CPUWeight=50', '--', '/usr/bin/claude', '--model', 'x', '--', 'a b']]);
// pause-and-resume: 100 is the root (never paused); 102 leads its own group with 103; 104 shares group 110 with an outsider
const G = (pid, ppid, pgid) => [pid, { pid, ppid, pgid, start: 0, cpu: 0, mem: 0, name: 'p' }];
const groupsOf = new Map([G(100, 1, 100), G(101, 100, 100), G(102, 100, 102), G(103, 102, 102), G(104, 100, 110), G(400, 1, 110)]);
const targets = lib.throttleTargets(groupsOf, 100);
assert.deepStrictEqual([targets.groups, targets.pids.sort()], [[102], [101, 104]]);
assert.deepStrictEqual(lib.throttleTargets(groupsOf, 999), { groups: [], pids: [] });
const duty = (...a) => Math.round(lib.nextDuty(...a) * 1000) / 1000;
// (duty, measured use, target): close most of the gap at once; open up by at most a doubling per step
assert.deepStrictEqual([duty(1, 0.9, 0.45), duty(0.5, 0.45, 0.45), duty(0.2, 0.01, 0.45), duty(0.2, 0, 0.45), duty(0.4, 0.3, 1), duty(0.05, 0.9, 0.01)], [0.575, 0.5, 0.37, 0.37, 1, 0.02]);

// repo layout
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudinho-'));
const wt = lib.parseWorktrees(`worktree ${root}\nHEAD abc\nbranch refs/heads/main\n\nworktree ${path.join(root, '..', 'side')}\nHEAD def\nbranch refs/heads/feat\n`);
assert.deepStrictEqual(wt.map(w => [w.branch, w.main]), [['main', true], ['feat', false]]);
assert.deepStrictEqual(lib.labelFor(root, path.join(root, '.claude', 'worktrees', '12-x', 'src')), { worktree: '12-x', label: '12-x' });
assert.deepStrictEqual(lib.labelFor(root, path.join(root, 'src')), { worktree: null, label: path.basename(root) });
assert.strictEqual(lib.labelFor(root, path.join(root, '..', 'side'), wt).worktree, 'side');
assert.ok(lib.isInside(root, path.join(root, 'a')) && !lib.isInside(root, root + '-other'));
// one folder under two spellings
if (process.platform === 'win32') assert.ok(lib.samePath(root, root.toUpperCase()));
else { fs.symlinkSync(root, `${root}-link`); assert.ok(lib.samePath(root, `${root}-link`)); fs.unlinkSync(`${root}-link`); }
assert.ok(!lib.samePath(root, path.dirname(root)) && lib.samePath(path.join(root, 'gone'), path.join(root, 'gone')));

// .claude / .github scan, and the editor's path guard
for (const f of ['CLAUDE.md', '.claude/settings.json', '.claude/skills/deploy/SKILL.md', '.claude/agents/reviewer.md', '.claude/worktrees/w/big.txt', '.github/workflows/ci.yml']) {
  fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
  fs.writeFileSync(path.join(root, f), f.endsWith('settings.json') ? '{"hooks":{"Stop":[]}}' : 'x');
}
const scan = lib.scanConfig(root);
assert.ok(!scan.files.some(f => f.includes('worktrees')), 'worktree checkouts are not config');
assert.deepStrictEqual([scan.summary.skills, scan.summary.agents, scan.summary.workflows, scan.summary.hooks, scan.summary.memory], [1, 1, 1, true, true]);
assert.strictEqual(lib.defaultTemplate(root).includes('PROCESS.md'), false);
assert.ok(lib.configPath(root, '.claude/agents/reviewer.md').startsWith(root));
const winOnly = process.platform === 'win32' ? ['.claude/..\\src\\x.js'] : [];   // "\" only separates paths on Windows
for (const bad of ['../outside.txt', '.claude/../../outside.txt', '.claude/../src/x.js', 'src/index.js', 'package.json', '.claude', ...winOnly]) {
  assert.throws(() => lib.configPath(root, bad), /Not a config file/, bad);
}
fs.rmSync(root, { recursive: true, force: true });

// the home config folder: only what a person edits there is listed, and nothing else can be reached
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claudinho-home-'));
for (const f of ['CLAUDE.md', 'settings.json', '.credentials.json', 'history.jsonl', 'projects/p/s.jsonl', 'agents/reviewer.md', 'rules/style.md',
  'skills/mine/SKILL.md', 'skills/mine/ref/notes.md', 'skills/synced/bundle/pdf/SKILL.md', 'skills/.trash/old/SKILL.md']) {
  fs.mkdirSync(path.dirname(path.join(home, f)), { recursive: true });
  fs.writeFileSync(path.join(home, f), 'x');
}
assert.deepStrictEqual(lib.scanHome(home), ['CLAUDE.md', 'agents/reviewer.md', 'rules/style.md', 'settings.json', 'skills/mine/SKILL.md', 'skills/mine/ref/notes.md']);
assert.deepStrictEqual(lib.scanHome(path.join(home, 'nowhere')), []);
assert.ok(lib.homePath(home, 'skills/mine/SKILL.md').startsWith(home));
for (const bad of ['.credentials.json', 'history.jsonl', 'projects/p/s.jsonl', 'skills/../.credentials.json', 'agents/../../outside', '../outside', 'agents', 'settings.json.bak']) {
  assert.throws(() => lib.homePath(home, bad), /Not a config file/, bad);
}
fs.rmSync(home, { recursive: true, force: true });

console.log('ok');
