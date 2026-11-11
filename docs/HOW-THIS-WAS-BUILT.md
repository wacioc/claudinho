# How claudinho was built

claudinho was built in one long working session on 10 and 11 November 2026, between its owner and Claude
(Anthropic's model, working as Claude Code on the owner's Windows PC). The owner wrote the brief, answered the
design questions and decided what came next at every step. Claude wrote the code and ran the tests.

This file is the record of that session: what was asked, what was decided and why, what was measured, what
went wrong, and what is still unverified. It is here so that whoever continues the project, a person or
another agent, starts with the context that session had.

- [README.md](../README.md) says what the app does and how to run it.
- [CLAUDE.md](../CLAUDE.md) holds short working notes for agents.
- This file says why things are the way they are.

## 1. The brief

The owner asked for a monitor for the Claude Code agents running in a repository. The requirements, grouped the
way the work was organised:

**Repository**

- Start by pointing the app at a GitHub repository or a plain folder.
- Detect an existing `.claude` setup and any `.github` configuration.

**Instances**

- A main view of every Claude Code instance that is running, each as a terminal, titled with the worktree it
  works in, or the folder name for the main folder.
- Start a plain instance in the default folder from that view, and start a new worktree with an instance in it.
- Click an instance for a detail view with a panel of all its environment variables.
- Per instance: context window size, API-equivalent cost, and how long it has been up.
- Per instance: a checkbox to merge its pull request automatically once it has finished its work.
- A setting with three levels for the moments Claude needs input: manual (always wait for the owner), a middle
  level, and auto (take the recommended option).
- Terminal look and feel throughout.

**Issues**

- List the repository's issues, open ones by default, show which are blocked, and by which issue numbers.
- Select one or several issues, right-click, and send a Claude Code instance to tackle each one, with a chosen
  model and effort, the way the owner's `claude_worktree` shell helper does it.
- With several issues selected, two more settings: how many agents may run at once (at most 4), and how
  autonomous they are. Manual: nothing is merged automatically. Semi-auto: the agent decides whether merging is
  safe. Full-auto: every pull request is merged when its instance considers the work finished.

**The `.claude` panel**

- Show what is defined under `.claude` (skills, agents and the rest) and edit it inline.
- After a change, offer to commit it to GitHub if the folder is a repository.
- "Create new skill" and "create new agent" buttons that take a prompt and generate the item, with room for
  follow-up questions; for an agent also its model and effort level.

**Account**

- The logged-in account's email and its 5-hour and 7-day usage in the main view, as the owner's own status line
  script shows them.

**Constraints**

- A desktop app, not a web app, that runs on Windows, macOS and Linux.
- It works on the owner's Claude Code subscription. No API tokens.
- Organise the ideas first, then plan, then build, and ask when something is uncertain.

Requests that followed, in order:

1. Test the automatic merge for real.
2. Show the CPU and memory used by the processes each instance starts, in the main view and the detail view.
3. Add a setting that balances CPU between instances so that none can take the whole machine.
4. "I want true percentage caps and weighted sharing. This needs to work on Windows, MacOS and Linux. Make no
   mistake."
5. Run the check of those limits on a real Mac. It ran three times; section 6 says why.
6. Publish the app, with this record, to GitHub.

## 2. Four questions, four answers

Before any code, Claude asked about the points the brief left open.

| Question | The owner's answer |
|---|---|
| What is the middle input level? | Timed: wait a few minutes for the owner, then take the recommended option. |
| Several issues at once: one agent after another, or side by side? | A pool: one instance per issue, at most N at once, the rest queue, and a blocked issue waits for its blockers. |
| Which desktop stack? | Electron. |
| Which merge method? | Squash. It is a setting. |

## 3. Decisions and their reasons

**The instances are the real `claude` program, each in a pseudo-terminal.** This is what makes the subscription
requirement hold without the app ever touching credentials: the CLI is already logged in. `node-pty` provides
the terminal and `xterm.js` draws it. `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are removed from every
instance's environment, so a key that happens to be set cannot switch an instance to API billing.

**Everything the app knows about a session comes through documented Claude Code interfaces.** Each instance is
started with its own `--settings` file, which sits above the user's and the project's settings for that session
only:

- The status line command becomes `tee <file> | ( <the user's own status line> )`. Claude Code pipes a JSON
  document with cost, context window and rate limits into the status line; the app reads the saved copy, and
  the terminal looks as it did before.
- HTTP hooks point at a small server inside the app: `PreToolUse` with the matcher `AskUserQuestion`,
  `PermissionRequest`, and `Stop`.
- Session status, also for sessions started outside the app, comes from `claude agents --json`; the account
  comes from `claude auth status`.

**The input levels live in that hook server.** Manual: the app replies with an empty body, and Claude Code shows
its own dialog in the terminal. Auto: the app replies at once, with the option labelled "(Recommended)" or else
the first one for a question, and with "allow" for a permission request. Timed: the app holds the HTTP request
open, shows it on the instance's card, and replies when the owner answers or when the deadline passes. The
hooks are registered with a two-hour timeout so that a held request is not cut off.

**GitHub goes through the `gh` CLI.** The app handles no tokens. Issues come from one GraphQL query that
includes `blockedBy`, GitHub's native issue dependencies. A blocker counts as done only when it is closed as
completed. An issue with a plain `blocked` label is shown as blocked too; it just has no number to show.

**Dispatch follows the owner's shell helper.** The worktree is named `<number>-<slugged title>`, without a
leading `TYPE | ` prefix and cut to whole words within 64 characters, and the instance is started with
`claude --worktree <name> --model … --effort … -- "<prompt>"`. The default prompt is
"Implement #N following docs/PROCESS.md" when the target repository has that file, and a self-contained one
otherwise. The pool starts at most 4 instances and checks the blockers of queued issues again every 5 minutes,
as the helper does.

**"Finished" has a concrete meaning.** The agent ended its turn (the `Stop` hook fired) and its branch has an
open pull request that is not a draft. With automatic merge on, the app then runs `gh pr merge --squash --auto`.

**The window has no framework and no build step.** It is plain JavaScript with one small DOM helper and native
`<dialog>` forms, under context isolation and a content security policy. The preload script exposes four
functions.

**Logic that can run without Electron lives in `lib.js`, with plain asserts in `test.js`.** The CPU limits live
in `cpu.js`, also free of Electron, so that `cpu-check.js` can exercise the real mechanism of whatever machine
it runs on.

**The smallest thing that works.** The session ran under a rule the owner set: no speculative options, the
standard library and the platform before a dependency, and one runnable check for logic that can break. Where
a shortcut was taken on purpose, a comment starting with `ponytail:` names its ceiling and the way up.

## 4. How the app was verified

All of this was done on Windows, with real Claude Code sessions.

The window was driven over the Chrome DevTools protocol: the app is started with `--remote-debugging-port`, and
a script evaluates expressions in the page and takes screenshots. Test launches used a throwaway
`--user-data-dir`, so the owner's real app data was never touched.

What was exercised that way:

- Plain instances and worktree instances, their titles, the detail view and the environment panel.
- The input levels: Auto, and Timed both with an answer given on the card and with the deadline taking the
  recommended option.
- Dispatching issues through the pool.
- Editing a `.claude` file with the commit prompt, including a push (to a local bare remote).
- The agent generator.
- Sessions started outside the app showing up as status-only cards.
- Starting the app from a shell that itself runs inside a Claude Code session.
- Automatic merge, live: against a throwaway private repository, the app merged the pull requests of
  dispatched agents.
- CPU and memory per instance, and the CPU limits inside the app: two instances under real load, shared
  equally, then two shares against one, then a 20% ceiling.

What was not exercised:

- Copy and paste in the terminals. Testing it would have read and overwritten the owner's clipboard.
- "New skill". It shares its code path with "New agent", which was.
- Semi-auto autonomy.
- A queued issue waiting out the 5-minute recheck on an open blocker. The hand-over itself was seen working.
- The app as a whole on macOS or Linux. Only the CPU limits were run there (section 6).

## 5. What went wrong on the way

| Symptom | Cause | What changed |
|---|---|---|
| In Timed mode, permission prompts were approved by nobody. | With Remote Control on, Claude Code relays a prompt to the owner's other devices, and an answer there wins. | Nothing was broken. Requests that Claude Code no longer waits on are now dropped from the card, also when a turn ends. |
| Terminal text read from the page was stale for cards scrolled out of view. | xterm.js stops drawing terminals that are off-screen. | Tests read the terminal's buffer, not the page. |
| Instances misbehaved when the app was started from a shell inside a Claude Code session. | They inherited that session's private wiring through `CLAUDE*` variables. | In that case only, `CLAUDE*` variables are dropped, except `CLAUDE_CONFIG_DIR`. |
| `npm install` refused to build `node-pty`. | npm 11 runs install scripts only for approved packages. | `allowScripts` in `package.json`. |
| On macOS, `node-pty` 1.1.0 ships its `spawn-helper` without the executable bit. | Packaging of the prebuilt binary. | The app sets the bit at start-up. This guard has not run on a Mac yet. |
| A 25% CPU ceiling ran at 56% with pause-and-resume on Linux. | `ps` on Linux prints CPU time in whole seconds, far too coarse to steer by. | On Linux the listing reads `/proc/<pid>/stat` (10 ms ticks). |
| With sharing on, limits dropped to 1% for a moment whenever load ramped up, then took 20 seconds to settle. | The step mixed readings from different stretches of time. | One step per measurement; see section 6. |
| Instances that had been held down beside a busy program outside the app stayed down. | Their limit was derived from what they used, and the other program took whatever they left. | The instances may claim a tenth of what outside programs use; see section 6. |

## 6. CPU: from a display to real limits

This part took the most work, and it is where the measurements matter.

### The display

One listing of all processes every 2 seconds: PowerShell with CIM on Windows, `/proc` on Linux, `ps` on macOS.
An instance's numbers cover its process tree, found through parent process ids: Claude Code plus everything it
started. CPU is shown as a share of the whole machine.

### The first limit, and why it was replaced

The first answer to "no instance may hog the CPU" pinned each instance to a set of cores. It worked in whole
cores only, and an instance could not borrow cores that stood idle. The owner then asked for true percentage
caps and weighted sharing on all three systems, and the pinning was removed.

### What each system offers

**Windows: job objects.** A job object per instance, with a kernel hard cap in hundredths of a percent of the
whole machine. The cap is exact. Windows also has job weights and minimum rates; they were tried and do not
divide the CPU fairly (two jobs with the same weight measured 67% and 23%). So on Windows the shares are worked
out by the app and enforced through the hard caps. The job's own accounting gives exact CPU seconds per
instance.

**Linux: systemd scopes on cgroup v2.** Each instance runs in a transient scope
(`systemd-run --user --scope`) with `CPUQuota` and `CPUWeight`; the kernel does both the capping and the
sharing, and changes are applied with `systemctl --user set-property --runtime`. This needs the `cpu`
controller delegated to the user's session, which systemd does from version 252. Older systems accept the
settings and silently ignore them, so the app asks the kernel at start-up whether a scope really gets a
`cpu.max` file, and falls back to pausing and resuming if not.

**macOS: nothing in the kernel, so pause and resume.** macOS gives an app no CPU cap and no weights for other
processes. The app therefore pauses and resumes an instance's processes with `SIGSTOP` and `SIGCONT` in 100 ms
cycles and adjusts the running fraction from measured use. Claude Code's own process is never paused: its
terminal has to stay alive, and a paused terminal program redraws itself on every resume.

### The sharing policy

`shareCpu` in `lib.js` is weighted max-min fairness, recomputed at every step:

- While there is enough for everyone, nobody is limited below its ceiling.
- Under contention, each instance's want is estimated: anything up to its ceiling if it presses against its
  limit, otherwise its current use plus room to grow.
- Instances that want less than their weighted share keep what they want. The rest is divided among the others
  by weight. Nobody is ever limited below its weighted share.
- What the instances have between them is what they used, plus what nobody used, plus a tenth of what programs
  outside the app used. Without that tenth, a limited instance could never win anything back from a busy
  outside program.

A step needs every reading to cover the same stretch of time. On Windows the step runs once a second and reads
the job accounting right there. With pause-and-resume the step runs on the call that follows each process
listing, because the listing is the only measurement. A step is skipped until every instance has a reading.

A ceiling needs no measuring: it applies at once, and exactly.

### The helper process

The pause cycle is not run by the app's own process. A small helper, the app's own binary started as plain
Node, receives the state as one line per change and does the pausing. There are two reasons:

- Timing. A 100 ms cycle needs timers that fire on time. The app is busy with its terminals, and macOS delays
  the timers of an app whose window is hidden (App Nap, from Apple's documentation; the delay itself was not
  measured here).
- Safety. If the app dies, however it dies, the helper's input closes, and it resumes everything before it
  exits. If the helper dies, the app resumes everything and starts a new helper at the next change. Both
  directions are scenarios in `cpu-check.js`.

### What the Mac runs changed

The project has no Mac. The check ran on a GitHub Actions macOS runner (macOS 26, Apple silicon, 5 cores).

Before the first run, re-reading the code for that run found two things. `ps` on macOS prints CPU time with the
locale's decimal mark, so a comma would have made every reading unusable; the parser now accepts any mark. And
the pause cycle moved into the helper described above.

| Run | Result | What its trace led to |
|---|---|---|
| 1 | All 8 scenarios passed. Two equal instances got 43.8% / 43.4%, with 11% of the machine unused; weights 2:1 gave 55.6% / 30.1%. | The sharing step was reworked: one step per measurement, readings from one stretch of time, the claim on outside load, exact ceilings. A second problem showed on Linux afterwards: two instances at their limits paced each other in turns. An instance is now paced only once two readings in a row average above its limit. |
| 2 | All 9 passed. 46.2% / 46.1%, and 63.0% / 33.8%. | The first step after instances start could still set limits too low for about two seconds. The step is now tied to an explicit "this call follows a listing" flag. |
| 3 | All 9 passed, on the code in this repository. | Nothing. |

Each change was first verified on Linux with pause-and-resume forced, which is the same code path. Its numbers
matched the Mac's closely every time.

### Final numbers

`npm run check:cpu` on the final code. Every figure is a share of the whole machine, averaged over 9 seconds.
Other load on the machine moves them, most visibly on the Windows PC.

| Scenario | Windows, job objects (16 threads) | Linux, kernel groups (16 threads, WSL) | Linux, pause and resume | macOS, pause and resume (5 cores) |
|---|---|---|---|---|
| Ceiling 25% | 24.6% | 25.2% | 24.7% | 24.9% |
| Two equal instances | 44.5% / 44.7% | 49.4% / 49.0% | 49.0% / 51.4% | 48.6% / 48.5% |
| Weights 2:1 | 61.3% / 31.2% | 65.0% / 36.2% | 64.9% / 35.2% | 62.9% / 34.9% |
| Light instance beside a heavy one | 74.8% / 10.2% (asks 12.5%) | 87.0% / 12.5% (asks 12.5%) | 87.2% / 11.4% (asks 12.5%) | 78.7% / 15.7% (asks 20%) |
| Sharing with a 30% ceiling | 30.5% / 29.3% | not rerun | 30.2% / 30.3% | 30.2% / 30.4% |
| Held at 10% beside outside load, then released | 5.3% / 5.9% → 16.3% / 10.1% | 10.0% / 10.0% → 25.9% / 25.7% | 9.5% / 9.2% → 23.0% / 23.0% | 10.6% / 10.5% → 32.7% / 32.7% |
| Ceiling lifted | 23.9% → 88.9% | 24.9% → 99.3% | 24.9% → 98.6% | 25.1% → 97.5% |
| Helper killed in the middle of a pause | not applicable | not applicable | recovered | recovered |
| App killed in the middle of a pause | not applicable | not applicable | 4 of 4 resumed | 4 of 4 resumed |

In the kernel-groups column, the ceiling, the light instance and the lifted ceiling are from the run just
before the last change. That change does not touch the kernel mechanism.

### What the limits cannot do

- **Windows, beside a program that keeps every core busy.** A capped job gets less than its cap there: an
  instance held at 10% got about 5%. With sharing on, two instances that would have had a third of the machine
  each ended at 10 to 16%. They are not stuck, but they stay well below what they would get without sharing.
  The untried way out is to steer the Windows caps by measured use, as the pause cycle does.
- **macOS, a light instance beside a heavy one.** It gets what the system's scheduler gives it and no more.
  Pausing the heavy instance frees every core for a moment, not one core all the time.
- **Linux weights are per core.** With many busy threads a 2:1 weight came out between 1.7:1 and 2:1 in a
  virtual machine, and once at 1.2:1 while the host was busy with other work.
- **Windows without limits splits unevenly by itself.** Two loaded instances got 55% / 43% in one run and
  58% / 28% in another. That is what the sharing switch corrects.
- **Single readings jitter around a hard cap.** An instance held at 20% on Windows showed 2-second readings
  between 16% and 24%; averaged over nine seconds it was 20.4%. The likely cause is that Windows runs a capped
  job in bursts, which a 2-second sample catches unevenly. This was not investigated further.

## 7. Still open

- The app itself has never been run on macOS or Linux.
- The effect of App Nap on the app's timers was not measured. The design avoids depending on it.
- There are no installers. A packaged build must keep Electron's `RunAsNode` fuse on, or the helper process
  needs another way to start.
- The Windows behaviour beside a saturating outside program, described above.
- Sessions started outside the app are shown but not limited, and a terminal cannot be attached to them.
- Closing an instance stops Claude Code but not the processes it left running; those are no longer limited.

## 8. Continuing the work

- **Windows** is the development machine. `npm run check:cpu` runs the job-object mechanism directly.
- **Linux** was a WSL distribution (Ubuntu 24.04, systemd 255). The default mechanism there is the kernel one;
  `CLAUDINHO_CPU=throttle` forces pause-and-resume, the mechanism macOS uses.
- **macOS**: the workflow in `.github/workflows/cpu-check.yml` runs the check on a hosted Mac. It starts only by
  hand, from the Actions tab.
- **Load inside an instance without a model call**: type `!` and a command in its terminal. Claude Code runs it
  in the instance's own process tree.
- **Test launches** of the app start real Claude Code sessions. They use the subscription, and with Remote
  Control on they appear on the owner's other devices.
- `cpu-check.js` prints every sample with `CPU_CHECK_VERBOSE=1`. The traces, not the verdicts, are what found
  the problems in section 6.
- This repository has no `docs/PROCESS.md` on purpose. The app, like the owner's helper, tells an agent to
  follow that file when it exists, and this record is a history, not a process to follow.

## 9. Sources

The owner's rule for the session was to name the documentation before building on it. These are the pages the
work relied on.

**Claude Code** (`https://code.claude.com/docs/en/…`): `hooks`, `statusline`, `settings`, `cli-reference`,
`worktrees`, `sub-agents`, `skills`, `authentication`, `env-vars`, `model-config`, `permission-modes`,
`claude-directory`.

**GitHub**

- <https://docs.github.com/en/rest/issues/issue-dependencies>
- <https://docs.github.com/en/graphql/reference/objects>
- <https://cli.github.com/manual/gh_api> and <https://cli.github.com/manual/gh_pr_merge>
- <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax>
- <https://docs.github.com/en/actions/reference/runners/github-hosted-runners>

**Windows job objects**

- <https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects>
- <https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_cpu_rate_control_information>
- <https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_accounting_information>
- <https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject>
- <https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-setinformationjobobject>

**Linux control groups and systemd**

- <https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html>
- <https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html>
- <https://systemd.io/CGROUP_DELEGATION/>
- <https://docs.kernel.org/admin-guide/cgroup-v2.html>
- <https://docs.kernel.org/scheduler/sched-bwc.html>

**macOS**

- <https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/AppNap.html>
- <https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/PrioritizeWorkAtTheTaskLevel.html>

**Libraries**

- <https://www.electronjs.org/docs/latest/>
- <https://github.com/microsoft/node-pty>
- <https://xtermjs.org/docs/>
