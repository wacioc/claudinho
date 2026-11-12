/* global api, Terminal, FitAddon */
// Renderer: five views (instances, worktrees, issues, pull requests, .claude) drawn from the state the main
// process pushes.

const $ = s => document.querySelector(s);

// h('tag.class', { props, onclick }, ...children). Children are appended as text nodes, never parsed as
// HTML, so untrusted strings (issue titles, file names, env values) cannot become markup.
function h(spec, props, ...kids) {
  const [tag, ...cls] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) { kids.unshift(props); props = {}; }
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat(2).filter(k => k != null && k !== false && k !== ''));
  return el;
}

let state = { instances: [], external: [], queue: [], settings: {}, repo: null };
const terms = new Map();     // instance id -> { term, fit, card, wrap, host, p, inst }
const backlog = new Map();   // PTY output that arrived before its terminal existed
let detailId = null, openWhenReady = null, shownRepo;
let issues = [], issuesFor = null, lastIdx = null;
const selected = new Set();
let configFiles = [], openFile = null, dirty = false, declined = '';
const prefs = { model: 'opus', effort: 'xhigh', level: 'manual', hideOutside: false };   // claude_worktree's defaults; the Instances filter
try { Object.assign(prefs, JSON.parse(localStorage.getItem('prefs') || '{}')); } catch { /* keep defaults */ }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 7000);
}
const errText = e => String(e.message).replace(/^Error invoking remote method 'rpc': (Error: )?/, '');
async function call(name, ...args) {
  try { return await api.call(name, ...args); }
  catch (e) { toast(errText(e)); throw e; }
}

function fmtDur(ms) {
  const m = Math.floor(ms / 60000), hrs = Math.floor(m / 60), d = Math.floor(hrs / 24);
  if (d) return `${d}d ${hrs % 24}h`;
  if (hrs) return `${hrs}h ${String(m % 60).padStart(2, '0')}m`;
  return m ? `${m}m` : `${Math.max(0, Math.floor(ms / 1000))}s`;
}
const fmtTokens = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n || 0));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmtBytes = n => (n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(1)} GB` : `${Math.round(n / 2 ** 20)} MB`);
const pct = share => `${Math.round(Math.min(1, share) * 100)}%`;
// CPU history as block characters. Square-root scale, so one busy core out of sixteen still shows up next
// to a burst that fills the machine.
const spark = hist => hist.map(v => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(Math.sqrt(Math.min(1, v)) * 8))]).join('');

// CPU and memory of a session's whole process tree: Claude Code itself plus everything it started.
// `limit` is the share of the machine the instance is held to right now (1 = no limit; see Settings).
function procChips(u, limit) {
  if (!u) return [];
  const limited = limit < 0.995;
  return [
    h('span', {
      // Worth a glance: a session holding half the machine, or one pressed against its own limit.
      className: `chip${u.cpu >= 0.5 || (limited && u.cpu >= 0.8 * limit) ? ' warn' : ''}`,
      title: `Share of all ${state.cores} cores used by this session and the processes it started. Peak ${pct(Math.max(...u.hist))} in the last ${u.hist.length * 2} s.${limited ? ` Held to ${pct(limit)} right now.` : ''}`,
    }, `cpu ${pct(u.cpu)}${limited ? ` of ${pct(limit)}` : ''} ${spark(u.hist.slice(-12))}`),
    h('span.chip', { title: `Memory held by ${u.count} process${u.count === 1 ? '' : 'es'}` }, `mem ${fmtBytes(u.mem)}`),
  ];
}
function renderProcs(el, u, limit) {
  if (!u) return el.replaceChildren(h('div.hint', 'No sample yet.'));
  el.replaceChildren(
    h('dl',
      h('dt', 'CPU'), h('dd', `${pct(u.cpu)} of ${state.cores} cores${limit < 0.995 ? `, held to ${pct(limit)}` : ''}`),
      h('dt', 'Peak'), h('dd', `${pct(Math.max(...u.hist))} in the last ${u.hist.length * 2} s`),
      h('dt', 'History'), h('dd', spark(u.hist)),
      h('dt', 'Memory'), h('dd', `${fmtBytes(u.mem)} in ${u.count} process${u.count === 1 ? '' : 'es'}`)),
    h('table', u.top.map(p => h('tr', h('td', p.n > 1 ? `${p.name} ×${p.n}` : p.name), h('td.num', pct(p.cpu)), h('td.num', fmtBytes(p.mem)))),
      u.more > 0 && h('tr', h('td', { colSpan: 3 }, `and ${u.more} more`))));
}

// ---------- dialogs ----------

// fields: { key, label, type: text|number|select|checkbox|textarea|static, value, options, hint, ...input props }
// submit: an async call made with the values before the dialog closes. If it fails, the dialog stays open and
// says why, so that what was typed is not lost.
function formDialog(title, fields, ok = 'OK', submit) {
  return new Promise(resolve => {
    const dlg = $('#dlg'), inputs = {}, error = h('div.loss'), okBtn = h('button.primary', { type: 'submit' }, ok);
    const rows = fields.filter(Boolean).map(({ key, label, type, value, options, hint, ...rest }) => {
      let el;
      if (type === 'static') el = h('div.static', [].concat(value).map(line => h('div', line)));
      else if (type === 'select') el = h('select', rest, options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)));
      else if (type === 'textarea') el = h('textarea', { value: value || '', maxLength: 8000, ...rest });
      else if (type === 'checkbox') el = h('input', { type, checked: !!value, ...rest });
      else el = h('input', { type, value: value == null ? '' : value, ...rest });
      if (key) inputs[key] = el;
      return h('label.row', h('span', label), el, hint && h('small', hint));
    });
    const done = v => { dlg.close(); resolve(v); };
    dlg.replaceChildren(h('form', {
      onsubmit: async e => {
        e.preventDefault();
        const v = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim()]));
        if (submit) {
          okBtn.disabled = true; error.textContent = '';
          try { await submit(v); } catch (err) { error.textContent = errText(err); return; } finally { okBtn.disabled = false; }
        }
        done(v);
      },
    }, h('h2', title), rows, error, h('div.actions', h('button', { type: 'button', onclick: () => done(null) }, 'Cancel'), okBtn)));
    dlg.oncancel = () => resolve(null);   // Esc
    dlg.showModal();
    const first = dlg.querySelector('input, select, textarea');
    if (first) first.focus();
  });
}

const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'].map(e => [e, e || 'default']);
const LEVELS = [['manual', 'Manual: always wait for me'], ['timed', 'Timed: wait, then take the recommended option'], ['auto', 'Auto: take the recommended option at once']];
// Who merges a session's pull request: the same choice wherever a session is started, and on its card.
const AUTONOMY = [['manual', 'Manual: nothing gets merged automatically'], ['semi', 'Semi-auto: the agent merges if it judges it safe'], ['full', 'Full-auto: the app merges the PR once the agent says it is ready']];
const autonomyField = () => ({ key: 'autonomy', label: 'Autonomy', type: 'select', value: 'manual', options: AUTONOMY });
const MERGE_CHIP = { manual: 'manual merge', semi: 'semi-auto merge', full: 'auto-merge' };
const MODELS = ['fable', 'opus', 'sonnet', 'haiku'];
const launchFields = () => [
  { key: 'model', label: 'Model', type: 'select', value: MODELS.includes(prefs.model) ? prefs.model : 'opus', options: MODELS.map(m => [m, m]) },
  { key: 'effort', label: 'Effort', type: 'select', value: prefs.effort, options: EFFORTS },
  { key: 'level', label: 'When input is needed', type: 'select', value: prefs.level, options: LEVELS, hint: `Covers Claude's questions and tool-permission prompts. Timed waits ${state.settings.timedMinutes} min.` },
];
// v: what a start dialog returned; without it, `prefs` is stored as it is.
function savePrefs(v) {
  Object.assign(prefs, v && { model: v.model, effort: v.effort, level: v.level });
  try { localStorage.setItem('prefs', JSON.stringify(prefs)); } catch { /* not persisted this time */ }
}

// ---------- groups ----------

// A group is a name that sessions share. Its colour is worked out from the name, so it is the same after a
// restart and on every card.
function groupColor(name) {
  let hue = 0;
  for (const ch of name) hue = (hue * 31 + ch.codePointAt(0)) % 360;
  return `hsl(${hue} 70% 68%)`;
}
const groupChip = name => h('span.group', { title: `Group: ${name}`, style: `--group:${groupColor(name)}` }, name);
// The stripe in the group's colour down the side of a card.
function stripe(card, group) {
  card.classList.toggle('grouped', !!group);
  card.style.setProperty('--group', group ? groupColor(group) : '');
}

// ---------- notifications ----------

// The tray icon: the app's mark, or the number of new notifications in a red circle. The window draws it,
// because the main process has nothing to draw text with. One picture per screen scale, 16 px at 100%.
function trayImages(count) {
  return [1, 1.25, 1.5, 2, 3].map(scale => {
    const size = Math.round(16 * scale), c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const text = !count ? 'c' : count > 9 ? '9+' : String(count);
    g.fillStyle = count ? '#e5484d' : '#11151c';
    g.beginPath();
    if (count) g.arc(size / 2, size / 2, size / 2, 0, 2 * Math.PI); else g.roundRect(0, 0, size, size, size * 0.22);
    g.fill();
    g.fillStyle = count ? '#fff' : '#e6b450';
    g.font = `bold ${Math.round(size * (text.length > 1 ? 0.58 : 0.78))}px "Segoe UI", system-ui, sans-serif`;
    g.fillText(text, size / 2, size * 0.54);
    return [scale, c.toDataURL('image/png')];
  });
}

const NOTE_MARKS = { input: '?', auto: '»', done: '✓', update: '⬆', app: '⬆', merge: '↩' };
let shownFresh = -1;
function renderBell() {
  const fresh = (state.notifications || []).filter(n => !n.seen).length;
  if (fresh === shownFresh) return;
  shownFresh = fresh;
  $('#n-bell').textContent = fresh > 99 ? '99+' : fresh;
  $('#n-bell').hidden = !fresh;
  $('#btn-bell').title = fresh ? plural(fresh, 'new notification') : 'Notifications';
  api.call('tray', trayImages(fresh), fresh).catch(() => {});   // a system without a tray: the bell still counts
}

// The list behind the bell, newest first. Opening it is what makes its entries no longer new.
function openNotes() {
  const list = (state.notifications || []).slice().reverse();
  $('#notes').replaceChildren(h('div.notes-head', 'Notifications'), ...(list.length ? list.map(n => h('div', {
    className: `note ${n.kind}${n.seen ? '' : ' fresh'}`,
    title: n.kind === 'update' ? 'Run `claude update`' : n.kind === 'app' ? 'Install it and restart' : terms.has(n.inst) ? 'Show this instance' : '',
    onclick: () => {
      $('#notes').hidden = true;
      if (n.kind === 'update') updateClaude();
      else if (n.kind === 'app') updateApp();
      else if (terms.has(n.inst)) { show('instances'); openDetail(n.inst); }
    },
  }, h('span.mark', NOTE_MARKS[n.kind]), h('div', n.label && h('b', `${n.label} `), n.text, h('div.hint', new Date(n.at).toLocaleTimeString()))))
    : [h('div.empty', 'Nothing yet. A session that asks for input, or is done, shows up here.')]));
  $('#notes').hidden = false;
  if (list.some(n => !n.seen)) call('seen');
}

async function updateClaude() {
  toast('Running `claude update`…');
  const line = await call('updateClaude');
  if (line) toast(line);
}

// The button on a card whose session is done and whose pull request is open: a draft is marked ready for
// review, anything else is merged, after a question, since a merge cannot be taken back.
async function prAct(id) {
  const inst = state.instances.find(i => i.id === id);
  if (!inst || !inst.pr) return;
  const { number, draft } = inst.pr;
  if (!draft && !confirm(`Merge pull request #${number} of ${inst.label}?`)) return;
  await call('prAct', id, draft ? 'ready' : 'merge');
  toast(draft ? `Pull request #${number} is ready for review` : `Pull request #${number} is merged`);
}

// The app replaces itself with the newer release and starts again, which stops whatever runs in it.
function updateApp() {
  const up = state.update;
  if (!up || /^downloading/.test(up.state || '')) return;
  const live = state.instances.filter(i => !i.exited).length;
  if (live && !confirm(`Installing claudinho ${up.latest} restarts the app and stops ${plural(live, 'running Claude Code instance')}.\n\nAfter the restart each one can be resumed where it left off. Install now?`)) return;
  call('updateApp');
}

// ---------- top bar ----------

function usageWin(label, w, at) {
  if (!w || w.resets_at * 1000 < Date.now()) return h('span.usage-win', `${label} –`);   // no data, or that window already reset
  const pct = Math.round(w.used_percentage), filled = Math.min(10, Math.max(0, Math.floor(pct / 10)));
  return h('span', {
    className: `usage-win ${pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok'}${Date.now() - at > 15 * 60000 ? ' stale' : ''}`,
    title: `Resets ${new Date(w.resets_at * 1000).toLocaleString()}. Reported by Claude Code ${fmtDur(Date.now() - at)} ago.`,
  }, `${label} ${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${pct}% ↻ ${fmtDur(w.resets_at * 1000 - Date.now())}`);
}

function renderTop() {
  const r = state.repo, a = state.account, u = state.usage;
  $('#version').textContent = state.version ? `v${state.version}` : '';
  // The app itself: a button when a newer release is out, which says how the download is going once pressed.
  const up = state.update;
  $('#btn-update-app').hidden = !up;
  if (up) {
    const failed = /^failed/.test(up.state || '');
    $('#btn-update-app').disabled = !!up.state && !failed;
    $('#btn-update-app').textContent = up.state && !failed ? `⬆ ${up.state}…` : `⬆ v${up.latest}`;
    $('#btn-update-app').title = failed ? `The update ${up.state}. Press to try again.` : `claudinho ${up.latest} is out. Press to install it: the app restarts, and sessions that are running are stopped and can be resumed.`;
  }
  $('#repo-name').replaceChildren(...(r ? [h('b', `📁 ${r.name}`), `  ${r.path}`] : ['No folder open']));
  $('#repo-name').title = r ? r.path : '';
  $('#account').textContent = !state.claudeFound ? 'Claude Code CLI not found on PATH'
    : a && a.loggedIn ? `✉ ${a.email}${a.subscriptionType ? ` · ${a.subscriptionType}` : ''}` : 'Not logged in: run `claude` and /login';
  $('#usage').replaceChildren(...(u ? [usageWin('5h', u.five_hour, u.at), usageWin('7d', u.seven_day, u.at)]
    : [h('span.hint', '5h / 7d usage shows up after an instance gets its first reply')]));
  // Claude Code itself: the version installed, and a button when a newer one is out.
  const cc = state.claude || {};
  $('#claude-version').textContent = cc.version ? `Claude Code ${cc.version}` : '';
  $('#btn-update').hidden = !cc.latest && !cc.updating;
  $('#btn-update').disabled = !!cc.updating;
  $('#btn-update').textContent = cc.updating ? '⬆ updating…' : `⬆ ${cc.latest}`;
  $('#btn-update').title = `Claude Code ${cc.latest} is out. Press to run \`claude update\`. Sessions that are running keep the version they started with.`;
  renderBell();
  $('#btn-new').disabled = !r || !state.claudeFound;
  $('#btn-worktree').disabled = !r || !r.isGit || !state.claudeFound;
  if (!r) return $('#setup').replaceChildren();
  $('#setup').replaceChildren(h('span.chip', r.github ? `GitHub ${r.github.owner}/${r.github.name}` : r.isGit ? 'git, no GitHub remote' : 'plain folder'));
  $('#worktrees').replaceChildren(...r.worktrees.filter(w => !w.main).map(w => h('option', { value: w.path.split(/[\\/]/).pop() })));
}

// ---------- instances ----------

const THEME = { background: '#0b0e14', foreground: '#c9d1d9', cursor: '#e6b450', selectionBackground: '#3a4a63' };
const IS_MAC = navigator.platform.startsWith('Mac');

function statusOf(i) {
  if (i.exited) return { text: `exited${i.exitCode ? ` (${i.exitCode})` : ''}`, cls: 'off' };
  if (i.pending.length) return { text: 'needs input', cls: 'wait' };
  if (i.starting) return { text: 'starting', cls: 'busy' };   // a new worktree, still running its SessionStart hooks
  const s = i.session.status;
  if (s === 'waiting') return { text: `needs input${i.session.waitingFor ? `: ${i.session.waitingFor}` : ''}`, cls: 'wait' };
  if (s === 'busy') return { text: 'working', cls: 'busy' };
  if (s === 'idle') return { text: i.pr ? 'finished' : 'idle', cls: 'idle' };
  return { text: s || 'starting', cls: 'off' };
}

// Windows/Linux terminal conventions: Ctrl+C copies when text is selected (else it interrupts), Ctrl+V pastes.
// macOS uses Cmd+C / Cmd+V through the app menu.
function termKeys(e, term) {
  if (IS_MAC || e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey) return true;
  if (e.code === 'KeyC' && (e.shiftKey || term.hasSelection())) {
    e.preventDefault(); call('clipWrite', term.getSelection()); term.clearSelection(); return false;
  }
  if (e.code === 'KeyV') { e.preventDefault(); call('clipRead').then(text => term.paste(text)); return false; }
  return true;
}

function layout(t) {
  if (!t.wrap.clientWidth) return;                                   // its tab is hidden
  if (t.inst.id === detailId) { t.host.style.cssText = ''; t.wrap.style.height = ''; t.fit.fit(); return; }
  // Grid: a scaled-down picture of the terminal. The PTY keeps its size, so Claude's TUI does not reflow.
  const screen = t.host.querySelector('.xterm-screen');
  if (!screen || !screen.offsetWidth) return;
  const s = Math.min(1, t.wrap.clientWidth / screen.offsetWidth);
  t.host.style.cssText = `width:${screen.offsetWidth}px;height:${screen.offsetHeight}px;transform:scale(${s});transform-origin:0 0`;
  t.wrap.style.height = `${Math.ceil(screen.offsetHeight * s)}px`;
}
const layoutSoon = t => requestAnimationFrame(() => layout(t));

function createCard(inst) {
  const term = new Terminal({ cols: 110, rows: 30, fontFamily: '"Cascadia Mono", Consolas, Menlo, "DejaVu Sans Mono", monospace', fontSize: 13, scrollback: 5000, cursorBlink: true, theme: THEME });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  const host = h('div.term-host'), wrap = h('div.term-wrap', host);
  const p = {
    title: h('span.title'), group: h('span.group'), badge: h('span.badge'), chips: h('span.chips-in'), up: h('span.chip'), pending: h('div.pending'),
    // The session's issue and its pull request, each a button that opens it on GitHub. They stay in place while
    // the chips beside them are built anew with every state: a button that is replaced under a click loses it.
    issueBtn: h('button', { hidden: true, onclick: e => { e.stopPropagation(); call('openUrl', t.inst.issueUrl); } }),
    prLink: h('button', { hidden: true, onclick: e => { e.stopPropagation(); call('openUrl', t.inst.pr.url); } }),
    done: h('span.tick', { title: 'Done: its last turn has ended, nothing it started is still running, and nothing has been asked of it since.' }, '✓'),
    prBtn: h('button.pr-act', { hidden: true, onclick: e => { e.stopPropagation(); prAct(inst.id); } }),
    info: h('dl'), env: h('div.env'), procs: h('div.procs'), audit: h('div.audit'),
    // The detail view's two tabs: the session's terminal, and the diff of its pull request.
    tabs: h('div.tabs', h('button.active', { onclick: () => { showTab(t, 'term'); term.focus(); } }, 'Terminal'), h('button', { onclick: () => showTab(t, 'diff') }, 'Diff')),
    diff: h('div.diff', { hidden: true }),
    groupIn: h('input', { type: 'text', list: 'groups', maxLength: 40, placeholder: 'none', title: 'Sessions with the same group name are marked as belonging together. Clear the name to take this one out of its group.',
      onchange: e => call('setInstance', inst.id, { group: e.target.value }) }),
    merge: h('select', { onchange: e => call('setInstance', inst.id, { autonomy: e.target.value }) }, AUTONOMY.map(([v, text]) => h('option', { value: v }, text))),
    level: h('select', { onchange: e => call('setInstance', inst.id, { level: e.target.value }) }, LEVELS.map(([v, text]) => h('option', { value: v }, text))),
    filter: h('input', { type: 'search', placeholder: 'filter by name…', oninput: () => renderEnv(t) }),
    weight: h('select', { title: 'Counts when "Share the CPU between instances by weight" is on in Settings.', onchange: e => call('setInstance', inst.id, { weight: e.target.value }) },
      [['low', 'Low: half a share'], ['normal', 'Normal'], ['high', 'High: a double share']].map(([v, text]) => h('option', { value: v }, text))),
  };
  p.meta = h('div.meta', p.issueBtn, p.prLink, p.chips);
  const card = h('article.card', { onclick: e => { if (detailId !== inst.id && !e.target.closest('button, .pending-box')) openDetail(inst.id); } },
    h('div.head', p.done, p.title, p.group, p.badge, h('span.spacer'), p.prBtn,
      h('button.back', { onclick: e => { e.stopPropagation(); closeDetail(); } }, '← All instances'),
      h('button.x', { title: 'Stop and remove', onclick: e => { e.stopPropagation(); closeInstance(inst.id); } }, '✕')),
    p.meta, p.pending, p.tabs,
    h('div.body', wrap, p.diff, h('aside.side',
      h('h3', 'Session'), p.info,
      h('label', 'Group ', p.groupIn),
      h('h3', 'Input requests'), p.audit,
      h('h3', 'CPU and memory'), p.procs,
      h('label', 'CPU weight ', p.weight),
      h('h3', 'Automation'),
      h('label', 'Autonomy ', p.merge),
      h('label', 'When input is needed ', p.level),
      h('h3', 'Environment variables'), p.filter, p.env)));
  $('#grid').append(card);
  term.open(host);
  term.onData(d => api.write(inst.id, d));
  term.onResize(({ cols, rows }) => api.resize(inst.id, cols, rows));
  term.attachCustomKeyEventHandler(e => termKeys(e, term));
  if (backlog.has(inst.id)) { term.write(backlog.get(inst.id)); backlog.delete(inst.id); }
  const t = { term, fit, card, wrap, host, p, inst };
  t.observer = new ResizeObserver(() => layoutSoon(t));
  t.observer.observe(wrap);
  t.observer.observe(host.querySelector('.xterm-screen'));
  terms.set(inst.id, t);
  return t;
}

function infoRows(i) {
  const s = i.status || {};
  return [
    ['Status', statusOf(i).text],
    ['Still running', i.background && i.background.detail.split('\n').map(line => h('div', line))],
    ['Folder', i.cwd],
    ['Branch', s.branch],
    ['Model', [s.model || i.model, s.effort || i.effort].filter(Boolean).join(' · ')],
    ['Context', s.ctxPct != null && `${Math.round(s.ctxPct)}% used: ${fmtTokens(s.ctxTokens)} of ${fmtTokens(s.ctxSize)} tokens`],
    ['API cost', s.cost != null && `$${s.cost.toFixed(4)} equivalent at list price`],
    ['Lines', (s.added || s.removed) && `+${s.added || 0} −${s.removed || 0}`],
    ['Started', new Date(i.startedAt).toLocaleTimeString()],
    ['Session', i.session.name || s.sessionId],
    ['Issue', i.issue && (i.issueUrl ? h('a', { onclick: () => call('openUrl', i.issueUrl) }, `#${i.issue}`) : `#${i.issue}`)],
    ['PR', i.pr && h('a', { onclick: () => call('openUrl', i.pr.url) }, `#${i.pr.number}${i.merge ? ` (${i.merge})` : ''}`)],
  ];
}

function renderPending(t, inst) {
  const p = inst.pending[0];
  if (!p) { t.pendingId = null; t.p.pending.replaceChildren(); return; }
  if (t.pendingId === p.id) return;                 // keep half-made choices while state refreshes
  t.pendingId = p.id;
  const send = choice => call('answer', inst.id, p.id, choice);
  const answers = {};
  const body = p.kind === 'permission'
    ? [h('div.q', `Claude wants to use ${p.tool}:`), h('pre', p.detail),
      h('button.primary', { onclick: () => send('recommended') }, 'Approve'), h('button', { onclick: () => send('deny') }, 'Deny')]
    : p.questions.flatMap(q => [h('div.q', q.question), h('div.opts', q.options.map(o => h('button', {
      className: o.label === q.recommended ? 'primary' : '', title: o.description || '',
      onclick: e => {
        answers[q.question] = o.label;
        for (const b of e.target.parentNode.children) b.classList.toggle('chosen', b === e.target);
        if (Object.keys(answers).length === p.questions.length) send({ answers });
      },
    }, o.label)))]);
  t.p.pending.replaceChildren(h('div.pending-box', body,
    h('button.link', { onclick: () => send('terminal') }, 'Answer in the terminal instead'),
    inst.pending.length > 1 && h('span.hint', `+${inst.pending.length - 1} more`),
    h('span.countdown', { 'data-deadline': p.deadline })));
}

// order: where the card sits in the grid. A group's cards share one, so they sit next to each other.
function updateCard(t, inst, order) {
  if (t.tab === 'diff' && inst.done && !t.inst.done) loadDiff(t);   // its turn has just ended: what it did should show
  t.inst = inst;
  t.p.tabs.children[1].textContent = inst.pr ? 'Diff (git)' : 'Diff (local)';   // the pull request as GitHub has it, or the folder's own diff until there is one
  const st = statusOf(inst), s = inst.status || {};
  t.p.title.textContent = `${inst.worktree ? '🌳' : '📁'} ${inst.label}`;
  t.p.title.title = inst.cwd;
  t.p.group.textContent = inst.group || '';
  t.p.group.hidden = !inst.group;
  t.p.group.title = `Group: ${inst.group}`;
  stripe(t.card, inst.group);
  t.card.style.order = order;
  if (document.activeElement !== t.p.groupIn) t.p.groupIn.value = inst.group || '';
  t.p.done.hidden = !inst.done;
  t.card.classList.toggle('done', !!inst.done);
  if (detailId === inst.id && t.auditRev !== inst.auditRev) loadAudit(t);
  t.p.badge.textContent = st.text;
  t.p.badge.className = `badge ${st.cls}`;
  t.p.badge.title = inst.starting ? 'Its first prompt has not gone in yet: Claude Code is still running the SessionStart hooks of this new worktree. Issues that are queued wait for it.' : '';
  t.card.classList.toggle('attention', st.cls === 'wait');
  // Its work is done and its pull request is still open: the owner can mark a draft ready, or merge, from here.
  const pr = inst.pr && inst.pr.state === 'OPEN' && (inst.done || inst.exited) ? inst.pr : null;
  t.p.prBtn.hidden = !pr;
  if (pr) {
    t.p.prBtn.textContent = pr.draft ? 'Mark ready for review' : 'Merge PR';
    t.p.prBtn.title = pr.draft ? `Pull request #${pr.number} is a draft: mark it as ready for review` : `Merge pull request #${pr.number} (${state.settings.mergeMethod})`;
  }
  t.p.issueBtn.hidden = !inst.issue;
  t.p.issueBtn.textContent = `#${inst.issue}`;
  t.p.issueBtn.disabled = !inst.issueUrl;   // on record without its address, and not of the folder that is open
  t.p.issueBtn.title = inst.issueUrl ? `Issue #${inst.issue}: open it on GitHub` : `Issue #${inst.issue}`;
  t.p.prLink.hidden = !inst.pr;
  if (inst.pr) {
    // With the merge state in a word or two ("merged", "not merged", "follow-up 1 of 3"). What follows its colon
    // is the reason: the tooltip here, and in full in the detail view's PR row.
    t.p.prLink.textContent = `PR #${inst.pr.number}${inst.merge ? ` ${inst.merge.split(':')[0]}` : inst.pr.state === 'CLOSED' ? ' closed' : inst.pr.draft ? ' draft' : ''}`;
    t.p.prLink.title = `${inst.merge ? `${inst.merge}\n` : ''}Pull request #${inst.pr.number}: open it on GitHub`;
  }
  t.p.chips.replaceChildren(...[
    [s.model || inst.model || 'default model', s.effort || inst.effort].filter(Boolean).join(' · '),
    s.ctxPct != null ? `ctx ${Math.round(s.ctxPct)}% of ${fmtTokens(s.ctxSize)}` : 'ctx –',
    s.cost != null ? `$${s.cost.toFixed(2)}` : '$ –',
    // Who merges its pull request, unless that is you. A session that has not heard of a change yet says so.
    (inst.autonomy !== 'manual' || inst.untold) && h('span', { className: inst.untold ? 'chip warn' : 'chip',
      title: inst.untold ? 'The session has not been told yet. It is, with its next prompt or tool call.' : '' }, `${MERGE_CHIP[inst.autonomy]}${inst.untold ? ' · not told yet' : ''}`),
    inst.level !== 'manual' && `input: ${inst.level}`,
    // Its turn has ended, but it is not done: what it started is still running, and it carries on when that ends.
    inst.background && h('span.chip', { title: `The session's turn has ended, with this still running:\n${inst.background.detail}\nIt is done when nothing is.` }, `still running: ${inst.background.text}`),
  ].filter(Boolean).map(c => (typeof c === 'string' ? h('span.chip', c) : c)), ...procChips(inst.procs, inst.limit), t.p.up);
  renderProcs(t.p.procs, inst.procs, inst.limit);
  if (document.activeElement !== t.p.weight) t.p.weight.value = inst.weight;
  renderPending(t, inst);
  if (document.activeElement !== t.p.level) t.p.level.value = inst.level;
  if (document.activeElement !== t.p.merge) t.p.merge.value = inst.autonomy;
  t.p.info.replaceChildren(...infoRows(inst).flatMap(([k, v]) => (v ? [h('dt', k), h('dd', v)] : [])));
}

const SECRET = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH/i;
function renderEnv(t) {
  const f = t.p.filter.value.toLowerCase();
  t.p.env.replaceChildren(...(t.envRows || []).filter(r => r.name.toLowerCase().includes(f)).map(r => {
    // Secrets stay masked until clicked, so a screenshot or a screen share does not leak them.
    const masked = SECRET.test(r.name) && r.value !== '';
    const val = h('span', { className: masked ? 'secret' : '', title: masked ? 'click to reveal' : '', onclick: () => { val.textContent = r.value; val.className = ''; } }, masked ? '••••••••' : r.value);
    return h('div', h('b', r.name, r.source === 'settings' && h('i', ' (settings)')), val);
  }));
}

// The record of a session's input requests, newest first: what was asked, what was on offer, which option the
// app would pick, which one was picked, and how.
const HOW = { manual: 'manual', timed: 'timed expired, auto picked', auto: 'auto' };
function loadAudit(t) {
  t.auditRev = t.inst.auditRev;
  call('audit', t.inst.id).then(rows => t.p.audit.replaceChildren(...(rows.length ? [h('div.hint', '✓ picked   ★ recommended'), ...rows.reverse().map(e => h('div.audit-row',
    h('div.hint', `${new Date(e.at).toLocaleTimeString()} · ${e.kind === 'question' ? 'question' : 'tool call'} · ${e.picked ? HOW[e.how] : 'no answer yet'}`),
    h('div.ask', e.ask),
    h('div.opts', e.options.map(o => h('span', { className: `opt${o === e.picked ? ' picked' : ''}` }, o === e.picked && '✓ ', o, o === e.recommended && h('i', ' ★')))),
    e.picked && !e.options.includes(e.picked) && h('div.hint', e.picked === 'dismissed' ? 'dismissed without an answer' : `picked: ${e.picked}`)))]
    : [h('div.hint', 'None so far: this session has not asked a question or for a permission.')])));
}

function openDetail(id) {
  const t = terms.get(id);
  if (!t) return;
  if (detailId) closeDetail();
  detailId = id;
  loadAudit(t);
  $('#view-instances').classList.add('detail');
  t.card.classList.add('detail');
  renderSessions();
  layoutSoon(t);
  t.term.focus();
  t.envRows = null;
  t.p.env.replaceChildren('loading…');
  call('env', id).then(rows => { t.envRows = rows; renderEnv(t); });
}
function closeDetail() {
  const t = terms.get(detailId);
  detailId = null;
  $('#view-instances').classList.remove('detail');
  if (t) { t.card.classList.remove('detail'); showTab(t, 'term'); }
  terms.forEach(layoutSoon);
}

// ---------- the detail view's list of sessions ----------

const groupNames = () => [...new Set(state.instances.map(i => i.group).filter(Boolean))].sort((a, b) => a.localeCompare(b));

// Beside the session on show: every instance with its name and its status, in the order of the wall, the one
// on show marked. A click goes to that session and keeps the tab, so each session's terminal, or each one's
// diff, is one click from the last.
let shownSessions = '';
function renderSessions() {
  if (!detailId) return;
  const groups = groupNames();
  const rows = state.instances.map(inst => ({ inst, st: statusOf(inst), order: inst.group ? groups.indexOf(inst.group) + 1 : 0 })).sort((a, b) => a.order - b.order);
  const key = JSON.stringify([detailId, rows.map(r => [r.inst.id, r.inst.label, r.inst.group, r.st, !!r.inst.done, r.inst.session.name])]);
  if (key === shownSessions) return;   // unchanged: leave the rows alone, a click may be under way
  shownSessions = key;
  // Sessions in one folder carry the same name: those are told apart by the name Claude Code gave each.
  const twice = new Set(rows.map(r => r.inst.label).filter((label, i, all) => all.indexOf(label) !== i));
  $('#sessions').replaceChildren(...rows.map(({ inst, st }) => {
    const row = h('div', { className: `srow${inst.id === detailId ? ' active' : ''}${st.cls === 'wait' ? ' attention' : ''}`, title: `${inst.cwd}\n${st.text}`, onclick: () => switchTo(inst.id) },
      h('div.name', inst.done && h('span.tick', '✓ '), `${inst.worktree ? '🌳' : '📁'} ${inst.label}`),
      twice.has(inst.label) && inst.session.name && h('div.hint', inst.session.name),
      h('span', { className: `badge ${st.cls}` }, st.text));
    stripe(row, inst.group);
    return row;
  }));
}
function switchTo(id) {
  const from = terms.get(detailId);
  if (id === detailId || !terms.has(id)) return;
  const tab = from && from.tab;
  openDetail(id);
  if (tab === 'diff') { showTab(terms.get(id), 'diff'); terms.get(id).term.blur(); }   // the keyboard stays out of a terminal that is not on show
}

// ---------- the Diff tab ----------

function showTab(t, name) {
  t.tab = name;
  [...t.p.tabs.children].forEach((b, i) => b.classList.toggle('active', (i === 1) === (name === 'diff')));
  t.wrap.hidden = name === 'diff';
  t.p.diff.hidden = name !== 'diff';
  if (name === 'diff') loadDiff(t); else layoutSoon(t);
}

// The pull request of the session's branch as GitHub's "Files changed" has it: what is pushed, against the
// merge base. Until the branch has one, the folder's own diff: what it holds beyond the default branch,
// committed or not. Read-only: the tab shows and links to GitHub, and nothing in it writes anywhere.
async function loadDiff(t) {
  const mine = t.diffLoad = {};
  if (!t.p.diff.firstChild) t.p.diff.replaceChildren(h('div.empty', 'Reading the diff…'));
  if (t.diffAt) t.diffAt.textContent = 'reading…';
  let d;
  try { d = await api.call('prDiff', t.inst.id); } catch (e) { d = { error: errText(e) }; }
  if (t.diffLoad !== mine) return;                    // a newer read is on its way
  const key = JSON.stringify(d);
  if (key !== t.diffKey) { t.diffKey = key; renderDiff(t, d); }   // nothing new: what is open, and the place in it, stay
  t.diffAt.textContent = `read ${new Date().toLocaleTimeString()}`;
}

function renderDiff(t, d) {
  const box = t.p.diff, known = t.inst.pr;
  t.diffAt = h('span.hint');
  const bar = (...kids) => h('div.diff-bar', kids, h('span.spacer'), t.diffAt, h('button', { onclick: () => loadDiff(t) }, '↻ Refresh'));
  if (!d) return box.replaceChildren(bar(known ? `Pull request #${known.number} could not be read from GitHub just now.` : 'There is nothing to show for this session.'));
  if (d.error) return box.replaceChildren(bar(h('span.loss', d.error)));
  // local: the branch has no pull request yet, and this is the folder's own diff. There is nothing on GitHub to link to.
  const onGitHub = d.local ? null : (text, hash = '') => h('a', { title: 'Opens GitHub in the browser', onclick: () => call('openUrl', `${d.url}/files${hash}`) }, text);
  const files = d.files.map(f => diffFile(f, onGitHub));
  // GitHub's "Jump to": a file's name takes you to its diff.
  const jump = h('select', { onchange: e => { const el = files[e.target.value]; e.target.value = ''; if (el) { el.open = true; el.scrollIntoView(); } } },
    h('option', { value: '' }, `${plural(d.files.length, 'changed file')}…`), d.files.map((f, i) => h('option', { value: i }, `${f.path}   +${f.additions} −${f.deletions}`)));
  const top = box.scrollTop;
  // What the folder's own diff is a diff against, in a few words, and in full as the tooltip.
  const [against, more] = !d.local ? [] : !d.git ? ['not a git repository', 'This folder is not a git repository.']
    : d.against === 'HEAD' ? ['what is not committed', 'No default branch was found to compare with, so this is what the folder holds beyond its last commit.']
      : d.against ? [`compared with ${d.against}`, `What this folder holds beyond ${d.against}: the commits on its branch, what is not committed, and the files git does not know yet.`]
        : ['nothing is committed yet', 'This repository has no commit yet: everything in the folder is new.'];
  box.replaceChildren(...[
    d.local ? bar(h('b', 'No pull request yet'), h('span.hint.diff-title', { title: more }, against), jump, h('span.good', `+${d.additions}`), h('span.loss', `−${d.deletions}`))
      : bar(onGitHub(`#${d.number}`), h('b.diff-title', { title: d.title }, d.title), h('span.chip', d.state === 'OPEN' ? (d.draft ? 'draft' : 'open') : d.state.toLowerCase()),
        jump, h('span.good', `+${d.additions}`), h('span.loss', `−${d.deletions}`)),
    d.partial && h('div.diff-note', 'This pull request is larger than what GitHub hands over, so some of its files come without their diff. ', onGitHub('See all of it on GitHub')),
    d.more > 0 && h('div.diff-note', `${plural(d.more, 'more new file')} that git does not know yet ${d.more === 1 ? 'is' : 'are'} not shown.`),
    !d.files.length && h('div.empty', !d.local ? 'This pull request changes no files.' : d.git ? 'Nothing here differs from that.' : 'There is nothing to compare.'),
    ...files,
  ].filter(Boolean));
  box.scrollTop = top;
}

// One file, open or folded as on GitHub's page. Its rows are built when it is first opened.
// ponytail: all rows of an open file are built and laid out at once, about 0.15 ms a row when measured, and a
// pull request opens up to 20,000 lines by itself (lib.mapDiff): three seconds in which the window, terminals
// included, draws nothing else. If that hurts, draw a file when it scrolls into view; `content-visibility: auto`
// on .diff-file cut the time to a tenth in a first try, which was not looked at on screen.
function diffFile(f, onGitHub) {
  const body = h('div');
  const fill = () => {
    if (body.firstChild) return;
    body.replaceChildren(f.hunks ? diffTable(f.hunks) : h('div.diff-note', f.note, onGitHub && [' ', onGitHub('Open it on GitHub', `#${f.anchor}`)]));
    if (f.hunks) diffColours(body.firstChild, f);
  };
  const el = h('details.diff-file', { open: !f.fold, ontoggle: () => { if (el.open) fill(); } },
    h('summary', h('span.path', f.from ? `${f.from} → ${f.path}` : f.path), f.status !== 'modified' && h('span.chip', f.status), f.fold && h('span.hint', f.fold),
      h('span.spacer'), h('span.good', `+${f.additions}`), h('span.loss', `−${f.deletions}`)),
    body);
  if (el.open) fill();
  return el;
}

// Syntax colours come a moment after the rows: the main process works them out, for this file alone. A line is
// then its runs of text, each in a span with highlight.js's class where it has one. A file in a language that
// is not known, and a line the colouring could not account for, stay as they are.
async function diffColours(table, f) {
  const lines = await api.call('diffColours', f.path, f.hunks).catch(() => null);
  if (!lines) return;
  table.querySelectorAll('tr:not(.hunk):not(.eof) td.code').forEach((td, i) => {
    if (lines[i]) td.replaceChildren(...lines[i].map(([cls, text]) => (cls ? h('span', { className: cls }, text) : text)));
  });
}

// The hunks of one file in one column, as GitHub's default view has them: the line's number in the old file, its
// number in the new one, and the line with its mark. The mark is drawn by the style sheet, so a copy holds the
// code alone.
function diffTable(hunks) {
  return h('table.diff-table', h('tbody', hunks.flatMap(k => [
    h('tr.hunk', h('td.ln'), h('td.ln'), h('td.code', k.header)),
    ...k.lines.map(l => h('tr', { className: { '+': 'add', '-': 'del', '\\': 'eof' }[l.type] || '' },
      h('td.ln', l.old), h('td.ln', l.new), h('td.code', { 'data-m': l.type === '\\' ? '' : l.type }, l.text))),
  ])));
}
// What removing a worktree would throw away, in words ('' = nothing). w: a row from the main process.
function lossOf(w) {
  if (w.leftover) return 'everything in this folder, which git no longer knows as a worktree';
  if (w.error) return `whatever is in it (its state could not be read: ${w.error})`;
  return [w.changed && plural(w.changed, 'uncommitted change'), w.unique && `${plural(w.unique, 'commit')} that ${w.unique === 1 ? 'is' : 'are'} on no other branch or remote`].filter(Boolean).join(' and ');
}
const NOTHING_LOST = 'Nothing is lost: it has no uncommitted changes, and its commits are on another branch or on a remote.';
const removedText = done => `Removed the worktree ${done.name}${done.branch ? ` and its branch ${done.branch}` : ''}.`;
const keptText = w => `The worktree ${w.name} was kept, because removing it would now discard ${lossOf(w)}. It can be removed from the Worktrees tab.`;

// Closing an instance stops Claude Code and removes the instance's worktree. It asks first while Claude Code
// is still running, and whenever work would go with the worktree.
const closing = new Set();   // a second click on the ✕ while the first is still being dealt with does nothing
async function closeInstance(id) {
  const t = terms.get(id);
  if (!t || closing.has(id)) return;
  closing.add(id);
  try {
    const inst = t.inst, wt = (await call('closeInfo', id)).worktree;
    const loss = wt ? lossOf(wt) : '', removable = wt && !wt.shared;
    let remove = removable && !loss;
    if (!inst.exited || (removable && loss)) {
      const v = await formDialog(`Close ${inst.label}?`, [
        !inst.exited && { type: 'static', label: 'Claude Code', value: `Still running${statusOf(inst).cls === 'busy' ? ', in the middle of a turn' : ''}. Closing stops it; its conversation stays available to \`claude --resume\`.` },
        wt && wt.shared && { type: 'static', label: 'Worktree', value: 'Stays where it is: another session is running in it.' },
        removable && { key: 'remove', label: 'Remove the worktree', type: 'checkbox', value: !loss,
          hint: [`Deletes .claude/worktrees/${wt.name}${wt.branch ? ` and its branch ${wt.branch}` : ''}. `, loss ? h('span.loss', `That discards ${loss}.`) : NOTHING_LOST] },
      ], 'Close');
      if (!v) return;
      remove = !!v.remove;
    }
    const done = await call('close', id, remove ? (loss ? 'force' : 'safe') : undefined);
    if (done) toast(done.removed ? removedText(done) : keptText(done.kept));
    if (!$('#view-worktrees').hidden) loadWorktrees();
  } finally { closing.delete(id); }
}

// Sessions that were open when the app last stopped (a power cut, a crash, or simply quitting).
let shownResumable = '';
function renderResumable() {
  const list = state.resumable || [], key = JSON.stringify(list);
  $('#btn-resume-all').hidden = list.length < 2;
  if (key === shownResumable) return;   // unchanged: leave the buttons alone, a click may be under way
  shownResumable = key;
  $('#resumable').replaceChildren(...list.map(r => {
    const card = h('article.card.ext',
      h('div.head', h('span.title', { title: r.dir }, `${r.worktree ? '🌳' : '📁'} ${r.label}`), r.group && groupChip(r.group), h('span.badge.off', 'interrupted'), h('span.spacer'),
        h('button.primary', { onclick: () => call('resume', r.id) }, 'Resume'),
        h('button', { title: 'Take it off this list. Its conversation stays available to `claude --resume`.', onclick: () => call('forget', r.id) }, 'Forget')),
      h('div.meta', [
        r.issue && (r.issueUrl ? h('button', { title: `Issue #${r.issue}: open it on GitHub`, onclick: () => call('openUrl', r.issueUrl) }, `#${r.issue}`) : `issue #${r.issue}`),
        [r.model || 'default model', r.effort].filter(Boolean).join(' · '), r.autonomy !== 'manual' && MERGE_CHIP[r.autonomy],
        r.level !== 'manual' && `input: ${r.level}`, `open until ${new Date(r.savedAt).toLocaleString()}`,
      ].filter(Boolean).map(c => (typeof c === 'string' ? h('span.chip', c) : c))),
      h('div.note', r.conversation ? 'Was open when the app last stopped. Resume continues its conversation where it left off.'
        : 'Was open when the app last stopped, before Claude Code had saved a conversation for it. Resume starts it again.'));
    stripe(card, r.group);
    return card;
  }));
}

let shownGroups = '';
function renderInstances() {
  const live = new Set(state.instances.map(i => i.id));
  for (const [id, t] of terms) {
    if (live.has(id)) continue;
    if (detailId === id) closeDetail();
    t.observer.disconnect(); t.term.dispose(); t.card.remove(); terms.delete(id);
  }
  // Cards in no group come first, then group after group by name.
  const groups = groupNames();
  for (const inst of state.instances) updateCard(terms.get(inst.id) || createCard(inst), inst, inst.group ? groups.indexOf(inst.group) + 1 : 0);
  renderSessions();
  // The names offered where a group is typed. Rebuilt only when they change: the list may be open under the cursor.
  const names = [...new Set([...state.instances, ...(state.resumable || []), ...state.queue].map(x => x.group).filter(Boolean))].sort();
  if (names.join('\n') !== shownGroups) { shownGroups = names.join('\n'); $('#groups').replaceChildren(...names.map(n => h('option', { value: n }))); }
  if (openWhenReady && terms.has(openWhenReady)) { openDetail(openWhenReady); openWhenReady = null; }
  renderResumable();

  // Sessions started outside the app, unless the filter hides them.
  const outside = prefs.hideOutside ? [] : state.external;
  $('#n-outside').textContent = prefs.hideOutside && state.external.length ? `${plural(state.external.length, 'session')} hidden` : '';
  $('#external').replaceChildren(...outside.map(e => {
    const st = statusOf({ pending: [], session: e });
    return h('article.card.ext', { className: `card ext${st.cls === 'wait' ? ' attention' : ''}` },
      h('div.head', h('span.title', { title: e.cwd }, `${e.worktree ? '🌳' : '📁'} ${e.label}`), h('span', { className: `badge ${st.cls}` }, st.text)),
      h('div.meta', [e.name, e.kind, e.startedAt && `up ${fmtDur(Date.now() - e.startedAt)}`].filter(Boolean).map(c => h('span.chip', c)), procChips(e.procs, 1)),
      h('div.note', 'Started outside claudinho: status only, no terminal.'));
  }));
  // Worktrees are made one at a time: while a new one is still starting, the queue waits for it.
  const first = state.instances.find(i => i.starting), after = first && `, after ${first.issue ? `#${first.issue}` : first.label} has started`;
  $('#queue').replaceChildren(...state.queue.map(j => h('span.chip.warn', { title: `${j.title}${j.group ? `\nGroup: ${j.group}` : ''}` },
    `queued #${j.number}${j.waitingOn.length ? `, waiting on ${j.waitingOn.map(n => (n === '?' ? 'GitHub' : `#${n}`)).join(' ')}` : after || ''}`,
    h('button', { title: 'Remove from the queue', onclick: () => call('unqueue', j.number) }, '✕'))));
  const total = state.instances.length + outside.length;
  const waiting = [...state.instances, ...outside.map(e => ({ pending: [], session: e }))].filter(i => statusOf(i).cls === 'wait').length;
  $('#n-instances').textContent = `${total || ''}${waiting ? ` ⚠${waiting}` : ''}`;
  $('#empty').textContent = total || (state.resumable || []).length ? '' : !state.repo ? 'Open a folder or clone a GitHub repo to get started.'
    : 'No Claude Code instance is running in this folder. Start one above, or send one after an issue from the Issues tab.';
}

async function newInstance(worktree) {
  const v = await formDialog(worktree ? 'New worktree' : `New instance in ${state.repo.name}`, [
    worktree && { key: 'worktree', label: 'Worktree name', type: 'text', list: 'worktrees', placeholder: 'blank = generated', pattern: '[A-Za-z0-9._\\-]{1,64}', hint: 'Created with `claude -w` under .claude/worktrees. An existing name reopens that worktree.' },
    ...launchFields(),
    autonomyField(),
    { key: 'prompt', label: 'First prompt (optional)', type: 'textarea', rows: 3 },
  ], 'Start');
  if (!v) return;
  savePrefs(v);
  openWhenReady = await call('spawn', { ...v, worktree: worktree ? v.worktree || true : undefined });
}

// ---------- worktrees ----------

let worktrees = null;   // rows from the main process; who is at work in each one comes from the live state
const IS_WIN = navigator.platform.startsWith('Win');
const pathKey = p => { const s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, ''); return IS_WIN ? s.toLowerCase() : s; };
const under = (dir, p) => pathKey(p) === pathKey(dir) || pathKey(p).startsWith(`${pathKey(dir)}/`);

async function loadWorktrees() {
  const box = $('#worktree-list');
  if (!state.repo || !state.repo.isGit) { worktrees = null; $('#n-worktrees').textContent = ''; return box.replaceChildren(h('div.empty', 'This folder is not a git repository, so it has no worktrees.')); }
  if (!worktrees) box.replaceChildren(h('div.empty', 'Reading the worktrees…'));
  try { worktrees = await call('worktrees'); } catch { worktrees = null; return box.replaceChildren(h('div.empty', 'Could not read the worktrees.')); }
  renderWorktrees();
}

let shownWorktrees = '';
function renderWorktrees() {
  if (!worktrees || $('#view-worktrees').hidden) return;
  $('#n-worktrees').textContent = worktrees.length || '';
  if (!worktrees.length) return $('#worktree-list').replaceChildren(h('div.empty', 'No worktrees under .claude/worktrees. "+ New worktree…" on the Instances tab makes one, and so does every issue sent to Claude Code.'));
  const rows = worktrees.map(w => {
    const inst = state.instances.find(i => !i.exited && under(w.path, i.cwd));
    const outside = !inst && state.external.some(e => under(w.path, e.cwd));
    return { w, inst, outside, paused: !inst && !outside && (state.resumable || []).some(r => under(w.path, r.dir)) };
  });
  const key = JSON.stringify(rows.map(r => [r.w, r.inst && [r.inst.id, statusOf(r.inst).text], r.outside, r.paused]));
  if (key === shownWorktrees && $('#worktree-list table')) return;   // unchanged: leave the buttons alone, a click may be under way
  shownWorktrees = key;
  $('#worktree-list').replaceChildren(h('table',
    h('thead', h('tr', ['Worktree', 'Branch', 'State', 'Last commit', 'Session', ''].map(c => h('th', c)))),
    h('tbody', rows.map(({ w, inst, outside, paused }) => {
      const [when, subject] = (w.last || '').split('\t');
      const what = w.leftover ? 'a leftover folder, no longer a worktree' : w.error ? `unreadable: ${w.error}`
        : [w.changed && plural(w.changed, 'uncommitted change'), w.unique && `${plural(w.unique, 'commit')} only here`].filter(Boolean).join(', ');
      return h('tr',
        h('td', { title: w.path }, `🌳 ${w.name}`),
        h('td', w.branch || (w.leftover ? '' : 'detached')),
        h('td', { className: what ? 'loss' : '' }, what || 'clean'),
        h('td', subject, when && h('span.hint', ` · ${when}`)),
        h('td', inst ? h('a', { title: 'Show this instance', onclick: () => { show('instances'); openDetail(inst.id); } }, statusOf(inst).text)
          : outside ? 'running outside the app' : paused ? 'interrupted' : '–'),
        h('td', h('button', { disabled: !!inst || outside, title: inst || outside ? 'A session is running in it. Closing the instance removes its worktree.' : '', onclick: () => removeWorktree(w) }, 'Remove')));
    }))));
}

async function removeWorktree(w) {
  const loss = lossOf(w);
  let done;
  const v = await formDialog(`Remove the worktree ${w.name}?`, [
    { type: 'static', label: 'Deletes', value: [w.path, w.branch && `and the branch ${w.branch}`].filter(Boolean) },
    { type: 'static', label: 'Lost with it', value: loss ? h('span.loss', loss) : NOTHING_LOST },
  ], loss ? 'Remove and discard' : 'Remove', async () => { done = await api.call('removeWorktree', w.path, !!loss); });
  if (!v) return;
  if (done) toast(done.removed ? removedText(done) : keptText(done.kept));
  loadWorktrees();
}

// ---------- issues ----------

async function loadIssues() {
  const box = $('#issues');
  $('#n-issues').textContent = '';
  if (!state.repo || !state.repo.github) return box.replaceChildren(h('div.empty', 'This folder has no GitHub remote, so there are no issues to show.'));
  box.replaceChildren(h('div.empty', 'Loading issues…'));
  issuesFor = state.repo.path;
  try { issues = await call('issues', $('#issue-state').value); }
  catch { issues = []; return box.replaceChildren(h('div.empty', 'Could not load issues. Check that `gh` is installed and logged in.')); }
  selected.clear();
  renderIssues();
}

function renderIssues() {
  const list = issues.filter(i => !$('#issue-blocked').checked || i.blocked);
  $('#n-issues').textContent = issues.length || '';
  if (!list.length) return $('#issues').replaceChildren(h('div.empty', 'No issues match.'));
  $('#issues').replaceChildren(h('table',
    h('thead', h('tr', ['#', 'Title', 'Blocked by', 'Assignees', 'Updated'].map(c => h('th', c)))),
    h('tbody', list.map((is, idx) => h('tr', {
      className: selected.has(is.number) ? 'sel' : '',
      onclick: e => {
        if (e.shiftKey && lastIdx != null) for (let k = Math.min(lastIdx, idx); k <= Math.max(lastIdx, idx); k++) selected.add(list[k].number);
        else if (e.ctrlKey || e.metaKey) { if (!selected.delete(is.number)) selected.add(is.number); lastIdx = idx; }
        else { selected.clear(); selected.add(is.number); lastIdx = idx; }
        renderIssues();
      },
      oncontextmenu: e => {
        e.preventDefault();
        if (!selected.has(is.number)) { selected.clear(); selected.add(is.number); lastIdx = idx; renderIssues(); }
        const picked = issues.filter(i => selected.has(i.number));
        showMenu(e.clientX, e.clientY, [
          [picked.length > 1 ? `Tackle ${picked.length} issues with Claude Code…` : `Tackle #${is.number} with Claude Code…`, () => tackle(picked)],
          ['Open on GitHub', () => call('openUrl', is.url)],
        ]);
      },
    },
    h('td.num', `#${is.number}`),
    h('td', is.title, is.labels.map(l => h('span.label', { style: /^[0-9a-f]{6}$/i.test(l.color) ? `border-color:#${l.color}` : '' }, l.name))),
    h('td', is.blockedBy.length ? is.blockedBy.map(b => h('span', { className: `blocker${b.done ? ' done' : ''}`, title: `${b.title}${b.done ? ' (completed)' : ''}` }, `#${b.number}`))
      : is.blocked && h('span.blocker', 'blocked')),
    h('td', is.assignees.join(', ')),
    h('td.when', new Date(is.updatedAt).toLocaleDateString()))))));
}

function showMenu(x, y, items) {
  const m = $('#ctx');
  m.replaceChildren(...items.map(([label, fn]) => h('li', { onclick: fn }, label)));
  m.hidden = false;
  m.style.left = `${Math.min(x, innerWidth - m.offsetWidth - 8)}px`;
  m.style.top = `${Math.min(y, innerHeight - m.offsetHeight - 8)}px`;
}
document.addEventListener('click', e => { $('#ctx').hidden = true; if (!e.target.closest('#notes')) $('#notes').hidden = true; });

const PROMPT_HINT = 'A Jinja2 template: {{ issue_id }}, {{ issue_title }} and {{ issue_url }} are filled in for the issue.';
// What a batch is called unless another name is typed: its issues, or the first three and how many more.
const batchName = picked => { const n = picked.map(i => `#${i.number}`); return (n.length > 4 ? [...n.slice(0, 3), `+${n.length - 3}`] : n).join(' '); };
async function tackle(picked) {
  // Whatever the order of the list: issues sent together start with the lowest number, the way a plan is numbered.
  picked = picked.slice().sort((a, b) => a.number - b.number);
  const multi = picked.length > 1;
  const v = await formDialog(multi ? `Tackle ${picked.length} issues` : `Tackle #${picked[0].number}`, [
    { type: 'static', label: multi ? 'Issues' : 'Issue', value: picked.map(i => {
      const open = i.blockedBy.filter(b => !b.done).map(b => `#${b.number}`);
      return `#${i.number} ${i.title}${open.length ? `  [starts once ${open.join(' ')} is completed]` : i.blocked ? '  [labelled blocked]' : ''}`;
    }) },
    ...launchFields(),
    multi && { key: 'parallel', label: 'Agents running at once', type: 'number', min: 1, max: 4, value: Math.min(4, picked.length), hint: 'One instance and worktree per issue; the rest queue (max 4).' },
    autonomyField(),
    multi && { key: 'group', label: 'Group', type: 'text', list: 'groups', maxLength: 40, required: true, value: batchName(picked),
      hint: 'Issues started together are a group: their cards carry this name and its colour. An existing name adds them to that group.' },
    { key: 'template', label: 'Prompt', type: 'textarea', rows: 3, value: state.repo.template, required: true, hint: PROMPT_HINT + ' This is the default prompt, changed under ⚙; an edit here counts for this start only.' },
  ], 'Start', v => api.call('dispatch', { ...v, issues: picked.map(i => ({ number: i.number, title: i.title, url: i.url })) }));
  if (!v) return;
  savePrefs(v);
  show('instances');
}

// ---------- pull requests ----------

let prs = null;   // rows from the main process; which session works on each one comes from the live state
const REVIEWS = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', REVIEW_REQUIRED: 'review required' };

async function loadPrs() {
  const box = $('#prs');
  if (!state.repo || !state.repo.github) { prs = null; $('#n-prs').textContent = ''; return box.replaceChildren(h('div.empty', 'This folder has no GitHub remote, so there are no pull requests to show.')); }
  if (!prs) box.replaceChildren(h('div.empty', 'Loading pull requests…'));
  try { prs = await call('prs'); } catch { prs = null; return box.replaceChildren(h('div.empty', 'Could not load the pull requests. Check that `gh` is installed and logged in.')); }
  renderPrs();
}

let shownPrs = '';
function renderPrs() {
  if (!prs || $('#view-prs').hidden) return;
  $('#n-prs').textContent = prs.length || '';
  if (!prs.length) return $('#prs').replaceChildren(h('div.empty', 'No open pull requests.'));
  // The session at work on a pull request: the one that reported it, or the one on its branch.
  const rows = prs.map(pr => ({ pr, inst: state.instances.find(i => (i.pr && i.pr.number === pr.number) || (i.status && i.status.branch === pr.branch)) }));
  const key = JSON.stringify(rows.map(r => [r.pr, r.inst && [r.inst.id, statusOf(r.inst).text, r.inst.group]]));
  if (key === shownPrs && $('#prs table')) return;   // unchanged: leave the links alone, a click may be under way
  shownPrs = key;
  $('#prs').replaceChildren(h('table',
    h('thead', h('tr', ['#', 'Title', 'State', 'Branch', 'Checks', 'Review', 'Session', 'Updated'].map(c => h('th', c)))),
    h('tbody', rows.map(({ pr, inst }) => {
      const c = pr.checks;
      return h('tr',
        h('td.num', `#${pr.number}`),
        h('td', h('a', { title: 'Open on GitHub', onclick: () => call('openUrl', pr.url) }, pr.title), pr.author && h('span.hint', ` · ${pr.author}`)),
        h('td', pr.draft ? h('span.hint', 'draft') : h('span.good', 'ready for review')),
        h('td', pr.branch, h('span.hint', ` → ${pr.base}`)),
        h('td', { className: c.state === 'failing' ? 'loss' : c.state === 'passing' ? 'good' : '' }, c.state === 'failing' ? `${c.failing} of ${c.total} failing` : c.state === 'none' ? '–' : c.state),
        h('td', { className: pr.review === 'CHANGES_REQUESTED' ? 'loss' : pr.review === 'APPROVED' ? 'good' : '' }, REVIEWS[pr.review] || '–'),
        h('td', inst ? [h('a', { title: 'Show this instance', onclick: () => { show('instances'); openDetail(inst.id); } }, statusOf(inst).text), inst.group && [' ', groupChip(inst.group)]] : '–'),
        h('td.when', new Date(pr.updatedAt).toLocaleDateString()));
    }))));
}

// ---------- .claude panel ----------

const GROUPS = [['Skills', /^\.claude\/skills\//], ['Agents', /^\.claude\/agents\//], ['Commands', /^\.claude\/commands\//],
  ['Other .claude files', /^\.claude\//], ['.github', /^\.github\//], ['Project root', /^/]];
// The home config folder, which applies to every project. Its files are listed with a "~/" in front.
const HOME_GROUPS = [['Skills', /^~\/skills\//], ['Agents', /^~\/agents\//], ['Commands', /^~\/commands\//], ['Other', /^~\//]];
let homeDir = '';
const shownPath = rel => (rel.startsWith('~/') ? `${homeDir}/${rel.slice(2)}` : rel);

async function loadConfig() {
  if (!state.repo) return $('#tree').replaceChildren(h('div.empty', 'Open a folder first.'));
  const list = await call('configList');
  homeDir = list.home.dir.replace(/\\/g, '/');
  configFiles = [...list.files, ...list.home.files];
  renderTree();
}

function renderTree() {
  const rest = new Set(configFiles.filter(f => !f.startsWith('~/'))), home = new Set(configFiles.filter(f => f.startsWith('~/')));
  const groups = (defs, left) => defs.map(([name, re]) => {
    const files = [...left].filter(f => re.test(f));
    files.forEach(f => left.delete(f));
    return h('details', { open: true }, h('summary', `${name} (${files.length})`),
      files.map(f => h('div', { className: `file${f === openFile ? ' active' : ''}`, title: shownPath(f), onclick: () => openConfig(f) }, f.replace(re, ''))));
  });
  $('#tree').replaceChildren(
    h('div.toolbar', h('button', { onclick: newSkill, disabled: !state.claudeFound }, '+ New skill'), h('button', { onclick: newAgent, disabled: !state.claudeFound }, '+ New agent')),
    h('h4', { title: state.repo.path }, `This folder: ${state.repo.name}`), ...groups(GROUPS, rest),
    h('h4', { title: `${homeDir}: applies to every project on this machine` }, `Home: ${homeDir}`), ...groups(HOME_GROUPS, home));
}

async function openConfig(rel) {
  if (dirty && !confirm('Discard the unsaved changes?')) return;
  const text = await call('configRead', rel);
  openFile = rel; dirty = false;
  const saveBtn = h('button.primary', { disabled: true, onclick: async () => {
    if (/\.json$/i.test(rel)) {   // a broken settings file is felt by every session that reads it
      try { JSON.parse(ta.value); } catch (e) { if (!confirm(`${shownPath(rel)} is not valid JSON (${e.message}).\n\nSave it anyway?`)) return; }
    }
    await call('configWrite', rel, ta.value);
    dirty = false; saveBtn.disabled = true;
    toast(`Saved ${shownPath(rel)}`);
    if (!rel.startsWith('~/')) offerCommit(`Update ${rel}`);   // the home folder is not part of this repo
  } }, 'Save');
  const ta = h('textarea', {
    spellcheck: false, value: text,
    oninput: () => { dirty = true; saveBtn.disabled = false; },
    onkeydown: e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveBtn.click(); } },
  });
  $('#editor').replaceChildren(h('div.toolbar', h('span.path', shownPath(rel)), h('span.spacer'), saveBtn), ta);
  renderTree();
}

// After any change under .claude: if the folder is a git repo, ask whether to commit (and push) it.
async function offerCommit(message) {
  const ch = await call('gitChanges');
  if (!ch || $('#dlg').open || JSON.stringify(ch.files) === declined) return;   // no repo, nothing changed, or already declined
  const v = await formDialog('Commit to GitHub?', [
    { type: 'static', label: `Changed on ${ch.branch || 'a detached HEAD'}`, value: ch.files },
    { key: 'message', label: 'Commit message', type: 'text', value: message, required: true },
    ch.hasRemote && { key: 'push', label: 'Push to origin', type: 'checkbox', value: true },
  ], 'Commit');
  if (!v) { declined = JSON.stringify(ch.files); return; }
  await call('commit', ch.files, v.message, !!v.push);
  toast(v.push ? `Committed and pushed to ${ch.branch}` : `Committed on ${ch.branch}`);
}

const FOLLOW_UP = 'If anything important is unclear, ask me follow-up questions with the AskUserQuestion tool before writing. Stop once the file is written.';
async function newSkill() {
  const v = await formDialog('Create new skill', [
    { key: 'text', label: 'What should the skill do?', type: 'textarea', rows: 7, required: true, hint: 'Claude Code writes it in a terminal and may ask follow-up questions there.' },
  ], 'Create');
  if (v) generate(`Create a new Claude Code skill for this project at .claude/skills/<short-kebab-case-name>/SKILL.md, with YAML frontmatter (name, description) followed by the instructions. ${FOLLOW_UP}\n\nWhat the skill should do:\n${v.text}`);
}
async function newAgent() {
  const v = await formDialog('Create new agent', [
    { key: 'text', label: 'What should the agent do?', type: 'textarea', rows: 7, required: true, hint: 'Claude Code writes it in a terminal and may ask follow-up questions there.' },
    { key: 'model', label: "The agent's model", type: 'select', value: 'inherit', options: ['inherit', 'fable', 'opus', 'sonnet', 'haiku'].map(m => [m, m]) },
    { key: 'effort', label: "The agent's effort", type: 'select', value: '', options: EFFORTS },
  ], 'Create');
  if (v) generate(`Create a new Claude Code subagent for this project at .claude/agents/<short-kebab-case-name>.md, with YAML frontmatter (name, description, model: ${v.model}${v.effort ? `, effort: ${v.effort}` : ''}) followed by the agent's system prompt. ${FOLLOW_UP}\n\nWhat the agent should do:\n${v.text}`);
}
async function generate(prompt) {
  openWhenReady = await call('spawn', { kind: 'generator', prompt, level: 'manual' });
  show('instances');
}

// ---------- wiring ----------

function show(view) {
  for (const v of ['instances', 'worktrees', 'issues', 'prs', 'config']) $(`#view-${v}`).hidden = v !== view;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'instances') terms.forEach(layoutSoon);
  if (view === 'worktrees') loadWorktrees();
  if (view === 'issues' && issuesFor !== (state.repo && state.repo.path)) loadIssues();
  if (view === 'prs') loadPrs();
  if (view === 'config') loadConfig();
}

function render() {
  renderTop();
  renderInstances();
  renderWorktrees();                                // who is at work in each one may have changed
  renderPrs();                                      // and on each pull request
  const p = state.repo && state.repo.path;
  if (p === shownRepo) return;
  shownRepo = p;                                    // another folder was opened: drop what belonged to the old one
  issues = []; issuesFor = null; selected.clear(); openFile = null; dirty = false; declined = ''; worktrees = null; prs = null;
  $('#n-worktrees').textContent = ''; $('#n-prs').textContent = '';
  $('#editor').replaceChildren(h('div.empty', 'Pick a file on the left to view or edit it.'));
  show(document.querySelector('.tab.active').dataset.view);
}

document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
$('#btn-new').onclick = () => newInstance(false);
$('#btn-worktree').onclick = () => newInstance(true);
$('#btn-resume-all').onclick = async () => { for (const r of state.resumable.slice()) await call('resume', r.id); };
$('#btn-refresh-worktrees').onclick = loadWorktrees;
$('#btn-refresh-prs').onclick = loadPrs;
$('#btn-bell').onclick = e => { e.stopPropagation(); if ($('#notes').hidden) openNotes(); else $('#notes').hidden = true; };
$('#btn-update').onclick = updateClaude;
$('#btn-update-app').onclick = updateApp;
$('#hide-outside').checked = !!prefs.hideOutside;
$('#hide-outside').onchange = e => { prefs.hideOutside = e.target.checked; savePrefs(); renderInstances(); };
$('#btn-refresh-issues').onclick = loadIssues;
$('#issue-state').onchange = loadIssues;
$('#issue-blocked').onchange = renderIssues;
$('#btn-open').onclick = async () => { const dir = await call('pickFolder'); if (dir) await call('openRepo', dir); };
$('#btn-clone').onclick = async () => {
  const v = await formDialog('Clone from GitHub', [{ key: 'spec', label: 'Repository', type: 'text', placeholder: 'owner/repo or URL', required: true }], 'Choose where to put it…');
  const parent = v && await call('pickFolder');
  if (!parent) return;
  toast(`Cloning ${v.spec}…`);
  await call('clone', v.spec, parent);
  toast(`Cloned ${v.spec}`);
};
const CPU_MECHANISMS = {
  job: 'Windows job objects. The cap is exact and kernel-enforced; the shares are recalculated every second.',
  cgroup: 'A Linux control group per instance. The kernel enforces both the cap and the weights, and always balances instances between them.',
  throttle: 'Pausing and resuming processes in short cycles, because this system gives ordinary apps no kernel CPU limit. Right on average; takes a few seconds to settle.',
};
$('#btn-settings').onclick = async () => {
  await formDialog('Settings', [
    state.repo && { key: 'template', label: `Default prompt for issue worktrees in ${state.repo.name}`, type: 'textarea', rows: 4, value: state.repo.template,
      hint: `What Claude Code is told when an instance is started for a GitHub issue. ${PROMPT_HINT} Kept per folder; clear it to get the built-in prompt back.` },
    { key: 'mergeMethod', label: 'Auto-merge method', type: 'select', value: state.settings.mergeMethod, options: [['squash', 'Squash'], ['merge', 'Merge commit'], ['rebase', 'Rebase']] },
    { key: 'timedMinutes', label: 'Timed input: minutes to wait', type: 'number', min: 1, max: 60, value: state.settings.timedMinutes, hint: 'How long the "timed" level waits for you before taking the recommended option.' },
    { key: 'cpuCeiling', label: 'CPU ceiling per instance (%)', type: 'number', min: 5, max: 100, value: state.settings.cpuCeiling,
      hint: `The most one instance, with everything it starts, may use of the whole machine (${state.cores} cores). 100 means no ceiling.` },
    { key: 'cpuShare', label: 'Share the CPU between instances by weight', type: 'checkbox', value: state.settings.cpuShare,
      hint: 'When instances compete, each gets CPU in proportion to its weight (set per instance in its detail view). An instance that needs less leaves the rest to the others.' },
    { type: 'static', label: 'Enforced by', value: CPU_MECHANISMS[state.cpuMechanism] || `Not available here${state.cpuError ? `: ${state.cpuError}` : ''}.` },
  ], 'Save', v => api.call('setSettings', v));
};

api.on('pty-data', (id, data) => {
  const t = terms.get(id);
  if (t) t.term.write(data); else backlog.set(id, (backlog.get(id) || '') + data);
});
api.on('state', s => { state = s; render(); });
api.on('config-changed', () => { if (!$('#view-config').hidden) loadConfig(); offerCommit('Update .claude'); });   // a skill/agent generator finished a turn

setInterval(() => {
  for (const t of terms.values()) t.p.up.textContent = t.inst.exited ? 'stopped' : `up ${fmtDur(Date.now() - t.inst.startedAt)}`;
  document.querySelectorAll('.countdown').forEach(el => {
    const s = Math.max(0, Math.round((el.dataset.deadline - Date.now()) / 1000));
    el.textContent = `recommended in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });
}, 1000);

call('state').then(s => { state = s; render(); });
