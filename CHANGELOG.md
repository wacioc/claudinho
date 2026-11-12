# Changelog

What each version of claudinho holds. Versions follow [semantic versioning](https://semver.org), every release
is tagged `vX.Y.Z`, and the app shows its version in the header. From 0.1.1 on, each version's installers are on
the [releases page](https://github.com/wacioc/claudinho/releases).

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
