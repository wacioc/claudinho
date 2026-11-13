# How claudinho was built

claudinho was built in one long working session from 10 to 12 November 2026, between its owner and Claude
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
deleted under a running program, so nothing is ended there. (Docker Desktop has since been left out of this:
see "Closing a card took Docker Desktop with it" in section 14.)

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
14 carry what that session recorded). The work here was then put on top of it. A variant written on the PC
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

## 12. The seventh round: when a session is done

The next day, with 0.4.0 installed and in use, the owner wrote:

> A claude code session should be considered done when it's not thinking any more, it has no subagents running,
> it has no monitor and no shell still running. Push an updated version with this fix.

### What was wrong

Until 0.4.0, done meant that the session's last turn had ended and no prompt had gone in since. A turn also
ends when the session has started something and waits for it: a command in the background, a subagent, a
monitor. Claude Code wakes the session when that ends or reports, and the session carries on. Such a pause got
the checkmark and the "is done" notification. With auto-merge on, the pull request was judged from what the
session had written at that point, and a dispatched session gave up its place in the pool.

### What Claude Code reports

The hooks reference gives the `Stop` hook a list, `background_tasks`, so that a hook can "distinguish 'session
is done' from 'session is paused waiting for background work to wake it back up'". What 2.1.322 sends was
measured first, with three sessions that each started one thing and ended their turn:

| Started | In `background_tasks` when the turn ended | What happened when it ended |
|---|---|---|
| A command, with `run_in_background`. | `{"type": "shell", "status": "running", "description": …, "command": "sleep 40"}` | A `<task-notification>` went in as a prompt (`UserPromptSubmit`). The turn that followed ended with an empty list. |
| A subagent, with `run_in_background`. | `{"type": "subagent", "status": "running", "description": …, "agent_type": "general-purpose"}` | Its report went in as a prompt that starts with `<agent-message`. The turn that followed ended with an empty list. |
| A monitor, with the Monitor tool. | An entry of type `shell`, with the monitor's command. The type `monitor` of the reference did not appear. | Each line the monitor reported went in as a `<task-notification>` prompt and made a turn of its own, which ended with the monitor still listed. The turn after its stream had ended closed with an empty list. |

Two more things showed. `claude agents --json` reports a session that waits like this as `busy`, for the whole
wait, which is why its card already read "working" beside the checkmark. And `SubagentStop` fires about a
second after every `Stop`, for helpers of Claude Code's own; it carries the same list, but a subagent that is
just ending is still in it.

### Decisions

| Decision | Why |
|---|---|
| Done is decided when a turn ends, from the list in that `Stop`. | That is what the list is for, and it is exact at that moment. With auto-merge the decision has to fall while the hook is still open, because a follow-up is the hook's answer. The status that is polled every three seconds says `busy` or `idle` and no more. |
| Everything in the list counts, whatever its type. | The owner named shells, subagents and monitors. The list also knows workflows, teammates, cloud sessions and MCP tasks, and they are the same thing to the owner: work the session started that is not over. A monitor cannot be told from a shell there in any case. |
| A scheduled wake-up does not count. | They are listed apart, in `session_crons`, and the owner's sentence is about what is running. A session in a `/loop` is done between two rounds; the next round goes in as a prompt and takes the mark away. |
| A turn that ends with something running changes nothing but what the card shows. | No checkmark, no notification, no review of the pull request, no button to merge, and a dispatched session keeps its place in the pool. Input requests are left as they are as well: a subagent may be waiting for an answer. The card gets a chip, "still running: 1 shell", with each task's description as its tooltip and as a row of the detail view, and it still learns of its pull request. |
| What wakes a session is not a prompt of the owner's. | `UserPromptSubmit` fires for it as for a typed prompt. The app took each one for the owner's latest prompt, which the review of a pull request weighs above the first, and began its count of follow-ups again. With done moved to the end of the background work, every such session would have been judged right after one. They are told apart by the tag they start with (`lib.ownPrompt`). |
| Nothing polls for work that ends without waking the session. | In every case tried, the end of a task woke the session. The ceiling stands where it applies, as a `ponytail:` comment in `onStop`, with the sign to go by. |

### How it was verified

The two helpers have asserts in `test.js`, fed with the entries and the prompts as Claude Code sent them.

The rest ran live, in the clone of the test repository, with four Haiku sessions told what to start and what
to write. All four were waiting at the same time; their cards read "working", without checkmark or outline,
with the chip, and without a button to merge.

| Session | While it waited | In the end |
|---|---|---|
| Starts `sleep 90` in the background and ends its turn. | "still running: 1 shell", for 90 seconds. | Done 98 seconds after the start, with one notification. |
| Starts a subagent in the background that takes a minute. | "still running: 1 subagent". | Done after the subagent's report, at 73 seconds, with one notification. |
| Starts a monitor that reports five lines, 15 seconds apart. | Five turns of one word, each ending with "still running: 1 shell". | Done after the monitor's stream had ended, at 85 seconds, with one notification. |
| Auto-merge on: opens a pull request, starts `sleep 45` in the background, and says the pull request is ready for merge. | The card showed the pull request, open, and the chip. No review. | When the command had ended, the session said so. Then came the review, the wait for checks and the merge, 89 seconds after the start, and one notification: "is done: pull request … (merged)". |

Not exercised: an input request of a subagent that is open while its session's turn ends, a task that ends
without waking its session, a `/loop`, and a dispatched batch, in which a waiting session has to keep its
place.

### The release of 0.4.0, which came before this round

The tag's run failed and published nothing. The Mac job had built, signed, notarised and passed every check,
and then could not hand its files over: `actions/upload-artifact` gave up after five attempts ("Failed to
CreateArtifact … is not valid JSON") while GitHub Actions had an outage. The release job needs every build, so
it was skipped. `gh run rerun <run> --failed` repeated the Mac job and then ran the release job, which also
took the Windows and Linux files the first attempt had stored. The release has all 14 files.

The published release was then read the way an installed copy reads it, without installing anything:
electron-updater's GitHub provider, with the three lines the packaged app carries in `app-update.yml`, as a
copy that claims version 0.3.9. It found 0.4.0 and named the Windows installer; as 0.4.0 it found nothing
newer. Before the release the same reading had ended, as it should, with "Cannot find latest.yml" for 0.3.1.
Every file that the three `latest*.yml` files name is in the release with the size given there, and is served
under the address the update asks for.

0.4.1 is the first release that an installed copy can update itself to.

### What went wrong

| Symptom | Cause | What changed |
|---|---|---|
| In the first live run, the card of the session that waited did not show its pull request, and the test's check for it failed. | The app reads a session's pull request in the same place where it judges it, and that no longer happens when a turn ends with something running. | Such a turn still reads the pull request, and does nothing else with it. |
| A subagent told to run `sleep 30` came back after four seconds. | Claude Code refuses a bare `sleep` in the foreground and points the model to a monitor or to the background. | The subagent of the test waits with `node -e "setTimeout(…)"`. |
| The run of the 0.4.0 tag failed. | An outage at GitHub, above. | The failed job was run again; no new tag was needed. |

## 13. The eighth round: lists by number, autonomy as one dropdown

The same day, two short requests, the second while the first was being worked on:

> I want the GH issues and PRs to be ordered by their #

> The auto-merge feature shouldn't be a checkbox, it should be the dropdown with the same options:
> manual/merge by the agent's discretion/auto merge

### The order of the two lists

| Decision | Why |
|---|---|
| Lowest number first. | The request names no direction. The pull requests already came highest first, which is how `gh pr list` hands them over, so a request that includes them asks for the other way round. Several issues are also started in the order of the list, and a batch that begins with its lowest number follows the way a plan is numbered. |
| Sorted in the app. | GitHub's schema, read with `gh api graphql`, orders issues by `CREATED_AT`, `UPDATED_AT` or `COMMENTS`: there is no order by number. `gh pr list` asks for `CREATED_AT`, descending, which `GH_DEBUG=api` shows. |
| Issues are asked for newest first, no longer last changed first. | The app stops at 1000 issues. In number order, the 1000 changed last are a list with holes in it; the newest 1000 are a list that starts later. The first live run showed the holes, on a repository with more open issues than that. |

### Autonomy

Until now the dialog for several issues had a dropdown with three settings, from the brief: Manual, Semi-auto,
Full-auto. Everywhere else there was a checkbox, auto-merge on or off: in the dialog for one issue, in the
dialogs for a new instance and a new worktree, and in an instance's detail view. Now the dropdown is in all of
them, and a session has one setting, its autonomy, where the code had two.

| Decision | Why |
|---|---|
| The three settings mean the same wherever they are chosen. | That is what the owner asked for. It changes one case: one issue on Manual is now told not to merge, as each issue of a batch always was. An unticked box had said nothing about merging and left it to the repository's own process. |
| A session started without an issue is told nothing on Manual and on Full-auto. | Its prompt is the owner's own, and the default must not put a sentence about pull requests into every session. Full-auto worked without a word to such a session before, by reading what it writes, and still does. |
| Semi-auto is said at the end of the first prompt wherever there is one. | With Semi-auto the session is the one that merges, so it has to know. An issue's prompt ended with the sentence already; the first prompt of a start dialog now does too. The first live run showed that it has to be there (below). |
| Where there is no first prompt, or the setting changes later, the session is told by a note: the app's answer to its next `UserPromptSubmit` or `PostToolUse` hook. | The hooks reference gives both an `additionalContext`, "added to Claude's context alongside" the prompt or the tool result. The other way is typing into the session's terminal, and there a dialog may be open that the Enter key would answer. A tool call of a subagent carries an `agent_id`; no note is sent with those. |
| Only a change to Semi-auto or away from it is told. | With the two others the owner or the app merges, whatever the session knows. Away from Semi-auto has to be told: a session that still believes it may merge would do so on a card that says Manual. |
| The card says "not told yet" until the note has gone. | An idle session has no prompt and no tool call for the note to go with. The owner can see that, and type something. |
| A session that is started again from its first prompt is taken to know what that prompt says about merging, and nothing since. | Its conversation is gone, and every note with it. Where the card says something else by now, it is owed a note, which goes with that prompt. |
| A record written by 0.4.1 or older reads as Full-auto with auto-merge on, as Manual without. | That is all such a record says. A batch started with Semi-auto before the update therefore shows as Manual after it. |

### How it was verified

`test.js` has asserts for the order by number, for the query's order, for the note, for what a first prompt
says about merging, and for what an older record reads as.

The lists were checked read-only, in an empty folder whose `origin` is a public repository with more than a
thousand open issues. The Issues tab showed 1000 rows, each with a higher number than the row above, and they
were the same 1000 that `gh issue list` gives as the newest; the same held for every state. The 59 open pull
requests were GitHub's 59, in number order. All four start dialogs had the dropdown, on Manual, and no
checkbox; three issues went to the dialog lowest number first. Three made-up records, two of them in the form
0.4.1 writes, came up as interrupted cards with the right setting.

The settings were then run live in the clone of the test repository, with Haiku sessions in auto mode, which is
this machine's default.

| Session | What happened |
|---|---|
| Semi-auto, with a first prompt. | The prompt on its screen ended with the sentence. It opened a pull request and merged it itself with `gh pr merge`, 39 seconds after its start. The app reviewed nothing. One notification: "is done: pull request … (merged)". |
| Full-auto. | As before this round: review, wait for checks, merged by the app at 47 seconds. |
| Started on Manual; its detail view set to Semi-auto while it ran three commands of twelve seconds each. | Chip "semi-auto merge · not told yet". Thirteen seconds later, while the turn was still running, the chip lost its second half. Asked at the end of the turn what it had been told about merging, the session quoted the sentence. |
| The same session, set back to Manual while idle. | "manual merge · not told yet", and still so four seconds later. Told with the next prompt typed to it, after which it quoted the Manual sentence and the chip was gone. |
| One issue, sent from the dialog with Semi-auto chosen. | Its prompt ended with the sentence, and its card was on Semi-auto from the start. |

Last, four made-up records without a conversation were started again from their first prompt, which asked
each session to quote what its prompt and what a note said about merging.

| Record | What happened |
|---|---|
| Semi-auto sentence in its prompt, card on Manual since. | "manual merge · not told yet" at its start. It quoted the sentence from its prompt and, as the note, the Manual one; the chip was gone. |
| Nothing about merging in its prompt, card on Semi-auto since. | "semi-auto merge · not told yet" at its start, then told: it quoted the Semi-auto sentence as the note. |
| Semi-auto sentence in its prompt, card on Semi-auto. | Nothing owed, no note. |
| Nothing in its prompt, card on Manual. | Nothing owed, no note. |

Not exercised: several real issues started in the order of the list, a session outside auto mode that hears of
Semi-auto by a note, a session resumed with its conversation while a note is still owed, and a conversation
that is cleared after it was told.

### What went wrong

| Symptom | Cause | What changed |
|---|---|---|
| In the first live run a session started by hand with Semi-auto heard of it by the note, next to its first prompt. It opened a pull request, ran `gh pr merge` and was refused: "Blocked by auto mode", "Merge Without Review". It left the pull request open and said so. | To auto mode a note from a hook is not the owner's word, and merging without review is something it wants the owner's word for. | Where a session starts with a prompt, the sentence is part of it: the same session then merged. For the rest the README says what holds. Nothing was done to get a note past auto mode. |
| A session whose card was changed while it worked was not told until its next prompt. | Every tool call reports to the app, but the app read such a report only while an input request was open. | It also reads it while a note is owed. |
| The check that compared the open issues with GitHub's list failed. | The app held the 1000 changed last, the list the 1000 newest. | The order the issues are asked for, above. |
| Found when the changes were read once more before the release: a session started with Semi-auto in its prompt, set to Manual on its card and told so, would have read the sentence again when it was started again without its conversation, with nothing owed to it. It could then have merged on a card that says Manual. | The record kept what the session was told last. A session without its conversation knows its first prompt only. | Started again, what it knows is read from that prompt (`toldToMerge` in `lib.js`). |
| In one session a `git commit` followed by a push stopped with "Permission denied" on the repository's `.git/config`. | Not looked into. Two sessions were at work in two worktrees of the one repository at that moment, on Windows. | Nothing. The commit was there; the session pushed again. |

## 14. The ninth round: a Diff tab, its colours, and a list of sessions

The same day, after 0.5.0 was out:

> In a claude code session view, I also want to have a Diff tab where I can see the updates in the PR that's
> currently in that claude code session.
> It should work exactly as the diff in GitHub and it should be read-only.

Shown the first version and what it leaves out, the owner picked one of those before any release:

> Syntax colours first

and, while that was being built:

> I also want in a claude code view to have a sidebar with a list of all the other running claude code
> sessions with their name and status so that I can cycle through them easily.

### How it was read, and why

| Decision | Why |
|---|---|
| The session view is the instance's detail view. It gets two tabs above the terminal: Terminal and Diff. | It is the one view of a single session, and the terminal has to stay a click away. The side panel stays beside both. |
| The diff is the pull request's as GitHub has it, not what is in the worktree. | "The PR that's currently in that session", "as the diff in GitHub": what "Files changed" shows there, which is what is pushed, against the merge base. |
| "Exactly as GitHub" was taken as GitHub's files, hunks and line numbers in GitHub's order, drawn like its default view. Not built in the first version: the side-by-side view, syntax colours, the marking of changed words inside a line, unfolding the lines between two hunks, hiding whitespace. | The default view is what GitHub shows without a click, and plain DOM can draw it. Syntax colours need a library, which this project does without where it can; the others are more code than a first version should carry unasked. The owner was told what is left out, before the work and after it, and asked for the colours (the second table). |
| GitHub's own page is not embedded. | It would need a github.com sign-in inside the app, and it is not read-only. |
| The data is GitHub's list of a pull request's files, not `gh pr diff`. | The list is structured: names as they are, a status, counts, and each file's hunks, so none of git's file headers has to be parsed. It is also the form the page shows. `gh pr diff` cuts some hunks differently, and it refuses a pull request of more than 300 files with a pointer to this list. |
| A file starts folded where it does on GitHub: a deleted file, a diff of more than 400 lines or 20 KB, and what follows a pull request's first 20,000 lines. | Deleted files fold on GitHub's page; the numbers are the ones GitHub documents. The last one also bounds how long the window is busy drawing, and every terminal lives in that window. |
| What GitHub's list leaves out is named and linked, not fetched another way. | The list has no patch for a binary file, for a file whose own diff is very large, and for some files of a very large pull request, which then come with their counts at zero as well. The worktree has the commits, so git could fill the gap. That is a second mechanism, left until it is missed. |
| It is read when the tab is opened, when the session's turn ends with the tab open, and on Refresh. A read that brings nothing new changes nothing on screen. | The end of a turn is when a session has usually pushed. What is open, and the place in the pane, outlive a refresh. |
| The tab asks GitHub for the branch's pull request itself. | The card learns of a pull request only when a turn ends. |
| Every row is a text node, built with the helper the rest of the window uses. | A diff is whatever a session, or anyone, wrote. The window can start sessions and remove worktrees, so nothing in a diff may become markup. |

The syntax colours and the list of sessions:

| Decision | Why |
|---|---|
| The colours come from highlight.js, the first dependency taken on for a feature. | A language needs a grammar to be coloured, and the platform has none. The owner chose colours knowing they need a library. highlight.js has 193 languages, finds one by a name or an alias, which a file's ending mostly is, ships GitHub's colours for a dark page as a style sheet, and is under the BSD licence. |
| It runs in the main process, for one file a call, when the tab first draws that file. | The window is sandboxed and loads no modules, and it stays so. In the main process the work has to be short, since every terminal passes through there: 8 µs a line when measured, 25 ms for the slowest of 700 files. A file that is never opened is never coloured. |
| What it answers, which is HTML, is never read as markup. It is taken apart into runs of text with a class each, and a line whose runs do not add up to the line stays uncoloured. | The rule of the diff itself. The comparison also means that a mistake in the taking apart cannot change what a line says. |
| A hunk is coloured as two pieces of code, its old side and its new side. | A comment or a string that runs over several lines keeps its colour within the hunk, and a removed line is coloured as part of the old file. What began above the hunk is not known. GitHub colours whole files and has that right; reading both versions of every file was not worth it for a first version. |
| The language is told by the file's name, with three endings set by hand (`.htm`, `.vue`, `.m`). The content is not guessed from. | Guessing takes long and goes wrong on short pieces. A wrong language is worse than no colours. |
| The list of sessions is a column on the left of the detail view: the app's instances in the order of the wall, each with its name, its status, the mark for done and its group's stripe. The session on show stays in it, marked. | "All the other running sessions", "to cycle through them": a list whose rows change with every click is hard to go through. Sessions started outside the app are left out: they have no view to go to. |
| Sessions with the same name also show the name Claude Code gave each. | An instance is named after its worktree, or after the folder when it has none, so two sessions in the folder itself would be two rows that read the same. On the wall their terminals tell them apart; in a list nothing does. |
| A click keeps the tab. | Going through the sessions' diffs is as likely as going through their terminals. Coming from the Diff tab, the keyboard is taken out of the terminal that is not on show. |
| No key for the next session. | The request names a list. Offered to the owner. |

### How it was verified

`test.js` has asserts for the hunks of a patch with their line numbers, for the note of a file without a
patch, for what starts folded, and for a pull request that GitHub hands over in part.

Read-only, against 150 pull requests of a public repository: 1,625 files, 3,529 hunks, 184,222 lines. In every
file the added and removed rows were as many as GitHub counts, the line numbers ran on without a gap, and each
hunk held as many lines as its header says. For 40 of them the result was compared with what `gh pr diff`
prints: the same files and the same added and removed lines in all 40, with the hunks cut differently in 8.
For one of those 8, GitHub's page was fetched: it has the hunks of the list. The address of a file on that
page, the hash of its name, was checked there too.

Live, in the clone of the test repository. The clone's checkout was put on a branch with one commit that holds
every kind of change, and a session was told to push it and open the pull request, with its Diff tab open from
before.

| What | What happened |
|---|---|
| Before the pull request. | "This session has no pull request yet." |
| The session's turn ends, 20 seconds in. | A second later the tab shows the pull request, without a click: number, title, "open", and GitHub's totals. |
| The 14 files. | GitHub's 14, in its order. Every open file has as many added and removed rows as GitHub counts. |
| A deleted file; a file of 600 added lines. | Folded, with the reason beside the name. Opened, the large one has its 600 rows. |
| A binary file, an empty file, a file that was only renamed. | Each with its note and a link to GitHub. |
| A renamed file with changes; a name with a space and a letter outside ASCII. | Both names with an arrow; the name as it is. |
| A file without a line break at its end. | The "No newline at end of file" row under each of the two lines. |
| A line that holds `<script>` and `<img onerror>`. | Shown as text. No script and no image element came of it. |
| A line of 400 characters; tabs. | Wraps inside the pane; kept. |
| The list for jumping. | Scrolls to the file, below the bar, which stays at the top. |
| Refresh with nothing new. | The pane stays where it was, and what was opened stays open. |
| The pull request closed on GitHub, then Refresh. | "closed", with the same 14 files. |
| The session resumed after the app was stopped. | Its tab reads the pull request of its branch. |
| Back to the terminal, and back to the wall. | The terminal is fitted and has the keyboard; the card on the wall shows its terminal and no tabs. |

Drawing was timed by handing the data of public pull requests to the same code. One of 3,600 rows took 119 ms.
One of 738 files, far over GitHub's limits, took 281 ms: most of its files are deleted or large and start
folded, 197 were open, with 6,789 rows. Made-up pull requests whose every file is open cost about 0.15 ms a
row: 1.2 seconds for 4,000 rows, 2.9 for 20,000, 6.3 for 50,000. Once drawn, jumping through the pane cost
nothing that could be measured.

The colours were checked the same three ways. `test.js` has asserts for the taking apart of highlight.js's
answer and for a hunk whose two sides are coloured differently. Read-only, on five public pull requests, the
one of 738 files among them: 542 of 695 files were coloured, 106,615 lines in 0.8 seconds, and every line's
runs added up to the line. The slowest file took 24 ms, apart from the first one, whose 131 ms hold the loading
of the library. The rest had names that tell no language. Live, the one file of code in the test session's
pull request came out in GitHub's colours (a keyword in `rgb(255, 123, 114)`), its text files stayed as they
were, and the line with `<script>` in it was still text. The data of a public pull request of Go code, handed
to the same drawing, gave 4,554 coloured runs on added, removed and kept lines, and all 3,499 lines read
exactly as GitHub had given them.

The list of sessions was run with three sessions: one in the clone's checkout, two in worktrees and in a group,
one of those with a question held on its card.

| What | What happened |
|---|---|
| On the wall. | No list. |
| A session on show. | A column of 230 px on the left with three rows, in the order of the wall; the session fills the rest, and its terminal is fitted to that. |
| The rows. | Name and status of each; the one on show marked; the one with the question in the colour for "needs input"; the two of the group with its stripe. |
| A click on another row, from the Diff tab. | That session is on show, on its Diff tab, which says that its branch has no pull request. The keyboard is not in its terminal. |
| A click on the third row, from the Terminal tab. | Its terminal, fitted and with the keyboard, and its question above it. |
| The question answered; the first session put into a group. | The row says idle and no longer stands out; the other row moves behind the first group and takes its own stripe. |
| A second session in the clone's own folder. | Two rows with the folder's name, each with Claude Code's name for its session below it; the two in worktrees without one. |

A packaged copy was built and `pack-check.js` run on it, with its new step: the highlighter loads from the
package and colours a line, and the style sheet gives a keyword GitHub's red.

Not exercised: a session in a worktree with a pull request (the test session with one ran in the clone's own
checkout; the code asks for nothing but the instance's folder), a pull request of more than 100 files read by
the app itself (the read-only check pages the same way and read the one of 738), a session's own pull request
once merged ("merged" was drawn from a public one's data), and the list with more sessions than fit its height.

### What went wrong

| Symptom | Cause | What changed |
|---|---|---|
| In the first live run the bar drew and no file did. | `replaceChildren` was handed an array and two booleans. It takes nodes, one by one. | Spread and filtered, as the window's helper does with its own children. |
| The Terminal tab lost its highlight. | The two buttons carried the class of the window's own navigation, whose code resets that class on everything that has it. | A class of their own; the style sheet gives both the same look. |
| A file whose mode alone had changed was called a binary file. | GitHub reports it as modified, without a patch and with no counts, exactly like a binary file that changed. | The note names both. |
| A check waited for minutes and came back with nothing, and scrolling a long diff seemed to take seconds. | The test window was covered by other windows. Chromium gives a hidden page no animation frames and holds its timers back, so the waits inside the page never ended. | Checks wait on their own side and measure in one go. The slowness was the check's, not the pane's. |
| A comment in the code said GitHub hands over about a megabyte of a pull request. | A guess. Measured on the pull request of 738 files: 3.8 MB of patches came, and from 3.1 MB on every second file came without one. | The comment says what was measured. |
| The first comparison of totals failed on one pull request. | Its files added up to less than its own totals. | That is how a pull request handed over in part is told, in the app as in the check, and the tab says so. |
| The check of the list waited two and a half minutes for a question on a card, and none came. | At the "manual" input level the app holds nothing: the session asks in its own terminal. Only "timed" puts a request on the card. | The check uses "timed". The row of that first session said "needs input" all the same, from the session's status. |
| At the end of that wait the list was reported as showing on the wall, before the check had opened any session. | Not found. Nothing in the app opens a session by itself; a click on a card does, and the test window stands on the owner's desktop. A second run, and the same wait once more with a look every fifteen seconds, had the list hidden throughout. | Nothing. The check now prints the state of the view with that verdict. |

### The release of 0.5.0, which came before this round

One change went in between the owner's go-ahead and the tag: the session that starts again from its first
prompt (section 13). The first attempt of the `installers` run then failed in the Windows job at
`upload-artifact`, with "Failed to FinalizeArtifact: Unable to make request: ECONNRESET", after the build, the
install and the update had passed there. GitHub's status page reported nothing. `gh run rerun --failed` ran
that job and the release job again, and the release came out with its 14 files.

### After the release of 0.6.0: hourly checks, the issues highest first, buttons to GitHub

0.6.0 came out on the first attempt, with the new step of `pack-check.js` passing on all three systems. Then:

> Make the claudinho update checker more often, like every 1 hour.

There are two checks that ran every six hours: for the app's own releases and for Claude Code's version. The
request names the first, and only that one was changed. An hourly look costs GitHub little: the installed
electron-updater (6.8.11, `GitHubProvider.js`) asks github.com's pages for the feed of releases, for the newest
release and for its `latest*.yml`, and says in a comment that it keeps away from GitHub's API because of that
API's limit. Checked with a copy run from source and pointed at a stand-in feed: it asks at its start and shows
the button. The hour until the next look was not waited for.

The day after, four things in one message, to go out together as 0.6.1:

> Update the issues list to be ordered descending by the issue #
> In a claude code session and in the global viewer, if a claude code session is linked to an issue display a
> button that links to the issue on github (#343 for example). And same for PR. If the claude code session has
> an opened PR, display a button that links to the PR.
> Make claude code update check hourly as well.
> When you're done, deploy these changes as 0.6.1

| Decision | Why |
|---|---|
| The Issues list is highest number first. The pull requests stay lowest first. | The request names the issues list. It takes back the direction chosen in section 13, for that list only. |
| Issues sent together still start with the lowest number, and their group is named in that order. | A batch began with its lowest number because the list did, and for a reason of its own: a plan is numbered in the order it is to be done. The request is about the list. |
| The two buttons are on the card, in the row of its chips, where "issue #5" and "PR #21 merged" stood as text. The card is the same on the wall and in the detail view, so both have them. | "In a claude code session and in the global viewer". The two chips that said the same without a link are gone. |
| The pull request's button is there for any pull request of the branch, open, merged or closed, with that state on it. | The chip was, and a merged pull request is still worth a look. "Opened" was read as "has been opened". |
| The buttons are kept out of the part of the row that is built anew with every state. | That happens every second or two, and a button that is replaced between the press and the release of the mouse does not get the click. |
| A session keeps the address GitHub gave for its issue. One on record with the number alone gets the address of the open folder's repository, and no button where it belongs to another folder. | The window shows every session, also those of a folder that was open before. Making the address from the open folder's repository alone could lead to another repository's issue. |
| The Claude Code check is hourly too. | Asked for. It is one run of `claude --version` and one line of text from the address the installer reads. |

Checked read-only, in the folder of the public repository: 1000 open issues, each with a lower number than the
one before and the same 1000 GitHub lists as its newest; three issues picked out of order go to the dialog
lowest first, with the group named that way; the pull requests as before; and at its start the app asks the
stand-in for Claude Code's releases. Checked live in the clone of the test repository, with the call that
opens a browser caught in the window and written down: a session sent after issue #1 has the button "#1" on
the wall and in the detail view, and it opens that issue; a session in the clone's checkout gets "PR #21" once
its Diff tab has read the pull request, and "PR #21 closed" after it was closed; a click on the wall does not
open the session; seven seconds of states later both buttons are still the same elements; the record on the
disk holds the issue's address. Of three made-up interrupted sessions, the one with the number alone and of
the open folder has a button to that folder's repository, the one of another folder has plain text, and the
one with its own address keeps it.

0.6.1 came out on the first attempt. Asked whether the pull requests should follow the issues, the owner
answered "Yes, PRs too": both lists are highest number first, with one order in `lib.js` for the two. Checked
read-only: 56 open pull requests and 1000 open issues, each list falling and the same as GitHub's. That went
out as 0.6.2, again on the first attempt.

### The local diff, while there is no pull request

> In the diff tab I want while the PR isn't opened yet to display the local Diff and put either Diff (local)
> or Diff (git) depending on whether a PR exists or not.

| Decision | Why |
|---|---|
| The local diff is everything the folder holds beyond the default branch: the commits on its branch, what is not committed, and the files git does not know yet. | A session edits first and commits later, and pushes last. Only what is not committed would be empty after its commit; only the commits would be empty before it. Together they are about what a pull request opened now would show, with the uncommitted work on top. |
| The default branch is the one `origin`'s HEAD names, else `origin/main`, `origin/master`, `main`, `master`. Where none is found, the diff is against the last commit; in a repository without a commit, against nothing. | That is the branch a pull request would go to, as far as the clone knows without asking GitHub. The local diff must work without a network. |
| It is read with `git diff-index -p -M` and `git ls-files --others --exclude-standard`, not with `git diff`. | The Diff tab is read-only, by the owner's first request for it. `git diff` brings the index up to date and writes it where a file was only touched (`diff.autoRefreshIndex`, which git's manual says holds for the porcelain command alone). In a scratch repository it did so with `--no-optional-locks` too. A session may be at its own `git add` at that moment. The plumbing command left the index byte for byte as it was. |
| git's patch text is turned into the rows GitHub's list of files has, and from there it goes the way of a pull request. | One drawing, one set of rules for folding and notes, one colouring. What a file is called is read from the lines that say it unmistakably ("rename to", "+++ b/…", "--- a/…"), and for a file without those from the two equal halves of its first line. |
| A file git does not know is read from the disk and shown as all added. At most 200 of them, 1 MB each, 8 MB in all. | `git diff-index` knows nothing of them, and new files are much of what a session makes. The limits are for a folder with something large in it that nobody has ignored yet. |
| The tab is called "Diff (local)" or "Diff (git)", the owner's words, by whether the card knows of a pull request. | Asked for. The card learns of one when a turn ends or when the tab reads the diff, and the name follows at once. |
| The local diff links nowhere. | There is nothing on GitHub yet. |

`test.js` has asserts for git's patch text with one chunk of every kind, as git 2.49 printed them, and for a
file that git does not know. Read-only, `lib.patchFiles` was held against git's own machine-readable lists
(`--name-status -z`, `--numstat -z`) for every pair of commits in this repository's history and for the
scratch repository: every name, status and count the same.

In a test copy, on three scratch folders whose sessions were asked nothing:

| Folder | What the tab showed |
|---|---|
| A repository with a committed change, a new file, an empty one, a deleted one, two renames, a binary file, a change of mode, a staged file, a change that is not staged, four files unknown to git, an ignored file, and one file that was only touched. | "Diff (local)", "No pull request yet, compared with main", and 15 files: the ones git names when it reads the files, in the order of their names. The touched file, which git's quick list calls modified, is not among them; nor is the ignored one. Counts, notes and folding as for a pull request, colours on the new file of code, no link to GitHub. A line added to a file showed after Refresh. |
| The same, read three times with a file touched just before. | git's index had the same hash and the same time stamp afterwards. |
| A repository without a commit. | "nothing is committed yet", and its two files, one staged and one unknown, as added. |
| A folder that is no repository. | "not a git repository", and nothing to compare. |

And live, in the clone of the test repository, on a branch with one commit, one change that was not committed
and one unknown file: the tab said "Diff (local)", compared with `origin/main`, with those four files. The
session was then told to push and to open a pull request. Three seconds after its turn ended the same tab said
"Diff (git)" and showed the pull request with the two files that had been pushed, and the card had its button.

| Symptom | Cause | What changed |
|---|---|---|
| `git --no-optional-locks diff` wrote the index of the scratch repository anew. | Found before any code was written, by hashing the index around each command. The option is documented for `git status`. | The plumbing command, which the manual says does not refresh. |
| At the end of the first run in the scratch repository its index had another hash than at the start. | The check itself had run `git checkout` on a file in between. | A check of its own that runs no git command between the two hashes. The first check puts its file back by hand. |
| On a second run, the comparison of the file list failed. | The first runs had left a file touched, and the check took its names from git's quick list, which calls such a file modified. The tab was right. | The check takes its names from the list git makes by reading the files, and has the touched file as a case of its own. |
| A patched copy of that check stopped matching anything. | The patch was written through a shell and lost its backslashes: the script held real tabs and zero bytes. | Written again as a file. |

### Closing a card took Docker Desktop with it

Found after 0.6.3, and not by a request. A session that needs Docker starts Docker Desktop when it is not
running. On Windows every instance sits in a job object, and whatever it starts is born inside that job
(section 6). Docker Desktop was therefore one of that instance's processes, and closing the instance together
with its worktree, which ends the whole job so that nothing holds the folder (section 7), ended Docker Desktop
too. With it went the containers of every other session. It left nothing to read: a job that is ended writes no
shutdown lines into a program's log and no crash record into Windows' event log, and the virtual machine
behind Docker stays up. What gave it away was the order of events: who had started Docker Desktop, and whose
card had been closed in the seconds before it was gone.

| Decision | Why |
|---|---|
| Closing with the worktree still ends what the instance started, but not Docker Desktop and not what Docker Desktop started itself. | The first is what makes the folder deletable and keeps a closed session from leaving a dev server behind. The second serves every session on the machine. |
| Which programs those are is a list of names, with Docker Desktop's alone (`lib.sparedPids`). | No test tells such a program from a session's own: Docker Desktop and a dev server both sit in the worktree and both have their program files elsewhere. A name is at least something the owner can read and add to. A browser that a session was the first to open is the next candidate; nobody has asked. |
| With one of those programs in the job, the job's processes are ended one at a time (`cpu.js`). Otherwise, which is the usual case because Docker Desktop mostly runs outside every instance, the job is ended as a whole, as before. | A job can only be ended whole. Its list of processes is asked for up to three times, since a process may start another while the first are being ended. The old way stays for every close that has nobody to spare: it is exact, and it has been in use since the second round. |
| The names come from the latest process listing, which is up to two seconds old. | The listing is already taken for the cards. A Docker Desktop started in the last two seconds before the close is not in it and is ended. |
| Where the folder then cannot be deleted, the message names what was left running. | `Start-Process` starts a program in the folder it is called from, so a Docker Desktop that a session started sits in the worktree, and Windows keeps that folder until Docker Desktop is closed. The owner has to know why the folder is still there. It waits on the Worktrees tab like any other leftover. |

`test.js` has asserts for which processes of a listing are spared: Docker Desktop below a session's shell, what
it started, a part of it whose parent is gone, an older process that only carries its pid as parent, and
Docker's own command line, which is the session's. `cpu-check.js` ends a real job both ways: whole, and with one
detached process left running.

Live, in a test copy on the test repository, with a stand-in named `Docker Desktop.exe` (a copy of `node.exe`).
In the first two cases a session started three things from its terminal: the stand-in, which started a helper
of its own, and an ordinary detached program. In the third the stand-in was started by the check itself, and
the session started the ordinary program alone.

| Where the stand-in was | After the instance was closed with its worktree |
|---|---|
| Started by the session, in the worktree, as `Start-Process` leaves it. | The stand-in and its helper ran on; the ordinary program was gone. The folder could not be deleted, after six seconds of trying, and the message said that Docker Desktop had been left running and might be what holds it. git's record and the branch were gone. With the stand-in ended, the leftover was removed. |
| Started by the session, in another folder. | The stand-in and its helper ran on; the ordinary program was gone. The worktree was removed in 0.4 seconds. |
| Outside the instance, which is the usual case. | The session's program was gone and the stand-in ran on. The worktree was removed in 0.9 seconds, by ending the job as a whole. |

| Symptom | Cause | What changed |
|---|---|---|
| The first run of the live check waited for a file that never came. | The command and Enter had gone to the terminal in one write, which Claude Code takes as pasted text: the command stood in the input box. | Enter as a write of its own, after a pause, as this file's section on testing already said. |

## 15. The tenth round: two ways of working, and sessions in containers

On 13 November, after 0.6.4. It began as a question:

> When dealing with multiple worktrees, one of the main problems is with the ports, since each worktree uses
> the same port if you don't do some extra work. That makes worktrees that need to spin up the same services
> overlap each other. Would it be possible to have each worktree spawn in it's own docker container so it can
> use the same ports in there safely, isolated from all other worktrees that are running in separate docker
> containers?

It was tried by hand before anything was built, a step at a time and each step on the owner's word: a Docker
inside a container, one container with a real session, three at once, three that each built and started the
same two services on the same two ports. Then came the request:

> I want to have 2 different operating modes that the claudinho user can pick from the start if he's a new
> user first starting the app:
> 1. Worktrees (as it works now)
> 2. Docker Containers (the solution we tested in this thread and worked)

with its particulars: two square pictures side by side to choose from at the first start, a list to change
between the two afterwards, each way showing its own sessions only, no "New worktree" button with containers,
terminals and detail view as they are, as many containers as cores less one, each with one core's two threads,
and 3 to 4 GB of memory for each. With it, a defect:

> even if there is a PR created that is linked to an issue and the worktree is checkout out on the branch that
> has an open PR, I don't see the clickable button with the #PR as there is for the # issue.

### What the trial had measured

On the owner's PC: Windows 11, Docker Desktop 29.9 on WSL 2, which gives Docker 16 processors and 30 GB.

| Question | Measured |
|---|---|
| Does a Docker inside a container work, and what does it cost? | Yes, in a privileged container, with the start script of Docker's own `docker:dind` image. It is up in one to two seconds and takes 44 MB idle. |
| What does a session with its services use? | 450 to 700 MB: Claude Code, a database, a development server. The image is 1.7 GB and shared. Each container's Docker keeps its own images, in a volume. |
| Do the same ports work in several containers at once? | Three sessions each built a FastAPI server on port 8000 and a Vite front end on port 5173 and started them, at the same time. Each answered with its own container's name, inside and from Windows, through the ports Docker had given them. |
| Can sessions share one login? | Three at once ran on one volume with Claude Code's configuration and login, without a login error. Each container's `claude agents --json` listed its own session and no other. |
| Do the app's hooks arrive? | Not as HTTP hooks. Claude Code refuses one whose host resolves to a private address (`HOOK_BLOCKED_ADDRESS`; loopback is let through). Sent by `curl` from a command hook, every one arrived. |
| Does it hold up? | Three containers ran for 25 minutes with a recorder beside them: Docker answered all 1,489 probes, the slowest in a third of a second. |

Docker Desktop did vanish twice during the trial. That was not the containers: it was the defect of section
14, "Closing a card took Docker Desktop with it", which the trial brought to light.

### How it was read, and why

| Decision | Why |
|---|---|
| The way of working is a setting with no default. Whoever has none is asked at the start, and the question cannot be put aside. | A first start has nothing to fall back to. It also asks an owner of an older version, once: the other way would otherwise go unnoticed, and one condition is simpler than telling a new owner from an old one. |
| Each way keeps its own sessions. Those of the other way are hidden, not stopped. | Asked for. A session does not care which list is on show, so its card goes on, and its notifications still come. Going to one from a notification, or from a row of another tab, changes the list. |
| A container is made when a session starts and removed when its card is closed. There is no pool made ahead. | The owner's first sketch was a pool made at the first start. A container is up in two seconds, so a pool gains nothing, and seven idle ones hold memory. What is worth keeping is kept per number, in a volume: the images its Docker pulled. The limit on their number is the owner's. |
| The limit is worked out from Docker's processors, not the machine's: one container for every two, less one. Each is held to two processors and 4 GB. | The owner's numbers: a core with its two threads each, one left over, 3 to 4 GB. On Windows Docker has all processors; on a Mac it has fewer, and it is Docker's that are shared out. Without a ceiling one container could take all of Docker's memory. |
| A container holds a clone of the folder, not a mounted worktree. The folder is mounted read-only and cloned inside, on a new branch from the default branch as GitHub has it, which is what `claude -w` does. | A worktree mounted from Windows does not work for git inside: its `.git` file names a path of the other system. Files mounted from Windows are also slow. The price is that work leaves a container only by `git push`, so this way needs a GitHub remote, and removing a container can lose work. |
| The two logins are made inside a container, by the owner, and kept in volumes. Where GitHub's is missing, the card runs `gh auth login` before anything else. | A copied Claude Code login is reported to break when its token is renewed. The app copies no credential from this computer. Claude Code asks for its own login in the terminal by itself. |
| The owner's Claude Code configuration is copied in at each start: the files and folders the home editor lists, `hooks`, and scripts lying directly in the folder. | The same lists that keep the editor away from credentials and conversations. Status lines and hooks call scripts from that folder. Plugins are installed by Claude Code itself from what `settings.json` names. |
| Hooks go by `curl` from command hooks, and a `curl` that fails counts as no answer. | See the trial. With the app gone, `curl` fails, and a hook that ends with code 2 blocks the tool call it was asked about. |
| The terminal is `docker exec -it` in the same pseudo-terminal as every other card. | Measured through `node-pty` on Windows: a real terminal of the size asked for, a resize reaches it, colours and non-ASCII text pass both ways. So the cards did not have to become plain boxes. |
| A container is stopped or removed when its card is closed, and `pkill claude` runs in one before a session is resumed in it. | Measured: ending the terminal on this side does not end the program inside. After a hard stop of the app, the session before was still running in its container. |
| A session's status is `claude agents --json` run inside its container with every poll, together with the branch of its clone. | It is what the app reads for every other session, and costs 0.13 seconds of one processor a time. The branch is needed for the pull request, which is then asked for by name from this computer (`gh pr view <branch>`). |
| The local diff is read inside the container, and the environment shown is the container's. | The detail view was to stay what it is. The one difference is the CPU weight, which a container does not have. |
| Closing removes a container when its clone holds nothing that is nowhere else; otherwise it is stopped and kept, with a record of what it held. The Containers tab lists them, and a kept one can be given a new session. | The same rule as for a worktree, with "pushed" in the place of "on another branch". A stopped container cannot be asked what it holds, hence the record. A new session is the only way to the work in a kept one. |
| The ports of a container that reach this computer are a setting, and Docker picks the port here. | Ports are given when a container is made, and the same port cannot be given to seven. The detail view lists each address. |
| The image is built by the app, from a recipe in the repository. Its tag is worked out from the recipe and from the version of Claude Code on this computer. | The package of Claude Code does not update itself. With the version as a build argument of the last layer, a new version here builds that layer again, which installs the newest. |
| The picture for containers is not Docker's logo. | Asked for was the logo, adapted to the app's style. Docker's trademark guidelines say its logos may not be modified, and need written approval as a design feature of another product. The picture is the app's own, and the name is written out. |
| A test copy can be told other names for its containers (`CLAUDINHO_BOX`). | A test must never take, stop or remove a container of the copy in use. |

Not built: Docker Engine alone on Linux, where `host.docker.internal` does not exist by itself; a ceiling per
container that follows the app's CPU settings; an image per repository.

### The pull request button

The app looked for a session's pull request in two places only: when a turn ended, and when the Diff tab was
opened. A session resumed after a restart of the app starts without a turn, so it had no button, although its
issue button, which comes from the saved record, was there. The owner had installed four versions that day,
each a restart. The same held for a session that opened its pull request early in a long turn.

Now the app also looks when a session is resumed, and whenever a tool call of a session without a known pull
request has run, at most once in half a minute. Tool calls already report to the app, so nothing new is
listened to. A session whose pull request is known is not asked about again until its turn ends.

### How it was verified

`test.js` has asserts for the new helpers: the limit, the free number, the ports setting, Docker's listings,
and that no HTTP hook is left in a container session's settings.

`box-check.js` (`npm run check:box`) makes one real container the way the app does, with this repository as
its folder, and starts no session. Its 19 verdicts: the ceilings, the labels, the clone on a new branch at
GitHub's default branch with GitHub as its remote, the folder readable and not writable, Docker with Compose
inside, what counts as work that is nowhere else, a hook's request reaching a server on 127.0.0.1 and its
answer coming back, a hook that says nothing when the app is gone, a status line's file read on this
computer, a port answering from this computer, Docker's reading of memory, and stop, start and remove.

`pack-check.js` got one more verdict, for what a packaged copy has to hold for this: the recipe of the image,
and the two pictures of the first question, which a fresh data folder brings on screen. It makes no container.

Live, in a test copy on the test repository, with containers of its own names:

| What | Result |
|---|---|
| The first start | The question with its two square pictures, side by side and the same size. Escape did not close it. One click set the way, and the list in the header changed it back. |
| A session in a new container | The container was there after 2 seconds, Claude Code at work after 13, its turn over after 17. The terminal showed Claude Code's own screen with its symbols. The first prompt and the end of the turn arrived through `curl`. Model, cost, context and branch were on the card, CPU and memory with the 4 GB ceiling, and four ports. |
| Its detail view | The local diff showed a new file, read inside the container. The environment was the container's. |
| Closed with an uncommitted file | Kept and stopped. The Containers tab said what it held, and its Remove dialog named the loss. |
| A new session in the kept container, at the "auto" input level | It asked a question; the app answered it, and the session read the answer back. |
| A pull request from inside | Pushed and opened by the session. The card had its button, the action for a draft, and "Diff (git)" with the file. Closed after that, the container was removed. |
| Both ways at once | A worktree session and a container session. Each list showed its own card and counted it alone; the detail view's list of sessions held its own kind; going to the other kind's session changed the list. |
| The button during a turn, with worktrees | A session opened its pull request and went on for 55 seconds. The button was on its card 22 seconds before the turn ended. |
| After a hard stop of the app | The container had run on, Claude Code in it. Each session was offered for resuming under its own way. The worktree session had its pull request button 4 seconds after the resume, with no turn. The container session went on in its container, in the same conversation, with one Claude Code in it. |
| A session whose container was removed behind its back | Resumed, it said that its container was gone and started again in a new one, from its first prompt, on a branch of the same name. |
| A full house | Six stand-ins and two issues sent off, two at once. The first took the seventh place. The second waited, its chip saying for a free container, and started in the place of a stand-in that was removed. A session started by hand meanwhile said on its card that all seven were taken. |

The sign-in for GitHub was run against an empty volume up to its first question, and stopped there: the test
makes no login.

### What went wrong

| Symptom | Cause | What changed |
|---|---|---|
| Symbols from a container came out garbled in the first terminal test. | The test, not the terminal: its own escape sequences had been turned into other characters before they were sent. Text that was read from a file passed. | Nothing in the app. A wrapper that set the console's code page was tried and dropped. |
| In the first live run the pull request was on the card only when the turn ended. | The look was allowed once a minute, and the whole turn was shorter. | Once in half a minute. |
| The note that counts the containers was up to 15 seconds behind. | Docker was asked on a timer only. | It is asked again when a container is made or removed. |

Not verified: macOS, and Docker Desktop's Linux edition; a first sign-in to Claude Code and to GitHub made in
the app's card by a new owner; a login being renewed while several sessions run; a container reaching its
memory ceiling; the image built on a machine that has none of its layers; the packaged app, whose check
starts no container.

### After 0.7.0: containers start side by side

The owner updated, sent four issues to containers, and watched them start one after another:

> when starting multiple claude code sessions in Docker containers you don't need to wait for them to start
> sequentially.

The rule of one at a time was made for worktrees (section 9): a repository sets a fresh worktree up in its
`SessionStart` hooks, and two of those side by side get in each other's way. 0.7.0 had applied it to containers
as well, for no better reason than that the same code started both. Nothing a container's set-up touches is
shared with another's, save two things, and both were looked at.

| Decision | Why |
|---|---|
| The queue holds a worktree back while another worktree is starting, and holds a container back for nothing. | Asked for. A starting worktree does not hold a container back either, nor the other way round. |
| Whether a container is still to be had is asked last, with nothing awaited between Docker's answer and the start, and the sessions that are still waiting for their container are counted as having one. | Started in one go, three sessions ask before any container exists. Counted by Docker's list alone, all three would find the same free places, and the one too many would fail on its card and be gone from the queue. |
| The numbers are still given out one at a time. | Two `docker run` at once could take the same name. It is a second each, and the filling goes on side by side. |
| The owner's configuration is first copied into a folder of the container's own, and from there file by file into the shared volume: the same file is left alone, a different one is written beside the old and renamed over it. | Until now every new container wrote the whole configuration anew, into a volume that the running sessions read. With several containers doing that at once, a session could find a settings file half written. Now a start with nothing changed writes nothing. |

`box-check.js` got four verdicts for the copy, against a folder of its own: only what a person keeps there
arrives, a file that is the same keeps its place on the disk, one that differs is replaced whole, and 200
reads during the replacing never see half a file. Its first run failed, usefully: the folder the copy went
through lay under `/tmp`, where the image's start script puts a memory disk that `docker cp` cannot reach. It
lies under `/var/tmp` now. The asserts and the live tests before it had not gone that way.

Live, in the test copy, while the owner's own four container sessions were running beside it:

| What | Result |
|---|---|
| Three issues sent at once, three at once allowed | Cards after 1.6, 3.1 and 4.7 seconds, containers after 3.4, 5.2 and 7.0, first prompts in after 15.7, 16.5 and 17.3. The third had its card eleven seconds before the first had taken its prompt. All three turns were over 16.8 seconds after the first card. One after another, at 13 seconds each, the third would have begun after 26. |
| Three issues at once with two places free | Two started side by side. The third stayed in the queue, waiting for a free container, with no failed card. It ran in the place of a stand-in that was removed. |

The cards still come a second and a half apart: each issue's blockers are asked of GitHub before it starts,
one issue after another.

## 16. Still open

- Sessions in containers: what section 15 lists as not verified. Docker Engine alone on Linux is not served.
  The ceilings are the same for every container and are not settings. A container's ports are fixed when it
  is made. A kept container can be given a new session, not its old conversation. The image is one for all
  repositories, and sessions cannot install system packages in it.
- A pull request's later fate on GitHub (merged or closed there) reaches a card only when the session's next
  turn ends.
- The Diff tab has GitHub's default view and no other, and shows no diff where GitHub's list of files gives
  none (section 14). A side-by-side view and filling the gaps from the worktree with git are what would come
  next. Its colours know nothing of what stands above a hunk. Its drawing is not spread over time: 20,000
  lines hold the window for about three seconds.
- The list of sessions is gone through with the mouse. There is no key for the next session.
- Semi-auto by a note does not get a session in auto mode to merge, and an idle session hears of a change only
  with the owner's next prompt (section 13). Whether the app should give a Semi-auto session a permission rule
  for `gh pr merge` is the owner's to decide.
- What a session still has running is read when a turn ends, and only then. A monitor is listed as a shell,
  and a scheduled wake-up is not counted as something running (section 12).

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
- The Pull requests tab shows and links; it does not merge, and it stops at 200. The Issues tab stops at 1000.
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
  Only on Windows, and only when the worktree goes too, are they ended. Docker Desktop is left running then
  (section 14). Any other program that serves the whole machine and that a session was the first to start, a
  browser for one, is still ended. A Docker Desktop that was started from inside the worktree keeps that
  folder until it is closed; the app could start Docker Desktop itself, outside every instance, so that no
  session has to.
- Two copies of the app share one state file, and the last one to save wins.
- Issues still queued for dispatch are not remembered across a restart.
- The home folder: skills linked in through a symlink are not listed, and new files cannot be created there
  from the app.
- A flag placed before the `.` on the command line makes the app open its own source folder (see the table
  above). The app could find the folder argument more carefully.

## 17. Continuing the work

- **Sessions in containers** are tested live in the clone of the test repository, with the test copy started
  under `CLAUDINHO_BOX=<a name>` so that its containers have names of their own. The two volumes with the
  logins are shared with the copy in use, so the test sessions are logged in; those volumes are never removed
  by a test. `npm run check:box` checks a container without a session. A full house is made with
  `docker create --name <name>-slot-N <the image> true`, which takes a number and starts nothing.
- **A test that writes a script through a shell** should look at what arrived. In this session a doubled
  backslash came out single, which turned `\342` in a JavaScript string into one character.
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
- **The Issues and the Pull requests tab** are tested read-only: an empty folder with `git init` and an
  `origin` that points at a public repository with many of both. The start dialogs can be opened and read
  there too, and closed with Cancel.
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
- **When a session is done** is tested live as well: a session is told to start something and end its turn,
  and the test writes down what the card says until that has ended. A command in the background is `sleep 90`
  with `run_in_background`; a subagent that has to take a while runs `node -e "setTimeout(() => {}, 60000)"`,
  because Claude Code refuses a bare `sleep` in the foreground.
- **Autonomy** is tested live in the same clone. A note is not shown in the terminal, so the test asks the
  session to quote what it has been told about merging; the card's "not told yet" says when the note went.
  The machine's default is auto mode, which refuses a merge that only a note asked for.
- **The Diff tab** is tested three ways. Read-only: what `lib.js` makes of GitHub's list of files, for the pull
  requests of a public repository, counted against GitHub's own numbers. Live, in the clone of the test
  repository: its checkout on a branch with one commit that holds every kind of change, which a session pushes
  and opens as a pull request. And by handing a large public pull request's data to `renderDiff` in the window.
  The colours are checked with it: every line has to read as GitHub gave it.
- **The list of sessions** is tested live with three sessions, two in a group, one with a question. For a
  question the app holds on the card, that session is started at the "timed" input level.
- **A test copy's window is usually covered by other windows.** A covered window gets no animation frames and
  its timers are held back. A check waits on its own side, never inside the page, and times what it measures
  in one go.
- **A release run that fails on GitHub's side** is run again, not tagged again: read the failed step with
  `gh run view <run> --log-failed`, then `gh run rerun <run> --failed`. Only the failed job and the release
  job run; the files of the jobs that passed are taken from the first attempt.
- **A published release's update feed** can be read without installing anything: a few lines of Electron that
  call electron-updater's `checkForUpdates` with `autoDownload` off and `forceDevUpdateConfig` on, beside a
  `dev-app-update.yml` with the provider, owner and repository, and a `package.json` that claims an older
  version.
- **A command that must not run in a check** is replaced by a shell function. A stand-in folder on the `PATH`
  is not enough in Git Bash, where a Windows path in `PATH` is split at its colon.
- This repository has no `docs/PROCESS.md` on purpose. The app, like the owner's helper, tells an agent to
  follow that file when it exists, and this record is a history, not a process to follow.

## 18. Sources

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

**Sessions in containers**

- <https://docs.docker.com/engine/containers/resource_constraints/> for `--memory`, `--cpus`, and what happens
  at the memory ceiling
- <https://docs.docker.com/reference/cli/docker/container/stats/>, `.../container/exec/`, `.../container/port/`,
  `.../container/ls/` and <https://docs.docker.com/reference/cli/docker/buildx/build/>
- <https://hub.docker.com/_/docker> for a Docker inside a container, and
  <https://docs.docker.com/engine/install/debian/> for the engine's packages
- <https://docs.docker.com/desktop/features/networking/> for `host.docker.internal` and published ports
- <https://www.docker.com/legal/trademark-guidelines/> for what may be done with Docker's logo
- Claude Code: `worktrees` (the base of a new worktree, `.worktreeinclude`), `hooks` (command hooks, exit codes,
  the answer on standard output), `setup` (the package repository and its key), `authentication`, `devcontainer`
- <https://cli.github.com/manual/gh_pr_view> (a pull request by its branch's name) and
  <https://cli.github.com/manual/gh_auth_login>
- Measured, not documented: that an HTTP hook to a private address is refused, that the terminal's end on this
  side leaves the program in the container running, and that `claude agents --json` in a container lists that
  container's sessions although the configuration folder is shared.

**The Diff tab**: <https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files> for the list of a pull
request's files, whose answer was also read from a real pull request;
<https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits#diff-limits> for
what GitHub's page loads by itself (400 lines and 20 KB of a file, 20,000 lines of a pull request);
<https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-comparing-branches-in-pull-requests>
for what "Files changed" compares; `gh api --help` and `gh pr diff --help` of gh 2.72.0. Seen, not documented:
where the page has a file (`#diff-` and the SHA-256 of its name), and that deleted files start folded there.
For the local diff, git 2.49's own manual, as installed with it and as on <https://git-scm.com/docs>:
`git-diff-index` (what it compares, and that it does not refresh), "Generating patch text with -p" (the lines
of a patch and how names are quoted), `git-config` (`core.quotePath`, `diff.autoRefreshIndex`), `git-ls-files`
and `git-merge-base`. For the colours, highlight.js 11.12.0: <https://highlightjs.readthedocs.io/en/latest/api.html> (`highlight`,
`getLanguage`), <https://github.com/highlightjs/highlight.js/blob/main/README.md> (what `require` loads, the
licence) and <https://highlightjs.readthedocs.io/en/latest/css-classes-reference.html> (the classes). That its
answer escapes the code, and which entities it uses, is not on those pages: it was read from an answer.

**Autonomy and the lists**: the `hooks` page below, for `additionalContext` ("Add context for Claude", and the
decision control of `UserPromptSubmit` and of `PostToolUse`) and for the `agent_id` a subagent's tool call
carries. GitHub's own schema for the orders its issue query offers (`{ __type(name: "IssueOrderField") {
enumValues { name } } }` through `gh api graphql`), and `GH_DEBUG=api gh pr list` for the order `gh` asks for.

**When a session is done**: the `hooks` page below, for what the `Stop` hook is given (`background_tasks`,
`session_crons`) and for what else fires `UserPromptSubmit`, and `agent-view` for what `status` says. For the
release run: <https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs>.

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
