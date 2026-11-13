// Sessions in Docker containers. No Electron.
//
// In this mode a session does not work in a worktree on this computer, but in a container of its own that has
// a Docker of its own inside, for the project's services. Every session can then run the same services on the
// same ports, and none sees another's.
//
// A container is a numbered place, claudinho-slot-N, and there are only so many of them (lib.boxLimit), each
// held to two processors and a memory ceiling the owner sets. It is made when its session starts and removed when the session's
// card is closed, as a worktree is. Three kinds of volume outlive it:
//   claudinho-slot-N-docker       the images its Docker pulled, kept for the next session at that number
//   claudinho-claude, -gh         Claude Code's configuration with its login, and GitHub's login: one of each
//                                 for all containers. Both logins are made inside a container, by the owner.
//   claudinho-npm-cache, -pip-cache, -uv-cache, -playwright   what npm, pip and uv downloaded, and the
//                                 browsers Playwright fetched
// The folder on this computer is mounted read-only at /src and cloned from there. A session's work leaves its
// container by `git push`. One folder of this computer it writes to directly: the memory that Claude Code keeps
// for the repository, mounted where Claude Code looks for it inside (see memoryIn). Sessions in containers and
// sessions in worktrees then read and write the same notes.
//
// The containers are privileged, which a Docker inside needs. That keeps sessions out of each other's way; it
// is no wall against a session that sets out to leave its container.
// ponytail: Docker Desktop only (Windows, macOS, and its Linux edition). The hooks reach the app through
// host.docker.internal, which Docker Desktop provides. On Docker Engine alone that name needs --add-host, and
// the hook server an address that containers can reach.
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib');

// CLAUDINHO_BOX: other names for the containers of a test copy, so that it never takes, stops or removes one of
// the copy in use. The image and the shared volumes are the same for both.
const PREFIX = (process.env.CLAUDINHO_BOX || 'claudinho').replace(/[^A-Za-z0-9-]/g, '');
const HOME = '/home/agent';
const DOCKERFILE = path.join(__dirname, 'container', 'Dockerfile');
const recipe = fs.existsSync(DOCKERFILE);   // false in a packaged copy that left it out: pack-check.js looks
const nameOf = n => `${PREFIX}-slot-${n}`;
const numberOf = name => { const m = new RegExp(`^${PREFIX}-slot-(\\d+)$`).exec(name || ''); return m ? Number(m[1]) : null; };
// Where Claude Code inside a container looks for the memory of the clone in `work`.
const memoryIn = work => `${HOME}/.claude/projects/${lib.projectDir(work)}/memory`;
// Playwright's browsers: one volume for all containers, at the place where every Playwright looks. Each version
// of Playwright wants builds of its own, and they lie there side by side. A Playwright that installs its builds
// also removes those that no installation it knows of still uses, and from inside one container it knows of
// none in another: so that is turned off (https://playwright.dev/docs/browsers#stale-browser-removal).
// ponytail: builds that nothing asks for any more stay in the volume until somebody clears it.
const BROWSERS = ['-e', 'PLAYWRIGHT_SKIP_BROWSER_GC=1', '-v', `claudinho-playwright:${HOME}/.cache/ms-playwright`];
const wait = ms => new Promise(r => setTimeout(r, ms));

// One docker command. Rejects with the last lines of what it printed as an error, and with its exit code.
function docker(args, { input, timeout = 120000, encoding = 'utf8' } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', args, { timeout, encoding, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, DOCKER_CLI_HINTS: 'false' } }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      reject(Object.assign(new Error(String(stderr || err.message).trim().split(/\r?\n/).slice(-2).join(' ') || `docker ${args[0]} failed`), { code: err.code }));
    });
    if (input != null) { child.stdin.on('error', () => { /* it ended before reading: its exit code says why */ }); child.stdin.end(input); }
  });
}

// A command inside a container: as the session's user unless `root` is set, in the folder `cwd`.
const inBox = (box, argv, { root = false, cwd, ...opts } = {}) =>
  docker(['exec', ...(opts.input != null ? ['-i'] : []), '-u', root ? 'root' : 'agent', ...(cwd ? ['-w', cwd] : []), box, ...argv], opts);

// A docker command that takes a while: `say` is told each line it prints as it goes. Rejects with the last one.
function follow(args, say) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let rest = '', last = '';
    const read = chunk => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop();
      for (const line of lines) if (line.trim()) { last = line.trim(); say(last); }
    };
    child.stdout.setEncoding('utf8').on('data', read);
    child.stderr.setEncoding('utf8').on('data', read);
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(last || `docker ${args[0]} failed`))));
  });
}

// Docker itself: the processors and the memory it has, and how many containers that allows.
async function info() {
  const [cpus, mem, version] = (await docker(['info', '--format', '{{.NCPU}} {{.MemTotal}} {{.ServerVersion}}'], { timeout: 15000 })).trim().split(' ');
  return { cpus: Number(cpus), mem: Number(mem), version, limit: lib.boxLimit(Number(cpus)) };
}

// The files in which a folder names its tools, for mise: https://mise.jdx.dev/configuration.html
const TOOL_FILES = ['mise.toml', '.mise.toml', 'mise.lock', '.tool-versions'];
// Those of a folder, as [name, what it holds].
const toolFiles = root => TOOL_FILES.map(name => { try { return [name, fs.readFileSync(path.join(root, name))]; } catch { return null; } }).filter(Boolean);

// The image a folder's containers are made from, built from container/Dockerfile when it is not there yet. It
// holds the tools the folder names (see toolFiles), so a container has them from its first second. Its tag is
// worked out from the recipe, from those files and from the version of Claude Code on this computer: a change
// of any builds a new image, of which Docker makes only the layers that differ. Every start of a container
// asks for it, which is how a changed mise.toml is noticed. Folders that name the same tools, or none, share
// an image.
// say: told each line of the build as it goes.
const building = new Map();   // tag -> the build under way: sessions started together wait for the same one
function tagOf(claude, tools) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(DOCKERFILE)).update(String(claude));
  for (const [name, text] of tools) hash.update(`\0${name}\0`).update(text);
  return `claudinho-slot:${hash.digest('hex').slice(0, 12)}`;
}
function image(claude, root, say = () => {}) {
  const tools = toolFiles(root), tag = tagOf(claude, tools);
  if (!building.has(tag)) building.set(tag, build(tag, claude, root, tools, say).finally(() => building.delete(tag)));
  return building.get(tag);
}

async function build(tag, claude, root, tools, say) {
  if (await docker(['image', 'inspect', '--format', '{{.Id}}', tag]).then(() => true, () => false)) return tag;
  // Whose image it is: the folder's, or everybody's who names no tools. The images that one had before go.
  const owner = tools.length ? root : '-';
  say(`Building the image for the containers${tools.length ? ` of this folder, with the tools that ${tools.map(t => t[0]).join(' and ')} name${tools.length === 1 ? 's' : ''}` : ''}. This is needed once, again when those tools change, and again with each new version of Claude Code. The first time it downloads several hundred megabytes, more for a large toolchain, and takes some minutes.`);
  // What Docker is given to build from: the recipe, and the folder's files in tools/.
  const context = fs.mkdtempSync(path.join(os.tmpdir(), 'claudinho-image-'));
  try {
    fs.copyFileSync(DOCKERFILE, path.join(context, 'Dockerfile'));
    fs.mkdirSync(path.join(context, 'tools'));
    for (const [name, text] of tools) fs.writeFileSync(path.join(context, 'tools', name), text);
    await follow(['build', '--progress', 'plain', '-t', tag, '--label', `claudinho.tools-of=${owner}`, '--build-arg', `CLAUDE_CODE=${claude}`, context], say)
      .catch(e => { throw new Error(`The image for containers could not be built: ${e.message}`); });
  } finally { fs.rmSync(context, { recursive: true, force: true }); }
  // A folder that names Playwright among its tools ("npm:playwright" in its mise.toml, with the version its
  // lockfile has) gets that version's browser now, into the volume the containers share: fetched once, when the
  // image is built, so that no session has to and no container waits for it. The image itself cannot hold it.
  // The volume lies over that place, and which build is wanted goes by the version of Playwright, which only
  // the folder knows (https://playwright.dev/docs/docker#image-tags). Chromium, whose libraries the image has.
  if (tools.length) {
    await follow(['run', '--rm', '-u', 'agent', '-w', '/work', '--entrypoint', 'sh', ...BROWSERS, tag, '-c',
      'if command -v playwright >/dev/null 2>&1; then echo "Fetching the browser of the Playwright this folder names, for all containers."; playwright install chromium; fi'], say)
      .catch(e => say(`The browser for Playwright could not be fetched now (${e.message}). A session can fetch it: playwright install chromium`));
  }
  // The same owner's older images, and those from before images had an owner. One that a container still uses
  // stays: Docker refuses to remove it.
  const tags = (await docker(['images', 'claudinho-slot', '--format', '{{.Repository}}:{{.Tag}}'])).split(/\r?\n/).filter(t => t && t !== tag);
  for (const old of tags) {
    const of = await docker(['image', 'inspect', '--format', '{{index .Config.Labels "claudinho.tools-of"}}', old]).then(x => x.trim(), () => null);
    if (of === owner || of === '') await docker(['rmi', old]).catch(() => { /* in use */ });
  }
  return tag;
}

// Every container of ours, running or not, by number. root, name, work and key are what `create` wrote on it:
// the folder on this computer it was made for, its session's name, where its clone is, and which folder under
// the app's data it sees as /claudinho.
async function list() {
  const format = ['.Names', '.State', '.Label "claudinho.root"', '.Label "claudinho.name"', '.Label "claudinho.work"', '.Label "claudinho.key"'].map(f => `{{${f}}}`).join('\t');
  const out = await docker(['ps', '-a', '--filter', `name=${PREFIX}-slot-`, '--format', format], { timeout: 20000 });
  return out.split(/\r?\n/).map(l => l.split('\t')).map(([box, state, root, name, work, key]) => ({ box, n: numberOf(box), running: state === 'running', root, name, work, key }))
    .filter(r => r.n).sort((a, b) => a.n - b.n);
}

// A new container at number n. dir: the folder on this computer that it sees as /claudinho, where the app puts
// the session's settings and the session leaves its status (see lib.instanceSettings). memoryGb: its ceiling.
// memory: the folder on this computer that holds the repository's memory (see lib.memoryDir). Without that
// mount the sessions in containers would keep a memory of their own in the shared volume, which nobody can
// look into and which the sessions on this computer never see.
async function create({ n, image: tag, root, name, work, key, dir, ports, memory, memoryGb = lib.BOX_MEMORY_GB }) {
  const box = nameOf(n);
  await docker(['run', '-d', '--init', '--privileged', '--name', box, '--hostname', `slot-${n}`,
    '--cpus', String(lib.BOX_CPUS), '--memory', `${memoryGb}g`,
    '--label', `claudinho.root=${root}`, '--label', `claudinho.name=${name}`, '--label', `claudinho.work=${work}`, '--label', `claudinho.key=${key}`,
    // 127.0.0.1 without a port: Docker picks a free one on this computer for each of them (see `ports`)
    ...ports.flatMap(p => ['-p', `127.0.0.1::${p}`]),
    '-v', `${box}-docker:/var/lib/docker`, '-v', `claudinho-claude:${HOME}/.claude`, '-v', `claudinho-gh:${HOME}/.config/gh`,
    '-v', `claudinho-npm-cache:${HOME}/.npm`, '-v', `claudinho-pip-cache:${HOME}/.cache/pip`,
    '-v', `claudinho-uv-cache:${HOME}/.cache/uv`, ...BROWSERS,
    '-v', `${root}:/src:ro`, '-v', `${dir}:/claudinho`, '-v', `${memory}:${memoryIn(work)}`, tag]);
  return box;
}

// The Docker inside takes a second or two to come up.
async function ready(box) {
  for (let t = 0; t < 120; t++) {
    if (await inBox(box, ['docker', 'info', '--format', '{{.ServerVersion}}'], { timeout: 10000 }).then(() => true, () => false)) return;
    await wait(500);
  }
  throw new Error(`The Docker inside ${box} did not come up.`);
}

// The owner's own Claude Code configuration, into the volume all containers share: what a person keeps in that
// folder (the lists the home editor works from), and the scripts that lie directly in it, which status lines
// and hooks call. Never the login, the conversations or the history: of those the containers have their own.
// ponytail: copied at each start of a container, which only adds and overwrites. What was deleted on this
// computer stays in the volume, and a setting that names a path of this computer points nowhere in there.
const CONFIG = [...lib.HOME_FILES, ...lib.HOME_DIRS, 'hooks'];
// It goes into a folder of the container's own first, and from there file by file into the volume: a file that
// is the same as the one there is left alone, and one that differs is written beside it and renamed over it.
// Sessions in other containers read that volume while this runs, and several containers may be at it at once,
// since they are started side by side: a settings file caught half written would not parse.
// to: where the volume is. box-check.js names a folder of its own there, so as not to write into the volume.
const STAGE = '/var/tmp/claudinho-config';   // not /tmp: there the image's start script puts a memory disk, which `docker cp` cannot reach
async function copyConfig(box, configDir, to = `${HOME}/.claude`) {
  let names;
  try { names = fs.readdirSync(configDir, { withFileTypes: true }).filter(e => CONFIG.includes(e.name) || (e.isFile() && /\.(sh|js|mjs|cjs|py)$/.test(e.name))).map(e => e.name); } catch { return; }
  if (!names.length) return;
  await inBox(box, ['sh', '-c', `rm -rf ${STAGE} && mkdir -p ${STAGE}`], { root: true });
  for (const name of names) await docker(['cp', path.join(configDir, name), `${box}:${STAGE}/`]);
  await inBox(box, ['bash', '-c', `cd ${STAGE} && find . -type f -print0 | while IFS= read -r -d '' f; do d="$1/$f"; cmp -s "$f" "$d" && continue; mkdir -p "$(dirname "$d")" && cp "$f" "$d.new-$HOSTNAME" && mv -f "$d.new-$HOSTNAME" "$d"; done`, 'bash', to], { timeout: 300000 });
}

const hostGit = (args, cwd, input) => new Promise((resolve, reject) => {
  const child = execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  if (input != null) { child.stdin.on('error', () => { /* it ended before reading */ }); child.stdin.end(input); }
});

// .worktreeinclude, as Claude Code reads it for a new worktree: the files that match one of its patterns and
// that git ignores (a project's .env, say) are copied along, since a clone does not bring them.
async function copyIncluded(box, root, work) {
  if (!fs.existsSync(path.join(root, '.worktreeinclude'))) return 0;
  const listed = await hostGit(['ls-files', '-z', '--others', '--ignored', '--exclude-from=.worktreeinclude'], root);
  const ignored = listed && await hostGit(['check-ignore', '-z', '--stdin'], root, listed).catch(() => '');   // git ends with 1 when none of them is ignored
  if (!ignored) return 0;
  await inBox(box, ['sh', '-c', 'xargs -0 -r cp --parents -t "$1"', 'sh', work], { cwd: '/src', input: ignored, timeout: 300000 });
  // In the folder they are ignored, which may be by a rule that the clone does not have (the folder's own
  // .git/info/exclude, the owner's global list). The clone is told to ignore each by name, so that none shows
  // as a change there, and none is committed by a session that adds everything.
  const files = ignored.split('\0').filter(Boolean);
  await inBox(box, ['sh', '-c', 'cat >> "$1/.git/info/exclude"', 'sh', work], { input: lib.excludeLines(files) });
  return files.length;
}

// What a new container gets before its session starts: the configuration, and the folder as a clone on a new
// branch. origin: the address to push to. identity: git's user.name and user.email for this folder.
// say: told what is going on, for the card.
async function fill(box, { root, work, branch, origin, identity, configDir, say = () => {} }) {
  // What the session before it at this number left in its Docker goes. The images it pulled stay.
  await inBox(box, ['sh', '-c', 'docker rm -f $(docker ps -aq) >/dev/null 2>&1; docker volume prune -af >/dev/null 2>&1; docker network prune -f >/dev/null 2>&1; true'], { timeout: 120000 });
  // For a folder's first container, Docker made the folders above the memory's mount, in the shared volume and
  // as root. Claude Code keeps the session's conversation in the one right above, as the session's user.
  await inBox(box, ['sh', '-c', 'chown agent:agent "$1" "$1/.."', 'sh', path.posix.dirname(memoryIn(work))], { root: true });
  await copyConfig(box, configDir);
  say('Cloning the folder into the container…');
  const git = (args, opts) => inBox(box, ['git', ...args], { cwd: work, ...opts });
  await inBox(box, ['git', 'clone', '-q', '/src', work], { timeout: 900000 });
  await git(['remote', 'set-url', 'origin', origin]);
  for (const [key, value] of identity) await git(['config', key, value]);
  // As for a worktree made by `claude -w`: a new branch from the default branch as the remote has it now. Without
  // an answer from the remote (no network, no login yet) it starts from what the folder on this computer is on.
  const fresh = await git(['fetch', '-q', '--prune', 'origin'], { timeout: 120000 }).then(() => git(['remote', 'set-head', 'origin', '-a'], { timeout: 60000 })).then(() => true, () => false);
  if (!fresh) say('The remote did not answer, so this session starts from what the folder on this computer is on.');
  await git(['switch', '-q', '--no-track', '-c', branch, ...(fresh ? ['origin/HEAD'] : [])]);
  // The clone came with a branch of its own: the one the folder on this computer is on. It is not the session's,
  // and commits on it that the folder has not pushed would count as work that is only in this container (see
  // `state`), which they are not. So it goes; the session can have it back from the remote.
  for (const other of (await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).split('\n').map(b => b.trim()).filter(b => b && b !== branch)) await git(['branch', '-q', '-D', other]);
  // The image has the tools that the folder on this computer names. The branch the session works on may name
  // others, or the folder none where the branch does: those are installed here, in the container alone.
  // With nothing missing this takes a fraction of a second.
  await inBox(box, ['mise', 'install'], { cwd: work, timeout: 1800000 }).catch(e => say(`Not all tools that this branch names could be installed: ${e.message}`));
  const copied = await copyIncluded(box, root, work);
  if (copied) say(`Copied ${copied} local file${copied === 1 ? '' : 's'} into the clone, as the folder's .worktreeinclude names them.`);
  // A .env that stays behind is the usual reason a project does not start in its container: say so.
  else if (!fs.existsSync(path.join(root, '.worktreeinclude')) && fs.readdirSync(root).some(n => /^\.env(\.|$)/.test(n) && !/\.(example|sample|template|dist)$/.test(n))) {
    say('This folder has a .env that is not part of the clone, and no list of local files to copy. Name them under the settings, as "Local files to copy".');
  }
}

// What a container's clone holds that is nowhere else, the way a worktree's row says it: changes that are not
// committed, and commits that are not pushed.
async function state(box, work) {
  const git = args => inBox(box, ['git', ...args], { cwd: work, timeout: 30000 });
  const row = {};
  try {
    row.branch = (await git(['branch', '--show-current'])).trim() || null;
    row.changed = (await git(['status', '--porcelain'])).split('\n').filter(Boolean).length;
    row.unique = Number(await git(['rev-list', '--count', '--branches', '--not', '--remotes']));
    row.last = (await git(['log', '-1', '--format=%cr%x09%s'])).trim();
  } catch (e) { row.error = e.message.split('\n')[0]; }
  return row;
}

// Whether GitHub's login is in the volume. Only the exit code leaves the container.
const signedIn = box => inBox(box, ['sh', '-c', 'gh auth token >/dev/null 2>&1'], { timeout: 20000 }).then(() => true, () => false);

// The arguments for `docker` that give a terminal inside a container, in the folder `work`.
const terminal = (box, work, argv) => ['exec', '-it', '-u', 'agent', ...(work ? ['-w', work] : []), '-e', 'TERM=xterm-256color', '-e', 'COLORTERM=truecolor', box, ...argv];

// The ports of a container and the port on this computer that Docker gave each. They change with every start.
const ports = async box => lib.parsePorts(await docker(['port', box]).catch(() => ''));
const stats = async names => lib.parseBoxStats(await docker(['stats', '--no-stream', '--format', '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.PIDs}}', ...names], { timeout: 30000 }));
const exists = box => docker(['container', 'inspect', '--format', '{{.Id}}', box]).then(() => true, () => false);
const start = box => docker(['start', box]);
// Another memory ceiling for containers that exist, running or not. The ceiling with swap goes along: Docker
// had set it to twice the memory when the container was made, and refuses a memory above it.
const resize = (names, memoryGb) => (names.length ? docker(['update', '--memory', `${memoryGb}g`, '--memory-swap', `${2 * memoryGb}g`, ...names]) : Promise.resolve());
// What the app's containers, their volumes and their image take on the disk (see lib.boxDisk). Docker needs
// two to three seconds for this.
const disk = async () => lib.boxDisk(await docker(['system', 'df', '-v', '--format', 'json'], { timeout: 60000 }), PREFIX);
// Stopped, a container keeps what is in it and runs nothing.
const stop = names => (names.length ? docker(['stop', '-t', '5', ...names], { timeout: 120000 }) : Promise.resolve());
// The same when the app is closing, which does not wait for it.
const stopBehind = names => { if (names.length) spawn('docker', ['stop', '-t', '5', ...names], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); };
// The volume of its Docker's images is left, for the next session at that number.
const remove = box => docker(['rm', '-f', '-v', box], { timeout: 120000 });

module.exports = { recipe, nameOf, numberOf, memoryIn, docker, inBox, info, toolFiles, tagOf, image, list, create, ready, copyConfig, fill, state, signedIn, terminal, ports, stats, resize, disk, exists, start, stop, stopBehind, remove };
