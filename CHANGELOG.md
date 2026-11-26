# Changelog

What each version of claudinho holds. Versions follow [semantic versioning](https://semver.org), every release
is tagged `vX.Y.Z`, and the app shows its version in the header. From 0.1.1 on, each version's installers are on
the [releases page](https://github.com/wacioc/claudinho/releases).

## 0.11.1 (2026-11-26)

**Issues**

- The "Agents running at once" field is gone from the dialog for several issues. Each issue now starts as soon
  as its blockers are closed and, with containers, a container is free; worktrees are still made one at a time.
  The limit was shared by every group and set by the batch sent last, and an issue it held back could say it
  was waiting for a free container while most were free.

## 0.11.0 (2026-11-26)

**Pull requests**

- A card whose pull request has merge conflicts says "Merge conflicts" where its Merge PR (or Mark ready for
  review) button was.
- A pull request that is merged, on GitHub, by its button or by auto-merge, now closes its session as the ✕
  does: the worktree or container is removed, or kept where removing it would discard work. A notification says
  which. A session in the middle of a turn is closed once the turn ends. One whose pull request was already
  merged when the app first saw it, such as a session resumed after the merge, is left open.
- While a session's work is done, its open pull request is looked at once a minute, so both of these show
  within a minute of the change on GitHub. Before, the card learnt of it at the end of the next turn.

## 0.10.4 (2026-11-25)

**Docker containers**

- The `file` command is in every new container: a session that ran it to see what it had downloaded was told it
  does not exist. The first container after this update waits for a new image, of which the part from the system
  libraries for Playwright on is built again, a folder's own tools with it. Containers that exist already stay
  without it.

## 0.10.3 (2026-11-25)

**Header**

- After Claude Code was signed in to another account, the header showed the new account's address beside the old
  account's 5h and 7d usage. The figures are now kept with the account they were read for, and the header shows
  them only for the account signed in now. Until a session of that account gets its first reply, it shows none.
  A session still running from before the switch can report the old account's figures as the new one's.

## 0.10.2 (2026-11-25)

**Docker containers**

- A session in a container whose Claude Code had the same process id as that of another container lost its
  status: its card said "starting" whatever it did, and a permission request answered in its terminal could stay
  open on the card. Each container now keeps the records of its running sessions to itself. Containers that exist
  already are as they were; resuming a session in one usually gives it another process id.

**Cards**

- A session that has taken a prompt and has no status says "unknown", where it said "starting".

## 0.10.1 (2026-11-25)

This version has a tag and no release: GitHub failed while it was published. 0.10.2 holds what is in it.

**Docker containers**

- Codex, OpenAI's command line, is in every new container. The first container after this update waits for a new
  image, of which only the last part is built after 0.9.2 or 0.10.0, and which is 430 MB larger. Containers that
  exist already stay without it.
- Codex has one login for all containers, in a Docker volume of its own, which you make once and by hand. The
  README says how, under "Worktrees or Docker containers". No card asks for it, and a session starts without it.
  OpenAI advises against one login for several jobs at once: two containers that renew it in the same moment can
  fail, and may have to be signed in again.

## 0.10.0 (2026-11-25)

**Docker containers**

- A container is no longer held to two processors. One that is alone at work has all of Docker's processors, and
  those that are busy share them evenly, so together they can now keep the whole computer busy. How many
  containers there may be has not changed. A container that exists already is freed when its session is resumed
  or a new one is started in it.
- A tool that starts as many workers as it sees processors now starts more of them in a container, within the
  same memory ceiling. That ceiling can be raised under ⚙.

## 0.9.2 (2026-11-25)

**Docker containers**

- Every new container gets the newest gh, from GitHub's own package repository. It had the one that Debian
  packages, 2.46.0 of January 2025. Without an answer from that repository a container keeps the gh its image
  was built with, and its card says so. The first container after this update waits for the image to be built
  again, all of it, a folder's own tools included. Containers that exist already keep the gh they have.

## 0.9.1 (2026-11-23)

**Docker containers**

- A session's start waits up to two minutes for Docker to say how many processors and how much memory it
  has, where it gave up after 15 seconds. A busy Docker took longer, and the session did not start.
- A docker command that runs out of time says so: "Docker did not answer `docker info` within 15 seconds",
  where it said no more than "Command failed" and the command.

## 0.9.0 (2026-11-23)

**Docker containers**

- An MCP server that a session in a container starts with `npx` has two minutes to start, where Claude Code
  gives it 30 seconds otherwise. Its first start installs it, and claude-context took longer than 30 seconds:
  stopped halfway, the install stayed broken in every container. A folder already broken that way goes with
  the caches, below.
- The caches that all containers share, what npm, pip and uv downloaded and Playwright's browsers, carry a
  number now. A release that raises it gives every container made after the update empty caches, so that
  something broken in them is gone without anybody looking for it. The app removes the old ones when it
  starts, each once no container uses it: a container that was kept goes on with the old caches until it is
  removed. This version is the first and empties them once. Packages are downloaded again as they are asked
  for, and Playwright's browser by the first session that needs it, 300 MB and more.

## 0.8.1 (2026-11-15)

**Versions**

- A click on the app's version in the header, or on Claude Code's, looks for a newer one at once, where the
  app otherwise looks every hour, and says what it found: that version is the newest, a newer one is out, or
  it could not be found out just now. A newer one gets its button and its notification as before.

## 0.8.0 (2026-11-15)

**Instances**

- The detail view has a third tab, **Files (Read-only)**: the folder the session works in as a tree, drawn
  the way VS Code's explorer draws one. Folders first, a click opens or closes one, and a file carries a mark
  for its kind. A click on a file shows it beside the tree, with line numbers and the Diff tab's colours, to
  read: nothing in the tab can change a file. For a session in a container it is the clone inside the
  container. The tab is read again when a folder is opened or closed, when the session's turn ends, and with
  Refresh.

**Issues**

- An issue that is started is assigned on GitHub to the account of its session: the one `gh` is signed in to
  on this computer, or in the containers for a session in a container. Where GitHub refuses, the session
  starts all the same and the bell says why.

## 0.7.5 (2026-11-15)

**Docker containers**

- Claude Code in the containers follows the account this computer is signed in to. Where the containers have
  no login, or another account's, the card signs them in before the session starts, once for all of them,
  with this computer's address filled in. After a switch of accounts here, the next container asks once more.
- Sessions in containers get the MCP servers that a session of the folder has on this computer: those of
  every project, and those added for the folder alone, which live in `~/.claude.json` and never reached a
  container before. They are read anew at every start.
- The plugins switched on in your settings and in the folder's own are installed for all containers, from the
  marketplaces this computer has them from. Before, only the settings that name them reached a container, and
  Claude Code there did not fetch them.
- A container's clone gets the folder's `.claude/settings.local.json`, which git does not track, as a session in
  a worktree reads it from the main checkout.

## 0.7.4 (2026-11-14)

**Docker containers**

- On a Mac with Apple silicon, a folder that names Flutter in its `mise.toml` gets containers again. Docker
  builds arm64 images there, Flutter publishes its Linux SDK for x64 only, and mise stopped the image's build.
  The image now takes Flutter from its git repository, at the tag of the version the folder names; sessions
  analyse and test as they do on x64.

## 0.7.3 (2026-11-14)

**Docker containers**

- Sessions in containers use the memory that Claude Code keeps for the repository on this computer, the one
  its sessions in worktrees use. Before, the containers of a folder had a memory among themselves, in a Docker
  volume: nobody could look into it, the sessions on this computer never saw it, and a note that one session
  wrote there about its container was read by every later one, also when it was no longer true. Containers
  made before this version keep that memory until they are removed.
- A session in a container is told where it is: that the container is its own to set up, that a tool that is
  missing can be installed and should be named, that a browser runs headless and how Playwright's is fetched,
  and that the memory is shared, so that what is true of one container only stays out of it.
- A folder can name Playwright among its tools: `"pipx:playwright"` or `"npm:playwright"` in its `mise.toml`,
  with the version its lockfile has. When its image is built, the app fetches that version's browser into the
  cache all containers share, so no container waits for it and no session has to fetch it. A Playwright that
  installs its browsers no longer removes another version's from that cache.
- Text can be copied from the terminal of a session in a container. Claude Code copies a selection itself; in
  a container it has no clipboard and asks its terminal, which the app now answers.

## 0.7.2 (2026-11-13)

**Docker containers**

- A folder's image no longer carries what mise downloaded to install the folder's tools. For a folder that
  names Flutter, that was 1.5 GB in its image.

## 0.7.1 (2026-11-13)

**Docker containers**

- Issues sent to Claude Code together start side by side, as many as you chose to run at once. Before, each
  container waited until the session in the one before it had taken its first prompt, the way worktrees do.
  Measured with three issues: all three were at work 17 seconds after they were sent off, where each start
  takes about 13 seconds by itself.
- Your Claude Code configuration goes into the containers file by file, and a file that has not changed is
  left alone. Before, every new container wrote all of it anew, under the sessions that were reading it.
- The memory ceiling of a container is a setting, and 8 GB unless you change it. It was 4 GB. A change counts
  for the containers there are as well.
- Local files that a clone does not bring, a `.env` for one, are copied into each new container from a list
  under ⚙: patterns in `.gitignore` syntax, kept in the folder's `.worktreeinclude`, which Claude Code reads
  for a new worktree too. A card says so when a `.env` stays behind for want of a list. In the clone, git
  ignores what was copied.
- A container is no longer kept at closing because the folder on this computer had commits that were not
  pushed. Those commits came along with the clone and counted as the session's.
- A folder names the tools its sessions need in a `mise.toml` (or `.tool-versions`), and they are built into
  that folder's image: `just`, `uv`, another Node.js, whatever mise knows. Every start of a container looks at the file,
  and a changed one builds a new image. The dialogs that start a session say which tools the folder names,
  and where it has no such file they offer to have Claude Code write one.
- The image has the system libraries of a headless Chromium, and sessions may use `sudo`. What uv and
  Playwright download is kept for all containers, as it already was for npm and pip.
- With Docker chosen, the card of a session that writes a skill or an agent was out of sight. It is on show
  under either choice now.

**All of it at a glance**

- Three figures in the bar say what every session of the app takes together: CPU, memory, and the disk of
  their worktrees and containers.

**Issues**

- A double click on an issue opens the dialog that "Tackle … with Claude Code" opens.

## 0.7.0 (2026-11-13)

**Two ways of working**

- Sessions can work in Docker containers instead of worktrees: each in a container of its own, with a Docker
  of its own inside, so that every session can run the same services on the same ports. The first start asks
  which way to begin with, and a list in the header changes between the two at any time. Each way has its own
  sessions, and the window shows those of the one that is chosen.
- With Docker chosen, **+ New instance** and every issue sent to Claude Code get a new container: a clone of
  the folder on a new branch, held to 2 processors and 4 GB. There may be one container for every two of
  Docker's processors, less one. Cards, terminals and the detail view are what they are for worktrees.
- A **Containers** tab stands where the Worktrees tab was. Closing an instance removes its container when
  nothing in it would be lost. One that holds uncommitted changes, or commits that are not pushed, is stopped
  and kept, and can be given a new session or removed from that tab.
- A setting names the ports of a container that can be reached from this computer. An instance's detail view
  lists the address of each.
- This way needs Docker Desktop, and has been tried on Windows. Worktrees work as before and need nothing of
  it.

**Instances**

- A session's pull request button no longer waits for the end of a turn. The app looks for the pull request
  when a session is resumed, and about every half minute while a session that has none yet is at work.
  Before, a session resumed after a restart of the app had no button until its next turn ended, and one that
  opened its pull request early in a long turn had none until the end of that turn.

## 0.6.4 (2026-11-13)

**Instances**

- Closing an instance together with its worktree no longer ends Docker Desktop. A session that needs Docker
  starts Docker Desktop when it is not running, and it then counted as one of that session's programs: closing
  the card ended it, and with it the containers of every other session. Everything else the session started
  is still ended.
- Where Docker Desktop was started from inside the worktree, Windows keeps that folder until Docker Desktop is
  closed. The app says so, and the folder waits on the Worktrees tab.

## 0.6.3 (2026-11-13)

**Instances**

- While a session's branch has no pull request, the Diff tab shows the folder's own diff: what it holds beyond
  the default branch, which is the commits on its branch, what is not committed, and the files git does not
  know yet. Before, the tab was empty until there was a pull request.
- The tab is called **Diff (local)** then, and **Diff (git)** once there is a pull request, whose diff it shows
  as before.

## 0.6.2 (2026-11-13)

**Pull requests**

- The Pull requests list is in number order with the highest first, like the Issues list. Before, the lowest
  came first.

## 0.6.1 (2026-11-13)

**Instances**

- A session that was sent after an issue has a button with the issue's number on its card, and a session whose
  branch has a pull request has one for the pull request, with its state. Each opens its page on GitHub, from
  the wall and from the detail view. They take the place of the two chips that said the same without a link.
- An interrupted session that was sent after an issue has the button too.

**Issues**

- The Issues list is in number order with the highest first. Before, the lowest came first. Several issues
  sent to Claude Code together still start with the lowest number.

**Versions**

- The app looks for a newer release of itself, and for a newer Claude Code, every hour. Before, it looked
  every six hours.

## 0.6.0 (2026-11-12)

**Instances**

- The detail view of an instance has a second tab, **Diff**: what the pull request of the session's branch
  changes, the way GitHub's "Files changed" shows it. The same files, hunks and line numbers in one column,
  added lines green and removed ones red, the code in GitHub's syntax colours, and files that fold. As on
  GitHub, a deleted file, a large diff and what follows the first 20,000 lines start folded.
- The tab is read-only. It is read from GitHub when it is opened, when the session's turn ends and with
  ↻ Refresh, and the pull request's number opens its files on GitHub.
- It has GitHub's default view only: there is no side-by-side view. A file that GitHub's list of files gives
  no diff for, a binary one or a very large one, is named and linked.
- Beside the session on show, the detail view lists all sessions the app runs, with name and status. A click
  goes to that session and keeps the tab, so the terminals, or the diffs, can be gone through one after
  another.

## 0.5.0 (2026-11-12)

**Issues and pull requests**

- Both lists are in number order, lowest first. Before, the issues came last changed first and the pull
  requests newest first. Several issues sent to Claude Code together start in that order.
- In a repository with more than 1000 issues the tab holds the newest 1000. Before, it held the 1000 changed
  last.

**Autonomy**

- The auto-merge checkbox is gone. Where it was, in the dialogs for a new instance, a new worktree and one
  issue and in an instance's detail view, there is the dropdown that the dialog for several issues had:
  Manual, Semi-auto, Full-auto. Full-auto is what the ticked box was.
- Semi-auto, in which the session merges its own pull request if it judges that safe, is thereby there for one
  issue and for a session started by hand. The session reads it at the end of its first prompt.
- The autonomy can be changed while a session runs. A change to Semi-auto or away from it is told to the
  session with its next prompt or tool call; until then its card says "not told yet". A session in Claude
  Code's auto mode that was told this way is refused the merge by auto mode: choose Semi-auto at the start.
- One issue started on Manual is now told not to merge, as each issue of a batch always was. Before, an
  unticked box said nothing about merging.
- Sessions on record from an older version keep their setting: auto-merge on is Full-auto, off is Manual.

## 0.4.1 (2026-11-12)

**Instances**

- A session is done only when its turn has ended and nothing it started is still running: no command in the
  background, no subagent, no monitor. Before, the end of every turn counted, so a session that had only
  paused to wait for its own background work got the checkmark and the "is done" notification, and with
  auto-merge on its pull request was judged at that point.
- While a session waits like that, its card says what is still running. Nothing is announced, judged or merged
  until that has ended, and a dispatched session keeps its place among the agents that run at once.

**Auto-merge**

- What wakes a session, the end of a command in the background or a subagent's report, no longer counts as a
  prompt of yours when the pull request is judged.

## 0.4.0 (2026-11-11)

**Auto-merge**

- Merging is the app's job now, and it waits for the session's word. With auto-merge on, the app reads what a
  session wrote at the end of a turn and merges its pull request once the session says it is ready: a draft
  is marked ready, the checks are waited for, then it is merged.
- What a session raises for debate is settled first. The app tells the session what to do about each point, up
  to three times in a row, and merges when nothing is open. What only you can decide holds the pull request,
  with the reason on the card.
- A failed check or a merge conflict goes back to the session to be repaired.
- Before, a pull request was merged as soon as a turn ended, whatever the session had written, and a draft was
  never merged.

**Instances**

- A card whose session is done and has an open pull request carries a button, on the wall and in the detail
  view: **Mark ready for review** for a draft, **Merge PR** otherwise.

**The app's own version**

- The app looks for newer releases of itself. A button and a notification announce one, and pressing either
  installs it and restarts the app, after asking if sessions are running. A Mac copy must be 0.3.1 or later
  for this, the first signed version.
- A release holds more files from now on: beside the installers, what the update reads.

## 0.3.1 (2026-11-11)

- The macOS apps are signed with a Developer ID and notarised by Apple. A downloaded copy now opens after one
  question from macOS, where before it was refused until allowed in Privacy & Security. The Windows installer
  is still not signed.
- Nothing changed in what the app does.

## 0.3.0 (2026-11-11)

**Notifications**

- A bell in the top right with the number of new notifications in a red circle, and a tray icon that shows the
  same number. A notification is raised when a session asks for input, when it has answered for itself, and
  when it is done.
- A session whose turn has ended is marked on its card with a green outline and a green checkmark.

**Instances**

- A record of every input request per session, in the detail view: what was asked, the options, the
  recommended one, the one picked, and whether that was by hand, by the timer running out, or automatic.
  Answers given in the terminal are recorded too. The record is kept across a restart.
- The start dialogs offer the model as a list: fable, opus, sonnet, haiku.

**Claude Code**

- The header shows the installed version of Claude Code. When a newer one is out, a button and a notification
  appear, and pressing either runs `claude update`.

**Removed**

- The row of tags in the top right that counted the folder's `.claude` and `.github` files. The tag that names
  the GitHub repository stays.

## 0.2.0 (2026-11-11)

**Instances**

- Groups: a name that sessions share. The cards of a group carry its name and a stripe in its colour, and sit
  next to each other. Any instance can be put into a group, or taken out, in its detail view, and the group is
  still there after a restart.
- A filter on the Instances tab hides the sessions that were started outside the app.

**Issues**

- Several issues started together are a group from the start.
- Worktrees are created one at a time: the next one waits until the session in the previous one has finished
  its `SessionStart` hooks, so two worktrees are never being set up side by side.

**Pull requests**

- A new tab with the repository's open pull requests, drafts and those ready for review, with their checks,
  review state and the session at work on each.

## 0.1.1 (2026-11-11)

- Installers for Windows (`.exe`), macOS (`.dmg`, one for Apple silicon and one for Intel) and Linux (AppImage),
  attached to each release from this one on. They are not signed.
- Nothing changed in what the app does.

## 0.1.0 (2026-11-11)

The first version.

**Instances**

- Every Claude Code instance of a folder as a live terminal, with model, context window, API-equivalent cost,
  uptime, CPU and memory, and a detail view with its environment variables.
- Per instance: an input level (manual, timed, auto) and automatic merge of its pull request when it finishes.
- Closing an instance asks first while Claude Code is still running, and removes the instance's worktree with
  it. Work that would be lost is named, and kept unless you say otherwise.
- The state of every open instance is saved every 10 seconds. After a quit, a crash or a power cut, each one
  can be resumed where it left off.

**Worktrees**

- A list of the worktrees under `.claude/worktrees` with what each one holds, and a way to remove them.

**Issues**

- The repository's issues with their blockers, and dispatch into worktrees: one instance per issue, up to four
  at once, with three levels of autonomy.
- The prompt for a dispatched issue is a template with `{{ issue_id }}`, `{{ issue_title }}` and
  `{{ issue_url }}`. Its default is a setting, kept per folder.

**Configuration**

- An editor for the folder's `.claude` and `.github` files, with an offer to commit, and for your own
  configuration in the home folder.
- Generators for a new skill and a new agent.

**CPU limits**

- A ceiling per instance and sharing by weight, enforced by job objects on Windows, control groups on Linux,
  and pausing and resuming on macOS.
