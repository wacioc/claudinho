# claudinho

A desktop monitor (Electron) for the Claude Code instances running in a repo: live terminals in groups, their
worktrees, GitHub issues with dispatch into worktrees, the open pull requests, notifications with a record of
every input request, an editor for the `.claude` setup, per-instance CPU limits, and resuming every session
after the app stops.

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
npm run dist                   # the installer of the system this runs on, into dist/
npm run check:pack -- <exe>    # starts a packaged copy of the app and checks it; which file to pass is in pack-check.js
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
| `pack-check.js` | Starts a packaged copy of the app and checks what packaging can break. No Electron. |
| `package.json`, under `build` | The packaging settings for electron-builder. JSON takes no comments, so their reasons are in section 8 of the build history. |
| `.github/workflows/installers.yml` | On a version tag: builds the installer of each system, runs `pack-check.js` on it, publishes the release. |

## How this code is written

- The smallest thing that works. No speculative options, no abstraction with a single user, the standard
  library and the platform before a new dependency.
- A shortcut taken on purpose carries a comment that starts with `ponytail:` and names its ceiling and the way up.
- Logic that can break gets one runnable check: an assert in `test.js` if it is pure, a scenario in
  `cpu-check.js` if it needs real load, a step in `pack-check.js` if it only breaks once the app is packaged.
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
- The start order of a batch is tested in a scratch repository whose `.claude/settings.json` has a slow
  `SessionStart` command hook that writes down when it begins and ends, in which folder. Two set-ups must
  never overlap. Issues can be handed to `dispatch` directly; with `GH_REPO` set, `gh` finds a repository for
  the blocker lookup although the scratch folder has no GitHub remote.
- The Pull requests tab is tested read-only in an empty folder whose `origin` is a public repository with
  many open pull requests. Nothing is started there.
- Input requests need a session that is asked before it uses a tool. Where the machine's default is auto
  mode, give the scratch repository `"permissions": { "defaultMode": "default" }` in its `.claude/settings.json`.
  A test answers in the terminal by writing keys to the instance (`api.write`): Enter, Down, Escape.
- `CLAUDINHO_RELEASES=<address>` makes the app read Claude Code's newest version from there, so a test can
  serve a higher one and see the update button. Pressing it runs the real `claude update`: check first that
  the installed version is the newest, or the test updates Claude Code.
- The tray icon cannot be seen through the DevTools protocol. Its pictures can: `trayImages(n)` in the window
  draws them.
- `pack-check.js` starts no real Claude Code session. On macOS and Linux a stand-in plays Claude Code; on
  Windows it starts no instance. The packaged app with the real Claude Code is tried by hand: after
  `npm run dist`, start `dist/win-unpacked/claudinho.exe` like any other test copy.

## Versions

The version is the one in `package.json`, and the app shows it in its header. For a new one: write its entry in
`CHANGELOG.md` and commit it, then run `npm version patch` (or `minor`, `major`). That raises the version in
both package files, commits, and tags the commit `vX.Y.Z`. Then `git push --follow-tags`: the tag starts the
`installers` workflow, which builds and checks the installers and publishes them as that version's release.
A version whose tag is not on GitHub has no release.

The Mac apps are signed with the owner's Developer ID and notarised. The `installers` workflow takes the
repository secrets `CSC_LINK` (the Developer ID Application certificate with its key, as base64 of a `.p12`),
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`, and fails when Gatekeeper
does not report the app as notarised. On a Mac, `npm run dist` signs with the certificate in the keychain and
notarises when `APPLE_KEYCHAIN_PROFILE` names a profile saved with `xcrun notarytool store-credentials`.

## Not done yet

- A person has only used the app on Windows. On macOS and Linux the packaged app has been started on hosted
  machines by `pack-check.js`, with a stand-in for Claude Code, and the CPU limits were checked.
- The Windows installer is not signed, and the installers carry Electron's default icon. The signed Mac build
  has run on the owner's Mac, not yet in the workflow (section 11 of the build history). A packaged build must keep Electron's
  `RunAsNode` fuse on (see `cpu.js`); `pack-check.js` fails when it is off.
- The open points are listed in the README under "Limits" and in section 11 of the build history.
