/* global api, Terminal, FitAddon */
// Renderer: three views (instances, issues, .claude) drawn from the state the main process pushes.

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
const prefs = { model: 'opus', effort: 'xhigh', level: 'manual' };   // claude_worktree's defaults
try { Object.assign(prefs, JSON.parse(localStorage.getItem('prefs') || '{}')); } catch { /* keep defaults */ }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 7000);
}
async function call(name, ...args) {
  try { return await api.call(name, ...args); }
  catch (e) { toast(String(e.message).replace(/^Error invoking remote method 'rpc': (Error: )?/, '')); throw e; }
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
function formDialog(title, fields, ok = 'OK') {
  return new Promise(resolve => {
    const dlg = $('#dlg'), inputs = {};
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
      onsubmit: e => {
        e.preventDefault();
        done(Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim()])));
      },
    }, h('h2', title), rows, h('div.actions', h('button', { type: 'button', onclick: () => done(null) }, 'Cancel'), h('button.primary', { type: 'submit' }, ok))));
    dlg.oncancel = () => resolve(null);   // Esc
    dlg.showModal();
    const first = dlg.querySelector('input, select, textarea');
    if (first) first.focus();
  });
}

const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'].map(e => [e, e || 'default']);
const LEVELS = [['manual', 'Manual: always wait for me'], ['timed', 'Timed: wait, then take the recommended option'], ['auto', 'Auto: take the recommended option at once']];
const launchFields = () => [
  { key: 'model', label: 'Model', type: 'text', list: 'models', value: prefs.model, placeholder: 'default', hint: 'An alias (fable, opus, sonnet, haiku) or a full model name.' },
  { key: 'effort', label: 'Effort', type: 'select', value: prefs.effort, options: EFFORTS },
  { key: 'level', label: 'When input is needed', type: 'select', value: prefs.level, options: LEVELS, hint: `Covers Claude's questions and tool-permission prompts. Timed waits ${state.settings.timedMinutes} min.` },
];
function savePrefs(v) {
  Object.assign(prefs, { model: v.model, effort: v.effort, level: v.level });
  try { localStorage.setItem('prefs', JSON.stringify(prefs)); } catch { /* not persisted this time */ }
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
  $('#repo-name').replaceChildren(...(r ? [h('b', `📁 ${r.name}`), `  ${r.path}`] : ['No folder open']));
  $('#repo-name').title = r ? r.path : '';
  $('#account').textContent = !state.claudeFound ? 'Claude Code CLI not found on PATH'
    : a && a.loggedIn ? `✉ ${a.email}${a.subscriptionType ? ` · ${a.subscriptionType}` : ''}` : 'Not logged in: run `claude` and /login';
  $('#usage').replaceChildren(...(u ? [usageWin('5h', u.five_hour, u.at), usageWin('7d', u.seven_day, u.at)]
    : [h('span.hint', '5h / 7d usage shows up after an instance gets its first reply')]));
  $('#btn-new').disabled = !r || !state.claudeFound;
  $('#btn-worktree').disabled = !r || !r.isGit || !state.claudeFound;
  if (!r) return $('#setup').replaceChildren();
  const s = r.setup, on = (cond, text) => cond && h('span.chip.on', text);
  $('#setup').replaceChildren(...[
    h('span.chip', r.github ? `GitHub ${r.github.owner}/${r.github.name}` : r.isGit ? 'git, no GitHub remote' : 'plain folder'),
    !s.claude && h('span.chip', 'no .claude setup'),
    on(s.memory, 'CLAUDE.md'), on(s.skills, plural(s.skills, 'skill')), on(s.agents, plural(s.agents, 'agent')),
    on(s.commands, plural(s.commands, 'command')), on(s.settings, 'settings'), on(s.hooks, 'hooks'), on(s.mcp, 'MCP'),
    !s.github && h('span.chip', 'no .github config'),
    on(s.workflows, plural(s.workflows, 'workflow')), on(s.issueTemplates, plural(s.issueTemplates, 'issue template')),
    on(s.prTemplate, 'PR template'), on(s.codeowners, 'CODEOWNERS'),
  ].filter(Boolean));
  $('#worktrees').replaceChildren(...r.worktrees.filter(w => !w.main).map(w => h('option', { value: w.path.split(/[\\/]/).pop() })));
}

// ---------- instances ----------

const THEME = { background: '#0b0e14', foreground: '#c9d1d9', cursor: '#e6b450', selectionBackground: '#3a4a63' };
const IS_MAC = navigator.platform.startsWith('Mac');

function statusOf(i) {
  if (i.exited) return { text: `exited${i.exitCode ? ` (${i.exitCode})` : ''}`, cls: 'off' };
  if (i.pending.length) return { text: 'needs input', cls: 'wait' };
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
    title: h('span.title'), badge: h('span.badge'), meta: h('div.meta'), up: h('span.chip'), pending: h('div.pending'),
    info: h('dl'), env: h('div.env'), procs: h('div.procs'),
    merge: h('input', { type: 'checkbox', onchange: e => call('setInstance', inst.id, { autoMerge: e.target.checked }) }),
    level: h('select', { onchange: e => call('setInstance', inst.id, { level: e.target.value }) }, LEVELS.map(([v, text]) => h('option', { value: v }, text))),
    filter: h('input', { type: 'search', placeholder: 'filter by name…', oninput: () => renderEnv(t) }),
    weight: h('select', { title: 'Counts when "Share the CPU between instances by weight" is on in Settings.', onchange: e => call('setInstance', inst.id, { weight: e.target.value }) },
      [['low', 'Low: half a share'], ['normal', 'Normal'], ['high', 'High: a double share']].map(([v, text]) => h('option', { value: v }, text))),
  };
  const card = h('article.card', { onclick: e => { if (detailId !== inst.id && !e.target.closest('button, .pending-box')) openDetail(inst.id); } },
    h('div.head', p.title, p.badge, h('span.spacer'),
      h('button.back', { onclick: e => { e.stopPropagation(); closeDetail(); } }, '← All instances'),
      h('button.x', { title: 'Stop and remove', onclick: e => { e.stopPropagation(); closeInstance(inst.id); } }, '✕')),
    p.meta, p.pending,
    h('div.body', wrap, h('aside.side',
      h('h3', 'Session'), p.info,
      h('h3', 'CPU and memory'), p.procs,
      h('label', 'CPU weight ', p.weight),
      h('h3', 'Automation'),
      h('label', p.merge, ' Merge the PR automatically when finished'),
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
    ['Folder', i.cwd],
    ['Branch', s.branch],
    ['Model', [s.model || i.model, s.effort || i.effort].filter(Boolean).join(' · ')],
    ['Context', s.ctxPct != null && `${Math.round(s.ctxPct)}% used: ${fmtTokens(s.ctxTokens)} of ${fmtTokens(s.ctxSize)} tokens`],
    ['API cost', s.cost != null && `$${s.cost.toFixed(4)} equivalent at list price`],
    ['Lines', (s.added || s.removed) && `+${s.added || 0} −${s.removed || 0}`],
    ['Started', new Date(i.startedAt).toLocaleTimeString()],
    ['Session', i.session.name || s.sessionId],
    ['Issue', i.issue && `#${i.issue}`],
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

function updateCard(t, inst) {
  t.inst = inst;
  const st = statusOf(inst), s = inst.status || {};
  t.p.title.textContent = `${inst.worktree ? '🌳' : '📁'} ${inst.label}`;
  t.p.title.title = inst.cwd;
  t.p.badge.textContent = st.text;
  t.p.badge.className = `badge ${st.cls}`;
  t.card.classList.toggle('attention', st.cls === 'wait');
  t.p.meta.replaceChildren(...[
    [s.model || inst.model || 'default model', s.effort || inst.effort].filter(Boolean).join(' · '),
    s.ctxPct != null ? `ctx ${Math.round(s.ctxPct)}% of ${fmtTokens(s.ctxSize)}` : 'ctx –',
    s.cost != null ? `$${s.cost.toFixed(2)}` : '$ –',
    inst.issue && `issue #${inst.issue}`,
    inst.pr && `PR #${inst.pr.number}${inst.merge ? ` ${inst.merge}` : ''}`,
    inst.autoMerge && 'auto-merge',
    inst.level !== 'manual' && `input: ${inst.level}`,
  ].filter(Boolean).map(c => h('span.chip', c)), ...procChips(inst.procs, inst.limit), t.p.up);
  renderProcs(t.p.procs, inst.procs, inst.limit);
  if (document.activeElement !== t.p.weight) t.p.weight.value = inst.weight;
  renderPending(t, inst);
  if (document.activeElement !== t.p.level) t.p.level.value = inst.level;
  t.p.merge.checked = inst.autoMerge;
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

function openDetail(id) {
  const t = terms.get(id);
  if (!t) return;
  if (detailId) closeDetail();
  detailId = id;
  $('#view-instances').classList.add('detail');
  t.card.classList.add('detail');
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
  if (t) t.card.classList.remove('detail');
  terms.forEach(layoutSoon);
}
async function closeInstance(id) {
  const t = terms.get(id);
  if (t && !t.inst.exited && !confirm(`Stop the Claude Code instance in "${t.inst.label}"?`)) return;
  await call('close', id);
}

function renderInstances() {
  const live = new Set(state.instances.map(i => i.id));
  for (const [id, t] of terms) {
    if (live.has(id)) continue;
    if (detailId === id) closeDetail();
    t.observer.disconnect(); t.term.dispose(); t.card.remove(); terms.delete(id);
  }
  for (const inst of state.instances) updateCard(terms.get(inst.id) || createCard(inst), inst);
  if (openWhenReady && terms.has(openWhenReady)) { openDetail(openWhenReady); openWhenReady = null; }

  $('#external').replaceChildren(...state.external.map(e => {
    const st = statusOf({ pending: [], session: e });
    return h('article.card.ext', { className: `card ext${st.cls === 'wait' ? ' attention' : ''}` },
      h('div.head', h('span.title', { title: e.cwd }, `${e.worktree ? '🌳' : '📁'} ${e.label}`), h('span', { className: `badge ${st.cls}` }, st.text)),
      h('div.meta', [e.name, e.kind, e.startedAt && `up ${fmtDur(Date.now() - e.startedAt)}`].filter(Boolean).map(c => h('span.chip', c)), procChips(e.procs, 1)),
      h('div.note', 'Started outside claudinho: status only, no terminal.'));
  }));
  $('#queue').replaceChildren(...state.queue.map(j => h('span.chip.warn', { title: j.title },
    `queued #${j.number}${j.waitingOn.length ? `, waiting on ${j.waitingOn.map(n => (n === '?' ? 'GitHub' : `#${n}`)).join(' ')}` : ''}`,
    h('button', { title: 'Remove from the queue', onclick: () => call('unqueue', j.number) }, '✕'))));
  const total = state.instances.length + state.external.length;
  const waiting = [...state.instances, ...state.external.map(e => ({ pending: [], session: e }))].filter(i => statusOf(i).cls === 'wait').length;
  $('#n-instances').textContent = `${total || ''}${waiting ? ` ⚠${waiting}` : ''}`;
  $('#empty').textContent = total ? '' : !state.repo ? 'Open a folder or clone a GitHub repo to get started.'
    : 'No Claude Code instance is running in this folder. Start one above, or send one after an issue from the Issues tab.';
}

async function newInstance(worktree) {
  const v = await formDialog(worktree ? 'New worktree' : `New instance in ${state.repo.name}`, [
    worktree && { key: 'worktree', label: 'Worktree name', type: 'text', list: 'worktrees', placeholder: 'blank = generated', pattern: '[A-Za-z0-9._\\-]{1,64}', hint: 'Created with `claude -w` under .claude/worktrees. An existing name reopens that worktree.' },
    ...launchFields(),
    { key: 'autoMerge', label: 'Auto-merge the PR when finished', type: 'checkbox' },
    { key: 'prompt', label: 'First prompt (optional)', type: 'textarea', rows: 3 },
  ], 'Start');
  if (!v) return;
  savePrefs(v);
  openWhenReady = await call('spawn', { ...v, worktree: worktree ? v.worktree || true : undefined });
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
document.addEventListener('click', () => { $('#ctx').hidden = true; });

async function tackle(picked) {
  const multi = picked.length > 1;
  const v = await formDialog(multi ? `Tackle ${picked.length} issues` : `Tackle #${picked[0].number}`, [
    { type: 'static', label: multi ? 'Issues' : 'Issue', value: picked.map(i => {
      const open = i.blockedBy.filter(b => !b.done).map(b => `#${b.number}`);
      return `#${i.number} ${i.title}${open.length ? `  [starts once ${open.join(' ')} is completed]` : i.blocked ? '  [labelled blocked]' : ''}`;
    }) },
    ...launchFields(),
    !multi && { key: 'autoMerge', label: 'Auto-merge the PR when finished', type: 'checkbox' },
    multi && { key: 'parallel', label: 'Agents running at once', type: 'number', min: 1, max: 4, value: Math.min(4, picked.length), hint: 'One instance and worktree per issue; the rest queue (max 4).' },
    multi && { key: 'autonomy', label: 'Autonomy', type: 'select', value: 'manual', options: [['manual', 'Manual: nothing gets merged automatically'], ['semi', 'Semi-auto: the agent merges if it judges it safe'], ['full', 'Full-auto: every PR is merged when its agent finishes']] },
    { key: 'template', label: 'Prompt', type: 'textarea', rows: 3, value: state.repo.template, required: true, hint: '{n} is replaced by the issue number.' },
  ], 'Start');
  if (!v) return;
  savePrefs(v);
  await call('dispatch', { ...v, issues: picked.map(i => ({ number: i.number, title: i.title })) });
  show('instances');
}

// ---------- .claude panel ----------

const GROUPS = [['Skills', /^\.claude\/skills\//], ['Agents', /^\.claude\/agents\//], ['Commands', /^\.claude\/commands\//],
  ['Other .claude files', /^\.claude\//], ['.github', /^\.github\//], ['Project root', /^/]];

async function loadConfig() {
  if (!state.repo) return $('#tree').replaceChildren(h('div.empty', 'Open a folder first.'));
  configFiles = (await call('configList')).files;
  renderTree();
}

function renderTree() {
  const rest = new Set(configFiles);
  $('#tree').replaceChildren(
    h('div.toolbar', h('button', { onclick: newSkill, disabled: !state.claudeFound }, '+ New skill'), h('button', { onclick: newAgent, disabled: !state.claudeFound }, '+ New agent')),
    ...GROUPS.map(([name, re]) => {
      const files = [...rest].filter(f => re.test(f));
      files.forEach(f => rest.delete(f));
      return h('details', { open: true }, h('summary', `${name} (${files.length})`),
        files.map(f => h('div', { className: `file${f === openFile ? ' active' : ''}`, title: f, onclick: () => openConfig(f) }, f.replace(re, ''))));
    }));
}

async function openConfig(rel) {
  if (dirty && !confirm('Discard the unsaved changes?')) return;
  const text = await call('configRead', rel);
  openFile = rel; dirty = false;
  const saveBtn = h('button.primary', { disabled: true, onclick: async () => {
    await call('configWrite', rel, ta.value);
    dirty = false; saveBtn.disabled = true;
    toast(`Saved ${rel}`);
    offerCommit(`Update ${rel}`);
  } }, 'Save');
  const ta = h('textarea', {
    spellcheck: false, value: text,
    oninput: () => { dirty = true; saveBtn.disabled = false; },
    onkeydown: e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveBtn.click(); } },
  });
  $('#editor').replaceChildren(h('div.toolbar', h('span.path', rel), h('span.spacer'), saveBtn), ta);
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
  for (const v of ['instances', 'issues', 'config']) $(`#view-${v}`).hidden = v !== view;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'instances') terms.forEach(layoutSoon);
  if (view === 'issues' && issuesFor !== (state.repo && state.repo.path)) loadIssues();
  if (view === 'config') loadConfig();
}

function render() {
  renderTop();
  renderInstances();
  const p = state.repo && state.repo.path;
  if (p === shownRepo) return;
  shownRepo = p;                                    // another folder was opened: drop what belonged to the old one
  issues = []; issuesFor = null; selected.clear(); openFile = null; dirty = false; declined = '';
  $('#editor').replaceChildren(h('div.empty', 'Pick a file on the left to view or edit it.'));
  show(document.querySelector('.tab.active').dataset.view);
}

document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
$('#btn-new').onclick = () => newInstance(false);
$('#btn-worktree').onclick = () => newInstance(true);
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
  const v = await formDialog('Settings', [
    { key: 'mergeMethod', label: 'Auto-merge method', type: 'select', value: state.settings.mergeMethod, options: [['squash', 'Squash'], ['merge', 'Merge commit'], ['rebase', 'Rebase']] },
    { key: 'timedMinutes', label: 'Timed input: minutes to wait', type: 'number', min: 1, max: 60, value: state.settings.timedMinutes, hint: 'How long the "timed" level waits for you before taking the recommended option.' },
    { key: 'cpuCeiling', label: 'CPU ceiling per instance (%)', type: 'number', min: 5, max: 100, value: state.settings.cpuCeiling,
      hint: `The most one instance, with everything it starts, may use of the whole machine (${state.cores} cores). 100 means no ceiling.` },
    { key: 'cpuShare', label: 'Share the CPU between instances by weight', type: 'checkbox', value: state.settings.cpuShare,
      hint: 'When instances compete, each gets CPU in proportion to its weight (set per instance in its detail view). An instance that needs less leaves the rest to the others.' },
    { type: 'static', label: 'Enforced by', value: CPU_MECHANISMS[state.cpuMechanism] || `Not available here${state.cpuError ? `: ${state.cpuError}` : ''}.` },
  ], 'Save');
  if (v) await call('setSettings', v);
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
