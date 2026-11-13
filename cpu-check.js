// node cpu-check.js [scenario name...]
// Exercises this machine's real CPU-limit mechanism (see cpu.js) with real load, and checks the numbers.
// It keeps every core busy for about three minutes. Other load on the machine moves the numbers, so the
// tolerances are wide; the printed figures are the real result.
// CPU_CHECK_VERBOSE=1 prints every sample, for reading a run on a machine you cannot watch.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const lib = require('./lib');
const cpu = require('./cpu');

const CORES = cpu.cores;
const VERBOSE = !!process.env.CPU_CHECK_VERBOSE;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = x => `${(x * 100).toFixed(1)}%`;

// A stand-in for an instance: a quiet root, like Claude Code, that starts N children which spin for S seconds.
const ROOT = `const { spawn } = require('child_process'); const [n, s] = process.argv.slice(1).map(Number);
setTimeout(() => { const kids = Array.from({ length: n }, () => spawn(process.execPath, ['-e', 'const end = Date.now() + ' + s * 1000 + '; while (Date.now() < end) {}'], { stdio: 'ignore' }));
Promise.all(kids.map(k => new Promise(r => k.on('exit', r)))).then(() => process.exit(0)); }, 500);`;

// The same process listing the app uses, as an independent measurement of each tree.
const trees = new Map();   // key -> { pid, samples: [[time, share]] }
const born = Date.now();
let procs = null, prev = null, at = 0, shownFormat = false;
// What the limits are run with at the moment; a scenario swaps its own in. As in the app, the controller is
// called after every listing and once a second, whether anything is being limited or not.
const nothingOn = { settings: { ceiling: 1, share: false }, weights: new Map() };
let live = nothingOn;
// The whole machine's busy share between two listings, from the operating system's own counters: a second
// opinion that does not come from the process listing the limits are steered by.
const machine = { samples: [] };
let cpusThen = os.cpus();
function machineBusy() {
  const cpus = os.cpus(), sum = t => t.user + t.nice + t.sys + t.idle + t.irq;
  let idle = 0, all = 0;
  cpus.forEach((c, k) => { const p = (cpusThen[k] || c).times; idle += c.times.idle - p.idle; all += sum(c.times) - sum(p); });
  cpusThen = cpus;
  return all > 0 ? 1 - idle / all : 0;
}
const [listCmd, listArgs] = lib.samplerCommand(process.platform, process.pid);
const lister = spawn(listCmd, listArgs, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
let rest = '', lines = [];
lister.stdout.setEncoding('utf8');
lister.stdout.on('data', chunk => {
  const parts = (rest + chunk).split(/\r?\n/);
  rest = parts.pop();
  for (const line of parts) {
    if (line !== 'END') { lines.push(line); continue; }
    const now = Date.now();
    if (VERBOSE && !shownFormat) { shownFormat = true; console.log(`   listing: ${lines.length} lines, the first ones: ${JSON.stringify(lines.slice(0, 3))}`); }
    procs = lib.parseProcs(lines); lines = [];
    for (const [key, t] of trees) {
      const used = lib.treeUsage(procs, t.pid, prev, prev ? (now - at) / 1000 : 0).cpu / CORES;
      t.samples.push([now, used]);
      cpu.observe(key, procs, used);
    }
    cpu.balance(live.settings, live.weights, true);
    machine.samples.push([now, machineBusy()]);
    if (VERBOSE && trees.size) {
      console.log(`   ${((now - born) / 1000).toFixed(1).padStart(6)}s  ${procs.size} processes, machine ${pct(machine.samples[machine.samples.length - 1][1])} busy   ` + [...trees].map(([key, t]) => `${pct(t.samples[t.samples.length - 1][1])} (limit ${pct(cpu.limit(key))}, ${lib.treeOf(procs, t.pid).length} in tree)`).join('   '));
    }
    prev = procs; at = now;
  }
});

function start(key, busy, seconds, settings, weight) {
  const effective = { ceiling: settings.ceiling, weight: settings.share ? weight : 1 };
  const [file, args] = cpu.command(key, process.execPath, ['-e', ROOT, String(busy), String(seconds)], effective);
  const child = spawn(file, args, { stdio: 'ignore' });
  const tree = { pid: child.pid, samples: [], done: new Promise(r => child.on('exit', r)) };
  if (!cpu.attach(key, child.pid, effective)) throw new Error('this mechanism could not take the process');
  trees.set(key, tree);
  return tree;
}
const mean = (tree, from, to) => {
  const xs = tree.samples.filter(([t]) => t >= from && t <= to).map(([, u]) => u);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
};
// How many of these processes are stopped right now (state T)?
function stoppedAmong(pids) {
  if (!pids.length) return 0;
  try { return execFileSync('ps', ['-o', 'stat=', '-p', pids.join(',')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(s => s.trim().startsWith('T')).length; }
  catch { return 0; }   // ps exits non-zero when none of them exists any more
}

// plan: [{ busy, weight }]; settings may be changed by `midway` half-way through (to test lifting a limit).
async function scenario(name, settings, plan, expect, midway) {
  const seconds = midway ? 30 : 22, t0 = Date.now(), weights = new Map();
  if (VERBOSE) console.log(`-- ${name}`);
  live = { settings, weights };
  const run = `c${process.pid}x${++runs}`;   // keys become systemd unit names on Linux: plain letters and digits
  const started = plan.map((p, k) => { weights.set(`${run}n${k}`, p.weight || 1); return start(`${run}n${k}`, p.busy, seconds, settings, p.weight || 1); });
  const ticker = setInterval(() => cpu.balance(settings, weights), 1000);
  let first;
  if (midway) {
    await sleep(14000);
    first = started.map(t => mean(t, t0 + 7000, t0 + 14000));
    midway(settings, weights);
  }
  await sleep(midway ? 14500 : 20500);
  const end = t0 + (midway ? 28000 : 20000);
  const got = started.map(t => mean(t, end - 9000, end));
  clearInterval(ticker);
  await Promise.all(started.map(t => t.done));
  for (const key of weights.keys()) { cpu.detach(key); trees.delete(key); }
  live = nothingOn;
  const verdict = expect(got, first);
  console.log(`${verdict ? 'ok  ' : 'FAIL'}  ${name.padEnd(22)} ${(first ? `before: ${first.map(pct).join(' / ')}   after: ` : '') + got.map(pct).join(' / ')}   (whole machine: ${pct(mean(machine, end - 9000, end))} busy)`);
  await sleep(2500);
  return verdict;
}

let runs = 0;
const lightBusy = Math.max(1, Math.round(CORES / 8)), light = lightBusy / CORES;
const scenarios = {
  // One instance loading every core, held to a quarter of the machine.
  ceiling: () => scenario('ceiling 25%', { ceiling: 0.25, share: false }, [{ busy: CORES }], ([a]) => a > 0.17 && a < 0.31),
  // Two instances both loading every core: equal weights should come out about even.
  equal: () => scenario('equal weights', { ceiling: 1, share: true }, [{ busy: CORES }, { busy: CORES }], ([a, b]) => a / b > 0.7 && a / b < 1.43),
  // The same with weights 2:1. Linux kernel weights act per core and come out flatter than 2:1 under load.
  weighted: () => scenario('weights 2:1', { ceiling: 1, share: true }, [{ busy: CORES, weight: 2 }, { busy: CORES, weight: 1 }], ([a, b]) => a / b > 1.2 && a / b < 3),
  // A light instance beside a heavy one keeps most of what it asks for. Needs room for "light" to mean something.
  light: () => (CORES < 3 ? (console.log('skip  light beside heavy (needs at least 3 cores)'), true)
    : scenario('light beside heavy', { ceiling: 1, share: true }, [{ busy: CORES }, { busy: lightBusy }], ([a, b]) => b > 0.5 * light && a > 1.3 * b)),
  // Sharing together with a ceiling: nobody goes above the ceiling.
  both: () => scenario('share + ceiling 30%', { ceiling: 0.3, share: true }, [{ busy: CORES }, { busy: CORES }], ([a, b]) => a < 0.36 && b < 0.36 && a / b > 0.7 && a / b < 1.43),
  // Sharing beside a busy process that is not ours. Both instances are first held at a tenth of the machine while
  // the outsider helps itself to the rest; when that ceiling goes, they have to win ground back from it. (How
  // much they get is up to the system; the point is that they are not stuck where they were held.)
  outside() {
    spawn(process.execPath, ['-e', ROOT, String(CORES), '30'], { stdio: 'ignore' });   // never attached: no limit, no weight
    return scenario('beside outside load', { ceiling: 0.1, share: true }, [{ busy: CORES }, { busy: CORES }],
      ([a, b], [a0, b0]) => a0 < 0.13 && b0 < 0.13 && a > 1.3 * a0 && b > 1.3 * b0 && a + b > 1.5 * (a0 + b0), s => { s.ceiling = 1; });
  },
  // A ceiling that is lifted while the instance runs.
  release: () => scenario('ceiling lifted', { ceiling: 0.25, share: false }, [{ busy: CORES }], ([after], [before]) => before < 0.31 && after > Math.max(0.33, before * 1.25), s => { s.ceiling = 1; }),

  // Closing an instance together with its worktree ends everything the instance started, also what has detached
  // itself from its terminal: on Windows a running program holds its folder, which then could not be deleted.
  // Twice: once with nobody of the job to spare (the one named is this check itself, outside the job), and once
  // with one of the detached processes to be left running (the way Docker Desktop is, see lib.sparedPids).
  async stop() {
    if (cpu.mechanism !== 'job') { console.log(`skip  stop everything        (not needed with the ${cpu.mechanism} mechanism: there a folder can be deleted under a running program)`); return true; }
    const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const detached = `require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { detached: true, stdio: 'ignore' }).pid`;
    let all = true;
    for (const sparing of [false, true]) {
      const root = spawn(process.execPath, ['-e', `setTimeout(() => console.log(${detached}, ${detached}), 500); setTimeout(() => {}, 60000);`], { stdio: ['ignore', 'pipe', 'ignore'] });
      if (!cpu.attach('s', root.pid, { ceiling: 1, weight: 1 })) throw new Error('this mechanism could not take the process');
      const [one, two] = String(await new Promise(r => root.stdout.once('data', d => r(String(d))))).trim().split(' ').map(Number);
      const before = [root.pid, one, two].filter(alive).length;
      const left = cpu.stop('s', new Set([sparing ? two : process.pid]));
      await sleep(1000);
      const after = [root.pid, one, two].filter(alive);
      cpu.detach('s');
      for (const pid of after) { try { process.kill(pid); } catch { /* gone */ } }
      const verdict = before === 3 && (sparing ? after.length === 1 && after[0] === two && left.length === 1 && left[0] === two : after.length === 0 && left.length === 0);
      console.log(`${verdict ? 'ok  ' : 'FAIL'}  ${(sparing ? 'stop all but one' : 'stop everything').padEnd(22)} running before: ${before} of 3 (two of them detached); after: ${after.length}${sparing ? `, ${after[0] === two ? 'the one to be left running' : 'NOT the one to be left running'}` : ''}`);
      all = all && verdict;
    }
    return all;
  },

  // The safety net of the pause-and-resume mechanism, in two halves. First the helper process that does the
  // pausing is killed, and in the same breath the limit is lifted: no new helper is needed then, so only the
  // controller itself can resume what the old helper had paused.
  helper() {
    if (cpu.mechanism !== 'throttle') { console.log(`skip  kill the helper        (the ${cpu.mechanism} mechanism never pauses anything)`); return true; }
    return scenario('kill the helper', { ceiling: 0.25, share: false }, [{ busy: CORES }], ([after], [before]) => before < 0.31 && after > Math.max(0.33, before * 1.25), (s, weights) => {
      const helper = [...procs.values()].find(p => p.ppid === process.pid && p.pgid === p.pid);   // our only child that leads a group of its own
      if (!helper) throw new Error('found no helper process to kill');
      process.kill(helper.pid, 'SIGKILL');
      s.ceiling = 1;
      cpu.balance(s, weights);
    });
  },
  // Then the controller: a second copy of this script throttles a tree hard and is killed outright in the
  // middle of a pause, so none of its exit handlers run. Everything that was paused must be running again
  // shortly after.
  async watchdog() {
    if (cpu.mechanism !== 'throttle') { console.log(`skip  kill the controller    (the ${cpu.mechanism} mechanism never pauses anything)`); return true; }
    if (VERBOSE) console.log('-- kill the controller');
    const sup = spawn(process.execPath, [__filename, '--supervisor'], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    sup.stdout.on('data', d => { out += d; });
    const giveUp = setTimeout(() => sup.kill('SIGKILL'), 45000);
    await new Promise(r => sup.on('exit', r));
    clearTimeout(giveUp);
    await sleep(1500);   // time for the helper to notice, and for the last of the output to arrive
    if (VERBOSE) console.log(out.trimEnd().split('\n').map(l => '   | ' + l).join('\n'));
    const root = Number((/ROOT (\d+)/.exec(out) || [])[1]), paused = Number((/PAUSED (\d+)/.exec(out) || [])[1]) || 0;
    const kids = () => (root ? lib.treeOf(procs, root).filter(p => p.pid !== root) : []);
    const nextListing = async () => { const stamp = at; while (at === stamp) await sleep(100); };
    await nextListing();
    const stillPaused = stoppedAmong(kids().map(p => p.pid)), alive = kids().length;
    const cpuThen = kids().reduce((s, p) => s + p.cpu, 0);
    await nextListing();
    const advanced = kids().reduce((s, p) => s + p.cpu, 0) - cpuThen;
    if (root) { try { process.kill(-root, 'SIGKILL'); } catch { /* already gone */ } }   // it was started as its own group
    const verdict = paused > 0 && alive > 0 && stillPaused === 0 && advanced > 0.3;
    console.log(`${verdict ? 'ok  ' : 'FAIL'}  ${'kill the controller'.padEnd(22)} paused when it died: ${paused} of ${alive}; still paused 1.5 s later: ${stillPaused}; CPU used since: ${advanced.toFixed(1)} s`);
    return verdict;
  },
};

// The second copy for the watchdog scenario (see there).
function supervisor() {
  const child = spawn(process.execPath, ['-e', ROOT, String(Math.max(2, Math.min(4, CORES))), '60'], { stdio: 'ignore', detached: true });   // its own group: it outlives us
  child.unref();
  fs.writeSync(1, `ROOT ${child.pid}\n`);
  live = { settings: { ceiling: 0.05, share: false }, weights: new Map() };
  cpu.attach('w', child.pid, { ceiling: 0.05, weight: 1 });
  trees.set('w', { pid: child.pid, samples: [] });
  const since = Date.now();
  setInterval(() => {
    if (Date.now() - since < 9000 || !procs) return;   // a few listings first, so the tree is known and throttled
    const kids = lib.treeOf(procs, child.pid).filter(p => p.pid !== child.pid).map(p => p.pid);
    if (kids.length && stoppedAmong(kids) === kids.length) {
      fs.writeSync(1, `PAUSED ${kids.length}\n`);
      process.kill(process.pid, 'SIGKILL');
    }
  }, 20);
}

if (process.argv[2] === '--supervisor') supervisor();
else (async () => {
  console.log(`mechanism: ${cpu.mechanism}${cpu.error ? ` (${cpu.error})` : ''}   cores: ${CORES}   platform: ${process.platform} ${process.arch}   node ${process.version}`);
  if (cpu.mechanism === 'none') process.exit(1);
  while (!procs) await sleep(200);   // first listing
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios);
  let failed = 0;
  try {
    for (const name of names) failed += (await scenarios[name]()) ? 0 : 1;
  } catch (e) {   // a scenario that broke half-way leaves its load running: no point in measuring on top of it
    console.log(`FAIL  ${e.stack}`);
    failed++;
  }
  cpu.shutdown();
  lister.kill();
  console.log(failed ? `${failed} scenario(s) outside tolerance` : 'all scenarios within tolerance');
  process.exit(failed ? 1 : 0);
})();
