// node pack-check.js <packaged executable> [extra arguments for the app]
// Starts a packaged copy of the app and checks what packaging can break:
//   - its binary still runs as plain Node (the CPU limits on macOS and Linux start their helper that way, see cpu.js)
//   - the terminal library loads from the package, with the helper programs it ships
//   - the app comes up, shows its version and opens a folder
//   - the Diff tab's syntax colours: the highlighter and its style sheet are packages of their own
//   - on macOS and Linux: an instance runs in a terminal. A stand-in plays Claude Code, so nothing here touches
//     the subscription. On Windows node-pty needs a real .exe, so that part is tried by hand with the real one.
// The executable is claudinho.exe, claudinho.app/Contents/MacOS/claudinho, or the AppImage file.
// It needs Node 22 or later (for WebSocket) and, on Linux, a display: `xvfb-run -a node pack-check.js ...`.
//
// node pack-check.js <packaged executable> --update <folder>
// Checks instead that the app can replace itself with a newer release. <folder> holds a second build with a
// higher version (`npx electron-builder --publish never --config.extraMetadata.version=99.0.0
// --config.directories.output=<folder>`). It is
// served over HTTP, the app is pointed at it and told to update, and the check passes when the copy on the
// disk has become that version and runs again. This REPLACES the app it is given, so it is for a machine that
// is thrown away afterwards: the hosted ones of the `installers` workflow. On macOS the app must lie in a
// folder that can be written to (not on the disk image), and both builds must be signed by the same developer.
const { spawn, spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

if (!process.argv[2] || !fs.existsSync(process.argv[2])) { console.error('usage: node pack-check.js <packaged executable> [--update <folder>]'); process.exit(2); }
const exe = path.resolve(process.argv[2]);
const next = process.argv[3] === '--update' ? path.resolve(process.argv[4] || '') : null;
const WIN = process.platform === 'win32';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudinho-pack-'));
let failed = false;
const report = (ok, name, detail) => { failed = failed || !ok; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(26)} ${detail}`); };

// Runs inside the packaged binary, as Node: opens a terminal through the packaged node-pty and reads it back.
const PTY = `const path = require('path');
const app = path.join(path.dirname(process.execPath), process.platform === 'darwin' ? '../Resources/app' : 'resources/app');
const pty = require(path.join(app, 'node_modules', 'node-pty'));
const p = process.platform === 'win32' ? pty.spawn('cmd.exe', ['/c', 'echo pty-works'], {}) : pty.spawn('/bin/sh', ['-c', 'echo pty-works'], {});
let out = '';
p.onData(d => { out += d; });
const done = () => { console.log(out.includes('pty-works') ? 'PTY-OK node ' + process.versions.node : 'PTY-BAD ' + JSON.stringify(out)); process.exit(0); };
p.onExit(() => setTimeout(done, 300));
setTimeout(done, 10000);`;

function asNode() {
  // With the RunAsNode fuse off the binary would ignore the variable and open the app: no output, and a timeout.
  // The AppImage's launcher puts --no-sandbox in front of the arguments where user namespaces are restricted
  // (Ubuntu 24.04), unless it is already among them, and Node refuses it as an option. Behind `--` it is
  // only an argument for the script, on every system.
  // Three minutes: an Intel build on Apple silicon is translated before its first start, which took more than
  // one minute on a hosted Mac.
  const r = spawnSync(exe, ['-e', PTY, '--', '--no-sandbox'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 180000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  report(/PTY-OK/.test(out), 'plain Node, terminal', r.error ? r.error.message : out.split('\n').pop().slice(0, 200));
}

// The window, over the DevTools protocol: evaluate an expression in the page and wait for its value.
async function page(port) {
  let target;
  for (let i = 0; i < 120 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch { /* not listening yet */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('the app opened no window');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  const waiting = new Map();
  let seq = 0;
  ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } });
  const ev = async expression => {
    const r = await new Promise(resolve => { waiting.set(++seq, resolve); ws.send(JSON.stringify({ id: seq, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });
    const bad = r.result.exceptionDetails;
    if (bad) throw new Error(bad.exception ? bad.exception.description : bad.text);
    return r.result.result.value;
  };
  const until = async (expression, what) => {
    for (let i = 0; i < 120; i++) { const v = await ev(expression); if (v) return v; await sleep(250); }
    throw new Error(`timed out waiting for ${what}`);
  };
  return { ev, until };
}

async function asApp() {
  const repo = path.join(tmp, 'repo'), data = path.join(tmp, 'data');
  execFileSync('git', ['init', '-q', repo]);
  const env = { ...process.env };
  if (!WIN) {
    // The stand-in for Claude Code goes first on the PATH. The app takes its PATH from the login shell (see
    // main.js), so a stand-in for that shell is what puts it there.
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\ncase "$1" in auth) echo "{}";; agents) echo "[]";; *) echo "stand-in for claude: $*"; exec cat;; esac\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'shell'), `#!/bin/sh\necho "PATH=${bin}:$PATH"\n`, { mode: 0o755 });
    env.SHELL = path.join(bin, 'shell');
  }
  // Its own data folder, so the installed app's settings and sessions stay untouched; port 0 lets it pick a free one.
  const app = spawn(exe, [repo, `--user-data-dir=${data}`, '--remote-debugging-port=0', ...process.argv.slice(3)], { env, stdio: 'inherit' });
  const exited = new Promise(resolve => app.on('exit', resolve));
  try {
    const portFile = path.join(data, 'DevToolsActivePort');
    for (let i = 0; i < 240 && !fs.existsSync(portFile); i++) await sleep(250);
    if (!fs.existsSync(portFile)) throw new Error('the app did not start within a minute');
    const { ev, until } = await page(fs.readFileSync(portFile, 'utf8').split('\n')[0]);

    const shown = await until(`(document.querySelector('#version') || {}).textContent`, 'the version in the header');   // the page may still be loading
    const version = `v${require('./package.json').version}`;
    report(shown === version, 'starts, shows its version', `${shown}${shown === version ? '' : `, expected ${version}`}`);
    const state = await until(`api.call('state').then(s => s.repo && s)`, 'the folder to open');
    report(state.repo.path === repo, 'opens a folder', `${state.repo.path}, git: ${state.repo.isGit}`);
    // One line of code through the highlighter in the main process, and the colour its style sheet gives a keyword.
    const runs = await ev(`api.call('diffColours', 'a.js', [{ header: '@@ -0,0 +1 @@', lines: [{ type: '+', new: 1, text: 'const a = 1;' }] }])`);
    const colour = await ev(`(() => { const s = document.body.appendChild(Object.assign(document.createElement('span'), { className: 'hljs-keyword' })); const c = getComputedStyle(s).color; s.remove(); return c; })()`);
    report(JSON.stringify(runs[0][0]) === '["hljs-keyword","const"]' && colour === 'rgb(255, 123, 114)', 'colours a diff', `${JSON.stringify(runs[0].slice(0, 2))}, a keyword in ${colour}`);

    if (!WIN) {
      const id = await ev(`api.call('spawn', { level: 'manual' })`);
      const text = `(() => { const t = terms.get(${JSON.stringify(id)}); if (!t) return ''; const b = t.term.buffer.active; let s = ''; for (let i = 0; i < b.length; i++) s += b.getLine(i).translateToString(true) + ' '; return s.trim(); })()`;
      const seen = await until(`${text}.includes('stand-in for claude') && ${text}`, 'the instance to print in its terminal').catch(async e => { throw new Error(`${e.message}; the terminal shows: ${JSON.stringify(await ev(text))}`); });
      report(true, 'runs an instance', seen.slice(0, 60));
      await ev(`api.call('close', ${JSON.stringify(id)})`);
    }
    await ev(`setTimeout(() => window.close(), 0)`);   // the app quits when its window closes
    await Promise.race([exited, sleep(10000)]);
  } catch (e) {
    report(false, 'the packaged app', e.message);
  }
  app.kill();
}

// The app, told that a newer release lies at an address of ours, replaces itself with it and starts again.
async function asUpdate() {
  const MAC = process.platform === 'darwin';
  const yml = WIN ? 'latest.yml' : MAC ? 'latest-mac.yml' : 'latest-linux.yml';
  const want = /^version: (\S+)/m.exec(fs.readFileSync(path.join(next, yml), 'utf8'))[1];
  // Whole files only. The updater first tries to fetch just the changed parts, gets no partial answer here,
  // and falls back to the whole installer.
  const server = http.createServer((req, res) => {
    const file = path.join(next, path.basename(decodeURIComponent(req.url.split('?')[0])));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Length': fs.statSync(file).size });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const data = path.join(tmp, 'data');
  const app = spawn(exe, [`--user-data-dir=${data}`, '--remote-debugging-port=0'], { env: { ...process.env, CLAUDINHO_UPDATES: `http://127.0.0.1:${server.address().port}` }, stdio: 'inherit' });
  const exited = new Promise(resolve => app.on('exit', resolve));
  // What the disk holds after the update. On Windows and macOS the app's own package.json, which the build
  // leaves a plain file, names the new version. On Linux a new AppImage lies where the old one was.
  const image = WIN || MAC ? null : fs.readdirSync(next).find(f => f.endsWith('.AppImage'));
  const manifest = path.join(path.dirname(exe), MAC ? '../Resources/app/package.json' : 'resources/app/package.json');
  const installed = () => {
    try {
      if (!image) return JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
      return fs.statSync(path.join(path.dirname(exe), image)).size === fs.statSync(path.join(next, image)).size ? want : null;
    } catch { return null; }   // mid-replacement
  };
  const running = () => (WIN
    ? (spawnSync('tasklist', ['/FI', `IMAGENAME eq ${path.basename(exe)}`, '/NH'], { encoding: 'utf8' }).stdout || '').includes(path.basename(exe))
    : spawnSync('pgrep', ['-f', image || exe]).status === 0);
  try {
    const portFile = path.join(data, 'DevToolsActivePort');
    for (let i = 0; i < 240 && !fs.existsSync(portFile); i++) await sleep(250);
    if (!fs.existsSync(portFile)) throw new Error('the app did not start within a minute');
    const { ev, until } = await page(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
    const was = await until(`(document.querySelector('#version') || {}).textContent`, 'the version in the header');
    const found = await until(`api.call('state').then(s => s.update && s.update.latest)`, 'the app to find the newer release');
    report(found === want, 'finds the newer release', `${was} sees ${found}${found === want ? '' : `, expected ${want}`}`);
    await ev(`api.call('updateApp')`);
    await Promise.race([exited, sleep(180000)]);   // it downloads, then closes to be replaced
    let now = null;
    for (let i = 0; i < 360 && now !== want; i++) { now = installed(); if (now !== want) await sleep(500); }
    report(now === want, 'replaces itself', now === want ? `the copy on the disk is ${now}` : `the copy on the disk is still ${now || 'the old one'}`);
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { up = running(); if (!up) await sleep(500); }
    report(up, 'starts again', up ? 'a claudinho process is running' : 'no claudinho process came up within a minute');
  } catch (e) {
    report(false, 'the update', e.message);
  }
  server.close();
}

(async () => {
  if (next) await asUpdate();
  else { asNode(); await asApp(); }
  await sleep(500);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  process.exit(failed ? 1 : 0);
})();
