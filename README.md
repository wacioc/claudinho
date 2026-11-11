# claudinho

A desktop monitor for the Claude Code instances running in a repo: a wall of live terminals, the repo's GitHub
issues with one-click dispatch into worktrees, and an editor for the `.claude` setup.

It drives your own `claude` CLI, so everything runs on your Claude Code subscription. No API key is used, and
`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` are removed from the instances it starts so they cannot switch to
API billing.

## Requirements

- Claude Code CLI on `PATH`, logged in (`claude`, then `/login`). On Windows it must be the native install (`claude.exe`).
- `git`, and the GitHub CLI `gh` (logged in) for issues, clone and PR merging.
- Node.js 20+ and npm.
- Windows: Git for Windows. Claude Code runs status lines through Git Bash, which is how cost, context and usage reach the app.
- Linux: `python3`, `make` and `g++`, because the terminal library (`node-pty`) compiles on install there. Kernel CPU
  limits need systemd 252 or later (Ubuntu 24.04, Debian 12, Fedora 40); older systems fall back to pausing and resuming.

## Run

```bash
git clone https://github.com/wacioc/claudinho.git && cd claudinho
npm install
npm start                      # reopens the last folder
npm start -- /path/to/repo     # or open a specific folder
npm test                       # self-check for the logic in lib.js
npm run check:cpu              # real-load check of the CPU limits; keeps every core busy for three to four minutes
```

The first start downloads the Electron binary. There are no installers yet; add `electron-builder` when you want them.

## What you get

| Tab | What it shows |
|---|---|
| **Instances** | Every Claude Code instance as a live terminal, titled with its worktree (or the folder name), with model, context window, API-equivalent cost, uptime, and the CPU and memory used by it and everything it started. Click one for the full terminal, a per-process breakdown, its environment variables, the auto-merge checkbox and the input level. Sessions started outside the app appear as status-only cards. |
| **Issues** | Open issues by default, with the issues blocking each one. Select one or many, right-click, "Tackle with Claude Code". |
| **.claude** | Everything under `.claude` and `.github`, editable inline. Saving offers to commit and push. "New skill" and "New agent" generate one from a prompt in a terminal, where Claude can ask follow-up questions. |

The header shows the logged-in account and the 5-hour and 7-day usage, as last reported by Claude Code.

### Input levels (per instance)

"Input" means both Claude's multiple-choice questions and tool-permission prompts.

| Level | Behaviour |
|---|---|
| Manual | Always waits for you, in the terminal. |
| Timed | Shows the request on the card and waits (5 minutes by default, see ⚙). You can answer on the card or in the terminal. At the deadline it takes the recommended option. |
| Auto | Takes the recommended option at once. |

The recommended option is the one labelled "(Recommended)", else the first; for a permission prompt it is "approve".
So Timed and Auto approve tool use without you. Your `deny` rules still apply.

### Dispatching issues

Each issue gets its own instance in its own worktree, started the way the `claude_worktree` shell helper does it:
`claude -w <number>-<slugged-title> --model … --effort … "<prompt>"`. An issue that is blocked by an open issue
waits in the queue until its blockers are closed as completed (re-checked every 5 minutes).

With several issues selected you also choose how many agents run at once (max 4) and the autonomy:

| Autonomy | Behaviour |
|---|---|
| Manual | Agents are told not to merge. |
| Semi-auto | The agent is told to merge its PR only if it judges that safe. |
| Full-auto | The app merges each PR when its agent finishes. |

"Finished" means the agent ended its turn and its branch has an open, non-draft PR. Auto-merge runs
`gh pr merge --squash --auto` (method configurable under ⚙). The merge waits for checks only when branch
protection requires them and the repo has "Allow auto-merge" turned on; otherwise the PR merges as soon as the
agent finishes. Merged branches are left in place unless the repo deletes head branches automatically.

### CPU limits

Two settings under ⚙, both off by default, and a weight per instance in its detail view.

| Setting | Behaviour |
|---|---|
| CPU ceiling per instance (%) | The most one instance, with everything it starts, may use of the whole machine. 100 means no ceiling. |
| Share the CPU between instances by weight | When instances compete, each gets CPU in proportion to its weight: low is half a share, normal one, high two. An instance that needs less leaves the rest to the others. Programs outside the app are left alone: the instances share what the system gives them. |

How they are enforced depends on what the operating system offers:

| | Ceiling | Sharing |
|---|---|---|
| **Linux** with systemd 252 or later | The kernel: `CPUQuota` on a control group per instance. | The kernel: `CPUWeight`. It always balances instances between them; the switch decides whether their weights apply. |
| **Windows** | The kernel: a hard cap on a job object per instance. | Worked out by the app once a second and enforced through those caps. Windows has job weights of its own, but they do not divide the CPU fairly: two jobs with the same weight measured 67% and 23%. |
| **macOS**, and Linux without a delegated cpu controller | The app pauses and resumes the instance's processes in 100 ms cycles. | Worked out by the app with every process listing (2 seconds) and enforced through those cycles. |

macOS gives an app no kernel CPU limit for other processes (its throttle only accepts a process limiting itself,
and no weights exist), so there the limits are right on average rather than kernel-enforced, and they take a few
seconds to settle. Claude Code's own process is never paused, only what it starts. The pausing is done by a small
helper process, not by the app itself: it keeps time while the app is busy or hidden, and when the app goes away,
however that happens, it resumes everything.

Sessions started outside the app are not limited. `npm run check:cpu` exercises the mechanism of the machine it
runs on with real load and prints what it measured.

## How it works

- Each instance is `claude` in a pseudo-terminal (`node-pty`), drawn with `xterm.js`.
- Each instance gets its own `--settings` file. It wraps your status line so the JSON Claude Code feeds it (cost,
  context, rate limits) is also saved for the app, and it adds HTTP hooks pointing at a local server inside the app:
  `PreToolUse` on `AskUserQuestion` and `PermissionRequest` for the input levels, `Stop` to notice a finished turn.
- Session status comes from `claude agents --json`; the account from `claude auth status`.
- CPU and memory come from one listing of all processes every 2 seconds (PowerShell and CIM on Windows, `ps`
  elsewhere), running only while there is a session to measure. A session's numbers cover its process tree:
  Claude Code plus everything it started. CPU is a share of the whole machine, as Task Manager shows it.
- CPU limits live in `cpu.js`: one mechanism per operating system behind the same calls, and one sharing policy
  (`shareCpu` in `lib.js`) for the systems whose kernel cannot share by weight.
- Issues come from `gh api graphql`; blockers are GitHub's native issue dependencies.

## Developing

- Everything that can run without Electron lives in `lib.js` and is covered by `npm test`.
- `npm start -- --remote-debugging-port=9333 <folder>` exposes the window to the Chrome DevTools protocol; the UI
  was tested that way (evaluating scripts in the page, taking screenshots).
- Instances started while testing are real Claude Code sessions: they use your subscription and, with Remote
  Control on, show up on your other devices.
- `CLAUDINHO_CPU=throttle` forces the pause-and-resume CPU mechanism on Linux. It is the one macOS uses, so it
  can be worked on without a Mac. To run the check on a real Mac, start the `cpu-check` workflow by hand from
  the repository's Actions tab.
- [docs/HOW-THIS-WAS-BUILT.md](docs/HOW-THIS-WAS-BUILT.md) records the brief this app was built from, the
  decisions and their reasons, and every measurement behind the CPU limits. [CLAUDE.md](CLAUDE.md) holds the
  working notes for agents.

## Limits

- Instances are children of the app: quitting stops them (it asks first). Conversations stay resumable with `claude --resume`.
- Sessions started elsewhere are status-only: a terminal cannot be attached to them.
- With Remote Control on, a permission prompt can also be answered from your other devices, whichever comes first.
- Only the project's `.claude` is shown, not `~/.claude`.
- CPU and memory are sampled, so a process that starts and ends between two samples is not seen, and a child
  whose parent has already exited is no longer counted.
- CPU limits follow a change within a few seconds, not at once: the shares are recalculated once a second on
  Windows and with every process listing (2 seconds) on macOS.
- Sharing by weight is between instances. While programs outside the app are busy too, the shares are a little
  less exact, because the instances are given some room to compete with them. Beside a program that keeps every
  core busy, limited instances are never stuck: they win ground back step by step (with pause and resume, a few
  percent of the machine with each listing). On Windows they still end up well below what they would get
  without sharing, because a capped job gets less than its cap while every core is taken: an instance held at
  10% got 5%, and two instances that would have had a third of the machine each got 10 to 16%.
- With pause and resume (macOS), a light instance beside a heavy one gets no more than the system's own
  scheduler gives it: on a 5-core Mac, an instance wanting one core beside one loading all five got 16% of the
  machine, not 20%. Pausing the heavy instance frees every core for a moment, not one core all the time.
- On Linux the kernel applies weights per core, so with many busy threads a 2:1 weight is not exact: in a virtual
  machine it came out between 1.7:1 and 2:1, and once at 1.2:1 while the host was busy with other work.
- While an instance is pressed against its limit, its own terminal can feel slower, because a group limit holds
  all of its threads.
- Closing an instance stops Claude Code but not the processes it left running; those are no longer limited.
- What has been run where: the whole app on Windows only. The CPU limits also on Linux (Ubuntu 24.04 under WSL,
  both mechanisms) and, with `npm run check:cpu`, on a Mac (macOS 26, Apple silicon, 5 cores, a GitHub Actions
  runner). The app itself has not been run on macOS or Linux yet.

## License

[MIT](LICENSE)
