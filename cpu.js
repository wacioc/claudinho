// Per-instance CPU limits: a ceiling for each instance and weighted sharing between them.
// One mechanism per platform behind the same calls:
//
//   job       Windows. A job object per instance with a kernel hard cap, which is exact. The kernel's own job
//             weights and minimum rates do not divide the CPU fairly (measured: equal weights gave 67% / 23%),
//             so the shares are worked out here by lib.shareCpu, once a second, and enforced as caps.
//   cgroup    Linux with systemd 252 or later. A transient scope per instance: the kernel enforces CPUQuota and
//             shares by CPUWeight on its own, exactly and at once.
//   throttle  Everything else (macOS; Linux without a delegated cpu controller). An ordinary user has no kernel
//             CPU limit there, so the instance's processes are paused and resumed in short cycles, and the
//             shares are worked out by lib.shareCpu as on Windows.
//
// Every share is a fraction of the whole machine (0..1); a limit of 1 means none.
// No Electron in here, so `node cpu-check.js` can exercise the real mechanism on each OS.
const { execFile, execFileSync, spawn } = require('child_process');
const os = require('os');
const lib = require('./lib');

const CORES = os.cpus().length;
const UNLIMITED = 0.995;

const nothing = { kernelShares: false, accounts: false, command: (key, file, args) => [file, args], attach: () => false, setLimit() {}, setWeight() {}, observe() {}, cpuSeconds: () => null, detach() {}, shutdown() {} };

// ---------- Windows: job objects ----------

function jobObjects() {
  const koffi = require('koffi');   // FFI, only ever loaded on Windows
  const k32 = koffi.load('kernel32.dll');
  const CreateJobObjectW = k32.func('void * __stdcall CreateJobObjectW(void *attributes, const char16_t *name)');
  const OpenProcess = k32.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)');
  const AssignProcessToJobObject = k32.func('int __stdcall AssignProcessToJobObject(void *job, void *process)');
  const SetInformationJobObject = k32.func('int __stdcall SetInformationJobObject(void *job, int infoClass, void *info, uint32_t length)');
  const QueryInformationJobObject = k32.func('int __stdcall QueryInformationJobObject(void *job, int infoClass, void *info, uint32_t length, void *returned)');
  const CloseHandle = k32.func('int __stdcall CloseHandle(void *handle)');
  const SET_QUOTA_AND_TERMINATE = 0x0101;   // the process rights AssignProcessToJobObject asks for
  const CPU_RATE = 15, ACCOUNTING = 1;      // JOBOBJECTINFOCLASS
  const ENABLE_HARD_CAP = 0x1 | 0x4;        // JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP
  const jobs = new Map();

  function setLimit(key, share) {
    const job = jobs.get(key);
    if (!job) return;
    // JOBOBJECT_CPU_RATE_CONTROL_INFORMATION { DWORD ControlFlags; DWORD CpuRate; }. CpuRate is in hundredths of
    // a percent of the whole machine and may not be 0; all-zero flags switch rate control off.
    const info = Buffer.alloc(8);
    if (share < UNLIMITED) {
      info.writeUInt32LE(ENABLE_HARD_CAP, 0);
      info.writeUInt32LE(Math.min(10000, Math.max(1, Math.round(share * 10000))), 4);
    }
    SetInformationJobObject(job, CPU_RATE, info, 8);
  }
  function detach(key) {
    const job = jobs.get(key);
    if (!job) return;
    setLimit(key, 1);   // whatever outlives the instance is not left capped
    CloseHandle(job);
    jobs.delete(key);
  }
  return {
    ...nothing, mechanism: 'job', accounts: true, setLimit, detach,
    // Call this right after the process is created: everything it starts from then on is born inside the job,
    // and a process cannot leave a job.
    attach(key, pid) {
      const job = CreateJobObjectW(null, null);
      if (!job) return false;
      const proc = OpenProcess(SET_QUOTA_AND_TERMINATE, 0, pid);
      const ok = proc && AssignProcessToJobObject(job, proc);
      if (proc) CloseHandle(proc);
      if (!ok) { CloseHandle(job); return false; }
      jobs.set(key, job);
      return true;
    },
    // CPU seconds used so far by every process that was ever in the job, the ones that already exited included.
    cpuSeconds(key) {
      const job = jobs.get(key), info = Buffer.alloc(48);   // JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
      if (!job || !QueryInformationJobObject(job, ACCOUNTING, info, 48, null)) return null;
      return Number(info.readBigInt64LE(0) + info.readBigInt64LE(8)) / 1e7;   // TotalUserTime + TotalKernelTime, in 100 ns
    },
    shutdown() { for (const key of [...jobs.keys()]) detach(key); },
  };
}

// ---------- Linux: systemd scopes on cgroup v2 ----------

function cgroups() {
  // systemd accepts CPU settings on a user scope either way and silently ignores them when the cpu controller
  // is not delegated to the user (systemd before 252, e.g. Ubuntu 22.04). So ask the kernel: does a scope that
  // has a CPU setting really get the controller's files?
  try {
    execFileSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', '-p', 'CPUWeight=100', '--',
      'sh', '-c', 'test -e "/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)/cpu.max"'], { stdio: 'ignore', timeout: 10000 });
  } catch { return null; }
  const set = (key, property) => execFile('systemctl', ['--user', 'set-property', '--runtime', lib.scopeUnit(key), property], () => {});
  return {
    ...nothing, mechanism: 'cgroup', kernelShares: true,
    command: (key, file, args, limit, weight) => lib.scopeCommand(key, lib.scopeProps(limit, weight, CORES), file, args),
    attach: () => true,
    setLimit: (key, share) => set(key, lib.scopeProps(share, 1, CORES)[1]),
    setWeight: (key, weight) => set(key, lib.scopeProps(1, weight, CORES)[0]),
  };
}

// ---------- anywhere else: pause and resume ----------

function throttle() {
  const PERIOD = 100;         // ms. Each tree runs for duty x PERIOD, then is paused for the rest of it.
  // key -> { root, target, duty, ids, base }. ids: pids, and process groups as negative numbers.
  // base: [the duty the latest reading of the tree's use was taken under, that reading, the reading before it].
  const trees = new Map();
  // The duty for a tree's limit, from its latest reading. A tree that runs freely is paced only once its last
  // two readings average above the limit. Going by a single reading, two trees at their limits kept pacing
  // each other in turns, each swinging by a tenth of the machine every listing: a paced tree loses a little
  // more than its pause, the other takes that up, reads high, and is paced next.
  const dutyFor = t => {
    if (!t.base) return 1;   // no reading yet
    const [duty, used, before = used] = t.base;
    return duty >= 0.98 && (used + before) / 2 <= t.target * 1.03 ? 1 : lib.nextDuty(duty, used, t.target);
  };

  // The pausing itself is done by a helper process, which is sent the whole state, { key: [duty, ids] }, as one
  // line per change. It is not done in this process, for two reasons.
  // Timing: the cycle needs timers that fire on time, and the app's do not. It is busy with its terminals, and
  // macOS holds back the timers of an app whose window is hidden, by seconds (App Nap).
  // Safety: the helper resumes everything when our end of its stdin closes, which happens however we die, so
  // nothing can stay paused behind us.
  const PACER = `let trees = {}, buf = '';
const send = (ids, signal) => { for (const id of ids) if (id > 1 || id < -1) { try { process.kill(id, signal); } catch {} } };
const paced = () => Object.values(trees).filter(t => t[0] < 0.98).flatMap(t => t[1]);
setInterval(() => {
  for (const key of Object.keys(trees)) {
    const [duty, ids] = trees[key];
    if (duty >= 0.98) continue;
    send(ids, 'SIGCONT');   // every cycle starts with everything running
    setTimeout(() => { const t = trees[key]; if (t && t[0] < 0.98) send(t[1], 'SIGSTOP'); }, duty * ${PERIOD});
  }
}, ${PERIOD});
process.stdin.on('data', chunk => {
  const lines = (buf + chunk).split('\\n');
  buf = lines.pop();
  if (!lines.length) return;
  const before = paced();
  trees = JSON.parse(lines[lines.length - 1]);
  const still = new Set(paced());
  send(before.filter(id => !still.has(id)), 'SIGCONT');   // whoever is no longer paced does not stay paused
});
process.stdin.on('end', () => process.exit(0));
process.on('exit', () => send(paced(), 'SIGCONT'));`;
  let pacer = null;
  function tell() {
    try {
      if (!pacer) {
        if (![...trees.values()].some(t => t.duty < 0.98)) return;   // nothing to pause: no helper needed yet
        // ELECTRON_RUN_AS_NODE makes the app's own binary behave as plain Node; detached keeps the helper out
        // of reach of a hang-up or Ctrl+C meant for us. Its stderr is ours, so a crash in it can be seen.
        // ponytail: this relies on Electron's RunAsNode fuse, which is on by default. A packaged build that
        // switches the fuse off needs another way to run the helper.
        const child = spawn(process.execPath, ['-e', PACER], { stdio: ['pipe', 'ignore', 'inherit'], detached: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
        // Should the helper die, what it had paused must not stay paused. The next change starts a new helper.
        const gone = () => {
          if (pacer === child) pacer = null;
          for (const t of trees.values()) for (const id of t.ids) { try { process.kill(id, 'SIGCONT'); } catch { /* gone */ } }
        };
        child.on('error', gone);
        child.on('exit', gone);
        child.stdin.on('error', () => {});
        child.unref();
        if (child.stdin.unref) child.stdin.unref();
        pacer = child;
      }
      const state = {};
      for (const [key, t] of trees) state[key] = [t.duty, t.ids];
      pacer.stdin.write(JSON.stringify(state) + '\n');
    } catch { /* no helper, no pausing: the instance runs without its limit rather than taking the app down */ }
  }

  return {
    ...nothing, mechanism: 'throttle',
    attach(key, pid) { trees.set(key, { root: pid, target: 1, duty: 1, ids: [], base: null }); return true; },
    // A new limit steers by the latest reading at once; it does not wait for the next listing.
    setLimit(key, share) {
      const t = trees.get(key);
      if (!t) return;
      t.target = share;
      t.duty = dutyFor(t);
      tell();
    },
    // Called with each process listing: who belongs to the tree now, and how much CPU it used meanwhile.
    observe(key, procs, used) {
      const t = trees.get(key);
      if (!t) return;
      const { groups, pids } = lib.throttleTargets(procs, t.root);
      t.ids = [...groups.map(g => -g), ...pids];
      t.base = [t.duty, used, t.base ? t.base[1] : undefined];
      t.duty = dutyFor(t);
      tell();
    },
    detach(key) { if (trees.delete(key)) tell(); },
    shutdown() {
      trees.clear();
      if (pacer) { try { pacer.stdin.end(); } catch { /* already gone */ } pacer = null; }   // it resumes everything as it goes
    },
  };
}

function pick() {
  if (process.platform === 'win32') {
    try { return jobObjects(); } catch (e) { return { ...nothing, mechanism: 'none', error: e.message }; }
  }
  // CLAUDINHO_CPU=throttle forces the portable mechanism; that is how it gets tested on Linux.
  if (process.platform === 'linux' && process.env.CLAUDINHO_CPU !== 'throttle') {
    const kernel = cgroups();
    if (kernel) return kernel;
  }
  return throttle();
}

// ---------- the controller ----------

const m = pick();
const tracked = new Map();   // key -> { limit, weight, used, was, seen, sec, at }
let steppedAt = 0;           // when the last sharing step was taken
let lastTimes = os.cpus().map(c => c.times);

// The share of the machine that nobody used since the last call.
function idleShare() {
  const now = os.cpus().map(c => c.times);
  let idle = 0, all = 0;
  now.forEach((t, k) => {
    const p = lastTimes[k] || t;
    idle += t.idle - p.idle;
    all += (t.user + t.nice + t.sys + t.idle + t.irq) - (p.user + p.nice + p.sys + p.idle + p.irq);
  });
  lastTimes = now;
  return all > 0 ? Math.min(1, Math.max(0, idle / all)) : 0;
}

module.exports = {
  mechanism: m.mechanism, kernelShares: m.kernelShares, error: m.error, cores: CORES,

  // How to start an instance: [file, args], wrapped where the mechanism needs it (a systemd scope on Linux).
  command(key, file, args, { ceiling, weight }) { return m.command(key, file, args, ceiling, weight); },

  // Right after the instance's process exists. False means this instance cannot be limited.
  attach(key, pid, { ceiling, weight }) {
    if (!m.attach(key, pid)) return false;
    tracked.set(key, { limit: ceiling, weight });
    if (!m.kernelShares) m.setLimit(key, ceiling);   // a scope already starts with its quota and weight
    return true;
  },

  detach(key) { m.detach(key); tracked.delete(key); },

  // From each process listing: the tree's members, and the share of the machine it used since the last one.
  observe(key, procs, used) {
    const t = tracked.get(key);
    if (!t) return;
    t.seen = used;
    m.observe(key, procs, used);
  },

  limit(key) { const t = tracked.get(key); return t ? t.limit : 1; },

  // Keeps the limits current. Call it once a second and, with `listing` set, right after each process listing
  // has gone through observe(). ceiling: the most any instance may have; share: whether instances are balanced
  // by weight; weights: Map(key -> weight).
  balance({ ceiling, share }, weights, listing = false) {
    if (m.kernelShares) {   // the kernel does the sharing: just keep its settings current
      for (const [key, t] of tracked) {
        const weight = share ? weights.get(key) || 1 : 1;
        if (t.limit !== ceiling) { t.limit = ceiling; m.setLimit(key, ceiling); }
        if (t.weight !== weight) { t.weight = weight; m.setWeight(key, weight); }
      }
      return;
    }
    const set = (key, t, next) => { t.limit = next; m.setLimit(key, next); };
    // A ceiling alone takes no measuring: it applies at once, and exactly.
    if (!share) for (const [key, t] of tracked) if (t.limit !== ceiling) set(key, t, ceiling);
    // Sharing goes by measured use, one step at a time. A mechanism that keeps accounts (job objects) takes its
    // step on the once-a-second call and reads them there. One that does not (pause and resume) knows an
    // instance's use only from the process listing, so its step is the call that follows a listing. The
    // readings are taken on every step, sharing or not: each of them, the idle share included, then covers
    // exactly the stretch since the step before.
    const now = Date.now();
    if (listing === m.accounts || now - steppedAt < 500) return;   // not this mechanism's step, or called out of turn
    const primed = now - steppedAt < 10000;   // else: the first step after a break, whose idle share covers the break
    steppedAt = now;
    const idle = idleShare(), keys = [...tracked.keys()];
    let sum = 0, ready = primed;
    const insts = keys.map(key => {
      const t = tracked.get(key), seconds = m.cpuSeconds(key);
      let raw = t.seen;   // from the listing; or, exactly, from the mechanism's own accounts
      t.seen = undefined;   // a reading counts once
      if (seconds !== null) {
        raw = t.sec === undefined ? undefined : Math.max(0, (seconds - t.sec) / ((now - t.at) / 1000) / CORES);
        t.sec = seconds; t.at = now;
      }
      if (raw === undefined) { ready = false; return null; }
      sum += raw;
      t.was = t.used;
      t.used = t.used === undefined ? raw : (t.used + raw) / 2;   // single readings jitter by a tenth or so
      return { weight: weights.get(key) || 1, ceiling, used: t.used, was: t.was, limit: Math.min(t.limit, ceiling) };
    });
    // Decide only when every instance has a reading for this stretch: one that is missing would be counted
    // neither as used nor as idle, and the rest would be squeezed into what seems to be left.
    if (!share || !ready) return;
    const limits = lib.shareCpu(insts, sum, idle);
    keys.forEach((key, k) => {
      const t = tracked.get(key), next = limits[k];
      // Small moves are not worth disturbing the enforcement for. Reaching the ceiling, or being above it, always is.
      if (next === ceiling ? t.limit !== next : t.limit > ceiling || Math.abs(next - t.limit) > Math.max(0.02, 0.08 * t.limit)) set(key, t, next);
    });
  },

  shutdown() { m.shutdown(); tracked.clear(); },
};
