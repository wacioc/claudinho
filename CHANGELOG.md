# Changelog

What each version of claudinho holds. Versions follow [semantic versioning](https://semver.org), every release
is tagged `vX.Y.Z`, and the app shows its version in the header. From 0.1.1 on, each version's installers are on
the [releases page](https://github.com/wacioc/claudinho/releases).

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
