# Changelog

What each version of claudinho holds. Versions follow [semantic versioning](https://semver.org), every release
is tagged `vX.Y.Z`, and the app shows its version in the header. From 0.1.1 on, each version's installers are on
the [releases page](https://github.com/wacioc/claudinho/releases).

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
