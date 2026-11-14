# claudinho

A desktop monitor for the Claude Code instances running in a repo: a wall of live terminals, the repo's GitHub
issues with one-click dispatch into worktrees or Docker containers, and an editor for the `.claude` setup.

It drives your own `claude` CLI, so everything runs on your Claude Code subscription. No API key is used, and
`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` are removed from the instances it starts so they cannot switch to
API billing.

## Requirements

The app drives programs that have to be installed already, whichever way you run it:

- Claude Code CLI on `PATH`, logged in (`claude`, then `/login`). On Windows it must be the native install (`claude.exe`).
- `git`, and the GitHub CLI `gh` (logged in) for issues, clone and PR merging.
- Docker Desktop, running, if sessions are to work in Docker containers (see
  [Worktrees or Docker containers](#worktrees-or-docker-containers)). Worktrees need nothing of it.
- Windows: Git for Windows. Claude Code runs status lines through Git Bash, which is how cost, context and usage reach the app.
- Linux: kernel CPU limits need systemd 252 or later (Ubuntu 24.04, Debian 12, Fedora 40); older systems fall
  back to pausing and resuming.

## Install

Every version's installers are on the [releases page](https://github.com/wacioc/claudinho/releases/latest).
The macOS apps are signed with a Developer ID and notarised by Apple. The Windows installer is not signed, so
Windows asks once before the first start.

| System | File | Installing, and the first start |
|---|---|---|
| Windows, 64-bit | `claudinho-<version>-win-x64.exe` | Run it. Windows says it protected your PC: choose **More info**, then **Run anyway**. It installs for your user, without admin rights, adds claudinho to the Start menu and the desktop, and starts it. |
| macOS, Apple silicon | `claudinho-<version>-mac-arm64.dmg` | Open it and drag claudinho to Applications. At the first start macOS asks whether to open an app downloaded from the internet. Versions up to 0.3.0 are not signed: macOS refuses their first start, and System Settings, Privacy & Security, offers **Open Anyway** for about an hour. |
| macOS, Intel | `claudinho-<version>-mac-x64.dmg` | The same. |
| Linux, x86-64 | `claudinho-<version>-linux-x86_64.AppImage` | Make it executable (`chmod +x`) and run it. It needs glibc 2.34 or later, which Ubuntu 22.04 and Debian 12 have. |

From 0.4.0 on the app updates itself (see [The app's own version](#the-apps-own-version)). An older version is
brought up to date by installing the newer file the same way. Settings and saved sessions are kept in your user
folder, apart from the app. A release also holds `.zip`, `.yml` and `.blockmap` files: those are what the
update reads, not something to download.

## Run from source

This needs Node.js 20 or later with npm, and on Linux also `python3`, `make` and `g++`, because the terminal
library (`node-pty`) compiles on install there.

```bash
git clone https://github.com/wacioc/claudinho.git && cd claudinho
npm install
npm start                      # reopens the last folder
npm start -- /path/to/repo     # or open a specific folder
npm test                       # self-check for the logic in lib.js
npm run check:cpu              # real-load check of the CPU limits; keeps every core busy for three to four minutes
npm run check:box              # makes one container the way the app does and checks it; needs Docker Desktop, starts no session
```

The first `npm install` downloads the Electron binary.

## What you get

| Tab | What it shows |
|---|---|
| **Instances** | Every Claude Code instance as a live terminal, titled with its worktree (or the folder name), with model, context window, API-equivalent cost, uptime, and the CPU and memory used by it and everything it started. Click one for the full terminal, a per-process breakdown, its environment variables, its autonomy and the input level, on a second tab the diff of its pull request, or of its folder while there is none yet, and beside it the list of all sessions to go from one to the next. A session that was sent after an issue, and one whose branch has a pull request, carry a button for each that opens it on GitHub. Sessions that belong to a group carry its name and colour, and one whose turn has ended a green outline and checkmark. Sessions started outside the app appear as status-only cards, which a filter can hide, and sessions that were open when the app last stopped appear as cards with a Resume button. |
| **Worktrees** | Every worktree under `.claude/worktrees`: its branch, whether it holds uncommitted changes or commits that exist nowhere else, its last commit, and the session at work in it. Each can be removed from here. |
| **Containers** | With Docker chosen, in the place of Worktrees: every container that sessions work in on this computer, with its session, its folder and branch, whether its clone holds uncommitted changes or commits that are not pushed, and whether it is running. A container that was kept can be given a new session, or removed. |
| **Issues** | Open issues by default, in number order with the highest first, with the issues blocking each one. Select one or many, right-click, "Tackle with Claude Code". A double click on an issue does the same for that one. |
| **Pull requests** | The repository's open pull requests in number order with the highest first, drafts and those ready for review: branch, checks, review state, and the session at work on each. A click on a title opens it on GitHub. |
| **.claude** | Everything under `.claude` and `.github` of the open folder, and your own configuration from the home folder (`~/.claude`): `CLAUDE.md`, `settings.json`, agents, skills, commands, rules. All of it is editable inline. Saving a file of the open folder offers to commit and push. "New skill" and "New agent" generate one from a prompt in a terminal, where Claude can ask follow-up questions. |

The header shows the app's version, the logged-in account, the 5-hour and 7-day usage as last reported by
Claude Code, the version of Claude Code that is installed, and the bell. When a newer version of the app or of
Claude Code is out, a button to install it appears beside the version it replaces. A list in the header says
where sessions work: in worktrees, or in Docker containers.

Three figures in the bar below say what all of it takes: the CPU and the memory of every session the app runs,
with whatever those sessions started, on this computer and in containers, and the disk their worktrees and
containers hold. Each one's tooltip says what it is made of. The disk takes seconds to measure, so it is
measured every ten minutes.

### Worktrees or Docker containers

There are two ways for sessions to work. The first start asks which one to begin with, and the list in the
header changes between them at any time. Each way has its own sessions: the window shows those of the one that
is chosen, and the others go on out of sight.

| | Worktrees | Docker containers |
|---|---|---|
| Where a session works | In a git worktree under `.claude/worktrees`, made by `claude -w`. | In a container of its own, on a clone of the folder, on a new branch made from GitHub's default branch. |
| Services and ports | All sessions share this computer. Two that start the same service on the same port get in each other's way, unless each worktree is given ports of its own. | Each container has a Docker of its own inside, so every session can run the same services on the same ports. |
| What it takes | Nothing beyond the requirements. | Docker Desktop, running. About 2 GB of disk for the image, more for a folder's own tools, what each container's services pull, and memory for each container while it runs. |
| How many at once | As many as you start. | One for every two of Docker's processors, less one: 7 where Docker has 16. Each may use 2 processors and 8 GB of memory, which is a setting. |
| Where the work is | On this computer, in the worktree. | In the container, until it is pushed. |

With Docker chosen:

- **+ New instance** starts a session in a new container, and there is no worktree to make. Issues sent from
  the Issues tab get a container each, and wait in the queue while all containers are taken.
- The cards and the detail view are the same. The terminal is Claude Code's own, running in the container. A
  card names its container, and its CPU and memory are the container's, as Docker reports them.
- Text is copied from a container's terminal as from any other. In Claude Code's full-screen view that is:
  select it with the mouse, and it is on the clipboard. Hold Shift while selecting for the terminal's own
  selection instead.
- The first container needs an image, which the app builds by itself: once, and again when Claude Code on this
  computer has a new version, so that containers run that version too. The first build downloads several
  hundred megabytes and takes some minutes; the card shows it going.
- The image holds git, gh, jq, curl, Python, Node.js, Docker with Compose, and the system libraries a headless
  Chromium needs. What else a folder's sessions need, the folder names in a `mise.toml` (or `.tool-versions`)
  at its root, for [mise](https://mise.jdx.dev/configuration.html): `just`, `uv`, Flutter, another Node.js.
  Those tools are built into that folder's image, so a container has them from its first second. Every start
  of a container asks for the image that goes with the file as it is: nothing is built while the file is the
  same, and when it has changed the next container waits for a new image, of which only the tools and what
  follows them are built again.
- A folder that tests in a browser names Playwright there as well, in the version its lockfile has:
  `"pipx:playwright"` for a Python project (with `uv` among the tools), `"npm:playwright"` for a JavaScript
  one. When the image is built, the app fetches that version's browser into the cache that all
  containers share. No container waits for it then, and no session has to fetch it.
- The dialogs that start a session say which tools the folder names. Where it has no such file they say that
  too, and offer to have Claude Code write one: it reads the folder's CI workflows, its justfile, its lockfiles
  and version files, writes a `mise.toml` with a version for every tool, and the app offers to commit it.
- A project's own set-up is not the image's: `uv sync`, `npm ci`, `flutter pub get`. It is the repository's,
  as for a worktree: its `SessionStart` hook, or the session itself. Sessions may use `sudo`, and what npm,
  pip, uv and Playwright download is kept for all containers: a browser that one session fetched
  (`playwright install chromium`) is there for every other, and the command finds nothing to do.
- Logins are made inside a container, once, and kept in Docker volumes that all containers share. Claude Code
  asks for its login in the first session's terminal (`/login`), and where GitHub has none yet, the card runs
  `gh auth login` before anything else. Nothing is copied from the logins of this computer.
- Your own Claude Code configuration is copied into the containers at each start, file by file and only what
  has changed: `CLAUDE.md`,
  `settings.json`, `keybindings.json`, agents, commands, output styles, rules, skills, hooks, and the scripts
  that lie directly in that folder.
- The memory that Claude Code keeps for the repository is one, for both ways of working. Every new container
  gets the folder's memory from this computer (under `~/.claude/projects`), where the sessions in worktrees
  keep theirs. What a session notes in a container, later sessions read wherever they work, and the other way
  round.
- A session in a container is told where it is: that the container is its own to set up, that a tool that is
  missing can be installed and should be named in its answer, that a browser runs headless and how
  Playwright's is fetched, and that the memory is shared with sessions elsewhere, so that what is true of one
  container only is kept out of it.
- A clone does not bring the folder's local files, a `.env` for one. Name them under ⚙, "Local files to copy
  into a new container or worktree": one pattern a line, in `.gitignore` syntax, anywhere in the folder.
  Files that match, and that git ignores, are copied into each new container, and git in the clone is told
  to ignore them there too. The list is the folder's `.worktreeinclude` file, which Claude Code reads the same
  way for a new worktree, so one list serves both. Where a `.env` stays behind for want of a list, the card
  says so.
- Inside, every container has the same ports. To open what a session runs in your browser, name the ports
  under ⚙ ("Ports of a container to reach from this computer"; 3000, 5173, 8000 and 8080 to begin with). Each
  gets a port of its own on this computer, listed in the instance's detail view. A change counts for
  containers made afterwards.
- The **Containers** tab stands where the Worktrees tab was.

A session's work leaves its container by `git push`, so this way needs a folder with a GitHub remote.

### Notifications

The bell in the top right carries the number of new notifications in a red circle, and the tray icon shows the
same number. Pressing the bell lists them, newest first; that is also what makes them no longer new. A click on
an entry opens the instance it is about.

| A notification says | When |
|---|---|
| needs input | A session asks a question or for a permission, at the Manual and at the Timed level. |
| answered for itself | The same at the Auto level, with what was asked and what was picked. |
| is done | A session's turn has ended and nothing it started is still running. With auto-merge on, it also says what became of the pull request. |
| was told | With auto-merge on, the app sent the session a follow-up before merging (see [Auto-merge](#auto-merge)). |
| Claude Code … is out | A newer version than the installed one has been released. Pressing it runs `claude update`. |
| claudinho … is out | A newer release of the app has been published. Pressing it installs that release. |

A session that is done is also marked on its card, with a green outline and a green checkmark, until the next
prompt goes in.

Done is more than the end of a turn. A turn can end while something the session started is still running: a
command in the background, a subagent, a monitor. Claude Code wakes the session when one of them ends or
reports, and the session carries on. Until a turn ends with nothing left running, the session is not done: its
card says what is still running, there is no checkmark and no notification, and its pull request is left
alone.

### The record of input requests

The detail view of an instance lists every input request of that session under **Input requests**: the
question or the tool call, the options, which one is the recommended one (★), which one was picked (✓), and how
it was settled:

| How | Meaning |
|---|---|
| manual | You chose: on the card, in the terminal, or on another device. |
| timed expired, auto picked | The Timed level waited, nobody answered, and the recommended option was taken. |
| auto | The Auto level took the recommended option at once. |

A permission prompt has two options here, approve and deny. The record is saved with the session, so it is
still there after a restart.

### Claude Code's own version

The header shows which version of Claude Code is installed. The app looks for a newer one at its start and
every hour. When one has been released, a button with that version appears beside it, and a notification with it. Pressing either runs `claude update`. Sessions that
are running keep the version they started with; what is started afterwards gets the new one.

### The app's own version

At its start and every hour the installed app looks at the
[releases](https://github.com/wacioc/claudinho/releases) of its repository. When a newer one has been
published, a button with that version appears beside the app's own, and a notification with it. Nothing is
downloaded before you press one of them: installing restarts the app, and that stops every session running in
it. If any is running, the app asks first. It then downloads the release, closes, installs it and starts
again; the sessions that were open come back as cards with a Resume button.

| System | How the update is installed |
|---|---|
| Windows | The new installer is run silently. Windows asks nothing: its question at a first install is about files that came through a browser. |
| Linux | The AppImage file is replaced by the new one, under the new version's file name. |
| macOS | Through macOS's own update mechanism, which takes the release's `.zip` and accepts it only when it is signed by the same developer as the running app. A copy older than 0.3.1 is not signed and cannot update itself: install a newer `.dmg` by hand once. |

A copy run from source does not look for releases.

### Closing an instance

The ✕ on a card stops Claude Code there and removes the card. When the instance runs in a worktree, closing it
also removes that worktree: the folder and its branch, as Claude Code itself does when a worktree session ends.

A dialog asks first in two cases:

| When | What the dialog offers |
|---|---|
| Claude Code is still running | To close or to cancel. It says so if a turn is under way. |
| Removing the worktree would discard work | The same, with "Remove the worktree" left unticked. It names what would go: uncommitted changes, and commits that are on no other branch and no remote. |

An instance that has already ended, in a worktree with nothing to lose, closes without a question. The branch
on the remote, and a pull request made from it, are never touched. A worktree that stays behind (kept on
purpose, or left by a session that crashed) can be removed from the Worktrees tab.

A session in a container is closed the same way, and the question is about its container. It is removed, with
the clone in it, when nothing would be lost: no uncommitted changes, and no commits that are not pushed.
Otherwise "Remove the container" is left unticked. A container that is not removed is stopped and kept on the
Containers tab, where it can be removed, or given a new session that commits and pushes what it holds.

### Resuming after the app stops

Claude Code saves every conversation as it goes. The app adds what it knows on top: every 10 seconds, and
whenever an instance starts or closes, it writes down which instances are open, in which worktree, with which
model, input level, autonomy and CPU weight.

The next time the app starts, whatever was open is back on the Instances tab as an "interrupted" card, whether
the app was quit, crashed, or lost power. **Resume** continues that conversation in its worktree with its
settings; **Forget** drops the card and leaves the conversation to `claude --resume`. An instance that had not
exchanged a message yet has no conversation to continue and is started again the way it was started.

A session in a container is resumed in its container. Quitting the app stops the containers of its sessions,
and a resume starts the container again. If the container is gone, the session starts again in a new one.

### Groups

A group is a name that sessions share. On the Instances tab every card of a group carries the group's name and
a stripe in the group's colour, and the cards of one group sit next to each other.

- Several issues started together are a group from the start. The start dialog proposes a name made of their
  numbers; type another one, or an existing group's name to add them to that group.
- Any instance can be put into a group, moved to another or taken out: the **Group** field in its detail view.
  Clearing the field takes it out.
- The group is saved with the session, so it is still there after a restart, on the interrupted card and on
  the resumed instance.

### Going from one session to the next

Beside the session on show, the detail view lists every instance the app runs: its name, its status as on its
card, a checkmark once it is done, and the stripe of its group. The list is in the order of the wall. The
session on show is marked, and one that waits for input stands out. Sessions that run in the same folder have
the same name, so each of those also shows the name Claude Code gave it. A click goes to that session and keeps the
tab you are on: from one terminal to the next, or from one session's diff to the next one's.

Sessions started outside the app are not in the list: they have no view to go to.

### Sessions started outside the app

Claude Code sessions that run in the folder but were started elsewhere (a terminal, the desktop app) show up
as status-only cards. **Hide sessions started outside claudinho** on the Instances tab takes them out of the
view, and says how many it hides. The choice is remembered.

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

The prompt is a template in Jinja2 syntax, for example `Implement issue #{{issue_id}}`:

| Placeholder | Filled in with |
|---|---|
| `{{ issue_id }}` | The issue's number. |
| `{{ issue_title }}` | Its title. |
| `{{ issue_url }}` | Its address on GitHub. |

The default prompt is set under ⚙ and kept per folder. The dispatch dialog shows it, and an edit there counts
for that start only. Only placeholders are supported: a template with `{% … %}` blocks, `{# … #}` comments,
filters or an unknown name is refused when you save or start, with the reason, so that nothing half-filled
reaches Claude.

Worktrees are created one at a time. A repository can set a fresh worktree up in a `SessionStart` hook (install
dependencies, copy files), and two of those running side by side get in each other's way. So the next issue's
worktree is created only when the session in the previous one has finished its `SessionStart` hooks. Until
then that card says "starting", and the queued issues say which one they are waiting for. How many agents then
work at once is still the number you choose.

With Docker containers chosen, each issue gets a container instead of a worktree, named after the issue the
same way, and so is its branch. Containers do not wait for each other: the sessions of a batch start side by
side, as many as you chose to run at once, because nothing one of them sets up can be in another's way. An
issue waits in the queue while every container is taken.

Several issues are started lowest number first, whatever the order of the list. For them you also choose how many
agents run at once (max 4; with containers, as many as there may be) and the group's name (see [Groups](#groups)). For one issue or several you choose
the autonomy (next section).

### Autonomy: who merges

Every session has an autonomy: who merges its pull request. It is a dropdown wherever a session is started
(**+ New instance**, **+ New worktree…**, the dialog for one issue or for several), and in the session's
detail view, where it can be changed while the session runs.

| Autonomy | Who merges | What the session is told |
|---|---|---|
| Manual | You. Nothing gets merged automatically. | For an issue: not to merge. Otherwise nothing: what you ask of it holds. |
| Semi-auto | The session, if it judges that safe. | To decide whether the pull request is safe to merge without review, and then to merge it with `gh pr merge --squash` (method configurable under ⚙) or to leave it open and say why. |
| Full-auto | The app, once the session says the pull request is ready (see [Auto-merge](#auto-merge)). | For an issue: not to merge, and to say when the pull request is ready. |

A session reads this at the end of its first prompt: an issue's prompt, or the first prompt of the start
dialog when Semi-auto is chosen there. A session that is set to Semi-auto without one (started without a
prompt, or changed in its detail view), and one that is set away from Semi-auto, is told by a note instead.
Claude Code puts the note next to the session's next prompt or tool result, so a session at work hears of it
at its next tool call and an idle one with your next prompt. Until then its card says "not told yet". A
session that has to be started again after the app stopped reads its first prompt once more: where its
autonomy was changed in the meantime, the note comes with that prompt.

A note is not a prompt of yours. A session running in Claude Code's auto mode that knows of Semi-auto from a
note only is refused the merge by auto mode ("Merge Without Review"): it leaves the pull request open and says
so. Choose Semi-auto at the start, or tell the session yourself.

### The diff of a session's work

The detail view of an instance has two tabs, **Terminal** and **Diff**. The Diff tab's name says which diff
it holds: **Diff (git)** once the session's branch has a pull request, **Diff (local)** until then.

**Diff (git)** shows what the pull request changes, the way GitHub's "Files changed" shows it: the same files
in the same order, the same hunks and line numbers, added lines green and removed ones red, and the code
coloured by its language in GitHub's colours. It is what has been pushed, compared with the point where the
branch left its base; work that is only in the folder so far is not in it. The pull request's number opens its
files on GitHub.

**Diff (local)** shows the folder's own diff, drawn the same way: what the folder holds beyond the default
branch. That is the commits on its branch, what is not committed, and the files git does not know yet;
ignored files are left out. It is about what a pull request opened now would show, with the work that is not
committed on top. The bar says which branch the folder is compared with: the one `origin`'s HEAD names, else
`main` or `master`.

In both, a click on a file's name folds or opens it, and the name stays in view while its diff scrolls by. As
on GitHub, a deleted file and a diff of more than 400 lines or 20 KB start folded, and so do the files after
the first 20,000 lines. The list in the bar jumps to a file.

The tab is read-only: it shows, and changes nothing, in the folder, in git or on GitHub. Text can be selected
and copied, without the line numbers and the + and − marks. It is read when the tab is opened, when the
session's turn ends while the tab is open, and with **↻ Refresh**.

### Merging a pull request yourself

When a session is done and its branch has an open pull request, its card carries a button in the
header, on the wall and in the detail view. For a draft it reads **Mark ready for review**; otherwise **Merge
PR**, which asks before it merges, with the method set under ⚙. What GitHub refuses, a conflict or a rule of
the branch, is shown as GitHub says it. The button is there for any instance, started in a worktree or in the
folder itself, with or without auto-merge.

### Auto-merge

With **Full-auto** as a session's autonomy, merging is the app's job, not the session's. Every time such a
session ends a turn with an open pull request on its branch and nothing it
started still running, the app reads what the session wrote and decides between three things.

| The app | When | What happens |
|---|---|---|
| merges | The session says its work is done and the pull request is ready for merge, and nothing it raised needs a change. | A draft is marked ready, the app waits for the pull request's checks, then runs `gh pr merge --squash` (method configurable under ⚙). |
| follows up | The session raised something for debate: an open question, a choice between options, a doubt, work it left out. | The session is told what to do about each point and carries on. Its next reply is read the same way. |
| holds | The session does not say the pull request is ready, or only you can decide what it raised. | The pull request stays open, and the card says why. |

What GitHub refuses also goes back to the session to be repaired: a failed check, or a conflict with the base
branch once another pull request has been merged first. After three follow-ups without a prompt of yours in
between, the pull request waits for you. A prompt you type counts for more than the one the session was started
with, so "it is fine as it is" is taken at its word. What wakes a session, the end of a command in the
background or a subagent's report, is not a prompt of yours and changes neither.

The card shows where a pull request stands (`reviewing`, `follow-up 1 of 3`, `waiting for checks`, `merged`,
`not merged`), with the reason as its tooltip and in the detail view; every follow-up is a notification and
stands in the session's terminal as feedback from the Stop hook. The session counts as working until the app
has decided, which includes the wait for the checks. Interrupting it in the terminal, typing a new prompt or
choosing another autonomy calls the merge off. Chosen for a session that is already idle, Full-auto has the
app decide from the session's last reply; no follow-up can be sent then, so one that would be needed shows as
the reason.

The reading is done by a Claude run of its own (Sonnet, no tools, about five seconds and one cent at list
price per turn that ends), on your subscription like the sessions. It is given the prompt the session was
started with, your latest prompt, the issue, the pull request's description and the session's last reply. It
does not read the code. Merged branches are left in place unless the repository deletes head branches
automatically.

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
runs on with real load and prints what it measured; `node cpu-check.js <scenario>` runs one scenario of it.

## How it works

- Each instance is `claude` in a pseudo-terminal (`node-pty`), drawn with `xterm.js`.
- A session in a container is `docker exec -it … claude` in the same kind of pseudo-terminal. Its container is
  made with `docker run --privileged --cpus 2 --memory 8g` from an image built from `container/Dockerfile`:
  Debian with Python, Node.js, git, gh, Docker's engine with Compose, and Claude Code from Anthropic's package
  repository. Between what every folder shares and Claude Code lies a layer with the folder's own tools,
  installed by `mise install` from its `mise.toml`; the image's tag is worked out from the recipe, that file
  and the version of Claude Code. The open folder is mounted read-only and cloned inside. The repository's
  memory folder on this computer is mounted where Claude Code looks for its memory inside, and
  `--append-system-prompt` tells the session where it is.
- Claude Code copies a selection itself. In a container it has no clipboard, and asks its terminal to do it
  (OSC 52): the app then writes the clipboard. A request to read the clipboard is never answered.
- From a container, the app's hook server is another machine, and Claude Code refuses an HTTP hook to a
  private address. Those sessions send the same requests with `curl`, from command hooks, to
  `host.docker.internal`. Their status comes from `claude agents --json` run inside each container, their CPU
  and memory from `docker stats`, and their pull request from `gh pr view <branch>` on this computer.
- Each instance gets its own `--settings` file. It wraps your status line so the JSON Claude Code feeds it (cost,
  context, rate limits) is also saved for the app, and it adds HTTP hooks pointing at a local server inside the app:
  `PreToolUse` on `AskUserQuestion` and `PermissionRequest` for the input levels, `Stop` to notice a finished turn.
- Whether a finished turn is the end of the session's work comes with the `Stop` hook: its `background_tasks`
  lists what the session started and is still running. Only a turn that ends with that list empty makes the
  session done. What wakes a paused session reaches the app like a prompt (`UserPromptSubmit`), as a
  `<task-notification>` or an `<agent-message>`, which is how it is told from a prompt of yours.
- With auto-merge on, the `Stop` hook is answered only once the app has decided. The decision comes from
  `claude -p` with a JSON schema, no tools and its own system prompt, started in the app's data folder so that
  no project's settings or hooks come into it. A follow-up is the hook's answer (`additionalContext`), which
  makes Claude Code carry on with it. The wait for checks reads `gh pr view --json statusCheckRollup` every
  15 seconds, for at most an hour.
- A change of autonomy that the session has to know of is the app's answer to that session's next
  `UserPromptSubmit` or `PostToolUse` hook (`additionalContext`): Claude Code hands it to the model next to
  the prompt or the tool result, and shows nothing of it in the terminal.
- The app's own update is [electron-updater](https://www.electron.build/v26/docs/features/auto-update)
  reading the repository's GitHub releases: the `latest*.yml` file of a release names its installer and that
  file's checksum, which is verified after the download. The hourly look is three small requests to
  github.com's pages (the feed of releases, the newest release, its `latest*.yml`), not to GitHub's API.
- An input request answered in the terminal is reported by no hook. What was picked is read from what the
  tool call did next, through `PostToolUse` and `PostToolUseFailure`: the result of a question holds the
  answers, and a tool that ran had been approved. One that never ran before its turn ended was refused.
- The newest Claude Code version is read from the address the official installer reads it from,
  `https://downloads.claude.ai/claude-code-releases/latest` (or `stable`, if that is your release channel), at
  the start and every hour. Beside GitHub, for the app's own releases, it is the one address the app
  itself contacts.
- The tray icon's picture is drawn by the window, with the number on it, and handed to the main process.
- Session status comes from `claude agents --json`; the account from `claude auth status`.
- CPU and memory come from one listing of all processes every 2 seconds (PowerShell and CIM on Windows, `ps`
  elsewhere), running only while there is a session to measure. A session's numbers cover its process tree:
  Claude Code plus everything it started. CPU is a share of the whole machine, as Task Manager shows it.
- CPU limits live in `cpu.js`: one mechanism per operating system behind the same calls, and one sharing policy
  (`shareCpu` in `lib.js`) for the systems whose kernel cannot share by weight.
- Issues come from `gh api graphql`; blockers are GitHub's native issue dependencies. Pull requests come from
  `gh pr list`. Both are fetched newest first, and GitHub cannot order issues by number, so the app sorts
  them, highest number first.
- The Diff tab reads GitHub's list of a pull request's files (`gh api repos/{owner}/{repo}/pulls/<n>/files`),
  a hundred a page. Each file comes with its status, its counts and its hunks, cut the way GitHub's page cuts
  them. `gh pr diff` prints the same lines with some hunks cut differently, and refuses a pull request of more
  than 300 files. The page is drawn with text nodes only, so nothing in a diff can become markup.
- The local diff is `git diff-index -p -M` against the merge base of the folder's HEAD and the default branch,
  and `git ls-files --others --exclude-standard` for the files git does not know. `git diff` is not used: where
  a file was only touched it writes git's index anew, and a session may be at its own `git add` just then.
- The syntax colours are [highlight.js](https://highlightjs.org/)'s, with the colour theme it ships for
  GitHub's dark page. It runs in the main process, for one file at a time when that file is first drawn, and
  picks the language by the file's name. What it answers is taken apart into runs of text with a class each,
  and a line whose runs do not add up to the line itself stays uncoloured.
- "Finished its `SessionStart` hooks" is read from another hook, `UserPromptSubmit`: Claude Code holds the
  first prompt back until those hooks are done, and gives no other sign of it. The status line and
  `claude agents` both react while the hooks are still running.
- Worktrees come from `git worktree list`. Before one is removed, `git status` and `git rev-list` say what would
  be lost with it; then it goes with `git worktree remove` and `git branch -D`.
- What a restart needs is in `state.json` in the app's data folder, next to the settings: per open instance its
  folder, worktree, settings, and the id of its conversation, which Claude Code reports through the status
  line. The file is written to the side, flushed and renamed, so a power cut leaves the old one or the new one.
  Resuming runs `claude --resume <id>` inside the instance's worktree.

## Developing

- Everything that can run without Electron lives in `lib.js` and is covered by `npm test`.
- `npm start -- --remote-debugging-port=9333 <folder>` exposes the window to the Chrome DevTools protocol; the UI
  was tested that way (evaluating scripts in the page, taking screenshots). Electron's own flags go after the
  `.` that `npm start` passes: put before it, the app takes `.` for the folder to open and works on its own
  source folder.
- The version is the one in `package.json`. `npm version patch` (or `minor`, `major`) raises it there and in
  the lock file, commits, and tags the commit `vX.Y.Z`; [CHANGELOG.md](CHANGELOG.md) says what each version
  holds. `git push --follow-tags` then publishes it: the tag starts the `installers` workflow, which builds
  the installer of each system on a machine of that system, starts every packaged app once, and attaches the
  installers to the version's release.
- `npm run dist` builds the installer of the system it runs on into `dist/`, with
  [electron-builder](https://www.electron.build); the settings are under `build` in `package.json`.
  `npm run check:pack -- <packaged executable>` starts a packaged copy and checks what packaging can break
  (see the top of `pack-check.js`).
- Instances started while testing are real Claude Code sessions: they use your subscription and, with Remote
  Control on, show up on your other devices.
- `CLAUDINHO_CPU=throttle` forces the pause-and-resume CPU mechanism on Linux. It is the one macOS uses, so it
  can be worked on without a Mac. To run the check on a real Mac, start the `cpu-check` workflow by hand from
  the repository's Actions tab.
- [docs/HOW-THIS-WAS-BUILT.md](docs/HOW-THIS-WAS-BUILT.md) records the brief this app was built from, the
  decisions and their reasons, and every measurement behind the CPU limits. [CLAUDE.md](CLAUDE.md) holds the
  working notes for agents.

## Limits

- Instances are children of the app: quitting stops them (it asks first), and the next start offers to resume
  them. What is resumed is the conversation. A command that was running when the app stopped is not run again,
  and issues that were still queued for dispatch are not remembered.
- Run one copy of the app per data folder. Two copies write the same state file, and the last one to save
  wins; give a second copy its own `--user-data-dir`.
- Sessions started elsewhere are status-only: a terminal cannot be attached to them, and they cannot be put
  into a group.
- Sessions in Docker containers have been run on Windows with Docker Desktop, and nowhere else. Docker
  Desktop on macOS should behave the same and has not been tried. On Linux with Docker Engine alone the hooks
  do not reach the app: `host.docker.internal` is Docker Desktop's.
- A session's container is privileged, which the Docker inside it needs. That keeps sessions out of each
  other's way: ports, services, processes and files. It is not a wall against a session that sets out to leave
  its container.
- A container's work exists only in it until it is pushed. Removing a container removes its clone. The app
  asks first, as for a worktree, and keeps a container that holds something; Docker's own clean-up commands
  do not ask.
- The logins of the containers are their own, in the Docker volumes `claudinho-claude` and `claudinho-gh`.
  Removing those volumes signs the containers out. A setting of yours that names a path or a program of this
  computer points nowhere inside a container: a status line or a hook written for Windows does not run there.
- Sessions in containers write to one folder of this computer: the repository's memory. A note that one of
  them writes is read by every session on the repository from then on, so a wrong one misleads them all. The
  notes are files, to read and to delete, under `~/.claude/projects/`, in the folder named after the
  repository's path, in `memory`. A container made before 0.7.3 has no such mount: its sessions keep the
  memory that the containers had among themselves, in the Docker volume `claudinho-claude`, until the container
  is removed. What was written there is not moved over.
- The memory folder is found by the name Claude Code gives a folder today. A memory that was moved with Claude
  Code's `autoMemoryDirectory` setting is not followed.
- Copying from a container's terminal rests on Claude Code asking its terminal for it, through `docker exec`
  and, on Windows, the console layer in between. That has been seen on Windows 11 with Docker Desktop only. An
  image on the clipboard cannot be pasted into a session in a container: Claude Code looks for it on a
  clipboard of its own, which a container does not have.
- Every container has the same ceiling: 2 processors, and the memory set under ⚙, 8 GB to begin with. The CPU
  ceiling and the CPU weights there do not apply to it. When a container reaches its memory ceiling, the
  kernel ends a process in it, which may be a service or Claude Code itself. The ceilings are not set aside:
  seven containers of 8 GB can ask for more than Docker has, and what Docker has is Docker's own setting
  (on Windows, the memory of its WSL machine).
- The ports that reach this computer are set when a container is made. A service on another port is reached
  from inside only: the session can test it, your browser cannot open it. The numbers on this computer change
  when a container is started again.
- A folder's tools are built from the `mise.toml` in the folder on this computer, pushed or not. A session
  finds them whatever its branch holds; tools that only the branch's own file names are installed when the
  container is made, into that container alone, which takes as long as they take. A version written as
  `latest` is looked up when the image is built and stays until the file changes. A change of one tool
  fetches all of the folder's tools again.
- A folder's tools have been tried with `just`, `uv`, Node.js and Flutter. With Flutter, a new app was
  created, analyzed and tested in a container. Building it for Android, the web or the Linux desktop needs
  what the image does not have: an Android SDK, Chrome, a C++ compiler. A tool that has to be compiled has
  not been tried.
- On a Mac with Apple silicon the containers are arm64, and Flutter publishes no SDK for Linux on arm64. The
  image takes Flutter from its git repository there, at the tag of the version the folder names: 1.1 GB, half
  a minute to build. Each new container's first `flutter create` or `flutter test` fetches about 170 MB more.
  Another tool that has no build for Linux on arm64 still stops the image.
- An image per set of tools takes disk. Flutter's SDK is a 1.5 GB download and 2.6 GB installed, and its
  image takes about four minutes to build the first time. Docker Desktop keeps a layer packed and unpacked,
  so it counts about 4 GB for such an image beyond the standard one. The app removes a folder's older images.
  Those of a folder that is no longer opened stay until they are removed by hand (`docker rmi`).
- What a session installs with `sudo`, or a tool it adds with mise, is in its container alone and goes with
  it. The image has the libraries of a headless Chromium, not the browser. Which build is wanted goes by the
  project's Playwright version, so the image all folders share cannot hold it, and the place where Playwright
  looks is a volume all containers share. A build gets there when the image is built for a folder that names
  Playwright among its tools, or when the first session that needs it fetches it. The version named in
  `mise.toml` has to be kept the same as the lockfile's by hand. Builds of versions that nothing uses any more
  stay in that volume. Only Chromium is fetched: the image has no libraries for Firefox or WebKit.
- A new version of Claude Code on this computer makes the next container wait for the image to be built
  again, about a minute. Sessions in containers that are already running keep the version they started with.
- Quitting the app stops the containers of its sessions, and a resume does not start again what those
  sessions had running inside. If the app is stopped hard, the containers run on until their sessions are
  resumed or they are removed.
- Windows 11 puts a new tray icon among the hidden ones. Drag it onto the taskbar, or switch it on under
  Settings, Personalization, Taskbar, "Other system tray icons", to have the number in view. On Linux a tray
  icon needs a desktop that shows them. The tray icon has not been tried on macOS or Linux.
- Notifications are a list inside the app and a number; the app raises no pop-up of the operating system.
  They are not kept when the app stops.
- For a request answered in the terminal, the record is completed when the tool call has ended, so an approved
  command that runs for ten minutes reads "no answer yet" for those ten minutes. Approving a plan (leaving plan
  mode) is not treated as an input request, by the input levels or by the record. What Claude Code refuses by
  itself in auto mode was never put to you, and is not in the record either.
- One worktree at a time holds for issues sent from the Issues tab, which always start with a prompt. A
  session started without a prompt gives no sign that its `SessionStart` hooks are done, so "Resume all
  interrupted" and worktrees started by hand are not held back. A session that stops at a dialog before its
  first prompt (a folder to trust, a login) keeps the queue waiting until the dialog is answered or the
  instance is closed.
- Auto-merge decides from what a session writes, not from the code: a session that calls unfinished work ready
  gets it merged, so let the repository's checks be the judge of the code. Checks that only start more than
  15 seconds after the session's reply, in a repository that does not require them, are not waited for. A turn
  that ends without a pull request is left to you, whatever the session asks in it. If the review cannot run
  (no usage left, say), the pull request is held and the card says so.
- The app's own update is run to the end on Windows, macOS and Linux each time a release is built, on a hosted
  machine, and a release whose update fails is not published. Downloads are checked against the checksum in
  the release; on macOS the system also checks the signature, on Windows and Linux nothing does.
- What a session still has running is read when a turn ends. In every case tried, Claude Code woke the session
  when something it had started ended, which leads to a turn and so to a new reading. Should something end
  without that, it stays on the card until the session's next turn, and the session is not marked done before
  that. A session that leaves a command running for good, a development server say, is never done: stop the
  command, or have the session stop it. Claude Code lists a monitor started with its Monitor tool as a shell,
  so that is what the card calls it. A scheduled wake-up (`/loop`) is not something running: between two of
  them the session counts as done.
- The button to merge or mark ready shows what the app knew when the session's turn ended. A pull request
  merged or closed on GitHub since then still has its button until the next turn, and a session resumed after
  a restart has none until then.
- The Issues tab lists the newest 1000 issues and the Pull requests tab the newest 200 open pull requests. In
  a repository with more, the oldest are missing from the lists.
- A session's issue button knows where to go from the issue it was sent after. A session on record from 0.6.0
  or older has only the issue's number: its button leads to the open folder's repository, and where the
  session belongs to another folder there is no button, only the number. A pull request button shows what the
  app knew of the pull request when it last read it. It looks when a session is resumed, about every half
  minute while a session that has none yet is at work, at the end of a turn, and when the Diff tab is opened.
  What becomes of a pull request on GitHub after that shows at the end of the next turn.
- The Diff tab has GitHub's default view and no other: one column, no side-by-side view, no marking of the
  changed words inside a line, no unfolding of the lines between two hunks, no hiding of whitespace changes.
  Its colours are worked out hunk by hunk, where GitHub colours whole files: a hunk that starts inside a
  comment or a string that began above it is coloured as code. A file whose name tells no language, or one
  the highlighter does not know, stays uncoloured. GitHub's list of files hands over less than its page can load: a binary file, a file
  whose own diff is very large, and some files of a very large pull request come without a diff. The tab
  names such a file, with its counts where GitHub gives them, and links to it on GitHub. A file whose mode
  alone changed cannot be told from a binary file that changed. A pull request's first 3000 files are listed.
- The local diff takes the default branch from the clone, as it was when the clone last heard from `origin`.
  Where it finds none, it shows what is not committed. Of the files git does not know, the first 200 are
  listed and read up to 1 MB each and 8 MB in all; a larger one is named without its lines. It is not kept up
  to date while a session edits: it is read again when the turn ends, or with Refresh.
- Semi-auto depends on the session being let to merge: Claude Code's own permissions still apply to its
  `gh pr merge`, and auto mode refuses it when the session was told by a note and not in a prompt. A session
  is told once; a conversation that is cleared or compacted may no longer know. An idle session hears of a
  change only with your next prompt. Sessions started for several issues with Semi-auto by a version up to
  0.4.1, and resumed by a later one, show as Manual: their record did not say.
- With Remote Control on, a permission prompt can also be answered from your other devices, whichever comes first.
- From the home folder, the editor lists what you write yourself: `CLAUDE.md`, `settings.json`,
  `keybindings.json`, and what is under `agents`, `commands`, `output-styles`, `rules` and `skills/<name>`.
  Everything else in there (credentials, conversations, history, skill bundles the desktop app syncs) is out
  of its reach. Skills linked in through a symlink are not listed, and new home files cannot be created from
  the app yet.
- A worktree counts as safe to remove when it has no uncommitted changes and its commits are on another branch
  or on a remote. After a squash merge whose remote branch has since been pruned, the commits look unsaved
  although their content is merged; the dialog then asks, and removing is fine.
- On Windows a folder cannot be deleted while a program is running in it. Closing an instance together with
  its worktree therefore ends everything the instance started, with one exception: Docker Desktop. A session
  that needs Docker starts it when it is not running, and other sessions use it too, so it is left running.
  If Docker Desktop was started from inside the worktree, or a program from elsewhere sits in the folder, the
  app says so; the folder then shows on the Worktrees tab as a leftover, to be removed once that program is
  closed. Other programs of that kind, a browser that a session was the first to open for one, are still ended.
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
  The exception is the Windows case above, where the worktree goes too.
- The Windows installer is not signed, which is why Windows asks before the first start. A Windows PC with
  Smart App Control turned on blocks the installer and offers no way to allow one app: run from source there,
  or turn Smart App Control off.
- On Ubuntu 24.04 and later the AppImage runs without Chromium's sandbox. Ubuntu lets only programs with an
  AppArmor profile create user namespaces, which that sandbox is built on. The AppImage's launcher tests for
  this and then starts the app without the sandbox instead of failing. The window only ever loads the app's
  own files. Where user namespaces are open to every program, the sandbox stays on.
- The app carries Electron's default icon.
- What has been run where: a person has used the whole app on Windows only, from source and as the packaged
  app. On macOS and Linux the packaged app of each release is started once on a hosted machine
  (`pack-check.js`): it comes up, opens a folder and runs an instance in a terminal, with a stand-in for Claude
  Code. The real Claude Code has not been run in the app there, and neither have worktree removal and
  resuming. The CPU limits were checked on Linux (Ubuntu 24.04 under WSL, both mechanisms) and, with
  `npm run check:cpu`, on a Mac (macOS 26, Apple silicon, 5 cores, a GitHub Actions runner).

## License

[MIT](LICENSE)
