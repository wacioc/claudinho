# claudinho

A desktop monitor (Electron) for the Claude Code instances running in a repo: live terminals, their worktrees,
GitHub issues with dispatch into worktrees, an editor for the `.claude` setup, per-instance CPU limits, and
resuming every session after the app stops.

- [README.md](README.md): what it does, how to run it, and its limits.
- [docs/HOW-THIS-WAS-BUILT.md](docs/HOW-THIS-WAS-BUILT.md): the brief, the decisions and their reasons, the
  measurements, and what is still unverified. Read it before changing the CPU limits, the hooks, worktree
  removal or the saved session state.
- [CHANGELOG.md](CHANGELOG.md): what each version holds.

## Commands

```bash
npm install
npm start                      # reopens the last folder; `npm start -- <folder>` opens another
npm test                       # asserts for lib.js; prints "ok"
npm run check:cpu              # real-load check of the CPU limits: every core busy for three to four minutes
```

## Layout

| File | What lives there |
|---|---|
| `main.js` | Electron main process: instances (`node-pty`), the hook server, the process sampler, the dispatch pool, the `rpc` table the window calls. |
| `preload.js` | The bridge to the window: `api.call`, `api.write`, `api.resize`, `api.on`. |
| `renderer/` | The window: plain JavaScript, one DOM helper, native `<dialog>` forms. No framework, no build step. |
| `lib.js` | Pure helpers, no Electron. Anything that can be tested without the app belongs here. |
| `test.js` | Plain asserts for `lib.js`. No test framework. |
| `cpu.js` | CPU limits: one mechanism per operating system behind the same calls. No Electron. |
| `cpu-check.js` | Runs the machine's real mechanism under real load and checks the numbers. |

## How this code is written

- The smallest thing that works. No speculative options, no abstraction with a single user, the standard
  library and the platform before a new dependency.
- A shortcut taken on purpose carries a comment that starts with `ponytail:` and names its ceiling and the way up.
- Logic that can break gets one runnable check: an assert in `test.js` if it is pure, a scenario in
  `cpu-check.js` if it needs real load.
- Comments say why, in plain words.
- Instances run on the Claude Code subscription. `childEnv` in `lib.js` strips API keys from their environment;
  keep it that way.

## Testing

- Starting an instance starts a real Claude Code session: it uses the subscription and, with Remote Control on,
  shows up on the owner's other devices, where a permission prompt can be answered too.
- Launch test copies with `--user-data-dir=<a temporary folder>` so real app data stays untouched, and with
  `--remote-debugging-port=<port>` to drive the window over the DevTools protocol.
- Electron's own flags go after the `.`: `electron . --inspect=9229 <folder>`. Before it, the app takes `.` for
  the folder to open and works on this checkout. Before a test starts an instance, check which folder is open.
- Worktree removal deletes folders and branches. Test it in a scratch repository, never in this one.
- The home-folder editor is tested with `CLAUDE_CONFIG_DIR` set to a scratch folder, never against the real
  home folder: the test reads, writes, and pokes at paths the editor must refuse.
- To put load inside an instance without a model call, type `!` and a command in its terminal. From a test,
  write `!`, the command and Enter one after another, with a pause in between.
- CPU limits: Windows runs its mechanism directly. On Linux the default is the kernel one, and
  `CLAUDINHO_CPU=throttle` forces pause-and-resume, the mechanism macOS uses. For a real Mac there is
  `.github/workflows/cpu-check.yml`, started by hand from the Actions tab.
- Other load on the machine moves the `check:cpu` numbers. Read the figures, and with `CPU_CHECK_VERBOSE=1` the
  per-sample trace, not only the verdicts.

## Versions

The version is the one in `package.json`, and the app shows it in its header. For a new one: write its entry in
`CHANGELOG.md` and commit it, then run `npm version patch` (or `minor`, `major`). That raises the version in
both package files, commits, and tags the commit `vX.Y.Z`.

## Not done yet

- The app has only been run on Windows. On macOS and Linux only the CPU limits were checked.
- No installers. A packaged build must keep Electron's `RunAsNode` fuse on (see `cpu.js`).
- The open points are listed in the README under "Limits" and in section 8 of the build history.
