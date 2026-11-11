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
7. A second round, the day it was published: ask before closing a running instance, clean up its worktree, a
   Worktrees section, the home folder's configuration in the editor, a default prompt in Jinja2 syntax, saved
   state for resuming after a power cut, and a version number. Section 7 covers it.
8. Installers for Windows, macOS and Linux. Section 8 covers it.
9. A fourth round: the open pull requests, groups of sessions, a filter for sessions started elsewhere, and
   batch worktrees that start one after another. Section 9 covers it.
10. A fifth round: notifications with a tray icon, a record of every input request, a mark for sessions that
    are done, Claude Code's version with an update button, a list of models, and fewer tags. Section 10 covers
    it.

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
otherwise. (Since the second round the prompt is a template with placeholders; see section 7.) The pool starts
at most 4 instances and checks the blockers of queued issues again every 5 minutes, as the helper does.

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
- The app as a whole on macOS or Linux. Only the CPU limits were run there (section 6). (Since the third
  round a check starts the packaged app there; see section 8.)

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

## 7. The second round: closing, worktrees, resuming

The day the app was published, the owner asked for seven more things:

1. A confirmation dialog when closing an instance that is still running.
2. If the instance is in a worktree, clean the worktree up when the instance is closed.
3. A separate Worktrees section that lists the repository's worktrees under `.claude`.
4. The configuration from the home folder (`CLAUDE.md`, `settings.json`, agents, skills) in the `.claude`
   section, editable inline.
5. A default prompt for worktrees, parametrised in Jinja2 syntax, such as `Implement issue #{{issue_id}}`, with
   `issue_id` filled in when a session is started for a GitHub issue.
6. Each session's state saved locally at fixed intervals, so that after a power cut each session can be resumed
   where it left off.
7. Versioning, with this as v0.1.0.

### How each was read, and why

**Closing.** The ✕ used the browser's own confirm box. It is now one of the app's dialogs, because it has more
to say: what happens to the worktree. It appears while Claude Code is still running, and also for an instance
that has ended if removing its worktree would discard work.

**Cleaning a worktree means what it means to Claude Code:** the folder and its branch go. On a normal exit
Claude Code does this itself, and asks when there are changes. The app ends Claude Code by ending its process,
and for that case the documentation promises nothing, so the app does the cleanup. Claude Code also locks a
worktree while a session uses it, and a session that is stopped leaves the lock behind (`git worktree list`
shows `locked claude session <name> (pid …)`), which is why the removal passes `--force` twice.

**What counts as lost is measured.** `git status --porcelain` gives the uncommitted changes, and
`git rev-list --count HEAD --not --exclude=<its branch> --branches --remotes` the commits that would be on no
branch and no remote afterwards. With both at zero the worktree goes without a question, and in the dialog the
box starts ticked. Otherwise the dialog names the loss and the box starts unticked: the owner asked for cleanup,
not for losing work by pressing Enter. The check is repeated after Claude Code has stopped, because an agent can
still be writing while the dialog is open. If something appeared in between, the worktree is kept and the app
says why.

**Windows needs one more step.** A folder cannot be deleted there while a program is running in it. `node-pty`
ends the processes attached to the instance's terminal, but one that has detached itself survives and holds the
folder. Each instance already sits in a job object for the CPU limits, and a process cannot leave a job, so
closing an instance together with its worktree now ends the whole job. Without that step the removal gave up
after six seconds of retries; with it the folder was gone in half a second. On macOS and Linux a folder can be
deleted under a running program, so nothing is ended there.

**The Worktrees section** lists what `git worktree list` reports under `.claude/worktrees`, plus folders in
there that git no longer knows. The second kind exists because of the order in which git removes a worktree:
when it cannot delete the folder (Windows again, with a program from outside the app sitting in it), it has
already dropped its own record. The owner asked only to see the worktrees. Each row also has a Remove button,
because cleanup on close needs a way to finish what it could not, and to remove a worktree that was kept on
purpose.

**The home folder holds more than configuration.** Credentials, every conversation and the prompt history are
in the same place. The editor therefore works from a fixed list, taken from the documentation of that folder:
`CLAUDE.md`, `settings.json`, `keybindings.json`, and the folders `agents`, `commands`, `output-styles`, `rules`
and `skills`. Anything else is refused by path, in the main process. In `skills`, only folders that hold a
`SKILL.md` directly are listed; other tools keep bundles and a trash folder in the same place, and those are
not the owner's to edit. `CLAUDE_CONFIG_DIR` moves the folder, and the app follows it. Saving a home file does
not bring up the commit offer, and saving a `.json` file that does not parse asks first, since a broken
settings file is felt by every session.

**The prompt is a Jinja2 template of which one construct is supported:** the `{{ name }}` placeholder, with
`issue_id`, `issue_title` and `issue_url`. That covers the request in a dozen lines, without a template engine
as a dependency. Three things were decided on the way:

- A template that uses a block, a comment, a filter or an unknown name is refused, with the reason, when it is
  saved and when it is used. Jinja itself prints nothing for an unknown name, which would hand Claude
  "Implement issue #".
- A value goes in as it is and is never read again as template text. An issue title is written by other people.
- The default is a setting, kept per folder. Until now the dispatch dialog remembered the last prompt typed
  there; now an edit in that dialog counts for that start only. Prompts saved with the old `{n}` are converted
  when they are loaded.

**Session state: Claude Code already keeps the conversation.** Its documentation says sessions are "saved
continuously to local transcript files". What a power cut would take is what the app knows on top of that:
which instances were open, in which worktree, with which model, input level, merge setting and weight, and
which conversation each one was in. That is written every ten seconds, and whenever an instance comes or goes.

- The conversation's id and the path of its transcript come from the status line input the app already reads,
  so they follow `/clear` and `/resume`.
- The file is written to the side, flushed, and renamed over the old one. A power cut leaves a whole file.
- When the app starts, everything on record is offered as an "interrupted" card. Quitting and a power cut are
  thereby the same case, handled by one mechanism.
- Resume runs `claude --resume <id>` inside the instance's worktree. A record without a transcript on disk (an
  instance that never exchanged a message) is started again the way it was started.
- An instance that has ended stays on record for 15 seconds. When a machine shuts down, Claude Code may be
  stopped a moment before the app is, and those are exactly the sessions to bring back.
- A record whose conversation is live again somewhere, going by `claude agents --json`, is not offered.

**Versioning** is the `version` in `package.json`, shown in the header, with a changelog and tags of the form
`vX.Y.Z`, which is what `npm version` produces.

### How it was verified

On Windows, with the window driven as before. Sessions were started with the smallest model and a one-line
prompt, or with none.

| What was done | What happened |
|---|---|
| The Worktrees tab on a repository with four worktrees left by earlier tests, all still locked. | Listed with branch, state and last commit. |
| Remove, five times: a clean worktree; one that got a file while the dialog was open; one with an uncommitted file; one with a commit that existed nowhere else; a folder git did not know. | Removed with its branch; kept, with the reason; removed after "Remove and discard"; the same; removed. |
| Close a running worktree instance with nothing to lose. | A dialog with the box ticked. Folder and branch gone, and its record gone from the state file. |
| Close one with an uncommitted file in its worktree. | The box unticked. Left that way, the worktree stayed; ticked on purpose, it went. |
| Close an instance that had left a detached process in its worktree. | Before the job-object step: "a program still has files open in it" after 6 s. With it: removed in 0.5 s, the process ended. |
| Remove a worktree while a program from outside the app sat in it. | The dialog stayed open with that message, and no branch was left behind. The folder was listed as a leftover and removed once the program was gone. |
| Two sessions open, then every process of the app killed at once. | The state file was whole. After the restart both were offered. Resume on the worktree session gave the same conversation id, in its worktree, on its branch, with its input level, weight and merge setting, and the earlier prompt and answer on screen. The other had no conversation yet and was started again. |
| Quit through the window with two instances open, restart, "Resume all". | Both came back, and closing them removed the worktree. For this run the app's native "still running" box was answered through the main process's debugger. |
| The default prompt in Settings with an unknown name, a block, an unclosed brace. | Each refused in the dialog with the reason, the text still there. A valid one was saved; clearing it brought the built-in one back. |
| Dispatch of a closed issue of the throwaway private repository, with a prompt asking for one line back. | Claude Code received the line with number, title and address filled in. An unknown name in the dialog started nothing. |
| The `.claude` tab against a stand-in home folder, set with `CLAUDE_CONFIG_DIR`. | Listing, editing and saving worked, and broken JSON was questioned. Credentials, conversations, history and a path with `..` were refused, for reading and for writing. |
| `node cpu-check.js stop` | A process and a detached child of it, both in the job, both ended. |

Not exercised:

- Any of this on macOS or Linux.
- A real power cut. The processes were killed instead.
- The native box that questions broken JSON. The test answered in its place.
- The owner's real home folder, on purpose: the test pokes at paths the editor must refuse.

### What went wrong

| Symptom | Cause | What changed |
|---|---|---|
| A worktree whose folder could not be deleted left its branch behind. | The branch was deleted last, after the step that failed. | The branch goes before the failure is reported. |
| The `.claude` tree showed `[object HTMLDetailsElement]`. | A list of elements was handed over where the elements themselves were expected. | Fixed after the first run of the tab. |
| The Remove buttons could swallow a click. | The table was rebuilt with every state update, every two or three seconds. | It is rebuilt only when something in it changed. |
| A test run created a worktree in this project's own checkout. | The test app had been started with one of Electron's flags before the `.`, and the app then takes `.` for the folder to open. | The worktree and its branch were removed again. Flags go after the `.`, and a test checks which folder is open before it starts anything. |
| A command typed into an instance from a test stayed in the input box. | Not established. It happened when the command and the Enter were written in one piece. | Tests write `!`, the command and Enter one after another with a pause in between, which has worked every time since. |

## 8. The third round: installers

The same day the owner asked how to run the app on Windows, macOS and Linux, having found no `.exe`. Until then
it ran from source only. Asked which systems should get an installer, the owner answered: all three.

### What was decided, and why

The installers are made by [electron-builder](https://www.electron.build) 26, a development dependency. Its
settings are under `build` in `package.json`, where no comment can stand, so the reasons are here.

| Setting | Why |
|---|---|
| `files` | Only what the app loads: its four scripts and `renderer/`. Left to the default, the README, this record and the checks would be packed too. The last pattern drops the debug symbols `node-pty` ships for Windows, 53 MB the app never reads. |
| `asar: false` | The app's files stay plain files instead of going into one archive. `node-pty` ships helper programs and a worker script that have to exist as real files, and the app sets the mode of one of them at its start. In an archive each of those would have to be unpacked again, and a mistake there shows only on the system it concerns. electron-builder warns about this setting at every build. `ponytail:` if the loose files ever matter, turn the archive on and list `node-pty` and `koffi` under `asarUnpack`; `pack-check.js` will say whether the terminals survived. |
| `npmRebuild: false` | `node-pty` and `koffi` are N-API modules. The binaries npm installs load in Electron as they are, which is how `npm start` has always run them. Rebuilding them would need a compiler on the Windows and macOS build machines. |
| `artifactName` | One pattern for every installer, with the system and the processor in the name. By default both Mac images would get the same name. |
| `toolsets.appimage: "1.0.3"` | The AppImage runtime that does not need FUSE 2, which current Ubuntu no longer installs. electron-builder recommends it and makes it the default in its next major version. The runtime that is the default in 26 also starts every app without Chromium's sandbox; this one does so only where the sandbox cannot work. |
| `mac.identity` and `mac.hardenedRuntime` left at their defaults | electron-builder signs with the Developer ID Application certificate it finds in the keychain, or in `CSC_LINK` on the build machine, turns the hardened runtime on, and has Apple notarise the app when the `APPLE_*` variables are set (see the `installers` workflow and `CLAUDE.md`). Notarisation requires the hardened runtime. With no `build/entitlements.mac.plist` here, electron-builder's own entitlements apply: JIT, unsigned executable memory, and `disable-library-validation`, which keeps `node-pty` and `koffi` loading. Without a certificate electron-builder 26 signs nothing, not even ad hoc, and a downloaded app is reported as damaged; the workflow checks Gatekeeper's verdict and fails instead of publishing it. Up to 0.3.0 the settings were `identity: "-"` and `hardenedRuntime: false`: an ad-hoc signature that names nobody, which macOS refuses at the first start while offering "Open Anyway". |
| `appId` | A name of its own instead of the default `com.electron.claudinho`. Windows and macOS know the installed app by it, so it should never have to change. |
| `predist` (a script, not a setting) | `node-pty` publishes its macOS helper without the executable bit. The app repairs that at its start (see `main.js`), which cannot work on a read-only disk image. So before every build the bit is set in `node_modules`, and the packaged file has it. |

**Not signed.** Signing needs a certificate for Windows and a paid developer account for macOS, and neither was
asked for. The README says what a user sees instead. After 0.3.0 the owner asked for the Mac apps to be signed
with their Developer ID; Windows still is not. One case has no way around it: with Smart App Control on,
Windows blocks an unsigned installer and offers no exception for a single app.

**A release comes from a tag, whole or not at all.** `.github/workflows/installers.yml` runs when a `v*` tag is
pushed. Each of three machines builds its system's installer, then installs it (Windows, silently), mounts it
(macOS, read-only) or runs it (the AppImage), and runs `pack-check.js` against that. Only when all three pass
does a fourth job create the release with every installer attached. electron-builder would publish by itself
when it sees a tag and a token; `--publish never` is what stops it. Started by hand, the workflow builds and
checks without publishing. The repository is public, so GitHub's standard machines cost nothing.

**The first installers are 0.1.1.** The tag `v0.1.0` points at a commit that cannot build them, and a published
tag is not moved.

**Ubuntu is named by its version** in the workflow, not as `ubuntu-latest`. `node-pty` is compiled on the build
machine, and what is compiled on a newer release does not load on an older one. The workflow prints what the
compiled file asks for.

### The check

`pack-check.js` takes the path of a packaged executable and has four steps:

1. The binary, started with `ELECTRON_RUN_AS_NODE`, opens a terminal through the packaged `node-pty` and reads
   it back. This fails if the `RunAsNode` fuse is off, if the native module does not load, or if one of its
   helper programs cannot be started.
2. The app starts, with its own data folder, and shows its version.
3. It opens the folder it was given.
4. On macOS and Linux it starts an instance and waits for that instance's output in its terminal.

Step 4 uses a stand-in for Claude Code, a four-line shell script, so that the check never uses the
subscription. The app takes its `PATH` from the login shell, so the check hands it a stand-in for the shell
too, one that prints a `PATH` with the stand-in first. On Windows `node-pty` can only start a real `.exe`, so
there is no step 4 there; the packaged app is tried with the real Claude Code by hand.

### How it was verified

| What was done | What happened |
|---|---|
| On the Windows PC: `npm run dist`, then the packaged app on the scratch repository with the real Claude Code. An instance in a worktree under a 50% ceiling, closed again with its worktree. | Claude Code came up in the terminal with its status line, the instance reported its limit of 0.5, and closing removed the folder and the branch. |
| Windows Server 2025, hosted: the installer run silently, then the check against the installed `claudinho.exe`. | Installed for the user without a prompt. Steps 1 to 3 passed. |
| macOS 26 on Apple silicon, hosted: each disk image mounted read-only, `codesign --verify --deep --strict`, then the check against the app inside it. | Both signatures valid and ad-hoc. The Apple silicon image passed all four steps, from the read-only image. The Intel image, run through Rosetta, passed steps 2 to 4 at once, and step 1 once the check allowed for the translation: it took 70 seconds (see below). |
| Ubuntu 24.04, hosted: the check against the AppImage file itself. | All four steps passed. The launcher had added `--no-sandbox`: Ubuntu 24.04 does not let a program without an AppArmor profile create user namespaces. The compiled `node-pty` asks for glibc 2.34 and libstdc++ 3.4.22, so the AppImage also loads on Ubuntu 22.04 and Debian 12. |

Step 4 was the first time an instance ran inside the app on macOS and on Linux.

Not exercised:

- What Windows and macOS say about a downloaded installer. A file built on the machine that runs it is not
  questioned. The README's steps for macOS follow Apple's documentation. Those for Windows describe the
  SmartScreen dialog as it is known; Microsoft's pages describe the check, not the dialog.
- The real Claude Code in the app on macOS or Linux, and a person using the app there.
- An Intel Mac. The Intel image ran on Apple silicon through Rosetta.
- Installing over an older version, and uninstalling.

### What went wrong

| Symptom | Cause | What changed |
|---|---|---|
| On the hosted machines the check failed with "Cannot read properties of null". | It asked the window for the version before the page had loaded. On the PC the page had always been faster. | The check waits for the element. |
| On Linux step 1 failed with "bad option: --no-sandbox". | The AppImage's launcher puts that flag in front of the arguments, and Node refuses it. | The check passes the flag itself, behind `--`, where it is only an argument. The app's own helper process is not affected: it starts the binary inside the image, not the launcher. |
| Step 1 timed out on the Intel image. | An Intel program on Apple silicon is translated before its first start, and for a binary of this size that took more than the minute the check allowed. | Three minutes. |

## 9. The fourth round: pull requests, groups, one worktree at a time

Still the same day, the owner asked for four things, and for a fifth while the work was under way:

1. A section that shows the open pull requests, draft or ready for review.
2. Groups of Claude Code sessions. Issues started as a batch are in a group from the start.
3. Grouped sessions marked in the viewer, so that it is obvious.
4. A filter that takes the sessions not started from claudinho out of the view.
5. When several worktrees are spawned at the same time, do not start them in parallel: wait for the
   `SessionStart` hook to finish, so that whatever a worktree configures is done before the next one is created.

### How each was read, and why

**Pull requests** come from `gh pr list --json`, which lists open ones by default, drafts included. The tab only
shows them; a click on a title opens the pull request on GitHub. Two things were added to what was asked,
because the data was already there: the checks in one word, and the session at work on the pull request (the
one that reported it, or the one on its branch). For the checks, whatever has ended and is not a success,
neutral or skipped counts as failing, so that a conclusion this code has never heard of is not shown as fine.

**A group is a name, and nothing else.** There is no list of groups to keep in step: a group exists as long as
a session carries its name. Its colour is worked out from the name, so it is the same on every card and after
a restart without being stored anywhere.

- A batch gets its name in the start dialog, which proposes the issues' numbers. The main process refuses a
  batch without a name, so "a batch is a group" does not depend on the dialog.
- The name can be changed, or cleared, in the instance's detail view. That covers single instances too.
- It is written into the session's record, so the interrupted card and the resumed instance still have it.
- The cards of a group are brought together with the CSS `order` property. The terminals are not moved in the
  page for it.

Not built, because not asked: actions on a whole group (rename, close), a group field when a single instance
is started, and groups for sessions started outside the app.

**The filter** is a checkbox on the Instances tab. It hides the outside sessions' cards, takes them out of the
number on the tab, and says how many it hides. It is remembered where the start dialog's defaults already
were, in the window's own storage.

**One worktree at a time** needed an answer first: how does the app know that a session's `SessionStart` hooks
are done? The hooks page says three things that matter here.

- `SessionStart` accepts only command and MCP-tool hooks. The app's hooks are HTTP hooks, so it cannot put one
  on that event.
- The hooks of one event run side by side, in no set order. A hook of the app's own could not tell when the
  repository's had finished.
- "A prompt you send while SessionStart hooks are still running doesn't reach Claude until they finish."

Nothing is documented as the sign that they have finished, so it was measured. A session was started the way
the app starts one, with a slow `SessionStart` hook standing in for a repository's set-up, on Claude Code
2.1.322:

| Seconds after the start | With a first prompt, hook of 12 s | Without a prompt, hook of 8 s |
|---|---|---|
| The slow hook begins, inside the new worktree | 1.8 | 1.4 |
| The status line runs | 1.9 | 1.7 |
| `claude agents --json` reports the session | 2.3, as busy | 2.3, as idle |
| The slow hook ends | 13.9 | 9.4 |
| `UserPromptSubmit` for the first prompt | 13.9 | never |

The status line and `claude agents` react while the hook is still running, so neither can be used. The first
prompt going in is the sign, and it comes at the moment the hook ends. So every instance's settings now carry
a fourth hook, `UserPromptSubmit`. A new worktree with a first prompt counts as "starting" until that hook
arrives, and while one is starting the pool creates no other. This holds for every issue sent from the Issues
tab, a batch or two single ones in a row.

There is no time limit on the wait. Claude Code itself gives up on a hook after ten minutes by default, and a
queue that is waiting says so: the card reads "starting", the queued issues name the one they wait for. A
limit of the app's own would start the next worktree in exactly the case the owner wanted to rule out.

### How it was verified

On Windows, with the window driven as before, on the smallest model and a prompt that asks for one word back.

| What was done | What happened |
|---|---|
| Three issues as one batch, three agents at once, in a scratch repository whose `SessionStart` hook takes ten seconds and writes down when it begins and ends. | The set-ups ran from 2.2 to 12.2 s, 14.4 to 24.4 s and 27.1 to 37.1 s: never two at once. Each next worktree was created about a second after the prompt before it had gone in. The cards read "starting", the chips "queued #2, after #1 has started". |
| The same batch sent to the main process without a group name; then the dialog. | Refused with the reason. The dialog proposed "#1 #2 #6" and would not start with the name emptied. |
| The three sessions on the Instances tab, beside one started by hand. | All three with the stripe and the name, in one colour, next to each other; the fourth without. |
| The fourth put into a group in its detail view, moved to the batch's group, taken out again. | Each change showed at once on the card and in the field. |
| Every process of the app killed with the batch open; restart; one session resumed. | The records had the group, the interrupted cards showed it, and the resumed instance kept it. |
| A session started outside the app, then the filter. | Its card went, "1 session hidden" appeared, the number on the tab went from 5 to 4, and the choice was still set after the window was reloaded. |
| The Pull requests tab in an empty folder whose remote is a public repository. | 59 rows, 34 of them drafts, the same as GitHub answered when asked directly. Checks read passing, "1 of 25 failing" or nothing; reviews read required, approved or changes requested. |
| A made-up instance on the first pull request's branch. | The Session cell linked to it and showed its group. |
| The tab in a folder without a GitHub remote. | It said so. |

Not exercised:

- A pull request opened by a session of the app, in the Session column. The instance above was made up.
- A `SessionStart` hook that fails, or one that runs into its time limit.
- A repository with more than 200 open pull requests.
- Any of this on macOS or Linux.

## 10. The fifth round: notifications, the record of input requests, updates

Right after version 0.2.0 was released, the owner asked for eight things:

1. Notifications: an icon in the top right, with the number of new ones in a red circle.
2. The same number on the app's tray icon.
3. A notification for an input request "when on manual or auto mode", and for a session that is done.
4. For each session, an audit of all its input requests, for questions and for tool calls: the options, the
   recommended one, the one picked, and whether that was manual, timed expired and auto picked, or auto.
5. Sessions that have finished their task marked with a green outline and a green checkmark.
6. A notification when a new version of Claude Code is released, with an icon that runs `claude update` when
   pressed, and the installed version on display.
7. The model offered as fable, opus, sonnet and haiku when a session is dispatched for an issue.
8. The CLAUDE.md, skills, agents, settings, hooks and workflows tags in the top right removed.

### How each was read, and why

**Timed is notified too.** The owner named manual and auto. A timed request also waits for the owner, and with
a deadline, so it raises the same "needs input" notification. When its wait runs out, the record says so; no
second notification is raised.

**"Done" is the end of a turn.** Claude Code reports it with the `Stop` hook. A turn stopped with Escape
reports nothing, and is not done. The mark goes when the next prompt goes in, which the `UserPromptSubmit` hook
of the fourth round reports. This is wider than the "finished" of the dispatch pool, which also asks for an
open pull request and stays as it was.

**The tray's number is a picture.** Outside macOS, Electron has no number or text for a tray icon, so the icon
is redrawn: the app's mark at zero, a red circle with the number otherwise, "9+" from ten on. The main process
has nothing to draw text with, so the window draws the pictures, one per screen scale, and hands them over. No
pop-up of the operating system is raised: none was asked for, and on macOS Electron shows one only for a signed
app.

**The record needed an answer that no hook reports.** A request settled through the app's own hook is known at
once: the Auto level, a choice on the card, the timer. One answered in the terminal is not. The hooks page says
so for permission prompts and is silent about questions, so it was measured, on Claude Code 2.1.322, with every
hook passing without an opinion and keys typed into the terminal:

| What was done in the terminal | What Claude Code reported afterwards |
|---|---|
| A question answered, with Enter or with Down and Enter | `PostToolUse` for `AskUserQuestion`, with the id of the tool call that `PreToolUse` had carried, and the answers by question. |
| A question dismissed with Escape | Nothing: no `PostToolUse`, no failure, no `Stop`. |
| A permission prompt approved | `PostToolUse` for the tool. The prompt itself (`PermissionRequest`) has no id, but the tool input it shows is, byte for byte, the input that `PostToolUse` carries. |
| A permission prompt refused with Escape | Nothing. |

So two more hooks now report every tool call that has run. An open question is closed by its id, an open
permission prompt by its tool and input. What is still open when the turn ends, or when a prompt goes into an
idle session, was refused or dismissed. Three things follow from reading it this way:

- An approved call is on record when it has ended, not when it was approved.
- Every tool call of every session makes one request to the app, on the same machine. The request has an
  address of its own, and while no request of that session is open the app answers without reading the body,
  which holds the tool's whole result. Its time limit is five seconds, so an app that hangs cannot hold a
  session's tools up for longer.
- "Allow, and do not ask again" cannot be told from "allow once".

**Updating.** `claude update` cannot only check. The newest version is read from where the official install
scripts read it: one line of text per release channel, and the owner's channel setting decides which. The setup
page says an update takes effect "the next time you start Claude Code", so the button asks nothing when
sessions are running.

**The list of models** replaced a text field with suggestions, in all three start dialogs and not only the one
for issues. The field came filled in, and a browser offers only the suggestions that match what the field
holds, so the other models never showed. A full model name can no longer be typed there.

**The tags** went as a row, with the ones the owner had not named (commands, MCP, the templates, "no .claude
setup"). The tag that names the GitHub repository stays. The counting behind them, in `lib.js`, went too. What
the brief asked for, detecting a `.claude` setup, is what the `.claude` tab shows.

### How it was verified

On Windows, with the window driven as before, in a scratch repository set to ask before every tool. Four
sessions on the smallest model, each asked to put a question, to write a file, or both.

| What was done | What the record and the app showed |
|---|---|
| Manual: a question answered in the terminal with Down and Enter, then a write approved there with Enter. | "Coffee (Recommended)", manual; "approve", manual. Two "needs input" notifications, then "is done". The card got its green outline and checkmark. |
| Manual: a write refused in the terminal with Escape, then a new prompt typed. | Open until the prompt went in, then "deny", manual. Not marked done in between. |
| Auto: the same question and write. | Both with the recommended option, auto, and an "answered for itself" notification each, naming what was picked. |
| Timed, one minute: the first of two questions answered on the card, the second left alone. | "Tea", manual; "Milk (Recommended)", timed expired, auto picked. |
| The bell after all of it; then opened. | 12 in the red circle, 12 entries all marked new; 0 once the list was open. A click on an entry opened that instance, with its record. |
| Every process of the app killed; restart; one session resumed. | Its two entries were still on record. Notifications were not kept, by design. |
| The version address replaced by one that says 9.9.9. | The header read "Claude Code 2.1.322" beside a button "9.9.9", with a notification. Pressing the button ran the real `claude update`, which answered "Claude Code is up to date (2.1.322)". |
| The start dialog, and the top right of the window. | The model is a list of the four names. One tag is left. |

Not exercised:

- The tray icon on macOS and Linux. On Windows the icon itself was not seen: Windows 11 put it among the hidden
  icons, where it had it on record for the test app. Its pictures were looked at in the window, at three sizes.
- An update that installs something. The installed version was the newest.
- Questions with several answers, or with an answer typed in, when answered in the terminal.

### What went wrong

| Symptom | Cause | What changed |
|---|---|---|
| The tray pictures, put into the page for a look, showed as broken images. | The page's own content rule refuses `data:` pictures. The tray is not affected: it gets them through the main process. | The check puts the canvases themselves into the page. |

## 11. The sixth round: signing, merging when ready, the app's own update

Still the same day. The owner installed 0.3.0 on a Mac, was refused at the first start, and asked how to sign
the app, on the Mac and on Windows. Then came two requests, in these words:

> For the claude code sessions that have checked the auto-merge checkbox, it's claudinho's job to actually go
> and merge the PR once the claude code session has mentioned that it's ready for merge. Claudinho can choose
> to follow-up on anything that the claude code session has raised for debate before merging; after clarifying
> everything with the claude code session, claudinho should merge the PR.

> I also want the functionality in claudinho to update itself, when a new release is published in github, it
> should display a notification somewhere that a newer version is available and do the update.

And, once the first of them was built:

> if a claude code instance has finished it's work and has opened a PR (either normal instance or worktree), I
> want both in the global view as well as the individual view the option to merge the PR (or Mark ready for
> review if it's a draft).

### Signing

**macOS: done by the owner, as 0.3.1.** While this round's features were being built on the Windows PC, the
owner signed the Mac apps in a session of their own, on their Mac, and released that as 0.3.1 (sections 8 and
12 carry what that session recorded). The work here was then put on top of it. A variant written on the PC
before that, with an App Store Connect key in place of the Apple ID, was dropped unrun. Two things from it are
worth keeping: electron-builder's page says `APPLE_API_KEY` holds the key's text, while version 26.18.0 passes
it to `notarytool --key`, which takes a file's path; and under the hardened runtime, programs inside the
terminals cannot use the microphone or the camera, or script other apps, unless the app is given entitlements
for that. The second is untried either way.

Signing is also what lets a Mac copy update itself (below).

**Windows: left unsigned, by the owner's decision.** Microsoft's own pages say that a signature does not remove
the SmartScreen warning for a new program: it shows the publisher's name instead of "unknown publisher", and
the warning ends only when the file or the certificate has gathered reputation, "several weeks and hundreds of
clean installs". Extended-validation certificates lost their instant pass in 2024. The routes were laid out
(Azure Artifact Signing at about 10 dollars a month, open to individuals only in the US and Canada; a
certificate from a certificate authority; SignPath Foundation for open-source projects; the Microsoft Store,
the only route without a warning, which means repackaging the app). The app's own update is not affected:
SmartScreen asks about files that came through a browser, and the update downloads the installer itself.

### Auto-merge: what was there, and what changed

Until this round a ticked box meant: when a turn ends and the branch has an open pull request that is not a
draft, run `gh pr merge --auto`. What the session had written played no part, a draft was never merged, and a
merge that GitHub queued or refused was never looked at again.

| Decision | Why |
|---|---|
| The session's last reply decides, read by a Claude run of the app's own. | "Has mentioned that it's ready" and "raised for debate" are judgments about prose. The run is `claude -p` with a JSON schema: a verdict (`merge`, `follow_up`, `hold`) and a message. |
| That run has no tools and its own short system prompt, and starts in the app's data folder. | It only has to read. Measured: 5 seconds and 1 cent at list price, against 6 seconds and 10 cents with the default tools and system prompt. No project's settings, hooks or `CLAUDE.md` reach it, `disableAllHooks` keeps the owner's own hooks out, and with session persistence off it leaves no session behind. `--bare` would be the obvious flag, but it does not use the subscription login. `ponytail:` it judges from the task, the issue, the pull request's description and the reply, not from the code; give it read-only tools when a decision needs the diff. |
| A follow-up is the Stop hook's answer. | The hook is the one place where the app is asked before a session goes idle. Measured on 2.1.322: answered with `additionalContext`, the session carries on with that text, shown in the terminal as "Stop hook feedback"; `decision: "block"` does the same but is shown as a hook error. The alternative, typing into the terminal, depends on timing and on nothing else being typed. |
| The hook is held until the app has decided, the wait for checks included. | Whatever goes wrong while merging can then go back to the session through the same answer. While it is held the session reports `busy`, which is true: it is not done. Its place in the dispatch pool is given up as soon as only waiting is left. A session without the box ticked is answered at once, as before. |
| Before merging: mark a draft ready, wait for the checks, then `gh pr merge` without `--auto`. | "Actually go and merge." `--auto` hands the merge to GitHub, which needs a repository setting and gives no answer. The checks are read from `statusCheckRollup` every 15 seconds for at most an hour; none at the first look is looked at once more, because GitHub starts them a few seconds after a push. |
| What GitHub refuses goes back to the session with GitHub's own words. | A failed check and a conflict are things a session can repair, and with several issues in flight the second merge into the same lines always conflicts. |
| Three follow-ups per prompt of the owner's, then hold. | A limit of the app's own, below Claude Code's (eight continuations in a row). A prompt typed by the owner starts the count again. |
| The owner's latest prompt is given to the review, and counts for more than the first. | Found in the first live run (below). |
| An interrupt, a new prompt or unticking the box calls the merge off. | The owner has taken over. Without this, a merge still waiting for checks would go through after the owner had asked for one more change. |
| Turns that end without a pull request are left alone. | Nothing to merge, and the request was about merging. |

### How auto-merge was verified

Pure parts have asserts: what the review is given, what is made of its answer, and the wait for checks
(running, green at once, none, started late, failed, never ending, called off). The rest ran live, in a clone
of the private repository made for merge tests, with six Haiku sessions told what to write at the end.

| Case | What happened |
|---|---|
| A session opens a draft, says it is ready and asks whether to add a second line, recommending it. | After 6 seconds: follow-up 1 of 3, "Yes, add the second line …". The session added it and said it was ready; the draft was marked ready and merged, 65 seconds after the start. |
| A session opens a pull request and says it is stopping for now. | Held: "it did not say the PR is ready for merge". |
| Two sessions change the same line and both say they are ready. | The first was merged after 45 seconds. The second was refused by GitHub ("Pull Request has merge conflicts"), was told so, repaired it, and was merged after 110 seconds. |
| The held session, after a restart of the app, resumed and told by the owner that the pull request is fine. | Merged 30 seconds after the prompt. |
| A session without the box says it is ready and goes idle; then the box is ticked. | Reviewed from its last reply and merged. |
| A session says its pull request is not ready yet. | Held, with the reason on the card and in the notification. |

Each merge took 15 to 20 seconds of waiting: the repository has no checks, and none is looked at twice.

Not exercised live: checks that fail or are still running (the asserts cover the waiting), the limit of three
follow-ups, an interrupt while the hook is held, a review that cannot run, and dispatch from the Issues tab
with Full-auto.

### The app's own update

| Decision | Why |
|---|---|
| `electron-updater`, a new dependency. | Replacing a running app is different on each system: a silent installer on Windows, a swapped file for an AppImage, Squirrel on macOS. It is the updater that belongs to electron-builder, reads the releases the workflow already makes, and checks the download against the checksum in the release. Writing those three installs by hand would be more code than the rest of the feature, in the one place where a mistake leaves an installed app unable to repair itself. |
| Nothing is downloaded until the owner presses. | Installing restarts the app, which stops every session. With sessions running the window asks first; the app's own question at quitting is skipped for that one quit, since it was just answered. |
| The Mac build makes a `.zip` beside each `.dmg`. | On macOS the update goes through Squirrel, which takes a `.zip`, and only from the developer who signed the running app. electron-builder writes `latest-mac.yml` only with that target. Before 0.3.1 was signed, the Mac copy only announced a release and opened its page; that went when the work was put on top of 0.3.1. |
| A release holds more files. | `latest.yml`, `latest-mac.yml`, `latest-linux.yml` and the `.blockmap` files are what the update reads. The workflow uploads them with the installers; electron-builder writes them although publishing is off. |
| `CLAUDINHO_UPDATES` points the app at an address of a test's. | The same way `CLAUDINHO_RELEASES` does for Claude Code's version. |
| The update is tried on every build, on all three systems. | The step that matters, a running app replacing itself, exists only in a packaged and installed copy, and on the owner's PC that copy is the owner's own. So the workflow builds a second installer that claims version 99.0.0, serves it to the first one, and `pack-check.js --update` passes when the copy on the disk has become 99.0.0 and runs again. On Linux this runs on a copy of the AppImage, which an update replaces, so that what is published is the first build. On macOS the app is copied off its read-only image, and the second build is signed but not notarised. |

Verified on the PC: the build writes `latest.yml`, the block map and `app-update.yml`; a packaged copy pointed
at a stand-in that names 99.0.0 and has no installer shows the button and the notification, asks before
stopping a running session and leaves everything alone on "no", and reports the download that fails with its
reason. The workflow's second-build command produces a 99.0.0 installer.

The install itself ran in the `installers` workflow, started by hand on the branch that holds this round, on
top of 0.3.1:

| System | What happened |
|---|---|
| Windows Server 2025 | The installed 0.3.1 found 99.0.0, downloaded it, closed, was replaced by the silent installer and ran again as 99.0.0. |
| macOS 26, Apple silicon | The same through Squirrel, from a copy of the signed and notarised app, to a second build signed with the same certificate. |
| Ubuntu 24.04 | The AppImage was replaced by the 99.0.0 file and ran again. |

Not exercised: an update from one published release to the next, which only the release after this one can
show, and an Intel Mac.

### Merge buttons on the cards

A card whose session has ended its turn, or has ended altogether, with a pull request still open carries one
button in its header, on the wall and in the detail view: **Mark ready for review** for a draft, **Merge PR**
otherwise. Marking ready asks nothing. Merging asks first, because it cannot be taken back, and runs
`gh pr merge` with the method from the settings; what GitHub refuses is shown as it says it. For this the app
now keeps, per instance, whether its pull request is a draft and whether it is open, merged or closed, and
records a draft too, which it used to ignore unless auto-merge was on. The button is there whatever the
auto-merge box says, so a pull request the app holds can be merged by hand.

Verified live: a session without auto-merge opened a draft and ended its turn. The card showed "Mark ready for
review" in both views; pressed, the draft was ready and the button read "Merge PR"; "no" to the question left
the pull request alone, "yes" merged it, GitHub agreed, and the button was gone.

Open: the app learns of a pull request when a turn ends, so one that is merged or closed on GitHub meanwhile
still shows its button until the next turn, and a session resumed after a restart shows none until then.

### What went wrong

| Symptom | Cause | What changed |
|---|---|---|
| A check of the signing step started a real build of the app, with an empty environment, and left two folders behind. | The stand-in for `npm` was put on the `PATH` under a Windows path. Git Bash splits `PATH` at colons, so `C:/…` was two entries and the real `npm` ran. | The folders were removed. A command that must not run is now replaced by a shell function, which nothing on the `PATH` can get past. |
| Four test sessions ended at once: "Workspace trust not yet accepted". | A fresh clone has to have its trust dialog answered once before `claude -w` works in it, and being inside a trusted folder does not count. The dialog opens on "No, exit". | Answered once for the scratch clone, one line down and Enter. The test now stops when a session ends early instead of waiting twenty minutes. |
| The held session stayed held after the owner had told it the pull request was fine. | The review knew the prompt the session was started with and nothing later, so the session's "ready" contradicted its instructions. | The owner's latest prompt, which the `UserPromptSubmit` hook carries, is given to the review. |
| A merged pull request carried a note saying the draft was being left as a draft. | The review was commenting on work that is the app's, and without knowing what the app does. | It is told that marking ready, waiting for checks and handing back failures are the app's, and that a merge carries a note only when a point was decided. |

## 12. Still open

- Windows stays unsigned, by decision (section 11).
- Auto-merge reads prose, not code, and leaves turns without a pull request alone. The cases not exercised
  live are listed in section 11.
- The tray icon is untried on macOS and Linux, and on Windows 11 it starts among the hidden icons.
- Approving a plan is not an input request for the app: not for the input levels, and so not for the record or
  the notifications either.
- The start dialogs offer four model names. A full model name cannot be typed there any more.
- "Resume all interrupted", and worktrees started by hand, are not held back one after another. A session
  that starts without a prompt gives no sign that its `SessionStart` hooks are done (see the table in
  section 9).
- A group cannot be renamed or closed as a whole, and sessions started outside the app cannot be put into one.
- The Pull requests tab shows and links; it does not merge, and it stops at 200.
- A person has only used the app on Windows. On macOS and Linux it has been started by `pack-check.js`, with a
  stand-in for Claude Code; everything in section 7 is untried there.
- The effect of App Nap on the app's timers was not measured. The design avoids depending on it.
- The Windows installer is not signed, and the app has Electron's default icon.
- The signed and notarised Mac build has run on the owner's Mac and in the `installers` workflow, started by
  hand on the `mac-signing` branch: Apple accepted both apps, Gatekeeper reports them as notarised from the
  disk images, and `pack-check.js` passed on both with the hardened runtime. On the owner's Mac a copy marked
  as downloaded starts.
- A packaged build must keep Electron's `RunAsNode` fuse on, or the helper process needs another way to start.
  `pack-check.js` fails when it is off.
- On Ubuntu 24.04 and later the AppImage runs without Chromium's sandbox. A `.deb` with an AppArmor profile
  would keep it.
- The Windows behaviour beside a saturating outside program, described above.
- Sessions started outside the app are shown but not limited, and a terminal cannot be attached to them.
- Closing an instance stops Claude Code but not the processes it left running; those are no longer limited.
  Only on Windows, and only when the worktree goes too, are they ended.
- Two copies of the app share one state file, and the last one to save wins.
- Issues still queued for dispatch are not remembered across a restart.
- The home folder: skills linked in through a symlink are not listed, and new files cannot be created there
  from the app.
- A flag placed before the `.` on the command line makes the app open its own source folder (see the table
  above). The app could find the folder argument more carefully.

## 13. Continuing the work

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
  the problems in section 6. `node cpu-check.js stop` runs a single scenario, here the one that ends an
  instance's processes.
- **Before a test starts an instance**, it checks which folder the app has open. Electron's own flags, such as
  `--remote-debugging-port` and `--inspect`, go after the `.`.
- **The home folder is tested against a stand-in**: the app is started with `CLAUDE_CONFIG_DIR` pointing at a
  scratch folder. Instances started in that run are not logged in, which does not matter for the editor.
- **The main process can be reached** with `--inspect=<port>`, for instance to answer a native dialog that a
  test cannot press.
- **A packaged copy** is in `dist/` after `npm run dist`: on Windows `dist/win-unpacked/claudinho.exe`, the
  same files the installer puts on the disk. It takes the folder and the test flags like the app from source
  does, in any order. `pack-check.js` is the check for it.
- **The other two systems' installers** can only be built on those systems. The `installers` workflow does it;
  started by hand from the Actions tab it builds and checks without publishing, and the installers can be
  downloaded from the run for a week.
- **The start order of a batch** is tested in a scratch repository whose `.claude/settings.json` has a slow
  `SessionStart` command hook that appends a line when it begins and when it ends, each with the time and its
  folder. Issues can be handed to the `dispatch` call directly; with `GH_REPO` set, `gh` has a repository for
  the blocker lookup although the folder has no GitHub remote.
- **The Pull requests tab** is tested read-only: an empty folder with `git init` and an `origin` that points at
  a public repository with many open pull requests.
- **Input requests** need a session that is asked before it uses a tool. On a machine whose default is auto
  mode, the scratch repository's `.claude/settings.json` gets `"permissions": { "defaultMode": "default" }` for
  the test. Answers in the terminal are typed by writing keys to the instance.
- **The update button** is tested with `CLAUDINHO_RELEASES` pointing at a one-line server that names a higher
  version. Pressing the button runs the real `claude update`, so the test first makes sure the installed
  version is the newest.
- **Auto-merge** is tested live in a clone of a GitHub repository made for it: the sessions open real pull
  requests there and the app merges them. A fresh clone needs its workspace trust dialog answered once. The
  verdicts come from a real Claude run, so a test writes down what happened instead of asserting a verdict;
  the prompts tell each session what to write at the end of its turn.
- **The app's own update** is looked at with `CLAUDINHO_UPDATES` pointing at a stand-in that serves a
  `latest.yml` with a higher version and no installer behind it. Never serve a real installer to a copy on a
  machine in use: the update installs over the app that is installed there. The install itself is what
  `pack-check.js --update` does on the hosted machines.
- **A command that must not run in a check** is replaced by a shell function. A stand-in folder on the `PATH`
  is not enough in Git Bash, where a Windows path in `PATH` is split at its colon.
- This repository has no `docs/PROCESS.md` on purpose. The app, like the owner's helper, tells an agent to
  follow that file when it exists, and this record is a history, not a process to follow.

## 14. Sources

The owner's rule for the session was to name the documentation before building on it. These are the pages the
work relied on.

**Signing and the app's own update**

- electron-builder 26 (`https://www.electron.build/v26/docs/…`): `features/code-signing/code-signing-mac`,
  `features/code-signing/notarization`, `features/code-signing/code-signing-win`, `mac`, `win`, `dmg`,
  `features/auto-update`, `publish`, `api/electron-updater.Class.AppUpdater`. Where a page and the installed
  version disagreed, the installed code was followed (`app-builder-lib` and `@electron/notarize`, whose README
  names the role a notary key needs).
- <https://developer.apple.com/help/account/certificates/create-developer-id-certificates/>
- <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>
- <https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api>
- <https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac>
- <https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions>
- <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation>
- <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options>
- <https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart>
- <https://signpath.org/terms>

**Auto-merge**: the `hooks` and `headless` pages below, `claude --help` of 2.1.322, and
<https://cli.github.com/manual/gh_pr_merge>, <https://cli.github.com/manual/gh_pr_ready> and
<https://cli.github.com/manual/gh_pr_checks>.

**Claude Code** (`https://code.claude.com/docs/en/…`): `hooks`, `headless`, `statusline`, `settings`, `cli-reference`,
`worktrees`, `sessions`, `sub-agents`, `skills`, `authentication`, `env-vars`, `model-config`,
`permission-modes`, `claude-directory`, `agent-view`, `setup`, `permissions`. The install scripts behind
<https://claude.ai/install.sh> and <https://claude.ai/install.ps1> show where the newest version is read from.

**git**

- <https://git-scm.com/docs/git-worktree>
- <https://git-scm.com/docs/git-rev-list>
- <https://git-scm.com/docs/git-branch>

**Templates, versions, files**

- <https://jinja.palletsprojects.com/en/stable/templates/>
- <https://docs.npmjs.com/cli/v11/commands/npm-version>
- <https://nodejs.org/api/fs.html>

**GitHub**

- <https://docs.github.com/en/rest/issues/issue-dependencies>
- <https://docs.github.com/en/graphql/reference/objects>
- <https://cli.github.com/manual/gh_api>, <https://cli.github.com/manual/gh_pr_merge> and
  <https://cli.github.com/manual/gh_pr_list>
- <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax>
- <https://docs.github.com/en/actions/reference/runners/github-hosted-runners>

**Windows job objects**

- <https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects>
- <https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_cpu_rate_control_information>
- <https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_accounting_information>
- <https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject>
- <https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-setinformationjobobject>
- <https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject>

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

- <https://www.electronjs.org/docs/latest/>, for the fifth round its pages `api/tray`, `api/native-image` and
  `api/net`
- <https://github.com/microsoft/node-pty>
- <https://xtermjs.org/docs/>

**Installers**

- electron-builder 26 (`https://www.electron.build/v26/docs/…`): `configuration`, `contents`, `cli`, `publish`,
  `architecture`, `nsis`, `mac`, `dmg`, `appimage`, `linux`, `features/github-actions`,
  `features/code-signing/code-signing-mac`
- <https://www.electronjs.org/docs/latest/tutorial/fuses>,
  <https://www.electronjs.org/docs/latest/tutorial/asar-archives> and
  <https://www.electronjs.org/docs/latest/tutorial/application-distribution>
- <https://docs.github.com/en/billing/concepts/product-billing/github-actions>,
  <https://docs.github.com/en/actions/reference/workflows-and-actions/contexts> and
  <https://cli.github.com/manual/gh_release_create>
- <https://support.apple.com/en-us/102445> (opening an app that is not notarised)
- <https://developer.apple.com/help/account/certificates/create-developer-id-certificates/>
- electron-builder 26.18.0's own code: `out/options/macOptions.d.ts` (the option docs for `identity`,
  `hardenedRuntime`, `notarize`), `out/mac/MacTargetHelper.js` (which `APPLE_*` variables start notarisation),
  `out/codeSign/codesign.js` (`CSC_LINK` as base64) and `templates/entitlements.mac.plist`
- <https://support.microsoft.com/en-us/topic/what-is-smart-app-control-285ea03d-fa88-4d56-882e-6698afdb7003>
- <https://docs.appimage.org/user-guide/troubleshooting/electron-sandboxing.html> and
  <https://discourse.ubuntu.com/t/ubuntu-24-04-lts-noble-numbat-release-notes/39890> (user namespaces)
