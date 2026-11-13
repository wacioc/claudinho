// Runs the real thing: makes one container the way the app does (containers.js) and checks what the app relies
// on there. Needs Docker Desktop running, builds the image if it is not there yet, and takes about a minute
// then. Starts no Claude Code session and uses no login.
//   node box-check.js        (npm run check:box)
// The container gets a name of its own, so the check never takes a place among the app's containers.
process.env.CLAUDINHO_BOX = 'claudinho-check';
const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const lib = require('./lib');
const boxes = require('./containers');

let failed = 0;
const check = (ok, text) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${text}`); if (!ok) failed++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const secs = t => `${((Date.now() - t) / 1000).toFixed(1)} s`;

(async () => {
  let image = null;
  const box = boxes.nameOf(1), work = lib.boxWork('claudinho-check'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudinho-check-'));
  // A folder of the check's own stands for the repository's memory on this computer.
  const memory = path.join(dir, 'memory'), memoryIn = boxes.memoryIn(work);
  const inside = (argv, opts) => boxes.inBox(box, argv, { cwd: work, ...opts }).then(s => s.trim());
  const inspect = format => boxes.docker(['inspect', box, '--format', format]).then(s => s.trim());
  try {
    const d = await boxes.info();
    console.log(`Docker ${d.version}: ${d.cpus} processors, ${(d.mem / 2 ** 30).toFixed(1)} GB. That allows ${d.limit} containers of ${lib.BOX_CPUS} processors and ${lib.BOX_MEMORY_GB} GB.`);
    await boxes.remove(box).catch(() => { /* none left from a check that was stopped */ });
    let t = Date.now();
    const version = lib.parseVersion(execFileSync('claude', ['--version'], { encoding: 'utf8' }));
    // A folder that names one small tool, and the image that is built for it.
    const tools = path.join(dir, 'tools');
    fs.mkdirSync(tools);
    fs.writeFileSync(path.join(tools, 'mise.toml'), '[tools]\njust = "1.36.0"\n');
    const said = [];
    image = await boxes.image(version, tools, line => { said.push(line); if (/^#\d+ \[/.test(line)) console.log(`     ${line.slice(0, 110)}`); });
    console.log(`image ${image} (${secs(t)})`);
    // Only a folder that names Playwright has a browser fetched when its image is built. The fetch itself is
    // 300 MB and more, and not part of this check.
    check(!said.some(line => /browser (of|for) (the )?Playwright/.test(line)), 'this folder names no Playwright, and no browser was fetched for it');
    t = Date.now();
    check(await boxes.image(version, tools) === image && Date.now() - t < 5000, `asked for again with nothing changed, it is there at once (${secs(t)})`);
    // Which image a folder gets is worked out from its file: another file, another Claude Code or no file is
    // another image, and the same file again is the same one.
    const tagNow = () => boxes.tagOf(version, boxes.toolFiles(tools));
    fs.writeFileSync(path.join(tools, 'mise.toml'), '[tools]\njust = "1.36.0"\n# a change\n');
    const changed = tagNow();
    fs.writeFileSync(path.join(tools, 'mise.toml'), '[tools]\njust = "1.36.0"\n');
    check(changed !== image && tagNow() === image && boxes.tagOf('0.0.0', boxes.toolFiles(tools)) !== image && boxes.tagOf(version, []) !== image, 'a changed file, another Claude Code, or no file at all each ask for another image');

    console.log('\na container, made and filled as for a session');
    t = Date.now();
    const github = lib.parseGitHub(execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: __dirname, encoding: 'utf8' }).trim());
    fs.mkdirSync(memory);
    fs.writeFileSync(path.join(memory, 'MEMORY.md'), '- a note from this computer\n');
    await boxes.create({ n: 1, image, root: __dirname, name: 'box-check', work, key: 'c0ffee00', dir, ports: [8000], memory, memoryGb: 3 });
    await boxes.ready(box);
    const made = secs(t);
    // As it is for a folder's first container: Docker has made the folder above the memory, as root.
    await boxes.inBox(box, ['chown', 'root:root', path.posix.dirname(memoryIn)], { root: true });
    await boxes.fill(box, { root: __dirname, work, branch: 'box-check', origin: `https://github.com/${github.owner}/${github.name}.git`, identity: [['user.name', 'box-check'], ['user.email', 'box-check@example.invalid']], configDir: path.join(dir, 'no-config'), say: line => console.log(`     ${line}`) });
    console.log(`  made and its Docker up after ${made}, filled after ${secs(t)}`);
    check(await inspect('{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}} {{.HostConfig.Privileged}}') === `${lib.BOX_CPUS}000000000 ${3 * 2 ** 30} true`, `held to ${lib.BOX_CPUS} processors and the 3 GB it was made with`);
    const row = (await boxes.list()).find(r => r.box === box);
    check(row && row.running && row.name === 'box-check' && row.work === work && row.key === 'c0ffee00' && lib.samePath(row.root, __dirname), 'on the list, with what was written on it');
    check(await inside(['git', 'branch', '--show-current']) === 'box-check', 'its clone is on the new branch');
    check(await inside(['git', 'rev-parse', 'HEAD']) === await inside(['git', 'rev-parse', 'origin/HEAD']), 'which starts at the default branch as GitHub has it');
    check(await inside(['git', 'remote', 'get-url', 'origin']) === `https://github.com/${github.owner}/${github.name}.git`, 'and pushes to GitHub, not to the folder on this computer');
    check(await inside(['sh', '-c', 'touch /src/x 2>&1; test -f package.json && echo there']).then(s => /Read-only/.test(s) && /there$/.test(s)), 'the folder on this computer is there to read, and cannot be written to');
    check(/^\d+\.\d+/.test(await inside(['docker', 'compose', 'version', '--short'])) && /^\d+\./.test(await inside(['docker', 'info', '--format', '{{.ServerVersion}}'])), 'a Docker of its own inside, with Compose');
    check(lib.parseVersion(await inside(['claude', '--version'])) !== null && /^v\d+/.test(await inside(['node', '--version'])) && /^Python 3/.test(await inside(['python', '--version'])), `Claude Code ${lib.parseVersion(await inside(['claude', '--version']))}, Node.js and Python are in it`);
    check(await inside(['just', '--version']) === 'just 1.36.0', 'the tool the folder names is in the image, and found from inside the clone without any set-up');
    check(await boxes.docker(['run', '--rm', '--entrypoint', 'sh', image, '-c', 'test ! -e /home/agent/.cache/mise && echo none']).then(x => x.trim() === 'none', () => false), 'and the image keeps nothing of what mise downloaded to install it');
    check(await inside(['sudo', '-n', 'id', '-u']) === '0', 'the session\'s user may become root, for what a project\'s set-up installs');
    check(Number(await inside(['sh', '-c', 'ldconfig -p | grep -c -E "libnss3|libatk-1|libgbm"'])) >= 3 && /^\d{4}\./.test(await inside(['mise', '--version'])), 'the libraries of a headless Chromium are there, and mise');
    check(await inside(['sh', '-c', 'echo "$PLAYWRIGHT_SKIP_BROWSER_GC"; test -w ~/.cache/ms-playwright && echo writable']) === '1\nwritable', 'Playwright\'s browsers are the shared volume, from which no installation removes another one\'s');

    console.log('\nthe repository\'s memory, which is a folder on this computer');
    check(await inside(['cat', `${memoryIn}/MEMORY.md`]) === '- a note from this computer', 'a note written on this computer is read inside, where Claude Code looks for its memory');
    await inside(['sh', '-c', `echo "from inside" > ${memoryIn}/inside.md`]);
    check(fs.readFileSync(path.join(memory, 'inside.md'), 'utf8').trim() === 'from inside', 'a note that the session\'s user writes inside is on this computer');
    check(await inside(['stat', '-c', '%U', path.posix.dirname(memoryIn)]) === 'agent', 'the folder above it, where the conversation is kept, is the session\'s user\'s, though Docker made it as root');

    console.log('\nwhat it holds that is nowhere else');
    let s = await boxes.state(box, work);
    check(s.branch === 'box-check' && s.changed === 0 && s.unique === 0, `fresh: ${JSON.stringify(s)}`);
    await inside(['sh', '-c', 'echo x > check.txt']);
    s = await boxes.state(box, work);
    check(s.changed === 1 && s.unique === 0, 'a new file counts as one uncommitted change');
    await inside(['sh', '-c', 'git add check.txt && git commit -q -m check']);
    s = await boxes.state(box, work);
    check(s.changed === 0 && s.unique === 1, 'committed, it is one commit that is not pushed');

    console.log('\nhooks: the request a session sends, and the answer it gets back');
    const server = http.createServer((req, res) => { let body = ''; req.on('data', c => { body += c; }); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ got: JSON.parse(body).hook_event_name, at: req.url })); }); });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const hook = lib.instanceSettings({ statusFile: '/claudinho/status.json', hookUrl: `http://host.docker.internal:${server.address().port}/token/id`, curl: true }).hooks.PostToolUse[0].hooks[0].command;
    const answer = await inside(['sh', '-c', hook], { input: JSON.stringify({ hook_event_name: 'PostToolUse' }) });
    check(answer === '{"got":"PostToolUse","at":"/token/id/after"}', `the app's server on 127.0.0.1 is reached from inside, and its answer comes back: ${answer}`);
    await new Promise(r => server.close(r));
    const silent = await boxes.inBox(box, ['sh', '-c', `${hook}; echo "exit $?"`], { input: '{}' }).then(x => x.trim(), e => `rejected: ${e.message}`);
    check(silent === 'exit 0', `with the app gone the hook says nothing and does not fail: ${silent}`);
    await inside(['sh', '-c', 'echo \'{"model":{"display_name":"x"}}\' | ' + lib.statusLineCommand('/claudinho/status.json')]);
    check(JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8')).model.display_name === 'x', 'what a status line writes inside is read on this computer');

    // Into a folder of the check's own: the volume it would go to is the one the app's sessions read.
    console.log('\nthe owner\'s Claude Code configuration, copied in');
    const config = path.join(dir, 'config'), to = '/tmp/config-check';
    fs.mkdirSync(path.join(config, 'skills', 'demo'), { recursive: true });
    for (const [file, text] of [['settings.json', '{"a":1}'], ['statusline.sh', 'echo hi\n'], ['skills/demo/SKILL.md', 'demo\n'], ['.credentials.json', '{"secret":1}'], ['history.jsonl', 'x\n']]) fs.writeFileSync(path.join(config, file), text);
    await boxes.inBox(box, ['mkdir', '-p', to]);
    await boxes.copyConfig(box, config, to);
    const arrived = await inside(['sh', '-c', `cd ${to} && find . -type f | sort | tr '\\n' ' '`]);
    check(arrived === './settings.json ./skills/demo/SKILL.md ./statusline.sh', `what a person keeps there arrives, and neither login nor history: ${arrived}`);
    const first = await inside(['stat', '-c', '%i %U', `${to}/settings.json`]);
    await boxes.copyConfig(box, config, to);
    check(first.endsWith(' agent') && await inside(['stat', '-c', '%i %U', `${to}/settings.json`]) === first, 'copied again, a file that is the same is left alone');
    fs.writeFileSync(path.join(config, 'settings.json'), '{"a":2}');
    await Promise.all([boxes.copyConfig(box, config, to), boxes.inBox(box, ['sh', '-c', `for k in $(seq 200); do cat ${to}/settings.json; echo; done | sort -u | tr '\\n' ' '`]).then(seen => { check(/^(\{"a":1\} )?(\{"a":2\} )?$/.test(seen), `read 200 times while it is replaced, it is never seen half written: ${seen.trim()}`); })]);
    check(await inside(['cat', `${to}/settings.json`]) === '{"a":2}' && await inside(['sh', '-c', `ls -A ${to} | grep -c new- || true`]) === '0', 'a file that differs is replaced whole, and nothing is left beside it');

    console.log('\na port of the container, from this computer');
    await boxes.docker(['exec', '-d', '-u', 'agent', '-w', work, box, 'python', '-m', 'http.server', '8000']);
    const [p] = await boxes.ports(box);
    let code = 0;
    for (let k = 0; k < 20 && code !== 200; k++) { code = await fetch(`http://localhost:${p.host}/package.json`).then(r => r.status, () => 0); if (code !== 200) await wait(300); }
    check(p.port === 8000 && code === 200, `its port 8000 answers at localhost:${p.host}`);
    const stats = (await boxes.stats([box])).get(box);
    check(stats && stats.mem > 0 && stats.memLimit === 3 * 2 ** 30 && stats.count > 0, `Docker's reading: ${stats && `${Math.round(stats.mem / 2 ** 20)} MB of ${stats.memLimit / 2 ** 30} GB, ${stats.count} processes`}`);

    await boxes.resize([box], 5);
    check((await boxes.stats([box])).get(box).memLimit === 5 * 2 ** 30, 'its memory ceiling can be raised while it runs');
    const took = await boxes.disk();
    check(took.image > 2 ** 30 && took.containers > 0 && took.volumes > 0, `what it takes on the disk is read: image ${(took.image / 1e9).toFixed(2)} GB, all volumes ${(took.volumes / 1e9).toFixed(2)} GB, this container's own layer ${(took.containers / 1e6).toFixed(0)} MB`);

    console.log('\nstopped, started again, removed');
    await boxes.stop([box]);
    check(await inspect('{{.State.Status}}') === 'exited', 'stopped, it runs nothing');
    await boxes.start(box);
    await boxes.ready(box);
    check(await inside(['cat', 'check.txt']) === 'x', 'started again, it holds what it held');
    await boxes.remove(box);
    check(!await boxes.exists(box), 'removed');
  } finally {
    await boxes.remove(box).catch(() => {});
    await boxes.docker(['volume', 'rm', `${box}-docker`]).catch(() => {});   // the check's own: the app keeps a container's volume
    // The two empty folders that the memory's mount left in the volume all containers share: the check's own too.
    if (image) await boxes.docker(['run', '--rm', '--entrypoint', 'rmdir', '-v', 'claudinho-claude:/c', image, `/c/projects/${lib.projectDir(work)}/memory`, `/c/projects/${lib.projectDir(work)}`]).catch(() => {});
    if (image) await boxes.docker(['rmi', image]).catch(() => {});           // and its image, which no folder of the owner's uses
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
