/* Steadymade AI OS — Operating Interface
   Vanilla JS app. Reads the real project files via the local API
   (/api/system, /api/file) and writes Markdown edits back to disk. */

'use strict';

// ---------------------------------------------------------------- state

const state = {
  system: null,          // live data from /api/system
  view: 'command',
  selectedAgent: null,   // agent id selected on the map
  selectedFolder: null,  // folder name selected on the map
  chatAgent: null,       // agent preset for chat view
  chatDraft: null,       // one-shot draft preset for chat view
  kn: {
    folder: null,        // active folder key in Knowledge view
    level: '',           // folder level shown in the folder column ('' = root)
    docsMode: 'docs',    // docs | artifacts
    filter: 'all',       // all | review-needed (docs mode)
    doc: null,           // active doc path
    content: '',
    savedContent: '',
    mode: 'edit',        // edit | preview
    colWidths: null,     // persisted folder/docs column widths
    resizeObserver: null,
  },
};

const CHAT_MODE_KEY = 'steadymade.chat.mode.v1';
const DEFAULT_PROVIDER_SETTINGS = {
  runtimeMode: 'claude-subscription',
  opencodeBin: '',
  cliBridgeEnabled: false,
  envVault: [],
  updatedAt: null,
};
const uiState = {
  chatMode: 'chat',
  providerSettings: { ...DEFAULT_PROVIDER_SETTINGS },
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const VIEW_TITLES = {
  chat: 'Chat',
  command: 'Command Center',
  map: 'Agent Map',
  knowledge: 'Knowledge Docs',
  workflows: 'Workflows',
  scheduler: 'Scheduler',
  skills: 'Skill Hub',
  departments: 'Departments',
  artifacts: 'Artifacts',
  settings: 'Settings',
};

const agentById = (id) => AGENTS.find((a) => a.id === id);
const deptById = (id) => DEPARTMENTS.find((d) => d.id === id);
// an access entry covers the folder itself and every folder nested under it
const agentAccess = (a, folder) => a.access.some((acc) => folder === acc || folder.startsWith(acc + '/'));

const CHAT_PORT = Number(window.CHAT_PORT || 4012);
const CHAT_URL = `${location.protocol}//${location.hostname}:${CHAT_PORT}`;
const CHAT_AGENT_MAP = {
  danny: 'danny',
  atlas: 'atlas',
  nora: 'nora',
  mara: 'mara',
  ada: 'ada',
  clara: 'clara',
  rosa: 'rosa',
  jonas: 'jonas',
  otto: 'otto',
  dora: 'dora',
  vera: 'vera',
  noah: 'noah',
  kira: 'kira',
  simon: 'simon',
  iris: 'iris',
};

// ---------------------------------------------------------------- workflows (editable)
// data.js WORKFLOWS is the base model; user edits live in interface/workflows.json
// (overrides for built-ins, custom workflows, deleted built-in ids). FLOWS is the
// merged, effective list every view uses.

let FLOWS = WORKFLOWS.map((w) => ({ ...w, builtin: true }));
let flowsCfg = { overrides: {}, custom: [], deleted: [] };

function applyFlowsCfg(cfg) {
  flowsCfg = {
    overrides: cfg.overrides || {},
    custom: cfg.custom || [],
    deleted: cfg.deleted || [],
  };
  FLOWS = WORKFLOWS
    .filter((w) => !flowsCfg.deleted.includes(w.id))
    .map((w) => (flowsCfg.overrides[w.id]
      ? { ...w, ...flowsCfg.overrides[w.id], id: w.id, builtin: true, overridden: true }
      : { ...w, builtin: true }))
    .concat(flowsCfg.custom.map((w) => ({ ...w, builtin: false })));
}

async function saveFlowsCfg() {
  const result = await apiJson('/api/workflows', { method: 'PUT', body: JSON.stringify(flowsCfg) });
  applyFlowsCfg(result.config);
}

// Preferred folder ordering for lists
const FOLDER_ORDER = ['inbox', 'company/company_handbook_SSOT', 'company/strategy', 'company/commercial', 'company/projects', 'company/marketing', 'company/contracts', 'company/references', 'personal', 'archive'];
function sortedFolders() {
  return [...state.system.folders].sort((a, b) => {
    const ia = FOLDER_ORDER.indexOf(a.name), ib = FOLDER_ORDER.indexOf(b.name);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

function allDocs() {
  return state.system.folders.flatMap((f) => f.docs.map((d) => ({ ...d, folder: f.name })));
}

function docMeta(path) {
  return state.system.meta.docs[path] || { status: 'draft', scope: 'Unknown' };
}

function statusBadgeClass(status) {
  if (status === 'approved') return 'badge-green';
  if (status === 'needs_review' || status === 'needs review' || status === 'conflict') return 'badge-apricot';
  return 'badge-gray';
}

function safeHref(url) {
  const href = String(url || '').trim();
  const lower = href.toLowerCase();
  const allowed = lower.startsWith('http://')
    || lower.startsWith('https://')
    || lower.startsWith('mailto:')
    || href.startsWith('/')
    || href.startsWith('./')
    || href.startsWith('../')
    || href.startsWith('#');
  return allowed ? esc(href) : null;
}

function isReviewStatus(status) {
  return status === 'needs_review' || status === 'needs review' || status === 'conflict';
}

function timeAgo(ms) {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 30) return d + 'd ago';
  return new Date(ms).toLocaleDateString();
}

function toast(msg, warn = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (warn ? ' warn' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function systemWarningsNoteHtml() {
  const warnings = Array.isArray(state.system?.warnings) ? state.system.warnings : [];
  if (!warnings.length) return '';
  return `<div class="card" style="border-color:var(--apricot)">
    <div class="section-title" style="margin-bottom:6px">Workspace Warnings</div>
    <div class="stat-note" style="white-space:normal">${warnings.map((w) => esc(w)).join('<br>')}</div>
  </div>`;
}

// ---------------------------------------------------------------- boot

async function boot() {
  try {
    state.system = await (await fetch('/api/system')).json();
  } catch (e) {
    $('#view').innerHTML = '<div class="view-pad"><div class="card">Could not reach the local file API. Start the server with <code>node interface/server.mjs</code>.</div></div>';
    return;
  }
  try { applyFlowsCfg(await apiJson('/api/workflows')); } catch { /* base workflows only */ }
  const live = state.system.agents.length + 1; // +1 = Danny (docs/)
  $('#status-agents').textContent = live + ' active';
  const u = state.system.user;
  if (u) {
    const uEl = $('#status-user');
    uEl.textContent = u.name || u.id;
    if (u.role) uEl.title = u.role;
  }
  bindChrome();
  uiState.chatMode = loadStoredChatMode();
  await refreshProviderSettingsState();
  syncChatModeSwitch();
  setView('command');
  checkOnboarding(); // non-blocking: shows the onboarding guide if the workspace is not fully onboarded
}

function loadStoredChatMode() {
  try {
    const value = String(localStorage.getItem(CHAT_MODE_KEY) || '').toLowerCase();
    return value === 'cli' ? 'cli' : 'chat';
  } catch {
    return 'chat';
  }
}

function persistChatMode(mode) {
  try { localStorage.setItem(CHAT_MODE_KEY, mode); } catch { /* localStorage unavailable */ }
}

function syncChatModeSwitch() {
  $$('#chat-mode-switch [data-chat-mode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.chatMode === uiState.chatMode);
  });
}

function toggleTopbarChatControls() {
  const wrap = $('#chat-mode-switch');
  if (!wrap) return;
  wrap.classList.toggle('hidden', state.view !== 'chat');
}

function setChatMode(mode, { persist = true } = {}) {
  const next = mode === 'cli' ? 'cli' : 'chat';
  uiState.chatMode = next;
  if (persist) persistChatMode(next);
  syncChatModeSwitch();
  postChatRuntimeConfig();
}

async function refreshProviderSettingsState() {
  try {
    const payload = await apiJson('/api/provider-settings');
    uiState.providerSettings = {
      ...DEFAULT_PROVIDER_SETTINGS,
      ...(payload?.settings || {}),
      envVault: Array.isArray(payload?.settings?.envVault) ? payload.settings.envVault : [],
    };
  } catch {
    uiState.providerSettings = { ...DEFAULT_PROVIDER_SETTINGS };
  }
}

function bindChrome() {
  $$('#nav .nav-item').forEach((btn) =>
    btn.addEventListener('click', () => setView(btn.dataset.view)));

  // search
  const input = $('#search');
  const results = $('#search-results');
  input.addEventListener('input', () => renderSearch(input.value.trim()));
  input.addEventListener('focus', () => renderSearch(input.value.trim()));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) results.classList.add('hidden');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
    if ((e.metaKey || e.ctrlKey) && e.key === 's' && state.view === 'knowledge') {
      e.preventDefault();
      saveDoc();
    }
  });

  $$('#chat-mode-switch [data-chat-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setChatMode(btn.dataset.chatMode));
  });
}

function openChat(agentId, draftMessage) {
  state.chatAgent = agentId || null;
  state.chatDraft = draftMessage || null;
  setView('chat');
}

function setView(view) {
  state.view = view;
  state.selectedAgent = state.selectedFolder = null;
  if (mapState.observer && view !== 'map') { mapState.observer.disconnect(); mapState.observer = null; }
  if (state.kn.resizeObserver && view !== 'knowledge') { state.kn.resizeObserver.disconnect(); state.kn.resizeObserver = null; }
  $$('#nav .nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#view-title').textContent = VIEW_TITLES[view];
  toggleTopbarChatControls();
  closeDrawer();
  const el = $('#view');
  const holder = $('#chat-holder');
  const isChat = view === 'chat';

  holder.classList.toggle('hidden', !isChat);
  el.classList.toggle('hidden', isChat);

  if (isChat) {
    el.innerHTML = '';
    renderChat();
    return;
  }

  el.className = 'view view-enter';
  el.innerHTML = '';
  ({ command: renderCommand, map: renderMap, knowledge: renderKnowledge,
     workflows: renderWorkflows, scheduler: renderScheduler, skills: renderSkills,
      departments: renderDepartments,
       artifacts: renderArtifacts, settings: renderSettings }[view])(el);
}

// ---------------------------------------------------------------- search

function renderSearch(q) {
  const box = $('#search-results');
  if (!q) { box.classList.add('hidden'); return; }
  const ql = q.toLowerCase();
  const hits = [];

  AGENTS.filter((a) => (a.name + ' ' + a.title + ' ' + a.role).toLowerCase().includes(ql))
    .slice(0, 4).forEach((a) => hits.push({ kind: 'AGENT', label: `${a.name} — ${a.title}`, go: () => { setView('map'); selectMapAgent(a.id); } }));

  allDocs().filter((d) => (d.title + ' ' + d.path).toLowerCase().includes(ql))
    .slice(0, 5).forEach((d) => hits.push({ kind: 'DOC', label: d.title, go: () => openInEditor(d.path) }));

  FLOWS.filter((w) => w.name.toLowerCase().includes(ql))
    .slice(0, 3).forEach((w) => hits.push({ kind: 'FLOW', label: w.name, go: () => setView('workflows') }));

  box.innerHTML = hits.length
    ? hits.map((h, i) => `<button class="search-result" data-i="${i}"><span class="mono-label">${h.kind}</span><span>${esc(h.label)}</span></button>`).join('')
    : '<div class="search-result"><span class="mono-label">—</span><span>No results</span></div>';
  box.classList.remove('hidden');
  $$('.search-result[data-i]', box).forEach((btn) =>
    btn.addEventListener('click', () => { hits[+btn.dataset.i].go(); box.classList.add('hidden'); $('#search').value = ''; }));
}

// ---------------------------------------------------------------- Command Center

function renderCommand(el) {
  const docs = allDocs();
  const statuses = docs.map((d) => docMeta(d.path).status);
  const needsReview = statuses.filter((s) => isReviewStatus(s)).length;
  const approved = statuses.filter((s) => s === 'approved').length;
  const recent = [...docs].sort((a, b) => b.mtime - a.mtime).slice(0, 7);
  // Knowledge health: capped list, lowest approval ratio first (stays actionable)
  const healthAll = sortedFolders()
    .filter((f) => f.docs.length)
    .map((f) => {
      const ok = f.docs.filter((d) => docMeta(d.path).status === 'approved').length;
      return { name: f.name, ok, total: f.docs.length, pct: Math.round((ok / f.docs.length) * 100) };
    });
  const health = [...healthAll].sort((a, b) => a.pct - b.pct || b.total - a.total).slice(0, 6);

  el.innerHTML = `
  <div class="view-pad">
    <div class="cc-grid">
      <div class="card card-dark stat-card stat-link" data-goto="map" title="Open Agent Map">
        <div class="mono-label" style="color:#7E978A">AGENTS ONLINE</div>
        <div class="stat-value">${AGENTS.length}</div>
        <div class="stat-note">Danny + ${AGENTS.length - 1} specialists, ${DEPARTMENTS.length} departments</div>
      </div>
      <div class="card stat-card stat-link" data-goto="knowledge" title="Open Knowledge Docs">
        <div class="mono-label">KNOWLEDGE DOCS</div>
        <div class="stat-value">${docs.length}</div>
        <div class="stat-note">${state.system.folders.length} folders, Markdown on disk</div>
      </div>
      <div class="card stat-card stat-link" data-act="review-items" title="Open review-needed docs in Knowledge Docs">
        <div class="mono-label">OPEN REVIEW ITEMS</div>
        <div class="stat-value" style="color:${needsReview ? 'var(--apricot-deep)' : 'var(--headline)'}">${needsReview}</div>
        <div class="stat-note">${approved} approved · ${docs.length - approved - needsReview} draft</div>
      </div>
      <div class="card stat-card stat-link" data-goto="workflows" title="Open Workflows">
        <div class="mono-label">WORKFLOWS</div>
        <div class="stat-value">${FLOWS.length}</div>
        <div class="stat-note">All routed through Danny</div>
      </div>
      <div class="card stat-card stat-link" data-act="usage-details" title="Open usage details">
        <div class="mono-label">USAGE</div>
        <div class="stat-value" id="cc-usage-cost">…</div>
        <div class="stat-note" id="cc-usage-note">Loading usage summary…</div>
      </div>
    </div>

    <div class="cc-cols">
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card">
          <div class="section-title">Recently Edited Knowledge</div>
          ${recent.map((d) => `
            <button class="list-row" data-open="${esc(d.path)}">
              <span class="badge ${statusBadgeClass(docMeta(d.path).status)}">${docMeta(d.path).status.toUpperCase()}</span>
              <span class="list-title">${esc(d.title)}</span>
              <span class="list-meta">${esc(d.folder)} · ${timeAgo(d.mtime)}</span>
            </button>`).join('')}
        </div>
        <div class="card">
          <div class="section-title">Active Agents</div>
          <div class="agent-pill-grid">
            ${AGENTS.map((a) => `<button class="agent-pill" data-agent="${a.id}"><span class="dot"></span>${a.name}<span class="mono-label">${esc(a.title)}</span></button>`).join('')}
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card">
          <div class="section-title" style="display:flex;align-items:center;gap:8px"><span style="flex:1">Knowledge Health</span><button class="chip" data-goto="knowledge">VIEW ALL</button></div>
          ${health.map((f) => `<div class="kh-row kh-link" data-kh="${esc(f.name)}" title="Open in Knowledge Docs">
              <span style="font-weight:600;color:var(--headline)">${esc(f.name)}</span>
              <span class="kh-bar"><i style="width:${f.pct}%"></i></span>
              <span class="list-meta">${f.ok}/${f.total} approved</span>
            </div>`).join('')}
          ${healthAll.length > health.length ? `<div class="stat-note" style="margin-top:6px">Lowest approval ratio first · ${healthAll.length - health.length} more folders in Knowledge Docs.</div>` : ''}
        </div>
        <div class="card">
          <div class="section-title" style="display:flex;align-items:center;gap:8px"><span style="flex:1">Recent Artifacts</span><button class="chip" data-goto="artifacts">VIEW ALL</button></div>
          ${state.system.artifacts.length ? state.system.artifacts.slice(0, 6).map((a) => `
            <button class="list-row" data-art-open="${esc(a.path)}" title="Open file">
              <span class="badge badge-gray">FILE</span>
              <span class="list-title">${esc(a.name)}</span>
              <span class="list-meta">${timeAgo(a.ctime || a.mtime)}</span>
            </button>`).join('') : '<div class="stat-note">No artifacts yet.</div>'}
        </div>
        <div class="card card-dark">
          <div class="section-title" style="color:#7E978A">Operating Principle</div>
          <div style="font-family:var(--font-display);font-size:14px;color:var(--white);line-height:1.5">
            One orchestrator, ${AGENTS.length - 1} specialists, knowledge as editable Markdown — nothing ships without review and approval.
          </div>
        </div>
      </div>
    </div>
  </div>`;

  $$('[data-open]', el).forEach((b) => b.addEventListener('click', () => openInEditor(b.dataset.open)));
  $$('[data-agent]', el).forEach((b) => b.addEventListener('click', () => { setView('map'); selectMapAgent(b.dataset.agent); }));
  $$('[data-goto]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); setView(b.dataset.goto); }));
  $('[data-act="usage-details"]', el)?.addEventListener('click', openUsageDrawer);
  $('[data-act="review-items"]', el)?.addEventListener('click', () => activateKnowledgeReviewFilter());
  $$('[data-kh]', el).forEach((b) => b.addEventListener('click', () => selectKnFolder(b.dataset.kh)));
  $$('[data-art-open]', el).forEach((b) => b.addEventListener('click', () =>
    window.open('/api/artifact?path=' + encodeURIComponent(b.dataset.artOpen), '_blank')));
  refreshCommandUsageCard(el);
}

async function refreshCommandUsageCard(el) {
  const costEl = $('#cc-usage-cost', el);
  const noteEl = $('#cc-usage-note', el);
  if (!costEl || !noteEl) return;
  try {
    const data = await apiJson('/api/usage');
    if (state.view !== 'command') return;
    const s = data.summary || {};
    costEl.textContent = fmtUsd(s.total_cost_usd);
    noteEl.textContent = `${fmtInt(s.count)} entries · ${fmtInt(s.sessions)} sessions · ${fmtInt(s.total_tokens)} tokens`;
  } catch {
    costEl.textContent = '—';
    noteEl.textContent = 'Usage unavailable';
  }
}

function activateKnowledgeReviewFilter({ openDrawer = false } = {}) {
  const reviewDocs = allDocs().filter((d) => isReviewStatus(docMeta(d.path).status));
  state.kn.filter = 'review-needed';
  state.kn.docsMode = 'docs';
  state.kn.doc = null;

  const current = knFolderList().find((f) => f.key === state.kn.folder);
  const currentHasReview = Boolean(current?.docs?.some((d) => isReviewStatus(docMeta(d.path).status)));
  if (!currentHasReview && reviewDocs.length) {
    const target = reviewDocs[0];
    const targetFolder = knFolderList().find((f) => f.docs.some((d) => d.path === target.path));
    if (targetFolder) {
      state.kn.folder = targetFolder.key;
      state.kn.level = knChildren(targetFolder.key).length ? targetFolder.key : knParent(targetFolder.key);
    }
  }

  if (state.view !== 'knowledge') setView('knowledge');
  else { paintKnFolders(); paintKnDocs(); paintKnEditor(); }

  if (openDrawer) openReviewDrawer();
}

// Optional helper drawer: every doc waiting for review/conflict resolution.
function openReviewDrawer() {
  const items = allDocs().filter((d) =>
    isReviewStatus(docMeta(d.path).status));
  openDrawer(`
    <div class="drawer-head">
      <button class="drawer-close">✕</button>
      <div class="drawer-dept">REVIEW QUEUE</div>
      <div class="drawer-name">Open Review Items</div>
      <div class="drawer-role">${items.length} document${items.length === 1 ? '' : 's'} with needs_review or conflict status.</div>
    </div>
    <div class="drawer-body">
      <div class="drawer-section">
        ${items.map((d) => `
          <button class="list-row" data-open="${esc(d.path)}">
            <span class="badge ${statusBadgeClass(docMeta(d.path).status)}">${docMeta(d.path).status.toUpperCase()}</span>
            <span class="list-title">${esc(d.title)}</span>
            <span class="list-meta">${esc(d.folder)}</span>
          </button>`).join('') || '<div class="stat-note">Nothing waiting for review.</div>'}
      </div>
    </div>`);
  $$('[data-open]', $('#drawer')).forEach((b) => b.addEventListener('click', () => openInEditor(b.dataset.open)));
}

// ---------------------------------------------------------------- Agent Map

const mapState = { positions: {}, folderPositions: {}, observer: null };

// the map shows only the top-level folders named in agent access lists;
// each entry aggregates the docs of everything nested underneath it
function agentFolders() {
  const names = [...new Set(AGENTS.flatMap((a) => a.access))];
  names.sort((a, b) => {
    const ia = FOLDER_ORDER.indexOf(a), ib = FOLDER_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return names.map((name) => ({
    name,
    docs: state.system.folders
      .filter((f) => f.name === name || f.name.startsWith(name + '/'))
      .flatMap((f) => f.docs),
  }));
}

// The map sizes itself to the real container (fullscreen) instead of a fixed
// viewBox — node sizes stay readable, the layout ellipse adapts. A
// ResizeObserver re-renders when the drawer opens/closes or the window resizes.
function renderMap(el) {
  drawMap(el);
  if (mapState.observer) mapState.observer.disconnect();
  let t = null, lastW = el.clientWidth, lastH = el.clientHeight;
  mapState.observer = new ResizeObserver(() => {
    if (state.view !== 'map') return;
    if (Math.abs(el.clientWidth - lastW) < 16 && Math.abs(el.clientHeight - lastH) < 16) return;
    clearTimeout(t);
    t = setTimeout(() => {
      lastW = el.clientWidth; lastH = el.clientHeight;
      drawMap(el);
      if (state.selectedAgent) applyAgentHighlight(state.selectedAgent);
      else if (state.selectedFolder) applyFolderHighlight(state.selectedFolder);
    }, 140);
  });
  mapState.observer.observe(el);
}

function drawMap(el) {
  const W = Math.max(el.clientWidth, 480);
  const H = Math.max(el.clientHeight, 420);
  // node scale follows the available map area, within readable bounds
  const s = Math.min(Math.max(Math.min(W / 1250, H / 780), 0.7), 1.45);
  const cx = W / 2, cy = H / 2;
  const agents = AGENTS.filter((a) => a.id !== 'danny');
  const folders = agentFolders();

  // ring agents grouped by department order
  const order = ['strategy', 'knowledge', 'marketing', 'sales', 'documents', 'creative', 'it'];
  agents.sort((a, b) => order.indexOf(a.dept) - order.indexOf(b.dept));

  // outer (folder) ellipse uses nearly the full container, inner ring ~62% of it
  const fR = { x: W / 2 - 118 * s, y: H / 2 - 46 * s };
  const aR = { x: fR.x * 0.60, y: fR.y * 0.62 };
  agents.forEach((a, i) => {
    const ang = -Math.PI / 2 + (i / agents.length) * Math.PI * 2;
    mapState.positions[a.id] = { x: cx + Math.cos(ang) * aR.x, y: cy + Math.sin(ang) * aR.y, ang };
  });
  mapState.positions.danny = { x: cx, y: cy };
  folders.forEach((f, i) => {
    const ang = -Math.PI / 2 + Math.PI / folders.length + (i / folders.length) * Math.PI * 2;
    mapState.folderPositions[f.name] = { x: cx + Math.cos(ang) * fR.x, y: cy + Math.sin(ang) * fR.y, ang };
  });

  // department arc labels at mid-angle of each cluster
  const halfStep = Math.PI / agents.length;
  const deptLabels = order.map((dept) => {
    const members = agents.filter((a) => a.dept === dept);
    if (!members.length) return null;
    const angs = members.map((a) => mapState.positions[a.id].ang);
    let mid = Math.atan2(angs.reduce((s2, x) => s2 + Math.sin(x), 0), angs.reduce((s2, x) => s2 + Math.cos(x), 0));
    const minAng = Math.min(...angs) - halfStep * 0.7;
    const maxAng = Math.max(...angs) + halfStep * 0.7;
    return { dept, x: cx + Math.cos(mid) * (aR.x + 100 * s), y: cy + Math.sin(mid) * (aR.y + 68 * s), minAng, maxAng };
  }).filter(Boolean);

  const edge = (x1, y1, x2, y2, cls, id) => {
    const mx = (x1 + x2) / 2 + (y2 - y1) * 0.08;
    const my = (y1 + y2) / 2 - (x2 - x1) * 0.08;
    return `<path class="edge ${cls}" data-edge="${id}" d="M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}"/>`;
  };

  let edges = '';
  // Danny ↔ every agent
  agents.forEach((a) => {
    const p = mapState.positions[a.id];
    edges += edge(cx, cy, p.x, p.y, 'hub', `danny:${a.id}`);
  });
  // agent ↔ folder access edges (lit on selection)
  AGENTS.forEach((a) => {
    const p = mapState.positions[a.id];
    folders.forEach((f) => {
      if (!agentAccess(a, f.name)) return;
      const fp = mapState.folderPositions[f.name];
      edges += edge(p.x, p.y, fp.x, fp.y, 'acc', `${a.id}>${f.name}`);
    });
  });

  const agentNode = (a) => {
    const p = mapState.positions[a.id];
    const w = 178, h = 66;
    return `<g class="node node-agent" data-node-agent="${a.id}" transform="translate(${p.x - (w * s) / 2},${p.y - (h * s) / 2}) scale(${s})">
      <rect class="node-box" width="${w}" height="${h}" rx="10"/>
      <circle class="node-dot" cx="18" cy="24" r="4"/>
      <text class="node-name" x="32" y="28">${esc(a.name)}</text>
      <text class="node-role" x="14" y="48">${esc(a.title)}</text>
    </g>`;
  };

  const folderNode = (f) => {
    const p = mapState.folderPositions[f.name];
    // long nested paths show only their last two segments; the drawer has the full path
    const label = f.name.length > 30 ? '…/' + f.name.split('/').slice(-2).join('/') : f.name;
    const w = Math.max(120, label.length * 7.5 + 56), h = 46;
    return `<g class="node node-folder" data-node-folder="${esc(f.name)}" transform="translate(${p.x - (w * s) / 2},${p.y - (h * s) / 2}) scale(${s})">
      <rect class="node-box" width="${w}" height="${h}" rx="20"/>
      <path d="M 17 ${h / 2 - 5} h 4 l 2 2 h 6 v 8 h -12 z" fill="none" stroke="var(--green-light)" stroke-width="1.2"/>
      <text class="node-name" x="36" y="${h / 2 - 3}">${esc(label)}/</text>
      <text class="node-role" x="36" y="${h / 2 + 13}">${f.docs.length} DOCS</text>
    </g>`;
  };

  const hubW = 260, hubH = 124;
  el.innerHTML = `
  <div class="map-wrap">
    <svg class="map-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <ellipse class="hub-ring" cx="${cx}" cy="${cy}" rx="${aR.x}" ry="${aR.y}"/>
      <ellipse class="hub-ring" cx="${cx}" cy="${cy}" rx="${fR.x}" ry="${fR.y}" stroke-dasharray="3 6"/>
      ${deptLabels.map((d) => {
        const x1 = cx + Math.cos(d.minAng) * aR.x, y1 = cy + Math.sin(d.minAng) * aR.y;
        const x2 = cx + Math.cos(d.maxAng) * aR.x, y2 = cy + Math.sin(d.maxAng) * aR.y;
        const la = (d.maxAng - d.minAng) > Math.PI ? 1 : 0;
        return `<path class="dept-arc" d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${aR.x.toFixed(1)} ${aR.y.toFixed(1)} 0 ${la} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}"/>`;
      }).join('')}
      ${edges}
      ${deptLabels.map((d) => `<text class="dept-label" text-anchor="middle" x="${d.x.toFixed(1)}" y="${d.y.toFixed(1)}" style="font-size:${(12 * s).toFixed(1)}px">${esc(deptById(d.dept).name.toUpperCase())}</text>`).join('')}
      ${folders.map(folderNode).join('')}
      ${agents.map(agentNode).join('')}
      <g class="hub" data-node-agent="danny" transform="translate(${cx - (hubW * s) / 2},${cy - (hubH * s) / 2}) scale(${s})">
        <circle class="hub-pulse" cx="${hubW / 2}" cy="${hubH / 2}" r="${hubW * 0.72}"/>
        <rect class="hub-box" width="${hubW}" height="${hubH}" rx="14"/>
        <circle cx="28" cy="34" r="5" fill="var(--green)"/>
        <text class="hub-name" x="44" y="40">Danny</text>
        <text class="hub-role" x="28" y="62">ORCHESTRATOR · CORE</text>
        <text class="hub-desc" x="28" y="84">Routes requests, coordinates agents,</text>
        <text class="hub-desc" x="28" y="98">retrieves context, manages approval.</text>
      </g>
    </svg>
    <div class="map-hint">CLICK AN AGENT OR FOLDER TO INSPECT ACCESS + WORKFLOWS</div>
    <div class="map-legend">
      <div class="legend-row"><span class="legend-swatch"></span> DANNY ROUTING</div>
      <div class="legend-row"><span class="legend-swatch green"></span> KNOWLEDGE ACCESS (SELECTED)</div>
      <div class="legend-row"><span class="legend-dot"></span> AGENT</div>
      <div class="legend-row"><span class="legend-dot folder"></span> AGENT-CONNECTED FOLDER</div>
    </div>
  </div>`;

  // default: access edges almost invisible until selection
  $$('.edge.acc', el).forEach((e) => (e.style.opacity = 0.10));

  $$('[data-node-agent]', el).forEach((n) =>
    n.addEventListener('click', (e) => { e.stopPropagation(); selectMapAgent(n.dataset.nodeAgent); }));
  $$('[data-node-folder]', el).forEach((n) =>
    n.addEventListener('click', (e) => { e.stopPropagation(); selectMapFolder(n.dataset.nodeFolder); }));
  $('.map-svg', el).addEventListener('click', clearMapSelection);
}

function clearMapSelection() {
  state.selectedAgent = state.selectedFolder = null;
  $$('.node, .hub').forEach((n) => n.classList.remove('selected', 'dim', 'lit'));
  $$('.edge').forEach((e) => {
    e.classList.remove('lit', 'dim');
    e.style.opacity = e.classList.contains('acc') ? 0.10 : '';
  });
  closeDrawer();
}

function selectMapAgent(id) {
  if (state.view !== 'map') { setView('map'); }
  requestAnimationFrame(() => {
    applyAgentHighlight(id);
    openAgentDrawer(id);
  });
}

function applyAgentHighlight(id) {
  clearHighlights();
  state.selectedAgent = id;
  state.selectedFolder = null;
  const a = agentById(id);
  const connected = new Set([id, 'danny']);
  $$('.edge').forEach((e) => {
    const eid = e.dataset.edge;
    if (eid === `danny:${id}` || (id === 'danny' && eid.startsWith('danny:'))) {
      e.classList.add('lit'); e.style.opacity = '';
    } else if (eid.startsWith(id + '>')) {
      e.classList.add('lit'); e.style.opacity = '';
    } else {
      e.classList.add('dim');
      e.style.opacity = e.classList.contains('acc') ? 0.04 : '';
    }
  });
  $$('.node-agent, .hub').forEach((n) => {
    const nid = n.dataset.nodeAgent;
    if (id === 'danny') { n.classList.add(nid === 'danny' ? 'selected' : 'lit'); return; }
    n.classList.toggle('selected', nid === id);
    n.classList.toggle('dim', !connected.has(nid));
  });
  $$('.node-folder').forEach((n) => {
    const lit = agentAccess(a, n.dataset.nodeFolder);
    n.classList.toggle('lit', lit);
    n.classList.toggle('dim', !lit);
  });
}

function selectMapFolder(name) {
  applyFolderHighlight(name);
  openFolderDrawer(name);
}

function applyFolderHighlight(name) {
  clearHighlights();
  state.selectedFolder = name;
  state.selectedAgent = null;
  const withAccess = AGENTS.filter((a) => agentAccess(a, name)).map((a) => a.id);
  $$('.edge').forEach((e) => {
    const eid = e.dataset.edge;
    if (eid.endsWith('>' + name)) { e.classList.add('lit'); e.style.opacity = ''; }
    else { e.classList.add('dim'); e.style.opacity = e.classList.contains('acc') ? 0.04 : ''; }
  });
  $$('.node-agent, .hub').forEach((n) =>
    n.classList.toggle('dim', !withAccess.includes(n.dataset.nodeAgent)));
  $$('.node-folder').forEach((n) => {
    n.classList.toggle('lit', n.dataset.nodeFolder === name);
    n.classList.toggle('dim', n.dataset.nodeFolder !== name);
  });
}

function clearHighlights() {
  $$('.node, .hub').forEach((n) => n.classList.remove('selected', 'dim', 'lit'));
  $$('.edge').forEach((e) => { e.classList.remove('lit', 'dim'); e.style.opacity = e.classList.contains('acc') ? 0.10 : ''; });
}

const LEVEL_RANK = { deny: 0, read: 1, ask: 2, write: 3 };
const LEVEL_LABEL = { deny: 'DENY', read: 'READ', ask: 'ASK', write: 'WRITE' };

function folderRulesMap(status) {
  const out = {};
  for (const f of status.folders || []) if (f.level) out[f.folder] = f.level;
  return out;
}

function globalLevelForFolder(folder, rules) {
  let best = null;
  for (const [k, level] of Object.entries(rules || {})) {
    if (folder === k || folder.startsWith(k + '/')) {
      if (!best || k.length > best.key.length) best = { key: k, level };
    }
  }
  return best ? best.level : 'write';
}

function effectiveLevel(global, override) {
  if (!override) return global;
  return LEVEL_RANK[override] < LEVEL_RANK[global] ? override : global;
}

function allowedOverrides(global) {
  return ['deny', 'read', 'ask', 'write'].filter((l) => LEVEL_RANK[l] <= LEVEL_RANK[global]);
}

async function fillAgentContextAccess(a) {
  const summary = $('#agent-access-summary');
  const panel = $('#agent-access-editor');
  const toggle = $('[data-act="cfg-access"]');
  if (!summary || !panel || !toggle) return;

  let status;
  try { status = await apiJson('/api/guardrails'); }
  catch { summary.textContent = 'Guardrails unavailable.'; return; }

  let open = false;
  let dirty = false;
  let agentRules = { ...(status.agents?.[a.id] || {}) };
  const globalRules = folderRulesMap(status);
  const defaultCoverage = new Set((a.access || []).map((acc) => {
    if (acc.startsWith('company/') || acc === 'inbox' || acc === 'personal') return `knowledge/${acc}`;
    return acc;
  }));
  let entries = [...new Set([
    ...Object.keys(agentRules),
    ...(status.folders || []).filter((f) => f.level).map((f) => f.folder),
    ...[...defaultCoverage],
  ])].sort((x, y) => x.localeCompare(y));

  const updateSummary = () => {
    const count = Object.keys(agentRules).length;
    summary.innerHTML = count
      ? `${count} override${count === 1 ? '' : 's'} defined. Global guardrails still set the maximum access.`
      : 'No per-agent overrides. This agent currently inherits global guardrails.';
  };

  const renderPanel = () => {
    if (!open) { panel.style.display = 'none'; panel.innerHTML = ''; return; }
    panel.style.display = 'block';
    panel.innerHTML = `
      <div class="gr-add-row" style="margin-bottom:8px">
        <input class="filter-input" id="ag-add-path" type="text" placeholder="add subfolder, e.g. knowledge/company/commercial/opportunities/ndr" style="flex:1;min-width:220px">
        <button class="chip" data-ag-add>ADD</button>
      </div>
      ${entries.map((folder) => {
        const global = globalLevelForFolder(folder, globalRules);
        const override = agentRules[folder] || '';
        const effective = effectiveLevel(global, override || null);
        const opts = allowedOverrides(global);
        const disabled = global === 'deny';
        const custom = !defaultCoverage.has(folder);
        return `<div class="gr-row">
          <span class="gr-folder" style="min-width:220px">${esc(folder)}/</span>
          <span class="list-meta" style="min-width:88px">GLOBAL ${LEVEL_LABEL[global]}</span>
          <select class="filter-input" data-ag-folder="${esc(folder)}" ${disabled ? 'disabled' : ''} style="min-width:130px">
            <option value="">inherit</option>
            ${opts.map((l) => `<option value="${l}" ${override === l ? 'selected' : ''}>${LEVEL_LABEL[l]}</option>`).join('')}
          </select>
          <span class="list-meta" style="min-width:88px">EFFECTIVE ${LEVEL_LABEL[effective]}</span>
          ${custom ? `<button class="chip" data-ag-remove="${esc(folder)}" style="color:var(--apricot-deep)">REMOVE</button>` : ''}
        </div>`;
      }).join('')}
      <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-primary btn-small" data-ag-save ${dirty ? '' : 'disabled'}>Save Context Access</button>
        <span class="stat-note">Agent permissions inherit global guardrails and cannot exceed them.</span>
      </div>`;

    $('[data-ag-add]', panel)?.addEventListener('click', () => {
      const raw = ($('#ag-add-path', panel)?.value || '').trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
      if (!raw) return toast('ENTER A SUBFOLDER PATH', true);
      if (raw.includes('..') || raw.startsWith('/')) return toast('INVALID PATH', true);
      if (!entries.includes(raw)) entries.push(raw);
      entries.sort((x, y) => x.localeCompare(y));
      dirty = true;
      renderPanel();
    });

    $$('[data-ag-folder]', panel).forEach((sel) => sel.addEventListener('change', () => {
      const folder = sel.dataset.agFolder;
      if (sel.value) agentRules[folder] = sel.value;
      else delete agentRules[folder];
      dirty = true;
      renderPanel();
    }));

    $$('[data-ag-remove]', panel).forEach((b) => b.addEventListener('click', () => {
      const folder = b.dataset.agRemove;
      entries = entries.filter((f) => f !== folder);
      delete agentRules[folder];
      dirty = true;
      renderPanel();
    }));

    $('[data-ag-save]', panel)?.addEventListener('click', async () => {
      const agents = JSON.parse(JSON.stringify(status.agents || {}));
      if (Object.keys(agentRules).length) agents[a.id] = agentRules;
      else delete agents[a.id];
      try {
        const result = await apiJson('/api/guardrails', {
          method: 'PUT',
          body: JSON.stringify({ folders: globalRules, agents }),
        });
        status = result.status;
        Object.keys(globalRules).forEach((k) => delete globalRules[k]);
        Object.assign(globalRules, folderRulesMap(status));
        agentRules = { ...(status.agents?.[a.id] || {}) };
        entries = [...new Set([
          ...Object.keys(agentRules),
          ...(status.folders || []).filter((f) => f.level).map((f) => f.folder),
          ...[...defaultCoverage],
        ])].sort((x, y) => x.localeCompare(y));
        dirty = false;
        updateSummary();
        renderPanel();
        toast(`${a.name.toUpperCase()} CONTEXT ACCESS SAVED`);
      } catch (e) {
        toast(e.message.toUpperCase(), true);
      }
    });
  };

  toggle.addEventListener('click', () => {
    open = !open;
    toggle.textContent = open ? 'Close' : 'Configure';
    renderPanel();
  });

  updateSummary();
  renderPanel();
}

// ---------------------------------------------------------------- Drawer

function openDrawer(html) {
  const d = $('#drawer');
  d.innerHTML = `<div class="drawer-inner">${html}</div>`;
  d.classList.add('open');
  $('.drawer-close', d).addEventListener('click', closeDrawer);
}

function closeDrawer() {
  $('#drawer').classList.remove('open');
}

function openAgentDrawer(id) {
  const a = agentById(id);
  const restricted = agentFolders().map((f) => f.name).filter((n) => !agentAccess(a, n));
  const flows = FLOWS.filter((w) => w.chain.includes(a.id));
  const live = state.system.agents.find((x) => x.path === a.promptPath);

  openDrawer(`
    <div class="drawer-head">
      <button class="drawer-close">✕</button>
      <div class="drawer-dept">${esc(deptById(a.dept).name)} DEPARTMENT</div>
      <div class="drawer-name">${esc(a.name)} — ${esc(a.title)}</div>
      <div class="drawer-role">${esc(a.role)}</div>
    </div>
    <div class="drawer-body">
      <div class="drawer-section">
        <div class="section-title">Status</div>
        <span class="badge badge-green">ACTIVE</span>
        ${live ? `<span class="badge badge-gray" style="margin-left:6px">PROMPT ${timeAgo(live.mtime).toUpperCase()}</span>` : ''}
      </div>
      <div class="drawer-section">
        <div class="section-title">Responsibilities</div>
        <ul>${a.responsibilities.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      </div>
      <div class="drawer-section">
        <div class="section-title">Inputs → Outputs</div>
        <ul>${a.inputs.map((r) => `<li>IN — ${esc(r)}</li>`).join('')}${a.outputs.map((r) => `<li>OUT — ${esc(r)}</li>`).join('')}</ul>
      </div>
      <div class="drawer-section">
        <div class="section-title">Default Context Coverage</div>
        <div class="tag-row">${a.access.map((f) => `<button class="chip" data-folder="${esc(f)}">${esc(f)}/</button>`).join('')}</div>
      </div>
      <div class="drawer-section">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div class="section-title" style="margin:0;flex:1">Context Access Policy</div>
          <button class="chip" data-act="cfg-access">Configure</button>
        </div>
        <div id="agent-access-summary" class="stat-note" style="white-space:normal">Loading guardrails…</div>
        <div id="agent-access-editor" style="display:none;margin-top:8px"></div>
      </div>
      ${restricted.length ? `<div class="drawer-section">
        <div class="section-title">Restricted</div>
        <div class="tag-row">${restricted.map((f) => `<span class="chip" style="border-style:dashed;color:var(--muted);cursor:default">${esc(f)}/</span>`).join('')}</div>
      </div>` : ''}
      <div class="drawer-section">
        <div class="section-title">Workflows</div>
        <div class="tag-row">${flows.map((w) => `<button class="chip" data-flow>${esc(w.name)}</button>`).join('')}</div>
      </div>
      <div class="drawer-section">
        <div class="section-title">No-Go Rules</div>
        <ul>${a.noGo.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      </div>
      <div class="drawer-section">
        <div class="section-title">Prompt File</div>
        <div class="path-line">${esc(a.promptPath)}</div>
      </div>
      ${a.promptPath.startsWith('.claude/agents/') ? `
      <div class="drawer-section">
        <div class="section-title">Plugins</div>
        <div id="agent-plugins-body" class="stat-note" style="white-space:normal">Loading plugins…</div>
      </div>` : ''}
      <div class="drawer-actions">
        <button class="btn btn-green btn-small" data-act="open-chat">Ask in Chat</button>
        <button class="btn btn-green btn-small" data-act="open-prompt">Open prompt</button>
        <button class="btn btn-small" data-act="edit-prompt">Edit prompt</button>
        <button class="btn btn-small" data-act="view-knowledge">View connected knowledge</button>
        <button class="btn btn-small" data-act="test-task">Run test task</button>
      </div>
    </div>`);

  const d = $('#drawer');
  $$('[data-folder]', d).forEach((b) => b.addEventListener('click', () => { setView('knowledge'); selectKnFolder(b.dataset.folder); }));
  $$('[data-flow]', d).forEach((b) => b.addEventListener('click', () => setView('workflows')));
  $('[data-act="open-chat"]', d).addEventListener('click', () => {
    closeDrawer();
    openChat(a.id, `Task for ${a.name}: <describe what you want help with>`);
  });
  $('[data-act="open-prompt"]', d).addEventListener('click', () => openInEditor(a.promptPath, 'preview'));
  $('[data-act="edit-prompt"]', d).addEventListener('click', () => openInEditor(a.promptPath, 'edit'));
  $('[data-act="view-knowledge"]', d).addEventListener('click', () => { closeDrawer(); if (state.view !== 'map') setView('map'); requestAnimationFrame(() => selectMapAgent(a.id)); });
  $('[data-act="test-task"]', d).addEventListener('click', () => {
    const brief = `**Subagent:** ${a.name} — ${a.title}\n**Workflow Type:** ${a.workflows[0]}\n**Task:** <describe the test task>\n**Context:** <only the relevant context>\n**Required Output:** <expected format>`;
    navigator.clipboard?.writeText(brief);
    toast('TASK BRIEF COPIED — PASTE INTO CLAUDE (LIVE AGENT EXECUTION PENDING)', true);
  });
  if (a.promptPath.startsWith('.claude/agents/')) fillAgentPlugins(a);
  fillAgentContextAccess(a);
}

// Plugins section in the agent drawer: assign plugins that are enabled in
// Settings to this agent. Persisted as a `plugins:` frontmatter line in the
// agent's prompt file.
async function fillAgentPlugins(a) {
  const box = $('#agent-plugins-body');
  if (!box) return;
  let plugins;
  try { ({ plugins } = await apiJson('/api/plugins')); }
  catch { box.textContent = 'Plugin manager unavailable.'; return; }
  const enabled = plugins.filter((p) => p.enabled);
  const live = state.system.agents.find((x) => x.path === a.promptPath) || {};
  const current = new Set(live.plugins || []);

  if (!enabled.length) {
    box.innerHTML = 'No plugins are enabled — enable plugins in Settings first, then assign them here.';
    return;
  }
  box.innerHTML = enabled.map((p) => `
    <label class="agent-plugin-row">
      <input type="checkbox" data-ap="${esc(p.id)}" ${current.has(p.id) ? 'checked' : ''}>
      <span>${esc(p.name)} <span class="list-meta">· ${esc(p.kind)}</span></span>
    </label>`).join('') +
    '<div class="stat-note" style="margin-top:6px;white-space:normal">Only plugins enabled in Settings can be assigned. Saved to the agent\'s frontmatter (<code>plugins:</code>) — new Claude sessions pick it up.</div>';

  $$('[data-ap]', box).forEach((cb) => cb.addEventListener('change', async () => {
    const selected = $$('[data-ap]', box).filter((x) => x.checked).map((x) => x.dataset.ap);
    try {
      await apiJson('/api/agent-plugins', { method: 'PUT', body: JSON.stringify({ path: a.promptPath, plugins: selected }) });
      if (state.system.agents.find((x) => x.path === a.promptPath)) {
        state.system.agents.find((x) => x.path === a.promptPath).plugins = selected;
      }
      toast(`${a.name.toUpperCase()} PLUGINS SAVED: ${selected.join(', ').toUpperCase() || 'NONE'}`);
    } catch (e) {
      cb.checked = !cb.checked; // revert the failed toggle
      toast(e.message.toUpperCase(), true);
    }
  }));
}

function openFolderDrawer(name) {
  // aggregate the folder itself and everything nested under it, matching the map node
  const docs = state.system.folders
    .filter((x) => x.name === name || x.name.startsWith(name + '/'))
    .flatMap((x) => x.docs);
  const withAccess = AGENTS.filter((a) => agentAccess(a, name));
  const flows = FLOWS.filter((w) => w.chain.some((id) => withAccess.some((a) => a.id === id)));
  const last = docs.length ? Math.max(...docs.map((d) => d.mtime)) : null;

  openDrawer(`
    <div class="drawer-head">
      <button class="drawer-close">✕</button>
      <div class="drawer-dept">KNOWLEDGE FOLDER</div>
      <div class="drawer-name">${esc(name)}/</div>
      <div class="drawer-role">${docs.length} Markdown document${docs.length === 1 ? '' : 's'} incl. subfolders${last ? ' · last modified ' + timeAgo(last) : ''}</div>
    </div>
    <div class="drawer-body">
      <div class="drawer-section">
        <div class="section-title">Agents With Access</div>
        <div class="tag-row">${withAccess.map((a) => `<button class="chip" data-agent="${a.id}">${esc(a.name)}</button>`).join('') || '<span class="stat-note">None</span>'}</div>
      </div>
      <div class="drawer-section">
        <div class="section-title">Documents</div>
        ${docs.map((doc) => `
          <button class="list-row" data-open="${esc(doc.path)}">
            <span class="badge ${statusBadgeClass(docMeta(doc.path).status)}">${docMeta(doc.path).status.toUpperCase()}</span>
            <span class="list-title">${esc(doc.title)}</span>
            <span class="list-meta">${timeAgo(doc.mtime)}</span>
          </button>`).join('') || '<span class="stat-note">Empty folder.</span>'}
      </div>
      <div class="drawer-section">
        <div class="section-title">Related Workflows</div>
        <div class="tag-row">${flows.map((w) => `<button class="chip" data-flow>${esc(w.name)}</button>`).join('')}</div>
      </div>
      <div class="drawer-actions">
        <button class="btn btn-green btn-small" data-act="open-folder">Open in Knowledge Docs</button>
      </div>
    </div>`);

  const d = $('#drawer');
  $$('[data-agent]', d).forEach((b) => b.addEventListener('click', () => selectMapAgent(b.dataset.agent)));
  $$('[data-open]', d).forEach((b) => b.addEventListener('click', () => openInEditor(b.dataset.open)));
  $$('[data-flow]', d).forEach((b) => b.addEventListener('click', () => setView('workflows')));
  $('[data-act="open-folder"]', d).addEventListener('click', () => { setView('knowledge'); selectKnFolder(name); });
}

// ---------------------------------------------------------------- Knowledge Docs

// Pseudo-folders so agent prompts + system docs are editable too
function knFolderList() {
  const list = sortedFolders().map((f) => ({ key: f.name, label: f.name + '/', docs: f.docs, kind: 'knowledge' }));
  list.push({ key: '_agents', label: '.claude/agents/', docs: state.system.agents, kind: 'system' });
  list.push({ key: '_system', label: 'docs/ + root', docs: state.system.docs, kind: 'system' });
  return list;
}

// Hierarchical view over the flat folder list. Folder keys are paths
// ("company/marketing/03_Social_Media"); the folder column shows one level at
// a time (Finder-style drill-down) with a breadcrumb to jump back up.
function knParent(key) {
  const i = key.lastIndexOf('/');
  return i === -1 ? '' : key.slice(0, i);
}

// direct children of a level: real subfolders (incl. pure container dirs that
// only exist as path prefixes) + the system pseudo-folders at root
function knChildren(level) {
  const prefix = level ? level + '/' : '';
  const map = new Map();
  for (const f of knFolderList()) {
    if (f.kind === 'system') {
      if (!level) map.set(f.key, { key: f.key, label: f.label, kind: 'system', docs: f.docs.length, subDocs: 0, subs: new Set(), hasEntry: true });
      continue;
    }
    if (!f.key.startsWith(prefix) || f.key === level) continue;
    const seg = f.key.slice(prefix.length).split('/')[0];
    const childKey = prefix + seg;
    let node = map.get(childKey);
    if (!node) {
      node = { key: childKey, label: seg + '/', kind: 'knowledge', docs: 0, subDocs: 0, subs: new Set(), hasEntry: false };
      map.set(childKey, node);
    }
    if (f.key === childKey) { node.docs = f.docs.length; node.hasEntry = true; }
    else { node.subs.add(f.key.slice(childKey.length + 1).split('/')[0]); node.subDocs += f.docs.length; }
  }
  return [...map.values()];
}

const KN_COLS_KEY = 'steadymade.kn.cols.v1';
const KN_COL_DEFAULTS = {
  wide: { folders: 215, docs: 285 },
  narrow: { folders: 180, docs: 235 },
};
const KN_COL_LIMITS = {
  folders: { min: 150, max: 420 },
  docs: { min: 180, max: 520 },
  editorMin: 320,
};

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function loadKnColWidths() {
  try {
    const raw = JSON.parse(localStorage.getItem(KN_COLS_KEY) || '{}');
    if (Number.isFinite(raw.folders) && Number.isFinite(raw.docs)) {
      return { folders: Math.round(raw.folders), docs: Math.round(raw.docs) };
    }
  } catch { /* ignore invalid localStorage */ }
  return null;
}

function saveKnColWidths(widths) {
  if (!widths) return;
  localStorage.setItem(KN_COLS_KEY, JSON.stringify({ folders: Math.round(widths.folders), docs: Math.round(widths.docs) }));
}

function normalizedKnColWidths(layout, widths = state.kn.colWidths || loadKnColWidths()) {
  const total = Math.round(layout.clientWidth || 0);
  const defaults = total && total <= 1080 ? KN_COL_DEFAULTS.narrow : KN_COL_DEFAULTS.wide;
  let folders = Number.isFinite(widths?.folders) ? widths.folders : defaults.folders;
  let docs = Number.isFinite(widths?.docs) ? widths.docs : defaults.docs;

  const maxFolders = total ? Math.min(KN_COL_LIMITS.folders.max, Math.floor(total * 0.5)) : KN_COL_LIMITS.folders.max;
  const maxDocs = total ? Math.min(KN_COL_LIMITS.docs.max, Math.floor(total * 0.6)) : KN_COL_LIMITS.docs.max;
  folders = clamp(Math.round(folders), KN_COL_LIMITS.folders.min, Math.max(KN_COL_LIMITS.folders.min, maxFolders));
  docs = clamp(Math.round(docs), KN_COL_LIMITS.docs.min, Math.max(KN_COL_LIMITS.docs.min, maxDocs));

  if (total) {
    const maxCombined = Math.max(KN_COL_LIMITS.folders.min + KN_COL_LIMITS.docs.min, total - KN_COL_LIMITS.editorMin);
    if (folders + docs > maxCombined) {
      let excess = folders + docs - maxCombined;
      const docsHeadroom = docs - KN_COL_LIMITS.docs.min;
      const decDocs = Math.min(excess, docsHeadroom);
      docs -= decDocs;
      excess -= decDocs;
      if (excess > 0) {
        const folderHeadroom = folders - KN_COL_LIMITS.folders.min;
        folders -= Math.min(excess, folderHeadroom);
      }
    }
  }

  return { folders, docs };
}

function applyKnColWidths(layout) {
  const widths = normalizedKnColWidths(layout);
  state.kn.colWidths = widths;
  layout.style.setProperty('--kn-col-1', `${widths.folders}px`);
  layout.style.setProperty('--kn-col-2', `${widths.docs}px`);
}

function bindKnResizers(layout) {
  const startDrag = (kind, ev) => {
    ev.preventDefault();
    const startX = ev.clientX;
    const start = { ...normalizedKnColWidths(layout) };
    layout.classList.add('resizing');

    const onMove = (e) => {
      const dx = e.clientX - startX;
      const next = { ...start };
      if (kind === 'folders') next.folders = start.folders + dx;
      else next.docs = start.docs + dx;
      state.kn.colWidths = next;
      applyKnColWidths(layout);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      layout.classList.remove('resizing');
      saveKnColWidths(state.kn.colWidths);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  $$('[data-kn-resize]', layout).forEach((h) => h.addEventListener('mousedown', (ev) => startDrag(h.dataset.knResize, ev)));
}

function initKnLayout(root) {
  const layout = $('.kn-layout', root);
  if (!layout) return;
  applyKnColWidths(layout);
  bindKnResizers(layout);
  if (state.kn.resizeObserver) state.kn.resizeObserver.disconnect();
  state.kn.resizeObserver = new ResizeObserver(() => applyKnColWidths(layout));
  state.kn.resizeObserver.observe(layout);
}

function renderKnowledge(el) {
  const warnings = systemWarningsNoteHtml();
  el.innerHTML = `${warnings ? `<div class="view-pad" style="padding-bottom:0">${warnings}</div>` : ''}<div class="kn-layout">
    <div class="kn-folders" id="kn-folders"></div>
    <div class="kn-resizer" data-kn-resize="folders" role="separator" aria-orientation="vertical" aria-label="Resize folders column"></div>
    <div class="kn-docs" id="kn-docs"></div>
    <div class="kn-resizer" data-kn-resize="docs" role="separator" aria-orientation="vertical" aria-label="Resize documents column"></div>
    <div class="kn-editor" id="kn-editor"></div>
  </div>`;
  initKnLayout(el);
  if (!state.kn.folder) {
    const first = knChildren('')[0];
    if (first) { state.kn.folder = first.key; state.kn.level = ''; }
  }
  paintKnFolders();
  paintKnDocs();
  paintKnEditor();
}

// select a folder by key from anywhere (map drawer, agent drawer, editor):
// the folder column jumps to the level that shows it
function selectKnFolder(key) {
  state.kn.folder = key;
  state.kn.docsMode = 'docs';
  state.kn.doc = null;
  state.kn.level = knChildren(key).length ? key : knParent(key);
  if (state.view !== 'knowledge') setView('knowledge');
  else { paintKnFolders(); paintKnDocs(); paintKnEditor(); }
}

function paintKnFolders() {
  const el = $('#kn-folders');
  if (!el) return;
  const folder = knFolderList().find((f) => f.key === state.kn.folder);
  const isSystemFolder = folder ? folder.kind === 'system' : knSystemFolderKey(state.kn.folder);
  const showDocControls = !isSystemFolder && Boolean(state.kn.folder);
  const folderDocs = folder?.docs || [];
  const reviewCount = folderDocs.filter((d) => isReviewStatus(docMeta(d.path).status)).length;
  const level = state.kn.level || '';
  const segs = level ? level.split('/') : [];
  const crumbs = [`<button class="kn-crumb ${level ? '' : 'current'}" data-level="">knowledge</button>`]
    .concat(segs.map((s, i) => `<button class="kn-crumb ${i === segs.length - 1 ? 'current' : ''}" data-level="${esc(segs.slice(0, i + 1).join('/'))}">${esc(s)}</button>`))
    .join('<span class="kn-crumb-sep">/</span>');
  const children = knChildren(level);

  el.innerHTML = `
    <div class="section-title" style="padding:0 12px;display:flex;align-items:center;gap:8px"><span style="flex:1">Folders</span></div>
    ${showDocControls ? `<div class="kn-controls" style="padding:0 12px 10px">
      <span class="filter-tabs compact" title="Docs or artifacts view">
        <button class="filter-tab ${state.kn.docsMode === 'docs' ? 'active' : ''}" data-kn-mode="docs">Docs</button>
        <button class="filter-tab ${state.kn.docsMode === 'artifacts' ? 'active' : ''}" data-kn-mode="artifacts">Art</button>
      </span>
      <span class="filter-tabs compact" title="Filter docs by review status">
        <button class="filter-tab ${state.kn.filter === 'all' ? 'active' : ''}" data-kn-filter="all">All</button>
        <button class="filter-tab ${state.kn.filter === 'review-needed' ? 'active' : ''}" data-kn-filter="review-needed">Review${reviewCount ? ` (${reviewCount})` : ''}</button>
      </span>
    </div>` : ''}
    <div class="kn-crumbs">${crumbs}</div>
    ${level ? `
      <button class="kn-folder-btn kn-up" data-up>
        <span class="kn-folder-name"><span style="font-family:var(--font-mono);color:var(--muted)">‹</span> ..</span>
        <span class="kn-folder-meta">UP ONE LEVEL</span>
      </button>` : ''}
    ${children.map((c) => `
      <button class="kn-folder-btn ${state.kn.folder === c.key ? 'active' : ''}" data-key="${esc(c.key)}" ${c.subs.size ? 'data-children="1"' : ''}>
        <span class="kn-folder-name"><span style="color:${c.kind === 'system' ? 'var(--muted)' : 'var(--green-light)'};font-family:var(--font-mono)">${c.kind === 'system' ? '·' : '▸'}</span> ${esc(c.label)}${c.subs.size ? '<span class="kn-chev">›</span>' : ''}</span>
        <span class="kn-folder-meta">${c.docs + c.subDocs} DOCS${c.subs.size ? ' · ' + c.subs.size + ' FOLDERS' : ''}</span>
      </button>`).join('') || '<div class="stat-note" style="padding:0 12px">No subfolders.</div>'}`;

  $$('.kn-crumb', el).forEach((b) => b.addEventListener('click', () => {
    state.kn.level = b.dataset.level;
    paintKnFolders();
  }));
  $('[data-up]', el)?.addEventListener('click', () => {
    state.kn.level = knParent(level);
    paintKnFolders();
  });
  $$('.kn-folder-btn[data-key]', el).forEach((b) => b.addEventListener('click', () => {
    state.kn.folder = b.dataset.key;
    state.kn.docsMode = 'docs';
    state.kn.doc = null;
    if (b.dataset.children) state.kn.level = b.dataset.key; // drill in: clicked folder becomes the level
    paintKnFolders(); paintKnDocs(); paintKnEditor();
  }));
  $$('[data-kn-mode]', el).forEach((b) => b.addEventListener('click', () => {
    state.kn.docsMode = b.dataset.knMode;
    state.kn.doc = null;
    paintKnFolders(); paintKnDocs(); paintKnEditor();
  }));
  $$('[data-kn-filter]', el).forEach((b) => b.addEventListener('click', () => {
    state.kn.filter = b.dataset.knFilter;
    if (state.kn.doc && state.kn.filter === 'review-needed' && !isReviewStatus(docMeta(state.kn.doc).status)) {
      state.kn.doc = null;
    }
    paintKnFolders(); paintKnDocs(); paintKnEditor();
  }));
}

function knSystemFolderKey(key) {
  return key === '_agents' || key === '_system';
}

function knArtifactsForFolder(folderKey) {
  if (!folderKey || knSystemFolderKey(folderKey)) return [];
  const prefix = `knowledge/${folderKey}/`;
  return state.system.artifacts
    .filter((a) => a.path.startsWith(prefix) && a.path.includes('/_artifacts/'))
    .sort((a, b) => (b.ctime || b.mtime) - (a.ctime || a.mtime));
}

function paintKnDocs() {
  const el = $('#kn-docs');
  if (!el) return;
  const folder = knFolderList().find((f) => f.key === state.kn.folder);
  const isSystemFolder = folder ? folder.kind === 'system' : knSystemFolderKey(state.kn.folder);
  const headerLabel = folder ? folder.label : (state.kn.folder || '—') + '/';
  const showNewDoc = !isSystemFolder && Boolean(state.kn.folder);
  if (state.kn.filter !== 'review-needed' && state.kn.filter !== 'all') state.kn.filter = 'all';
  if (state.kn.docsMode !== 'artifacts' && state.kn.docsMode !== 'docs') state.kn.docsMode = 'docs';

  if (state.kn.docsMode === 'artifacts') {
    const artifacts = knArtifactsForFolder(state.kn.folder);
    el.innerHTML = `<div class="section-title" style="padding:0 12px;display:flex;align-items:center;gap:8px">
      <span style="flex:1">${esc(headerLabel)}</span>
      ${showNewDoc ? '<button class="chip" data-new-doc title="Create a new Markdown document">+ New Doc</button>' : ''}
    </div>` +
      (artifacts.length ? artifacts.map((a) => `
      <button class="kn-doc-btn" data-art-open="${esc(a.path)}">
        <div class="kn-doc-title">${esc(a.name)}</div>
        <div class="kn-doc-meta">
          <span class="badge badge-gray">${esc((a.name.includes('.') ? a.name.split('.').pop() : 'file').toUpperCase())}</span>
          <span>${timeAgo(a.ctime || a.mtime)}</span><span>${(a.size / 1024).toFixed(1)}kb</span>
        </div>
      </button>`).join('') : '<div class="stat-note" style="padding:0 12px">No artifacts in this subtree.</div>');
    $$('[data-art-open]', el).forEach((b) => b.addEventListener('click', () => {
      window.open('/api/artifact?path=' + encodeURIComponent(b.dataset.artOpen), '_blank');
    }));
    $('[data-new-doc]', el)?.addEventListener('click', () => openNewDocDrawer(state.kn.folder));
  } else {
    const folderDocs = folder?.docs || [];
    const filteredDocs = state.kn.filter === 'review-needed'
      ? folderDocs.filter((d) => isReviewStatus(docMeta(d.path).status))
      : folderDocs;
    el.innerHTML = `<div class="section-title" style="padding:0 12px;display:flex;align-items:center;gap:8px">
      <span style="flex:1">${esc(headerLabel)}</span>
      ${showNewDoc ? '<button class="chip" data-new-doc title="Create a new Markdown document">+ New Doc</button>' : ''}
    </div>` +
      (filteredDocs.length ? filteredDocs.map((d) => `
      <button class="kn-doc-btn ${state.kn.doc === d.path ? 'active' : ''}" data-path="${esc(d.path)}">
        <div class="kn-doc-title">${esc(d.title)}</div>
        <div class="kn-doc-meta">
          <span class="badge ${statusBadgeClass(docMeta(d.path).status)}">${docMeta(d.path).status.toUpperCase()}</span>
          <span>${timeAgo(d.mtime)}</span><span>${d.words}w</span>
        </div>
      </button>`).join('') : `<div class="stat-note" style="padding:0 12px">${folder ? (state.kn.filter === 'review-needed' ? 'No review-needed docs in this folder.' : 'Empty folder.') : 'No documents at this level - open a subfolder.'}</div>`);
    $('[data-new-doc]', el)?.addEventListener('click', () => openNewDocDrawer(state.kn.folder));
    $$('.kn-doc-btn[data-path]', el).forEach((b) => b.addEventListener('click', () => loadDoc(b.dataset.path)));
  }
}

async function loadDoc(path, mode) {
  if (state.kn.content !== state.kn.savedContent && !confirm('Discard unsaved changes?')) return;
  const res = await (await fetch('/api/file?path=' + encodeURIComponent(path))).json();
  state.kn.doc = path;
  state.kn.content = state.kn.savedContent = res.content;
  if (mode) state.kn.mode = mode;
  paintKnDocs();
  paintKnEditor();
}

function openInEditor(path, mode = 'preview') {
  // figure out which folder pane the doc belongs to
  const folder = knFolderList().find((f) => f.docs.some((d) => d.path === path));
  if (folder) {
    state.kn.folder = folder.key;
    state.kn.docsMode = 'docs';
    state.kn.level = knChildren(folder.key).length ? folder.key : knParent(folder.key);
  }
  state.kn.filter = 'all';
  state.kn.doc = null;
  closeDrawer();
  setView('knowledge');
  loadDoc(path, mode);
}

function findDocEntry(path) {
  for (const f of knFolderList()) {
    const d = f.docs.find((x) => x.path === path);
    if (d) return d;
  }
  return null;
}

function paintKnEditor() {
  const el = $('#kn-editor');
  if (!el) return;
  if (!state.kn.doc) {
    el.innerHTML = `<div class="kn-editor-empty">Select a document to read or edit it.<br><br>
      <span class="mono-label">EDITS ARE SAVED TO THE REAL .MD FILES ON DISK</span></div>`;
    return;
  }
  const entry = findDocEntry(state.kn.doc) || { title: state.kn.doc, mtime: Date.now() };
  const meta = docMeta(state.kn.doc);
  const related = AGENTS.filter((a) =>
    a.promptPath === state.kn.doc ||
    a.access.some((f) => state.kn.doc.startsWith('knowledge/' + f + '/')));
  const dirty = state.kn.content !== state.kn.savedContent;

  el.innerHTML = `
    <div class="kn-meta-bar">
      <div class="kn-meta-top">
        <div>
          <div class="kn-doc-h">${esc(entry.title)}</div>
          <div class="kn-path">${esc(state.kn.doc)}</div>
        </div>
        <div class="kn-actions-row">
          <span class="save-state ${dirty ? 'dirty' : ''}" id="save-state">${dirty ? 'UNSAVED CHANGES' : 'SAVED · ' + timeAgo(entry.mtime).toUpperCase()}</span>
          <button class="btn btn-small" id="btn-mode">${state.kn.mode === 'edit' ? 'Preview' : 'Edit'}</button>
          <button class="btn btn-green btn-small" id="btn-save">Save</button>
        </div>
      </div>
      <div class="kn-meta-controls">
        <span class="mono-label">STATUS</span>
        <select id="sel-status">${DOC_STATUSES.map((s) => `<option ${s === meta.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <span class="mono-label">MARKET</span>
        <select id="sel-scope">${MARKET_SCOPES.map((s) => `<option ${s === meta.scope ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <span class="mono-label" style="margin-left:auto">RELATED</span>
        <span class="kn-agents-row">${related.slice(0, 6).map((a) => `<button class="chip" data-agent="${a.id}">${esc(a.name)}</button>`).join('') || '<span class="mono-label">—</span>'}</span>
      </div>
      <div class="kn-ask-row">
        <button class="btn btn-ghost btn-small" data-ask="nora">Ask Nora about this document</button>
        <button class="btn btn-ghost btn-small" data-ask="mara">Ask Mara to classify this</button>
        <button class="btn btn-ghost btn-small" data-ask="atlas">Ask Atlas: strategic relevance</button>
      </div>
    </div>
    <div class="kn-edit-area">
      ${state.kn.mode === 'edit'
        ? `<textarea class="kn-textarea" id="kn-text" spellcheck="false">${esc(state.kn.content)}</textarea>`
        : `<div class="kn-preview"><div class="md">${mdToHtml(state.kn.content)}</div></div>`}
    </div>`;

  $('#btn-mode').addEventListener('click', () => {
    state.kn.mode = state.kn.mode === 'edit' ? 'preview' : 'edit';
    paintKnEditor();
  });
  $('#btn-save').addEventListener('click', saveDoc);
  const ta = $('#kn-text');
  if (ta) ta.addEventListener('input', () => {
    state.kn.content = ta.value;
    const s = $('#save-state');
    const d = state.kn.content !== state.kn.savedContent;
    s.textContent = d ? 'UNSAVED CHANGES' : 'SAVED';
    s.classList.toggle('dirty', d);
  });
  $('#sel-status').addEventListener('change', (e) => setDocMeta('status', e.target.value));
  $('#sel-scope').addEventListener('change', (e) => setDocMeta('scope', e.target.value));
  $$('[data-agent]', el).forEach((b) => b.addEventListener('click', () => { setView('map'); selectMapAgent(b.dataset.agent); }));
  $$('[data-ask]', el).forEach((b) => b.addEventListener('click', () => {
    const verbs = {
      nora: 'Summarize this document and list key facts with sources.',
      mara: 'Classify this document: type, market scope, duplicates, canonical status.',
      atlas: 'Review this document for strategic relevance to Steadymade.',
    };
    const draft = `${verbs[b.dataset.ask]}\n\nDocument: ${state.kn.doc}`;
    openChat(b.dataset.ask, draft);
    navigator.clipboard?.writeText(`Task:\n${draft}`);
    toast('OPENED IN CHAT (DRAFT PREFILLED). TASK ALSO COPIED TO CLIPBOARD.');
  }));
}

// PUT a markdown file with guardrail awareness: a 409 confirmRequired response
// means the folder is set to "ask" — the user confirms, then we resend.
async function putFileGuarded(path, content) {
  const doPut = (confirmed) => fetch('/api/file', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(confirmed ? { path, content, confirmed: true } : { path, content }),
  });
  let res = await doPut(false);
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    if (data.confirmRequired) {
      if (!confirm(`Guardrail: "${data.folder}" is set to ASK.\n\nSave changes to ${path}?`)) {
        throw new Error('save cancelled (guardrail)');
      }
      res = await doPut(true);
    }
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || (data.errors && data.errors.join('; ')) || 'HTTP ' + res.status);
  }
  return res.json();
}

async function saveDoc() {
  if (!state.kn.doc) return;
  try {
    await putFileGuarded(state.kn.doc, state.kn.content);
    state.kn.savedContent = state.kn.content;
    const entry = findDocEntry(state.kn.doc);
    if (entry) { entry.mtime = Date.now(); entry.words = state.kn.content.split(/\s+/).length; }
    paintKnEditor();
    paintKnDocs();
    toast('SAVED TO DISK · ' + state.kn.doc.split('/').pop().toUpperCase());
  } catch (e) {
    toast(('SAVE FAILED: ' + e.message).toUpperCase(), true);
  }
}

async function setDocMeta(key, value) {
  const meta = state.system.meta;
  meta.docs[state.kn.doc] = { ...docMeta(state.kn.doc), [key]: value };
  await fetch('/api/meta', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) });
  paintKnDocs();
  toast(key.toUpperCase() + ' SET: ' + value.toUpperCase());
}

// New-document drawer (lives in the Knowledge view since the header buttons
// were removed): folder select + name, guardrail-aware save, opens the editor.
function openNewDocDrawer(defaultFolder) {
  const folders = state.system.folders.map((f) => f.name);
  if (!folders.length) return toast('NO KNOWLEDGE FOLDERS AVAILABLE', true);
  const preset = folders.includes(defaultFolder) ? defaultFolder : folders[0];
  openDrawer(`
    <div class="drawer-head">
      <button class="drawer-close">✕</button>
      <div class="drawer-dept">KNOWLEDGE · NEW</div>
      <div class="drawer-name">New Document</div>
      <div class="drawer-role">Creates a Markdown file in the selected knowledge folder (guardrails apply).</div>
    </div>
    <div class="drawer-body">
      <div class="form-field"><label>Folder</label>
        <select id="nd-folder">${folders.map((f) => `<option ${f === preset ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
      </div>
      <div class="form-field"><label>File name (without .md)</label><input id="nd-name" placeholder="new-document"></div>
      <button class="btn btn-primary" id="nd-create">Create Document</button>
    </div>`);
  $('#nd-name').focus();
  $('#nd-create').addEventListener('click', async () => {
    const folder = $('#nd-folder').value;
    const name = ($('#nd-name').value || '').trim().replace(/\.md$/, '');
    if (!name) return toast('FILE NAME IS REQUIRED', true);
    if (/[\\/]|\.\./.test(name)) return toast('INVALID FILE NAME', true);
    const relPath = `knowledge/${folder}/${name}.md`;
    try {
      await putFileGuarded(relPath, `# ${name}\n\nStatus: draft\n\n`);
      try { state.system = await apiJson('/api/system'); } catch { /* keep stale model */ }
      closeDrawer();
      state.kn.folder = folder;
      state.kn.level = knChildren(folder).length ? folder : knParent(folder);
      setView('knowledge');
      loadDoc(relPath, 'edit');
      toast('CREATED ' + relPath.toUpperCase());
    } catch (e) { toast(e.message.toUpperCase(), true); }
  });
}

// ---------------------------------------------------------------- Workflows

function renderWorkflows(el) {
  const deletedBuiltins = WORKFLOWS.filter((w) => flowsCfg.deleted.includes(w.id));
  el.innerHTML = `<div class="view-pad">
    <div class="card" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <div style="flex:1;min-width:220px">
        <div class="section-title" style="margin:0 0 4px">Agent Workflows</div>
        <div class="stat-note" style="white-space:normal">Edit the steps of any workflow, create new ones or delete them. Changes apply to the scheduler's workflow selection and Danny's routing view.</div>
      </div>
      <button class="btn btn-primary btn-small" data-wf-new>New Workflow</button>
    </div>
    ${FLOWS.map((w) => `
      <div class="card wf-card">
        <div class="wf-head">
          <div class="wf-name">${esc(w.name)}</div>
          <span class="badge badge-dark">${esc(w.id.toUpperCase())}</span>
          ${w.builtin ? '' : '<span class="badge badge-gray">CUSTOM</span>'}
          ${w.overridden ? '<span class="badge badge-apricot">EDITED</span>' : ''}
          <span style="margin-left:auto;display:flex;gap:6px">
            <button class="chip" data-wf-edit="${esc(w.id)}">EDIT</button>
            ${w.overridden ? `<button class="chip" data-wf-reset="${esc(w.id)}">RESET</button>` : ''}
            <button class="chip" data-wf-del="${esc(w.id)}" style="color:var(--apricot-deep)">DELETE</button>
          </span>
        </div>
        <div class="wf-desc">${esc(w.desc)}</div>
        <div class="wf-chain">
          ${w.chain.map((stepId, i) => {
            const a = agentById(stepId);
            const arrow = i < w.chain.length - 1 ? '<span class="wf-arrow">→</span>' : '';
            if (a) {
              return `<button class="wf-step ${stepId === 'danny' ? 'dark' : ''}" data-agent="${a.id}">
                <span class="wf-step-name">${esc(a.name)}</span>
                <span class="wf-step-role">${esc(a.title)}</span>
              </button>${arrow}`;
            }
            const t = TERMINALS[stepId] || { name: stepId, role: 'step' };
            return `<span class="wf-step terminal">
              <span class="wf-step-name">${esc(t.name)}</span>
              <span class="wf-step-role">${esc(t.role)}</span>
            </span>${arrow}`;
          }).join('')}
        </div>
      </div>`).join('')}
    ${deletedBuiltins.length ? `
    <div class="card">
      <div class="section-title">Deleted Built-in Workflows</div>
      ${deletedBuiltins.map((w) => `
        <div class="list-row" style="cursor:default">
          <span class="badge badge-gray">DELETED</span>
          <span class="list-title">${esc(w.name)}</span>
          <button class="chip" data-wf-restore="${esc(w.id)}">RESTORE</button>
        </div>`).join('')}
    </div>` : ''}
  </div>`;

  $$('[data-agent]', el).forEach((b) => b.addEventListener('click', () => { setView('map'); selectMapAgent(b.dataset.agent); }));
  $('[data-wf-new]', el).addEventListener('click', () => openWorkflowDrawer(null));
  $$('[data-wf-edit]', el).forEach((b) => b.addEventListener('click', () => openWorkflowDrawer(FLOWS.find((w) => w.id === b.dataset.wfEdit))));
  $$('[data-wf-reset]', el).forEach((b) => b.addEventListener('click', async () => {
    delete flowsCfg.overrides[b.dataset.wfReset];
    try { await saveFlowsCfg(); toast('WORKFLOW RESET TO DEFAULT'); renderWorkflows(el); }
    catch (e) { toast(e.message.toUpperCase(), true); }
  }));
  $$('[data-wf-del]', el).forEach((b) => b.addEventListener('click', async () => {
    const w = FLOWS.find((x) => x.id === b.dataset.wfDel);
    if (!confirm(`Delete workflow "${w.name}"?${w.builtin ? '\n\nBuilt-in workflows can be restored later.' : ''}`)) return;
    if (w.builtin) {
      delete flowsCfg.overrides[w.id];
      if (!flowsCfg.deleted.includes(w.id)) flowsCfg.deleted.push(w.id);
    } else {
      flowsCfg.custom = flowsCfg.custom.filter((x) => x.id !== w.id);
    }
    try { await saveFlowsCfg(); toast('WORKFLOW DELETED'); renderWorkflows(el); }
    catch (e) { toast(e.message.toUpperCase(), true); }
  }));
  $$('[data-wf-restore]', el).forEach((b) => b.addEventListener('click', async () => {
    flowsCfg.deleted = flowsCfg.deleted.filter((id) => id !== b.dataset.wfRestore);
    try { await saveFlowsCfg(); toast('WORKFLOW RESTORED'); renderWorkflows(el); }
    catch (e) { toast(e.message.toUpperCase(), true); }
  }));
}

// Workflow editor drawer: name, description, and a step-by-step chain editor
// (agents + terminal steps, reorder, add, remove).
function openWorkflowDrawer(flow) {
  const isNew = !flow;
  const chain = flow ? [...flow.chain] : ['danny', 'user'];
  const stepOptions = [
    ...AGENTS.map((a) => ({ value: a.id, label: `${a.name} — ${a.title}` })),
    ...Object.entries(TERMINALS).map(([id, t]) => ({ value: id, label: `${t.name} — ${t.role}` })),
  ];

  openDrawer(`
    <div class="drawer-head">
      <button class="drawer-close">✕</button>
      <div class="drawer-dept">WORKFLOW · ${isNew ? 'NEW' : esc(flow.id.toUpperCase())}</div>
      <div class="drawer-name">${isNew ? 'New Workflow' : 'Edit Workflow'}</div>
      <div class="drawer-role">Define the agent chain Danny follows for this workflow type.</div>
    </div>
    <div class="drawer-body">
      <div class="form-field"><label>Name</label><input id="wf-name" value="${esc(flow ? flow.name : '')}" placeholder="Client Onboarding"></div>
      <div class="form-field"><label>Description</label><textarea id="wf-desc" rows="2" placeholder="What this workflow produces.">${esc(flow ? flow.desc : '')}</textarea></div>
      <div class="form-field">
        <label>Steps (in order)</label>
        <div id="wf-steps"></div>
        <button class="chip" id="wf-add-step" style="align-self:flex-start;margin-top:6px">+ ADD STEP</button>
      </div>
      <button class="btn btn-primary" id="wf-save">${isNew ? 'Create Workflow' : 'Save Changes'}</button>
    </div>`);

  const paintSteps = () => {
    $('#wf-steps').innerHTML = chain.map((step, i) => `
      <div class="wfe-row">
        <span class="mono-label" style="width:18px;text-align:right">${i + 1}</span>
        <select data-step="${i}">
          ${stepOptions.map((o) => `<option value="${esc(o.value)}" ${o.value === step ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
        <button class="chip" data-step-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="chip" data-step-down="${i}" ${i === chain.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="chip" data-step-del="${i}" style="color:var(--apricot-deep)" ${chain.length <= 2 ? 'disabled' : ''}>✕</button>
      </div>`).join('');
    $$('[data-step]', $('#wf-steps')).forEach((s) => s.addEventListener('change', () => { chain[+s.dataset.step] = s.value; }));
    $$('[data-step-up]', $('#wf-steps')).forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.stepUp;
      [chain[i - 1], chain[i]] = [chain[i], chain[i - 1]];
      paintSteps();
    }));
    $$('[data-step-down]', $('#wf-steps')).forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.stepDown;
      [chain[i], chain[i + 1]] = [chain[i + 1], chain[i]];
      paintSteps();
    }));
    $$('[data-step-del]', $('#wf-steps')).forEach((b) => b.addEventListener('click', () => {
      chain.splice(+b.dataset.stepDel, 1);
      paintSteps();
    }));
  };
  paintSteps();

  $('#wf-add-step').addEventListener('click', () => { chain.push('rosa'); paintSteps(); });

  $('#wf-save').addEventListener('click', async () => {
    const name = $('#wf-name').value.trim();
    const desc = $('#wf-desc').value.trim();
    if (!name) return toast('NAME IS REQUIRED', true);
    if (chain.length < 2) return toast('A WORKFLOW NEEDS AT LEAST 2 STEPS', true);

    if (isNew) {
      let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'workflow';
      while (FLOWS.some((w) => w.id === id) || flowsCfg.deleted.includes(id)) id += '_2';
      flowsCfg.custom.push({ id, name, desc, chain: [...chain] });
    } else if (flow.builtin) {
      flowsCfg.overrides[flow.id] = { name, desc, chain: [...chain] };
    } else {
      flowsCfg.custom = flowsCfg.custom.map((w) => (w.id === flow.id ? { ...w, name, desc, chain: [...chain] } : w));
    }
    try {
      await saveFlowsCfg();
      closeDrawer();
      toast(isNew ? 'WORKFLOW CREATED' : 'WORKFLOW SAVED');
      if (state.view === 'workflows') renderWorkflows($('#view'));
    } catch (e) { toast(e.message.toUpperCase(), true); }
  });
}

// ---------------------------------------------------------------- Departments

function renderDepartments(el) {
  el.innerHTML = `<div class="view-pad dept-list">
    ${DEPARTMENTS.map((d, i) => {
      const members = AGENTS.filter((a) => a.dept === d.id);
      return `<div class="card dept-row">
        <div class="dept-info">
          <div class="dept-idx">${String(i + 1).padStart(2, '0')}</div>
          <div class="dept-name">${esc(d.name)}</div>
          <div class="dept-sub">${esc(d.note)}</div>
          <div class="dept-count">${members.length} AGENT${members.length === 1 ? '' : 'S'}</div>
        </div>
        <div class="dept-agents">
          ${members.map((a) => `
            <button class="dept-agent-row" data-agent="${a.id}">
              <span class="dept-agent-avatar">${a.name[0]}</span>
              <span>
                <div class="dept-agent-name">${esc(a.name)} — ${esc(a.title)}</div>
                <div class="dept-agent-role">${esc(a.role)}</div>
              </span>
            </button>`).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>`;
  $$('[data-agent]', el).forEach((b) => b.addEventListener('click', () => openAgentDrawer(b.dataset.agent)));
}

// ---------------------------------------------------------------- Scheduler

const schedState = { data: null, el: null, timer: null };

const AGENT_OPTIONS = AGENTS
  .filter((a) => a.promptPath.startsWith('.claude/agents/'))
  .map((a) => ({ value: a.promptPath.replace('.claude/agents/', '').replace(/\.md$/, ''), label: `${a.name} — ${a.title}` }));

async function apiJson(path, opts) {
  const req = { ...(opts || {}) };
  const method = String(req.method || 'GET').toUpperCase();
  const hasBody = req.body !== undefined && req.body !== null;
  const bodyIsForm = typeof FormData !== 'undefined' && req.body instanceof FormData;
  const bodyIsJsonString = typeof req.body === 'string';
  if (hasBody && bodyIsJsonString && (method === 'POST' || method === 'PUT' || method === 'PATCH') && !bodyIsForm) {
    const headers = new Headers(req.headers || {});
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    req.headers = headers;
  }
  const res = await fetch(path, req);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.errors && data.errors.join('; ')) || data.error || `HTTP ${res.status}`);
  return data;
}

function runBadge(status) {
  if (status === 'ok') return '<span class="badge badge-green">OK</span>';
  if (status === 'running') return '<span class="badge badge-apricot">RUNNING</span>';
  if (status === 'timeout') return '<span class="badge badge-apricot">TIMEOUT</span>';
  return '<span class="badge badge-gray">' + esc(String(status || '—').toUpperCase()) + '</span>';
}

function fmtWhen(ts) {
  return ts ? new Date(ts).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '—';
}

function renderScheduler(el) {
  schedState.el = el;
  el.innerHTML = '<div class="view-pad"><div class="card">Loading scheduler…</div></div>';
  refreshScheduler();
}

async function refreshScheduler() {
  try {
    schedState.data = await apiJson('/api/scheduler');
  } catch (e) {
    schedState.el.innerHTML = `<div class="view-pad"><div class="card">Scheduler unavailable: ${esc(e.message)}</div></div>`;
    return;
  }
  paintScheduler();
}

function paintScheduler() {
  const el = schedState.el;
  if (!el || state.view !== 'scheduler') return;
  const { jobs, runs } = schedState.data;

  el.innerHTML = `
  <div class="view-pad simple-list" style="max-width:980px">
    <div class="card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
        <div class="section-title" style="flex:1;margin:0">Scheduled Jobs (cron → headless Claude runs)</div>
        <button class="btn btn-primary btn-small" data-act="new-job">New Job</button>
        <button class="btn btn-ghost btn-small" data-act="refresh">Refresh</button>
      </div>
      ${jobs.length ? jobs.map((j) => `
        <div class="list-row" style="cursor:default">
          <span class="badge ${j.enabled ? 'badge-green' : 'badge-gray'}">${j.enabled ? 'ON' : j.scheduleType === 'once' && j.lastRun ? 'DONE' : 'OFF'}</span>
          <span class="list-title">${esc(j.name)}${j.running ? ' <span class="badge badge-apricot">RUNNING</span>' : ''}</span>
          <span class="list-meta mono-label">${j.scheduleType === 'once' ? 'once · ' + fmtWhen(j.runAt) : esc(j.schedule)}</span>
          <span class="list-meta">${esc(j.workflow || '')}${j.workflow ? ' · ' : ''}${esc(j.agent || 'danny (main)')}</span>
          <span class="list-meta">next: ${j.nextRun ? fmtWhen(j.nextRun) : j.enabled ? '—' : 'paused'}</span>
          <span class="list-meta">${j.lastRun ? 'last: ' + esc(j.lastRun.status) : 'never ran'}</span>
          <span style="display:flex;gap:6px">
            <button class="chip" data-run="${j.id}">RUN NOW</button>
            <button class="chip" data-edit="${j.id}">EDIT</button>
            <button class="chip" data-toggle="${j.id}">${j.enabled ? 'PAUSE' : 'ENABLE'}</button>
            <button class="chip" data-del="${j.id}" style="color:var(--apricot-deep)">DELETE</button>
          </span>
        </div>`).join('') : '<div class="stat-note">No jobs yet. Create one — e.g. a Monday-morning LinkedIn draft by Clara, or a weekly knowledge-inbox review by Mara.</div>'}
      <div class="stat-note" style="margin-top:10px">
        Jobs run <code>claude -p</code> headless in this project (CLAUDE.md + subagents loaded), while this server is running.
        Cron format: <code>min hour day month weekday</code> — e.g. <code>0 7 * * 1-5</code> = weekdays 07:00.
      </div>
    </div>

    <div class="card">
      <div class="section-title">Run History</div>
      ${runs.length ? runs.map((r) => `
        <div class="list-row" style="cursor:default;align-items:flex-start">
          ${runBadge(r.status)}
          <span style="flex:1;min-width:0">
            <span class="list-title" style="display:block">${esc(r.jobName)}</span>
            ${r.summary ? `<span class="stat-note" style="display:block;white-space:normal">${esc(r.summary.slice(0, 180))}</span>` : ''}
          </span>
          <span class="list-meta">${esc(r.trigger)} · ${fmtWhen(r.startedAt)}</span>
          <span class="list-meta">${r.endedAt ? Math.max(1, Math.round((r.endedAt - r.startedAt) / 1000)) + 's' : '…'}</span>
          <span style="display:flex;gap:6px">
            <button class="chip" data-log="${r.id}">LOG</button>
            <button class="chip" data-run-del="${r.id}" style="color:var(--apricot-deep)">DELETE</button>
          </span>
        </div>`).join('') : '<div class="stat-note">No runs yet.</div>'}
      <div class="stat-note" style="margin-top:10px;white-space:normal">
        History is persisted in <code>scheduler/runs.json</code> and per-run logs in <code>scheduler/logs/</code>.
        Cron windows missed while the app is off are skipped. One-time jobs past due run after restart.
      </div>
    </div>
  </div>`;

  $('[data-act="new-job"]', el).addEventListener('click', () => openJobDrawer(null));
  $('[data-act="refresh"]', el).addEventListener('click', refreshScheduler);
  $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => openJobDrawer(jobs.find((j) => j.id === b.dataset.edit))));
  $$('[data-run]', el).forEach((b) => b.addEventListener('click', async () => {
    try { await apiJson(`/api/scheduler/jobs/${b.dataset.run}/run`, { method: 'POST' }); toast('JOB STARTED'); setTimeout(refreshScheduler, 800); }
    catch (e) { toast(e.message.toUpperCase(), true); }
  }));
  $$('[data-toggle]', el).forEach((b) => b.addEventListener('click', async () => {
    const j = jobs.find((x) => x.id === b.dataset.toggle);
    try { await apiJson(`/api/scheduler/jobs/${j.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !j.enabled }) }); refreshScheduler(); }
    catch (e) { toast(e.message.toUpperCase(), true); }
  }));
  $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => {
    const j = jobs.find((x) => x.id === b.dataset.del);
    if (!confirm(`Delete job "${j.name}"?`)) return;
    try { await apiJson(`/api/scheduler/jobs/${j.id}`, { method: 'DELETE' }); toast('JOB DELETED'); refreshScheduler(); }
    catch (e) { toast(e.message.toUpperCase(), true); }
  }));
  $$('[data-log]', el).forEach((b) => b.addEventListener('click', async () => {
    const res = await fetch(`/api/scheduler/runs/${b.dataset.log}/log`);
    const run = runs.find((r) => r.id === b.dataset.log);
    let text = res.ok ? await res.text() : '';
    // spawn failures and very short runs leave an empty log file — the run
    // summary (exit reason / error message) is then the real information
    if (!text.trim()) {
      text = run
        ? [`status: ${run.status}`, run.exitCode !== null ? `exit code: ${run.exitCode}` : null, '', run.summary || (run.status === 'running' ? 'Run is still in progress — reopen this log when it finishes.' : '(no output captured)')].filter((l) => l !== null).join('\n')
        : 'Log not found.';
    }
    openDrawer(`
      <div class="drawer-head">
        <button class="drawer-close">✕</button>
        <div class="drawer-dept">RUN LOG</div>
        <div class="drawer-name">${esc(run ? run.jobName : b.dataset.log)}</div>
        <div class="drawer-role">${run ? fmtWhen(run.startedAt) + ' · ' + esc(run.status) + (run.endedAt ? ' · ' + Math.max(1, Math.round((run.endedAt - run.startedAt) / 1000)) + 's' : '') : ''}</div>
      </div>
      <div class="drawer-body">
        <pre class="run-log">${esc(text)}</pre>
      </div>`);
  }));
  $$('[data-run-del]', el).forEach((b) => b.addEventListener('click', async () => {
    const run = runs.find((x) => x.id === b.dataset.runDel);
    if (!run) return;
    if (!confirm(`Delete run history entry "${run.jobName}"?`)) return;
    try {
      const res = await fetch(`/api/scheduler/runs/${run.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        toast('RUN IS STILL ACTIVE — WAIT FOR IT TO FINISH BEFORE DELETING HISTORY', true);
        return;
      }
      if (!res.ok) throw new Error((data.errors && data.errors.join('; ')) || data.error || `HTTP ${res.status}`);
      toast('RUN HISTORY ENTRY DELETED');
      refreshScheduler();
    } catch (e) {
      toast(e.message.toUpperCase(), true);
    }
  }));

  // live view: refresh automatically while something is running
  clearTimeout(schedState.timer);
  if (jobs.some((j) => j.running) || runs.some((r) => r.status === 'running')) {
    schedState.timer = setTimeout(() => { if (state.view === 'scheduler') refreshScheduler(); }, 5000);
  }
}

const CRON_PRESETS = [
  { label: 'Weekdays 07:00', value: '0 7 * * 1-5' },
  { label: 'Every Monday 07:00', value: '0 7 * * 1' },
  { label: 'Daily 07:00', value: '0 7 * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'First of month 08:00', value: '0 8 1 * *' },
];

const WEEKDAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];

// Recurrence builder ⇄ cron: simple patterns map onto hourly / daily / weekly /
// monthly with individual settings; anything else stays a raw cron expression.
function parseCronToBuilder(schedule) {
  const def = { freq: 'daily', minute: 0, time: '07:00', days: new Set([1, 2, 3, 4, 5]), dom: 1, cron: schedule || '0 7 * * 1-5' };
  const f = String(schedule || '').trim().split(/\s+/);
  if (f.length !== 5) return { ...def, freq: 'custom' };
  const [min, hour, dom, mon, dow] = f;
  const num = (s) => /^\d{1,2}$/.test(s);
  const pad = (n) => String(n).padStart(2, '0');
  const parseDows = (s) => {
    const days = new Set();
    for (const part of s.split(',')) {
      const r = part.match(/^(\d)(?:-(\d))?$/);
      if (!r) return null;
      for (let v = +r[1]; v <= +(r[2] ?? r[1]); v++) days.add(v % 7);
    }
    return days.size ? days : null;
  };
  if (num(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') return { ...def, freq: 'hourly', minute: +min };
  if (num(min) && num(hour)) {
    const time = pad(+hour) + ':' + pad(+min);
    if (dom === '*' && mon === '*' && dow === '*') return { ...def, freq: 'daily', time };
    if (dom === '*' && mon === '*' && dow !== '*') {
      const days = parseDows(dow);
      if (days) return { ...def, freq: 'weekly', time, days };
    }
    if (num(dom) && mon === '*' && dow === '*') return { ...def, freq: 'monthly', time, dom: +dom };
  }
  return { ...def, freq: 'custom' };
}

function buildCronFromBuilder(rec) {
  const [h, m] = (rec.time || '07:00').split(':').map(Number);
  if (rec.freq === 'hourly') return `${rec.minute || 0} * * * *`;
  if (rec.freq === 'daily') return `${m} ${h} * * *`;
  if (rec.freq === 'weekly') return rec.days.size ? `${m} ${h} * * ${[...rec.days].sort((a, b) => a - b).join(',')}` : '';
  if (rec.freq === 'monthly') return `${m} ${h} ${rec.dom || 1} * *`;
  return String(rec.cron || '').trim();
}

function toLocalDatetimeValue(ts) {
  const d = ts ? new Date(ts) : new Date(Date.now() + 3600_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function openJobDrawer(job) {
  const j = job || { name: '', agent: '', workflow: '', prompt: '', scheduleType: 'cron', schedule: '0 7 * * 1', runAt: null, enabled: true, timeoutMinutes: 15 };
  const workflowId = String(j.workflow || '').replace(/_workflow$/, '');
  openDrawer(`
    <div class="drawer-head">
      <button class="drawer-close">✕</button>
      <div class="drawer-dept">SCHEDULER</div>
      <div class="drawer-name">${job ? 'Edit Job' : 'New Job'}</div>
      <div class="drawer-role">Runs headless in this project via the Claude Code CLI.</div>
    </div>
    <div class="drawer-body">
      <div class="form-field"><label>Name</label><input id="jf-name" value="${esc(j.name)}" placeholder="Weekly LinkedIn draft"></div>
      <div class="form-field"><label>Workflow (optional — sets the agent chain and gates)</label>
        <select id="jf-workflow">
          <option value="">— no specific workflow —</option>
          ${FLOWS.map((w) => `<option value="${esc(w.id)}" ${workflowId === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-field"><label>Agent</label>
        <select id="jf-agent">
          <option value="">danny (main orchestrator)</option>
          ${AGENT_OPTIONS.map((o) => `<option value="${esc(o.value)}" ${j.agent === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
      </div>
      <div class="form-field"><label>Task prompt</label><textarea id="jf-prompt" rows="6" placeholder="What should run?">${esc(j.prompt)}</textarea></div>
      <div class="form-field"><label>Schedule type</label>
        <select id="jf-type">
          <option value="cron" ${j.scheduleType !== 'once' ? 'selected' : ''}>Recurring (cron)</option>
          <option value="once" ${j.scheduleType === 'once' ? 'selected' : ''}>One-time (pick date & time)</option>
        </select>
      </div>
      <div class="form-field" id="jf-once-wrap" style="display:${j.scheduleType === 'once' ? 'flex' : 'none'}">
        <label>Run at (date &amp; time — click the calendar icon to pick)</label>
        <input id="jf-runat" type="datetime-local" value="${toLocalDatetimeValue(j.runAt)}" min="${toLocalDatetimeValue(Date.now())}">
        <span class="stat-note">One-time jobs disable themselves after firing. A time in the past fires on the next scheduler tick.</span>
      </div>
      <div class="form-field" id="jf-cron-wrap" style="display:${j.scheduleType === 'once' ? 'none' : 'flex'}">
        <label>Recurrence</label>
        <select id="jf-freq">
          ${[['hourly', 'Hourly'], ['daily', 'Daily'], ['weekly', 'Weekly — pick the days'], ['monthly', 'Monthly'], ['custom', 'Custom (cron expression)']]
            .map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
        <div class="freq-body" id="jf-freq-body"></div>
        <span class="stat-note">Runs as cron: <code class="cron-preview" id="jf-cron-preview"></code></span>
      </div>
      <div class="form-field"><label>Timeout (minutes)</label><input id="jf-timeout" type="number" min="1" max="120" value="${esc(j.timeoutMinutes)}"></div>
      <div class="form-field form-check"><label><input id="jf-enabled" type="checkbox" ${j.enabled ? 'checked' : ''}> Enabled</label></div>
      <button class="btn btn-primary" id="jf-save">${job ? 'Save Changes' : 'Create Job'}</button>
    </div>`);

  $('#jf-type').addEventListener('change', () => {
    const once = $('#jf-type').value === 'once';
    $('#jf-once-wrap').style.display = once ? 'flex' : 'none';
    $('#jf-cron-wrap').style.display = once ? 'none' : 'flex';
  });
  // close the native date/time popup as soon as a value is picked
  $('#jf-runat').addEventListener('change', (e) => e.target.blur());

  // ---- recurrence builder (individual settings per frequency) ----
  const rec = parseCronToBuilder(j.schedule);
  $('#jf-freq').value = rec.freq;

  const updatePreview = () => {
    const cron = buildCronFromBuilder(rec);
    $('#jf-cron-preview').textContent = cron || '— pick at least one weekday —';
  };

  const timeFieldHtml = () => `
    <div class="freq-inline"><label>At time</label><input id="jf-rec-time" type="time" value="${esc(rec.time)}"></div>`;

  const paintFreq = () => {
    const body = $('#jf-freq-body');
    if (rec.freq === 'hourly') {
      body.innerHTML = `<div class="freq-inline"><label>At minute</label><input id="jf-rec-minute" type="number" min="0" max="59" value="${rec.minute}" style="width:80px"></div>`;
    } else if (rec.freq === 'daily') {
      body.innerHTML = timeFieldHtml();
    } else if (rec.freq === 'weekly') {
      body.innerHTML = `
        <div class="wd-row">${WEEKDAYS.map(([v, l]) => `<span class="wd-chip ${rec.days.has(v) ? 'on' : ''}" data-wd="${v}">${l}</span>`).join('')}</div>
        ${timeFieldHtml()}`;
    } else if (rec.freq === 'monthly') {
      body.innerHTML = `
        <div class="freq-inline"><label>Day of month</label><input id="jf-rec-dom" type="number" min="1" max="31" value="${rec.dom}" style="width:80px"></div>
        ${timeFieldHtml()}`;
    } else {
      body.innerHTML = `
        <select id="jf-preset">
          <option value="">— presets —</option>
          ${CRON_PRESETS.map((p) => `<option value="${esc(p.value)}" ${rec.cron === p.value ? 'selected' : ''}>${esc(p.label)} · ${esc(p.value)}</option>`).join('')}
        </select>
        <input id="jf-rec-cron" value="${esc(rec.cron)}" placeholder="0 7 * * 1-5" style="margin-top:6px">
        <span class="stat-note">Format: min hour day month weekday — e.g. <code>*/30 8-18 * * 1-5</code></span>`;
    }
    $('#jf-rec-time')?.addEventListener('change', (e) => { rec.time = e.target.value || '07:00'; updatePreview(); });
    $('#jf-rec-minute')?.addEventListener('input', (e) => { rec.minute = Math.min(59, Math.max(0, Number(e.target.value) || 0)); updatePreview(); });
    $('#jf-rec-dom')?.addEventListener('input', (e) => { rec.dom = Math.min(31, Math.max(1, Number(e.target.value) || 1)); updatePreview(); });
    $('#jf-rec-cron')?.addEventListener('input', (e) => { rec.cron = e.target.value; updatePreview(); });
    $('#jf-preset')?.addEventListener('change', (e) => {
      if (!e.target.value) return;
      rec.cron = e.target.value;
      $('#jf-rec-cron').value = rec.cron;
      updatePreview();
    });
    $$('[data-wd]', body).forEach((chip) => chip.addEventListener('click', () => {
      const v = +chip.dataset.wd;
      if (rec.days.has(v)) rec.days.delete(v); else rec.days.add(v);
      chip.classList.toggle('on', rec.days.has(v));
      updatePreview();
    }));
    updatePreview();
  };
  paintFreq();
  $('#jf-freq').addEventListener('change', (e) => { rec.freq = e.target.value; paintFreq(); });

  $('#jf-save').addEventListener('click', async () => {
    const once = $('#jf-type').value === 'once';
    if (once && !$('#jf-runat').value) {
      toast('PICK A DATE AND TIME FOR THE ONE-TIME RUN', true);
      return;
    }
    const schedule = buildCronFromBuilder(rec);
    if (!once && !schedule) {
      toast(rec.freq === 'weekly' ? 'PICK AT LEAST ONE WEEKDAY' : 'ENTER A CRON EXPRESSION', true);
      return;
    }
    const body = JSON.stringify({
      name: $('#jf-name').value,
      agent: $('#jf-agent').value || null,
      workflow: $('#jf-workflow').value || null,
      prompt: $('#jf-prompt').value,
      scheduleType: once ? 'once' : 'cron',
      schedule,
      runAt: once ? new Date($('#jf-runat').value).getTime() : null,
      timeoutMinutes: Number($('#jf-timeout').value),
      enabled: $('#jf-enabled').checked,
    });
    try {
      if (job) await apiJson(`/api/scheduler/jobs/${job.id}`, { method: 'PUT', body });
      else await apiJson('/api/scheduler/jobs', { method: 'POST', body });
      closeDrawer();
      toast(job ? 'JOB UPDATED' : 'JOB CREATED');
      refreshScheduler();
    } catch (e) { toast(e.message.toUpperCase(), true); }
  });
}

// ---------------------------------------------------------------- Skill Hub

const skillState = {
  data: null,          // /api/skills result ({ scopes: [{name, kind, skills}] })
  q: '',               // search query
  filter: 'all',       // all | active | inactive
  workspace: '',       // '' = all, otherwise a scope name (company / personal / personal-<name>)
  updates: {},         // map key "scope/name" -> update result
  updatesCheckedAt: null,
  updatesLoading: false,
  market: null,        // /api/marketplace result
  marketQ: '',
  marketCat: '',
  marketScope: 'personal', // install target workspace
  marketOpen: false,
  installing: null,
  plugins: null,
  el: null,
};

function allSkills() {
  return (skillState.data?.scopes || []).flatMap((s) => s.skills);
}

function workspaceLabel(scope) {
  if (scope.name === 'company') return 'Company Skills';
  if (scope.name === 'personal') return 'Personal Skills';
  return `Personal Workspace — ${scope.name.replace(/^personal-/, '')}`;
}

function skillKey(scope, name) {
  return `${scope}/${name}`;
}

function shortSha(sha) {
  return typeof sha === 'string' && sha.length ? sha.slice(0, 7) : '—';
}

function formatInstalledDate(iso) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleDateString();
}

function skillCapabilitySummary(skill) {
  return {
    prompt: true,
    tools: Array.isArray(skill.requiresPlugins) && skill.requiresPlugins.length > 0,
    knowledge: Array.isArray(skill.knowledge) && skill.knowledge.length > 0,
  };
}

function skillTypeBadgesHtml(skill) {
  const caps = skillCapabilitySummary(skill);
  const out = ['<span class="badge badge-gray">PROMPT</span>'];
  if (caps.tools) out.push('<span class="badge badge-gray">+TOOLS</span>');
  if (caps.knowledge) out.push('<span class="badge badge-gray">+KNOWLEDGE</span>');
  return out.join(' ');
}

function findSkill(scope, name) {
  for (const sc of skillState.data?.scopes || []) {
    if (sc.name !== scope) continue;
    const hit = sc.skills.find((s) => s.name === name);
    if (hit) return hit;
  }
  return null;
}

function openSkillCustomizeEditor(skill) {
  const scopedSkill = /^personal(?:-|$)/.test(skill.scope)
    ? { scope: skill.scope, name: skill.name }
    : null;
  openFileEditorDrawer(skill.path, {
    title: 'Customize Skill',
    hint: 'Edits the local SKILL.md — adapt triggers, instructions and constraints to Steadymade.',
    scopedSkill,
  });
}

function toKnowledgeFolder(dep) {
  const raw = String(dep || '').trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!raw) return null;
  return raw.startsWith('knowledge/') ? raw.replace(/^knowledge\//, '') : raw;
}

async function openSkillConfigureDrawer(skill) {
  let plugins = [];
  try {
    ({ plugins } = await apiJson('/api/plugins'));
    skillState.plugins = plugins;
  } catch {
    plugins = skillState.plugins || [];
  }

  const byId = Object.fromEntries((plugins || []).map((p) => [p.id, p]));
  const requires = skill.requiresPlugins || [];
  const knowledge = skill.knowledge || [];
  const capabilities = skill.capabilities || [];

  openDrawer(`
    <div class="drawer-head">
      <button class="drawer-close">✕</button>
      <div class="drawer-dept">SKILL HUB · CONFIGURE</div>
      <div class="drawer-name">/${esc(skill.name)}</div>
      <div class="drawer-role">${esc(skill.scope)} · ${esc(skill.path)}</div>
    </div>
    <div class="drawer-body">
      <div class="drawer-section">
        <div class="section-title">Capability summary</div>
        <div class="tag-row">${skillTypeBadgesHtml(skill)}</div>
        ${capabilities.length ? `<div class="stat-note" style="margin-top:8px;white-space:normal">Declared capabilities: ${esc(capabilities.join(', '))}</div>` : ''}
      </div>
      <div class="drawer-section">
        <div class="section-title">Plugin dependencies</div>
        ${requires.length ? requires.map((id) => {
          const p = byId[id];
          const on = Boolean(p?.enabled);
          return `<div class="kv-row"><span><code>${esc(id)}</code>${p ? ` <span class="list-meta">· ${esc(p.name)}</span>` : ''}</span><span class="badge ${on ? 'badge-green' : 'badge-apricot'}">${on ? 'ENABLED' : 'MISSING'}</span></div>`;
        }).join('') : '<div class="stat-note">No plugin dependencies declared.</div>'}
      </div>
      <div class="drawer-section">
        <div class="section-title">Knowledge dependencies</div>
        ${knowledge.length ? `<div class="tag-row">${knowledge.map((k) => `<span class="chip" style="cursor:default">${esc(k)}</span>`).join('')}</div>` : '<div class="stat-note">No knowledge dependencies declared.</div>'}
      </div>
      <div class="drawer-actions">
        <button class="btn btn-primary btn-small" data-act="skill-config-customize">CUSTOMIZE SKILL.md</button>
        <button class="btn btn-small" data-act="skill-config-plugins">OPEN PLUGINS SETTINGS</button>
        <button class="btn btn-small" data-act="skill-config-knowledge">OPEN KNOWLEDGE DOCS</button>
      </div>
    </div>`);

  const d = $('#drawer');
  $('[data-act="skill-config-customize"]', d)?.addEventListener('click', () => openSkillCustomizeEditor(skill));
  $('[data-act="skill-config-plugins"]', d)?.addEventListener('click', () => {
    closeDrawer();
    settingsState.section = 'plugins';
    setView('settings');
  });
  $('[data-act="skill-config-knowledge"]', d)?.addEventListener('click', () => {
    closeDrawer();
    const first = toKnowledgeFolder((skill.knowledge || [])[0]);
    setView('knowledge');
    if (first) requestAnimationFrame(() => selectKnFolder(first));
  });
}

function updateBadgesHtml(skill) {
  const badges = [];
  const update = skillState.updates[skillKey(skill.scope, skill.name)] || null;
  const localModified = typeof update?.localModified === 'boolean'
    ? update.localModified
    : (typeof skill.localModified === 'boolean' ? skill.localModified : null);

  if (update?.status === 'update_available') badges.push('<span class="badge badge-apricot">UPDATE AVAILABLE</span>');
  if (update?.status === 'unpinned') badges.push('<span class="badge badge-gray">UNPINNED</span>');
  if (update?.status === 'unknown') badges.push('<span class="badge badge-gray">UNKNOWN</span>');
  if (update?.status === 'current') badges.push('<span class="badge badge-green">CURRENT</span>');
  if (localModified === true) badges.push('<span class="badge badge-apricot">MODIFIED</span>');

  return badges.join(' ');
}

function renderSkills(el) {
  skillState.el = el;
  el.innerHTML = '<div class="view-pad"><div class="card">Loading skills…</div></div>';
  refreshSkills();
}

async function refreshSkills() {
  try {
    skillState.data = await apiJson('/api/skills');
  } catch (e) {
    skillState.el.innerHTML = `<div class="view-pad"><div class="card">Skill hub unavailable: ${esc(e.message)}</div></div>`;
    return;
  }
  paintSkills();
}

function skillMatches(s) {
  const q = skillState.q.toLowerCase();
  if (q && !(s.name + ' ' + (s.description || '')).toLowerCase().includes(q)) return false;
  if (skillState.filter === 'active' && !s.active) return false;
  if (skillState.filter === 'inactive' && s.active) return false;
  return true;
}

function skillBodyHtml() {
  const notes = {
    company: 'skills/company/ — shared via git, changes go through review.',
    personal: 'skills/personal/ — private, gitignored, never committed.',
  };
  const empties = {
    company: 'No company skills yet. Add a folder with a SKILL.md under skills/company/.',
    personal: 'No personal skills yet — install one from the marketplace or add a folder with a SKILL.md.',
  };
  const scopes = skillState.data.scopes.filter((s) => !skillState.workspace || s.name === skillState.workspace);
  return scopes.map((scope) => {
    const skills = scope.skills;
    const visible = skills.filter(skillMatches);
    const activeCount = skills.filter((s) => s.active).length;
    return `
    <div class="card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div class="section-title" style="flex:1;margin:0">${esc(workspaceLabel(scope))} <span class="list-meta">${visible.length} / ${skills.length}</span></div>
        <span class="badge badge-gray">${activeCount} ACTIVE</span>
      </div>
      <div class="stat-note" style="margin-bottom:8px">${esc(notes[scope.name] || `skills/${scope.name}/ — personal workspace on the shared drive, gitignored.`)}</div>
      ${visible.length ? visible.map((s) => {
        const caps = skillCapabilitySummary(s);
        const type = ['PROMPT', caps.tools ? '+TOOLS' : null, caps.knowledge ? '+KNOWLEDGE' : null].filter(Boolean).join(' ');
        const meta = [
          `v${s.version || '—'}`,
          type,
          (s.sha || s.installedAt) ? `Installed ${shortSha(s.sha)} · ${formatInstalledDate(s.installedAt)}` : null,
        ].filter(Boolean).join(' · ');
        return `
        <div class="skill-row">
          <button class="skill-toggle ${s.active ? 'on' : ''}" data-skill="${esc(s.scope)}:${esc(s.name)}" data-active="${s.active ? '1' : ''}" title="${s.active ? 'Deactivate' : 'Activate'} /${esc(s.name)}" role="switch" aria-checked="${s.active ? 'true' : 'false'}"><i></i></button>
          <div class="skill-main">
            <div class="skill-title-row">
              <span class="skill-name">/${esc(s.name)}</span>
              ${updateBadgesHtml(s)}
            </div>
            <div class="skill-desc">${esc((s.description || 'No description in SKILL.md frontmatter.').slice(0, 220))}</div>
            <div class="skill-meta">${esc(meta)}</div>
          </div>
          <span class="skill-actions">
            <button class="chip" data-configure-skill="${esc(s.scope)}:${esc(s.name)}">CONFIGURE</button>
            <button class="chip" data-customize="${esc(s.path)}" data-customize-scope="${esc(s.scope)}" data-customize-name="${esc(s.name)}">CUSTOMIZE</button>
            ${/^personal(?:-|$)/.test(s.scope) ? `<button class="chip" data-remove-skill="${esc(s.scope)}:${esc(s.name)}" style="color:var(--apricot-deep)">REMOVE</button>` : ''}
          </span>
        </div>`;
      }).join('') : `<div class="stat-note">${esc(skills.length ? 'No skills match the current filter.' : empties[scope.name] || 'No skills in this workspace yet.')}</div>`}
    </div>`;
  }).join('');
}

function paintSkillBody() {
  const el = skillState.el;
  const body = $('#sk-body', el);
  if (!body) return;
  const all = allSkills();
  body.innerHTML = skillBodyHtml();
  const count = $('#sk-count', el);
  if (count) count.textContent = `${all.filter(skillMatches).length} of ${all.length}`;
  $$('.filter-tab', el).forEach((b) => b.classList.toggle('active', b.dataset.filter === skillState.filter));

  $$('[data-skill]', body).forEach((b) => b.addEventListener('click', async () => {
    const [scope, name] = b.dataset.skill.split(':');
    const activating = !b.dataset.active;
    try {
      if (activating) {
        const skill = findSkill(scope, name);
        const required = skill?.requiresPlugins || [];
        if (required.length) {
          const { plugins } = await apiJson('/api/plugins');
          skillState.plugins = plugins;
          const enabled = new Set(plugins.filter((p) => p.enabled).map((p) => p.id));
          const missing = required.filter((id) => !enabled.has(id));
          if (missing.length) {
            toast(`CAN'T ACTIVATE /${name.toUpperCase()} — ENABLE MISSING PLUGINS: ${missing.join(', ').toUpperCase()}`, true);
            return;
          }
        }
      }
      await apiJson('/api/skills/toggle', { method: 'POST', body: JSON.stringify({ scope, name, active: !b.dataset.active }) });
      toast(`/${name.toUpperCase()} ${b.dataset.active ? 'DEACTIVATED' : 'ACTIVATED'}`);
      skillState.data = await apiJson('/api/skills');
      paintSkillBody();
    } catch (e) { toast(e.message.toUpperCase(), true); }
  }));
  $$('[data-configure-skill]', body).forEach((b) => b.addEventListener('click', () => {
    const [scope, name] = b.dataset.configureSkill.split(':');
    const skill = findSkill(scope, name);
    if (!skill) return toast('SKILL NOT FOUND', true);
    openSkillConfigureDrawer(skill);
  }));
  $$('[data-customize]', body).forEach((b) => b.addEventListener('click', () => {
    const skill = findSkill(b.dataset.customizeScope, b.dataset.customizeName);
    if (!skill) return toast('SKILL NOT FOUND', true);
    openSkillCustomizeEditor(skill);
  }));
  $$('[data-remove-skill]', body).forEach((b) => b.addEventListener('click', async () => {
    const [scope, name] = b.dataset.removeSkill.split(':');
    if (!confirm(`Remove /${name} from ${scope}?\n\nIt will be moved to skills/${scope}/.trash locally, not hard-deleted.`)) return;
    try {
      const result = await deleteWithGuardrailConfirm(`/api/skills/${encodeURIComponent(scope)}/${encodeURIComponent(name)}`, {}, `Remove /${name} from ${scope}`);
      skillState.data = await apiJson('/api/skills');
      paintSkillBody();
      toast(`REMOVED /${name.toUpperCase()} → ${(result.trashPath || 'TRASH').toUpperCase()}`);
    } catch (e) {
      toast(e.message.toUpperCase(), true);
    }
  }));
}

function paintSkills() {
  const el = skillState.el;
  if (!el || state.view !== 'skills') return;

  const scopes = skillState.data.scopes;
  const personalScopes = scopes.filter((s) => s.kind === 'personal');
  el.innerHTML = `
  <div class="view-pad simple-list" style="max-width:920px">
    <div class="card">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <input id="sk-search" class="filter-input" type="text" placeholder="Search skills…" value="${esc(skillState.q)}" style="flex:1;min-width:180px">
        <select id="sk-workspace" class="filter-input" title="Workspace filter — personal workspaces on the shared drive appear here automatically">
          <option value="">All workspaces</option>
          ${scopes.map((s) => `<option value="${esc(s.name)}" ${skillState.workspace === s.name ? 'selected' : ''}>${esc(workspaceLabel(s))}</option>`).join('')}
        </select>
        <span class="filter-tabs">
          ${['all', 'active', 'inactive'].map((f) => `<button class="filter-tab ${skillState.filter === f ? 'active' : ''}" data-filter="${f}">${f === 'all' ? 'All' : f === 'active' ? 'Active' : 'Inactive'}</button>`).join('')}
        </span>
        <span class="list-meta" id="sk-count"></span>
        <button class="btn btn-small" data-act="check-updates">${skillState.updatesLoading ? 'Checking…' : 'Check Updates'}</button>
        ${personalScopes.length ? '<button class="btn btn-primary btn-small" data-act="new-skill">New Skill</button>' : ''}
        <button class="btn btn-ghost btn-small" data-act="market">${skillState.marketOpen ? 'Hide Marketplace' : 'Browse Marketplace'}</button>
      </div>
      ${skillState.updatesCheckedAt ? `<div class="stat-note" style="margin-top:8px">Update status checked ${esc(timeAgo(Date.parse(skillState.updatesCheckedAt)))}</div>` : ''}
    </div>
    ${skillState.marketOpen ? '<div id="sk-market"></div>' : ''}
    <div id="sk-body"></div>
    <div class="card">
      <div class="section-title">How activation works</div>
      <div class="stat-note" style="white-space:normal;line-height:1.6">
        Your active set lives in <code>.skill-profile</code> (workspace root, gitignored) — scope lines activate
        a whole scope, <code>+scope/skill</code> adds one, <code>-scope/skill</code> excludes one. The hub
        materializes it as symlinks in <code>.claude/skills/</code>, where Claude Code discovers skills —
        so activation applies to Danny, all subagents and scheduled jobs. Per machine, per user.
        On a shared drive, each person can keep an own workspace as <code>skills/personal-&lt;name&gt;/</code>
        (gitignored) — it appears in the workspace filter automatically.
      </div>
    </div>
  </div>`;

  // search re-renders only the list body, so the input keeps focus naturally
  $('#sk-search', el).addEventListener('input', (e) => { skillState.q = e.target.value; paintSkillBody(); });
  $('#sk-workspace', el).addEventListener('change', (e) => { skillState.workspace = e.target.value; paintSkillBody(); });
  $$('.filter-tab', el).forEach((b) => b.addEventListener('click', () => { skillState.filter = b.dataset.filter; paintSkillBody(); }));
  $('[data-act="check-updates"]', el)?.addEventListener('click', checkSkillUpdates);
  $('[data-act="new-skill"]', el)?.addEventListener('click', openNewSkillDrawer);
  $('[data-act="market"]', el).addEventListener('click', () => { skillState.marketOpen = !skillState.marketOpen; paintSkills(); if (skillState.marketOpen) loadMarketplace(); });
  paintSkillBody();
  if (skillState.marketOpen && skillState.market) paintMarketplace();
}

async function checkSkillUpdates() {
  if (skillState.updatesLoading) return;
  skillState.updatesLoading = true;
  paintSkills();
  try {
    const data = await apiJson('/api/marketplace/updates');
    const map = {};
    for (const s of data.skills || []) map[skillKey(s.scope, s.name)] = s;
    skillState.updates = map;
    skillState.updatesCheckedAt = data.checkedAt || new Date().toISOString();
    toast('SKILL UPDATE STATUS REFRESHED');
  } catch (e) {
    toast(e.message.toUpperCase(), true);
  } finally {
    skillState.updatesLoading = false;
    paintSkills();
  }
}

function openNewSkillDrawer() {
  const scopes = (skillState.data?.scopes || []).filter((s) => s.kind === 'personal');
  if (!scopes.length) return toast('NO PERSONAL SKILL SCOPE AVAILABLE', true);
  const preferred = scopes.some((s) => s.name === skillState.workspace) ? skillState.workspace : (skillState.marketScope || scopes[0].name);
  openDrawer(`
    <div class="drawer-head">
      <button class="drawer-close">✕</button>
      <div class="drawer-dept">SKILL HUB · NEW</div>
      <div class="drawer-name">New Skill</div>
      <div class="drawer-role">Creates a personal SKILL.md in the selected workspace.</div>
    </div>
    <div class="drawer-body">
      <div class="form-field"><label>Scope</label>
        <select id="ns-scope">${scopes.map((s) => `<option value="${esc(s.name)}" ${preferred === s.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      </div>
      <div class="form-field"><label>Skill name (kebab-case)</label><input id="ns-name" placeholder="my-skill"></div>
      <button class="btn btn-primary" id="ns-create">Create Skill</button>
    </div>`);
  $('#ns-name')?.focus();

  $('#ns-create')?.addEventListener('click', async () => {
    const scope = $('#ns-scope').value;
    const name = ($('#ns-name').value || '').trim();
    if (!name) return toast('SKILL NAME IS REQUIRED', true);
    try {
      const result = await postJsonWithGuardrailConfirm('/api/skills/new', { scope, name }, `Create /${name} in ${scope}`);
      skillState.workspace = scope;
      skillState.data = await apiJson('/api/skills');
      closeDrawer();
      if (state.view === 'skills') paintSkills();
      openFileEditorDrawer(result.path, {
        title: `Customize /${name}`,
        hint: 'Define triggers, constraints and output format for this personal skill.',
        scopedSkill: { scope, name },
      });
      toast(`CREATED /${name.toUpperCase()} IN ${scope.toUpperCase()}`);
    } catch (e) {
      toast(e.message.toUpperCase(), true);
    }
  });
}

async function loadMarketplace(refresh = false) {
  const wrap = $('#sk-market');
  if (wrap) wrap.innerHTML = '<div class="card">Loading marketplace from github.com/ComposioHQ/awesome-claude-skills…</div>';
  try {
    skillState.market = await apiJson('/api/marketplace' + (refresh ? '?refresh=1' : ''));
  } catch (e) {
    if (wrap) wrap.innerHTML = `<div class="card">Marketplace unavailable (offline?): ${esc(e.message)}</div>`;
    return;
  }
  paintMarketplace();
}

function resolveMarketplaceOpenUrl(skill) {
  if (skill?.openUrl) return skill.openUrl;
  const raw = String(skill?.url || '');
  if (!raw.startsWith('./')) return raw;
  const subpath = raw.replace(/^\.\//, '').replace(/\/+$/, '');
  return `https://github.com/ComposioHQ/awesome-claude-skills/tree/master/${subpath}`;
}

async function postJsonWithGuardrailConfirm(apiPath, payload, actionLabel) {
  const send = (confirmed) => fetch(apiPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(confirmed ? { ...payload, confirmed: true } : payload),
  });

  let res = await send(false);
  let data = await res.json().catch(() => ({}));
  if (res.status === 409 && data.confirmRequired) {
    if (!confirm(`Guardrail: "${data.folder}" is set to ASK.\n\n${actionLabel}?`)) {
      throw new Error('action cancelled (guardrail)');
    }
    res = await send(true);
    data = await res.json().catch(() => ({}));
  }
  if (!res.ok) throw new Error((data.errors && data.errors.join('; ')) || data.error || `HTTP ${res.status}`);
  return data;
}

async function deleteWithGuardrailConfirm(apiPath, payload = {}, actionLabel) {
  const send = (confirmed) => fetch(apiPath, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(confirmed ? { ...payload, confirmed: true } : payload),
  });

  let res = await send(false);
  let data = await res.json().catch(() => ({}));
  if (res.status === 409 && data.confirmRequired) {
    if (!confirm(`Guardrail: "${data.folder}" is set to ASK.\n\n${actionLabel}?`)) {
      throw new Error('action cancelled (guardrail)');
    }
    res = await send(true);
    data = await res.json().catch(() => ({}));
  }
  if (!res.ok) throw new Error((data.errors && data.errors.join('; ')) || data.error || `HTTP ${res.status}`);
  return data;
}

function paintMarketplaceList() {
  const listEl = $('#mkt-list');
  if (!listEl || !skillState.market) return;
  const skills = skillState.market.skills;
  const q = skillState.marketQ.toLowerCase();
  const visible = skills.filter((s) =>
    (!skillState.marketCat || s.category === skillState.marketCat) &&
    (!q || (s.name + ' ' + s.description).toLowerCase().includes(q))).slice(0, 40);

  listEl.innerHTML = `
      ${visible.map((s, i) => `
        <div class="list-row" style="cursor:default;align-items:flex-start">
          <span class="badge ${s.missingUpstream ? 'badge-apricot' : (s.installable ? 'badge-green' : 'badge-gray')}">${s.missingUpstream ? 'UNAVAILABLE' : (s.installable ? 'INSTALLABLE' : 'EXTERNAL')}</span>
          <span style="flex:1;min-width:0">
            <span class="list-title" style="display:block">${esc(s.name)} <span class="list-meta">· ${esc(s.category)}</span></span>
            <span class="stat-note" style="display:block;white-space:normal">${esc(s.description.slice(0, 200))}</span>
          </span>
          <span style="display:flex;gap:6px;flex-shrink:0">
            <a class="chip" href="${esc(resolveMarketplaceOpenUrl(s))}" target="_blank" rel="noopener" style="text-decoration:none">OPEN</a>
            ${s.installable && s.available !== false ? `<button class="chip" data-install="${i}">${skillState.installing === s.url ? 'INSTALLING…' : 'INSTALL'}</button>` : ''}
          </span>
        </div>`).join('') || '<div class="stat-note">No marketplace entries match.</div>'}
      ${skills.length > 40 && visible.length === 40 ? '<div class="stat-note" style="margin-top:6px">Showing first 40 matches — refine the search.</div>' : ''}`;

  $$('[data-install]', listEl).forEach((b) => b.addEventListener('click', async () => {
    const s = visible[+b.dataset.install];
    if (skillState.installing) return;
    skillState.installing = s.url;
    paintMarketplaceList();
    try {
      const targetScope = skillState.marketScope || 'personal';
      const result = await postJsonWithGuardrailConfirm('/api/marketplace/install', { url: s.url, scope: targetScope }, `Install /${s.name} into ${targetScope}`);
      toast(`INSTALLED /${result.name.toUpperCase()} — REVIEW, THEN ACTIVATE`);
      skillState.installing = null;
      skillState.data = await apiJson('/api/skills');
      paintSkillBody();
      paintMarketplaceList();
    } catch (e) {
      skillState.installing = null;
      paintMarketplaceList();
      toast(e.message.toUpperCase(), true);
    }
  }));
}

function paintMarketplace() {
  const wrap = $('#sk-market');
  if (!wrap || !skillState.market) return;
  const skills = skillState.market.skills;
  const cats = [...new Set(skills.map((s) => s.category))];

  wrap.innerHTML = `
    <div class="card" style="border-color:var(--green-light)">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <div class="section-title" style="flex:1;margin:0">Marketplace <span class="list-meta">${esc(skillState.market.source || '')} · ${skills.length} skills</span></div>
        <button class="chip" data-mkt-refresh>REFRESH LIST</button>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <input id="mkt-search" class="filter-input" type="text" placeholder="Search marketplace…" value="${esc(skillState.marketQ)}" style="flex:1;min-width:160px">
        <select id="mkt-cat" class="filter-input" style="max-width:240px">
          <option value="">All categories</option>
          ${cats.map((c) => `<option value="${esc(c)}" ${skillState.marketCat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        <select id="mkt-scope" class="filter-input" style="max-width:240px" title="Install target workspace">
          ${(skillState.data?.scopes || []).filter((s) => s.kind === 'personal').map((s) => `<option value="${esc(s.name)}" ${skillState.marketScope === s.name ? 'selected' : ''}>Install to: ${esc(s.name)}</option>`).join('')}
        </select>
      </div>
      <div id="mkt-list"></div>
      <div class="stat-note" style="margin-top:8px;white-space:normal">
        Installs download the skill from GitHub into <code>skills/personal/</code> (private). Review the SKILL.md
        before activating — third-party skills are instructions for your agents. Customize after install via the skill's CUSTOMIZE button.
      </div>
    </div>`;

  $('#mkt-search', wrap).addEventListener('input', (e) => { skillState.marketQ = e.target.value; paintMarketplaceList(); });
  $('#mkt-cat', wrap).addEventListener('change', (e) => { skillState.marketCat = e.target.value; paintMarketplaceList(); });
  $('#mkt-scope', wrap)?.addEventListener('change', (e) => { skillState.marketScope = e.target.value; });
  $('[data-mkt-refresh]', wrap).addEventListener('click', () => loadMarketplace(true));
  paintMarketplaceList();
}

// ---------------------------------------------------------------- File editor drawer (profile, instructions, SKILL.md)

async function openFileEditorDrawer(path, { title = 'Edit File', hint = '', template = '', scopedSkill = null } = {}) {
  let content = template;
  let exists = false;
  try {
    const res = await fetch('/api/file?path=' + encodeURIComponent(path));
    if (res.ok) { content = (await res.json()).content; exists = true; }
  } catch { /* offline */ }

  openDrawer(`
    <div class="drawer-head">
      <button class="drawer-close">✕</button>
      <div class="drawer-dept">${exists ? 'EDIT' : 'CREATE'} · MARKDOWN</div>
      <div class="drawer-name">${esc(title)}</div>
      <div class="drawer-role">${esc(path)}${hint ? ' — ' + esc(hint) : ''}</div>
    </div>
    <div class="drawer-body">
      <div class="form-field" style="flex:1">
        <label>${exists ? 'Content' : 'New file content'}</label>
        <textarea id="fe-content" rows="22" spellcheck="false">${esc(content)}</textarea>
      </div>
      <button class="btn btn-primary" id="fe-save">${exists ? 'Save' : 'Create File'}</button>
    </div>`);

  $('#fe-save').addEventListener('click', async () => {
    try {
      if (scopedSkill) {
        await apiJson('/api/skills/content', {
          method: 'PUT',
          body: JSON.stringify({ scope: scopedSkill.scope, name: scopedSkill.name, content: $('#fe-content').value }),
        });
      } else {
        await putFileGuarded(path, $('#fe-content').value);
      }
      toast('SAVED ' + path.toUpperCase());
      closeDrawer();
      // refresh the system model so a newly created file shows up in the Knowledge view immediately
      try { state.system = await apiJson('/api/system'); } catch { /* keep stale model */ }
      if (state.view === 'settings') renderSettings($('#view'));
    } catch (e) { toast(e.message.toUpperCase(), true); }
  });
}

// ---------------------------------------------------------------- Artifacts / Settings

const artState = { q: '', range: 'all', type: 'all', layout: 'list' };

const ART_RANGES = [
  ['24h', 24 * 3600e3, 'Last 24h'],
  ['7d', 7 * 24 * 3600e3, 'Last 7 days'],
  ['30d', 30 * 24 * 3600e3, 'Last 30 days'],
  ['all', Infinity, 'All time'],
];

// File-type taxonomy: extension → category. Each category has a label, a
// minimal line icon and a tone (drives the tile tint) so artifacts are
// scannable by type. Tones stay within the brand palette (green / apricot /
// neutral) instead of a rainbow of file-manager colors.
const ART_TYPES = {
  pdf:      { label: 'PDF',      tone: 'apricot', exts: ['pdf'],
              icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h6"/><path d="M9 18h4"/>' },
  word:     { label: 'Word',     tone: 'green',   exts: ['doc', 'docx', 'rtf', 'odt', 'pages'],
              icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13l1.5 5 2-4 2 4 1.5-5"/>' },
  sheet:    { label: 'Sheet',    tone: 'green',   exts: ['xls', 'xlsx', 'csv', 'ods', 'numbers'],
              icon: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16"/><path d="M4 15h16"/><path d="M10 4v16"/>' },
  slides:   { label: 'Slides',   tone: 'apricot', exts: ['ppt', 'pptx', 'key', 'odp'],
              icon: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>' },
  image:    { label: 'Image',    tone: 'green',   exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'heic'],
              icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="m21 15-5-5L5 21"/>' },
  markdown: { label: 'Markdown', tone: 'neutral', exts: ['md', 'markdown'],
              icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15V9l2.5 3L12 9v6"/><path d="M16 9v4"/><path d="m14.5 12 1.5 2 1.5-2"/>' },
  html:     { label: 'HTML',     tone: 'apricot', exts: ['html', 'htm'],
              icon: '<path d="m9 9-3 3 3 3"/><path d="m15 9 3 3-3 3"/><path d="M4 4h16v16H4z"/>' },
  data:     { label: 'Data',     tone: 'neutral', exts: ['json', 'yaml', 'yml', 'xml', 'toml'],
              icon: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>' },
  archive:  { label: 'Archive',  tone: 'neutral', exts: ['zip', 'tar', 'gz', 'rar', '7z'],
              icon: '<path d="M21 8v13H3V8"/><rect x="1" y="3" width="22" height="5" rx="1"/><path d="M10 12h4"/>' },
  text:     { label: 'Text',     tone: 'neutral', exts: ['txt', 'log'],
              icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h8"/>' },
};
const ART_TYPE_FALLBACK = { label: 'File', tone: 'neutral',
  icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>' };

function artExt(name) {
  return name.includes('.') ? name.split('.').pop().toLowerCase() : '';
}
function artTypeId(name) {
  const ext = artExt(name);
  for (const [id, t] of Object.entries(ART_TYPES)) if (t.exts.includes(ext)) return id;
  return 'file';
}
function artTypeMeta(id) {
  return ART_TYPES[id] || ART_TYPE_FALLBACK;
}
function artTileHtml(a) {
  const t = artTypeMeta(artTypeId(a.name));
  return `<span class="art-tile art-tone-${t.tone}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg></span>`;
}

function renderArtifacts(el) {
  paintArtifacts(el);
  // refresh the listing from disk so newly generated artifacts show up
  apiJson('/api/system').then((sys) => {
    state.system = sys;
    if (state.view === 'artifacts') paintArtifacts(el);
  }).catch(() => {});
}

function paintArtifacts(el) {
  const rangeMs = ART_RANGES.find(([id]) => id === artState.range)[1];
  const q = artState.q.toLowerCase();
  // filter by range + search first; type filter is applied after so the type
  // tabs always reflect what's available in the current range/search scope
  const scoped = [...state.system.artifacts]
    .sort((a, b) => (b.ctime || b.mtime) - (a.ctime || a.mtime)) // newest generated first
    .filter((a) => (a.ctime || a.mtime) >= Date.now() - rangeMs)
    .filter((a) => !q || (a.name + ' ' + (a.folder || '')).toLowerCase().includes(q));

  // counts per type present in scope, for the type tabs
  const typeCounts = {};
  for (const a of scoped) { const id = artTypeId(a.name); typeCounts[id] = (typeCounts[id] || 0) + 1; }
  const presentTypes = Object.keys(ART_TYPES).concat('file').filter((id) => typeCounts[id]);
  // reset a type filter that no longer has matches
  if (artState.type !== 'all' && !typeCounts[artState.type]) artState.type = 'all';

  const items = scoped.filter((a) => artState.type === 'all' || artTypeId(a.name) === artState.type);

  const typeTab = (id, label, count) =>
    `<button class="filter-tab ${artState.type === id ? 'active' : ''}" data-type="${id}">${esc(label)} <span class="ft-count">${count}</span></button>`;

  const gridHtml = items.map((a) => `
    <button class="art-card" data-art-open="${esc(a.path)}" title="${esc(a.name)}">
      ${artTileHtml(a)}
      <span class="art-name">${esc(a.name)}</span>
      <span class="art-folder">${esc(a.folder || 'artifacts')}/</span>
      <span class="art-card-meta">
        <span>${esc(artTypeMeta(artTypeId(a.name)).label)}</span>
        <span>${(a.size / 1024).toFixed(1)} KB</span>
      </span>
      <span class="art-card-time" title="${new Date(a.ctime || a.mtime).toLocaleString()}">${timeAgo(a.ctime || a.mtime)}</span>
    </button>`).join('');

  const listHtml = items.map((a) => `
    <button class="art-list-row" data-art-open="${esc(a.path)}">
      ${artTileHtml(a)}
      <span class="art-list-main">
        <span class="art-list-name">${esc(a.name)}</span>
        <span class="art-folder">${esc(a.folder || 'artifacts')}/</span>
      </span>
      <span class="badge badge-gray">${esc(artTypeMeta(artTypeId(a.name)).label)}</span>
      <span class="list-meta">${(a.size / 1024).toFixed(1)} KB</span>
      <span class="list-meta" title="${new Date(a.ctime || a.mtime).toLocaleString()}">${timeAgo(a.ctime || a.mtime)}</span>
    </button>`).join('');

  el.innerHTML = `<div class="view-pad simple-list" style="max-width:1040px">
    <div class="card">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div class="section-title" style="margin:0">Artifacts <span class="list-meta">${items.length} of ${state.system.artifacts.length}</span></div>
        <input id="art-search" class="filter-input" type="text" placeholder="Search artifacts…" value="${esc(artState.q)}" style="flex:1;min-width:160px">
        <span class="filter-tabs">
          ${ART_RANGES.map(([id, , label]) => `<button class="filter-tab ${artState.range === id ? 'active' : ''}" data-range="${id}">${label}</button>`).join('')}
        </span>
        <span class="filter-tabs" title="View">
          <button class="filter-tab ${artState.layout === 'grid' ? 'active' : ''}" data-layout="grid">Grid</button>
          <button class="filter-tab ${artState.layout === 'list' ? 'active' : ''}" data-layout="list">List</button>
        </span>
      </div>
      ${presentTypes.length ? `<div class="art-type-tabs">
        <span class="filter-tabs">
          ${typeTab('all', 'All', scoped.length)}
          ${presentTypes.map((id) => typeTab(id, artTypeMeta(id).label, typeCounts[id])).join('')}
        </span>
      </div>` : ''}
      <div class="stat-note" style="margin-top:8px">Generated files under <code>artifacts/</code> and <code>knowledge/**/_artifacts/**</code>, newest first by creation date.</div>
    </div>
    ${items.length
      ? (artState.layout === 'grid'
          ? `<div class="art-grid">${gridHtml}</div>`
          : `<div class="card art-list">${listHtml}</div>`)
      : `<div class="card">${state.system.artifacts.length ? 'No artifacts match the current filter.' : 'No artifacts yet — agent runs place generated files under artifacts/ or knowledge/**/_artifacts/**.'}</div>`}
  </div>`;

  const search = $('#art-search', el);
  search.addEventListener('input', () => {
    artState.q = search.value;
    const pos = search.selectionStart;
    paintArtifacts(el);
    const s2 = $('#art-search', el);
    s2.focus();
    s2.setSelectionRange(pos, pos);
  });
  $$('[data-range]', el).forEach((b) => b.addEventListener('click', () => { artState.range = b.dataset.range; paintArtifacts(el); }));
  $$('[data-type]', el).forEach((b) => b.addEventListener('click', () => { artState.type = b.dataset.type; paintArtifacts(el); }));
  $$('[data-layout]', el).forEach((b) => b.addEventListener('click', () => { artState.layout = b.dataset.layout; paintArtifacts(el); }));
  $$('[data-art-open]', el).forEach((b) => b.addEventListener('click', () => {
    window.open('/api/artifact?path=' + encodeURIComponent(b.dataset.artOpen), '_blank');
  }));
}

// ---------------------------------------------------------------- Usage / Memory

function fmtUsd(v) {
  return Number(v || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(v) {
  return Number(v || 0).toLocaleString();
}

function fmtDuration(ms) {
  const s = Math.round(Number(ms || 0) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function usageDetailsHtml(data, { compact = false } = {}) {
  const s = data.summary || {};
  const entries = data.entries || [];
  return `${compact ? '' : '<div class="view-pad simple-list" style="max-width:1040px">'}
    <div class="card">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div class="section-title" style="flex:1;margin:0">Usage Report</div>
        <span class="list-meta">${esc(data.path || 'runs/usage.jsonl')}</span>
      </div>
      <div class="stat-note" style="margin-top:6px;white-space:normal">
        Local runtime telemetry from Chat and Scheduler. Token and cost fields are populated when available from the underlying run metadata.
      </div>
    </div>

    <div class="cc-grid">
      <div class="card stat-card"><div class="mono-label">ENTRIES</div><div class="stat-value">${fmtInt(s.count)}</div><div class="stat-note">${fmtInt(s.sessions)} sessions · ${fmtInt(s.errors)} errors</div></div>
      <div class="card stat-card"><div class="mono-label">COST</div><div class="stat-value" style="font-size:28px">${fmtUsd(s.total_cost_usd)}</div><div class="stat-note">reported by runtime result metadata when available</div></div>
      <div class="card stat-card"><div class="mono-label">DURATION</div><div class="stat-value" style="font-size:28px">${fmtDuration(s.total_duration_ms)}</div><div class="stat-note">sum of logged durations</div></div>
      <div class="card stat-card"><div class="mono-label">TOKENS</div><div class="stat-value" style="font-size:28px">${fmtInt(s.total_tokens)}</div><div class="stat-note">in ${fmtInt(s.input_tokens)} · out ${fmtInt(s.output_tokens)}</div></div>
    </div>

    <div class="card">
      <div class="section-title">Recent usage entries</div>
      ${entries.length ? entries.slice(0, compact ? 30 : 80).map((e) => {
        const source = String(e.source || 'chat');
        const isScheduler = source === 'scheduler';
        const badge = isScheduler
          ? (e.status === 'ok' ? '<span class="badge badge-green">SCHED</span>' : `<span class="badge ${e.is_error ? 'badge-apricot' : 'badge-gray'}">SCHED</span>`)
          : `<span class="badge ${e.is_error ? 'badge-apricot' : 'badge-gray'}">${e.is_error ? 'ERROR' : 'CHAT'}</span>`;
        const title = isScheduler
          ? `${esc(e.job_name || e.jobName || e.job_id || e.jobId || 'scheduler run')} <span class="list-meta">${esc(e.status || '')}</span>`
          : `${esc(e.selected_agent || 'danny')} <span class="list-meta">${esc(e.mode || '')}</span>`;
        const duration = e.duration_ms == null ? '—' : fmtDuration(e.duration_ms);
        const cost = e.cost_usd == null ? '—' : fmtUsd(e.cost_usd);
        const tokens = e.total_tokens == null ? '—' : `${fmtInt(e.total_tokens)} tokens`;
        return `
        <div class="list-row" style="cursor:default">
          ${badge}
          <span class="list-title">${title}</span>
          <span class="list-meta">${esc(e.model || 'default')}</span>
          <span class="list-meta">${duration}</span>
          <span class="list-meta">${cost}</span>
          <span class="list-meta">${tokens}</span>
          <span class="list-meta" title="${esc(e.timestamp || '')}">${e.timestamp ? timeAgo(Date.parse(e.timestamp)) : '—'}</span>
        </div>`;
      }).join('') : '<div class="stat-note">No usage recorded yet. Run one chat turn or scheduler job to create the first entry.</div>'}
    </div>
  ${compact ? '' : '</div>'}`;
}

async function renderUsage(el) {
  el.innerHTML = '<div class="view-pad"><div class="card">Loading usage…</div></div>';
  let data;
  try { data = await apiJson('/api/usage'); }
  catch (e) {
    el.innerHTML = `<div class="view-pad"><div class="card">Usage unavailable: ${esc(e.message)}</div></div>`;
    return;
  }
  el.innerHTML = usageDetailsHtml(data);
}

function openUsageDrawer() {
  openDrawer(`
    <div class="drawer-head">
      <button class="drawer-close">✕</button>
      <div class="drawer-dept">COMMAND CENTER</div>
      <div class="drawer-name">Usage Details</div>
      <div class="drawer-role">Local telemetry from runs/usage.jsonl (chat + scheduler)</div>
    </div>
    <div class="drawer-body" id="usage-drawer-body">
      <div class="card">Loading usage…</div>
    </div>`);
  const body = $('#usage-drawer-body');
  const render = async () => {
    try {
      const data = await apiJson('/api/usage');
      if (!body) return;
      body.innerHTML = usageDetailsHtml(data, { compact: true }) +
        '<div style="margin-top:10px"><button class="btn btn-ghost btn-small" id="usage-drawer-refresh">Refresh</button></div>';
      $('#usage-drawer-refresh', body)?.addEventListener('click', render);
    } catch (e) {
      if (body) body.innerHTML = `<div class="card">Usage unavailable: ${esc(e.message)}</div>`;
    }
  };
  render();
}

function renderMemoryCard() {
  const companyPath = 'knowledge/company/company_handbook_SSOT/agent-memory.md';
  const personalPath = 'memory/MEMORY.md';
  return `<div class="card" data-section="profile">
      <div class="section-title">Memory</div>
      <div class="stat-note" style="white-space:normal;margin-bottom:10px">
        Memory is split by scope so local/private context does not leak into shared company material.
      </div>
    <div class="card">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span class="badge badge-green">COMPANY</span>
        <span class="list-title">Shared company memory</span>
        <span class="list-meta">${esc(companyPath)}</span>
        <button class="btn btn-green btn-small" data-act="mem-company">Open</button>
      </div>
      <div class="stat-note" style="margin-top:8px;white-space:normal">For organization-level facts that all agents may use. No private personal facts.</div>
    </div>
    <div class="card">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span class="badge badge-apricot">PERSONAL</span>
        <span class="list-title">Private personal memory</span>
        <span class="list-meta">${esc(personalPath)} · gitignored</span>
        <button class="btn btn-small" data-act="mem-personal">Create / Open</button>
      </div>
      <div class="stat-note" style="margin-top:8px;white-space:normal">Curated long-term memory (MEMORY.md); working notes live in memory/daily/. Local user context only — never copied into company artifacts. See memory/README.md.</div>
    </div>
    <div class="card">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span class="badge badge-gray">TEAM</span>
        <span class="list-title">Shared team memory</span>
        <span class="list-meta">AI_OS/knowledge/team/ in OneDrive</span>
      </div>
      <div class="stat-note" style="margin-top:8px;white-space:normal">Team memory remains in the shared OneDrive team area unless this repo explicitly links and documents a <code>knowledge/team/</code> path.</div>
    </div>
  </div>`;
}

const PERSONAL_MEMORY_TEMPLATE = '# MEMORY — curated long-term memory (local user)\n\nDurable facts, preferences and standing decisions. One dated line per entry\n(`- YYYY-MM-DD | fact`). Keep under ~200 lines.\n\n## Working preferences\n\n## Standing decisions\n\n## Active context\n';

async function ensurePersonalMemoryFile() {
  const personalPath = 'memory/MEMORY.md';
  try {
    await apiJson('/api/file?path=' + encodeURIComponent(personalPath));
  } catch {
    await putFileGuarded(personalPath, PERSONAL_MEMORY_TEMPLATE);
  }
  return personalPath;
}

function bindMemoryActions(scope = document) {
  const companyPath = 'knowledge/company/company_handbook_SSOT/agent-memory.md';
  $('[data-act="mem-company"]', scope)?.addEventListener('click', () => openInEditor(companyPath, 'edit'));
  $('[data-act="mem-personal"]', scope)?.addEventListener('click', async () => {
    try {
      const personalPath = await ensurePersonalMemoryFile();
      openInEditor(personalPath, 'edit');
    } catch (e) {
      toast(e.message.toUpperCase(), true);
    }
  });
}

const FILE_TEMPLATES = {
  'knowledge/personal/user-profile.md': `# User Profile — <Name>\n\n- **Rolle:** TODO\n- **Märkte:** TODO (DACH / Australia / Both)\n- **Sprache:** TODO (de / en)\n\n## Verantwortung & Aufgaben\n\n- TODO\n\n## Arbeitsweise\n\n- Entscheidungen: TODO\n- Detailtiefe: TODO\n\n## Kommunikation\n\n- Ton: TODO\n\n## Schmerzpunkte & Ziele\n\n- TODO\n\n> Tipp: /personal-onboarding füllt dieses Profil im Interview.\n`,
  'CLAUDE.local.md': `<!-- persona:start -->\n# Persönliche Instructions — <Name>\n\n- Ich bin TODO (Rolle). Vollständiges Profil: knowledge/personal/user-profile.md\n- Antworte auf TODO (de/en); Ton: TODO.\n- Detailtiefe: TODO.\n- Standard-Markt: TODO.\n<!-- persona:end -->\n`,
  'memory/MEMORY.md': PERSONAL_MEMORY_TEMPLATE,
};

const settingsState = { section: 'all', el: null, data: null };

const PROVIDER_MODES = [
  { value: 'claude-subscription', label: 'Claude subscription (Claude CLI auth)' },
  { value: 'anthropic-api', label: 'Anthropic API key (env-driven)' },
  { value: 'opencode', label: 'OpenCode multi-provider runtime' },
];

function providerRestartStatusLabel(settings) {
  const mode = String(settings?.runtimeMode || DEFAULT_PROVIDER_SETTINGS.runtimeMode);
  const bridge = Boolean(settings?.cliBridgeEnabled);
  const modeLabel = PROVIDER_MODES.find((m) => m.value === mode)?.label || mode;
  return `Restart required · active mode: ${modeLabel} · CLI bridge ${bridge ? 'ON' : 'OFF'}`;
}

const SETTINGS_SECTIONS = [
  ['all', 'All'],
  ['project', 'Project Info'],
  ['runtime', 'Runtime'],
  ['knowledge-spaces', 'Knowledge Spaces'],
  ['ai-provider', 'AI Provider'],
  ['onboarding', 'Onboarding'],
  ['profile', 'Profile & Instructions'],
  ['plugins', 'Plugins'],
  ['guardrails', 'Guardrails'],
];

function renderSettings(el) {
  settingsState.el = el;
  el.innerHTML = '<div class="view-pad settings-block"><div class="card">Loading settings…</div></div>';
  paintSettings(el);
}

async function paintSettings(el) {
  let workspace = { checks: [], onboarding: null };
  let plugins = [];
  let guardrails = null;
  let providerSettings = { settings: { ...DEFAULT_PROVIDER_SETTINGS } };
  let appSettings = state.system?.appSettings || null;
  try {
    [workspace, { plugins }, guardrails, providerSettings, appSettings] = await Promise.all([
      apiJson('/api/workspace'), apiJson('/api/plugins'), apiJson('/api/guardrails'), apiJson('/api/provider-settings'), apiJson('/api/app-settings'),
    ]);
  } catch { /* server-side features unavailable */ }
  if (state.view !== 'settings') return;
  settingsState.data = { workspace, plugins, guardrails, providerSettings, appSettings };
  uiState.providerSettings = { ...DEFAULT_PROVIDER_SETTINGS, ...(providerSettings?.settings || {}) };
  postChatRuntimeConfig();
  paintSettingsBody(el);
}

function paintSettingsBody(el) {
  const { workspace, plugins, guardrails, providerSettings, appSettings } = settingsState.data;
  const show = (section) => settingsState.section === 'all' || settingsState.section === section;
  const profileChecks = (workspace.checks || []).filter((c) => c.id !== 'mcp-servers' && c.path !== '.mcp.json');
  const onb = workspace.onboarding;
  const provider = { ...DEFAULT_PROVIDER_SETTINGS, ...(providerSettings?.settings || {}) };
  const providerSavedAt = Date.parse(provider.updatedAt || '');
  const restartLabel = providerRestartStatusLabel(provider);
  const providerSavedLabel = Number.isFinite(providerSavedAt)
    ? `Saved ${timeAgo(providerSavedAt)} · ${restartLabel}`
    : `Not saved yet on this machine. ${restartLabel}`;
  const providerEnvRows = Array.isArray(provider.envVault) ? provider.envVault.map((row) => ({
    key: String(row?.key || ''),
    hasValue: Boolean(row?.hasValue),
    masked: String(row?.masked || ''),
    value: '',
  })) : [];
  const appCfg = appSettings || {};
  const appCfgSettings = appCfg.settings || {};
  const appSaved = appCfg.savedEffectiveRoots || {};
  const appActive = appCfg.activeRuntimeRoots || {};
  const sharedSaved = appSaved.shared || {};
  const sharedActive = appActive.shared || {};
  const personalSaved = appSaved.personal || {};
  const personalActive = appActive.personal || {};
  const sharedFolders = sharedActive.detectedSubfolders || sharedSaved.detectedSubfolders || {};
  const ksDone = Boolean(workspace.knowledgeSpaces?.personalReady && workspace.knowledgeSpaces?.sharedReady);

  const editable = {
    'user-profile': { title: 'Personal Profile', hint: 'Your persona profile — private, never committed.' },
    'claude-local': { title: 'Personal Instructions', hint: 'Loaded by Claude Code in addition to CLAUDE.md — private.' },
    'claude-md': { title: 'General Instructions', hint: 'Shared project instructions — changes go through review.' },
    'memory-file': { title: 'Personal Memory', hint: 'Curated local memory — private, gitignored.' },
    'operating-profile': { title: 'Company Operating Profile', hint: 'Filled via /company-onboarding.' },
  };

  const onboardingCard = !onb ? '' : `
    <div class="card" data-section="onboarding" ${onb.complete ? '' : 'style="border-color:var(--apricot)"'}>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div class="section-title" style="flex:1;margin:0">Onboarding</div>
        <span class="badge ${onb.complete ? 'badge-green' : 'badge-apricot'}">${onb.complete ? 'COMPLETE' : 'INCOMPLETE'}</span>
      </div>
      <div class="kv-row">
        <span>${onb.personalDone ? '<span class="badge badge-green">DONE</span>' : '<span class="badge badge-apricot">OPEN</span>'} Personal onboarding — persona profile + personal instructions</span>
        <span><span class="list-meta">run /personal-onboarding in Claude Code</span></span>
      </div>
      <div class="kv-row">
        <span>${onb.companyDone ? '<span class="badge badge-green">DONE</span>' : '<span class="badge badge-apricot">OPEN</span>'} Company onboarding — operating profile filled${onb.companyTodos ? ` <span class="list-meta">· ${onb.companyTodos} TODOs open</span>` : ''}</span>
        <span><span class="list-meta">run /company-onboarding in Claude Code</span></span>
      </div>
      <div class="kv-row">
        <span>${onb.memoryDone ? '<span class="badge badge-green">DONE</span>' : '<span class="badge badge-apricot">OPEN</span>'} Memory setup — local memory files exist</span>
        <span><span class="list-meta">memory/MEMORY.md + memory/daily/</span></span>
      </div>
      <div class="kv-row">
        <span>${ksDone ? '<span class="badge badge-green">DONE</span>' : '<span class="badge badge-apricot">OPEN</span>'} Knowledge spaces — personal + shared roots configured and reachable</span>
        <span><span class="list-meta">Settings → Knowledge Spaces</span></span>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-ghost btn-small" data-act="onboarding-guide">Show Onboarding Guide</button>
        <span class="stat-note">The guide also appears automatically when the app loads while onboarding is incomplete.</span>
      </div>
    </div>`;

  el.innerHTML = `<div class="view-pad settings-block">
    <div class="card settings-filter">
      <span class="filter-tabs">
        ${SETTINGS_SECTIONS.map(([id, label]) => `<button class="filter-tab ${settingsState.section === id ? 'active' : ''}" data-section-tab="${id}">${label}</button>`).join('')}
      </span>
    </div>

    ${show('project') ? `
    <div class="card" data-section="project">
      <div class="section-title">Project</div>
      <div class="kv-row"><span>Name</span><span>Steadymade AI OS — Agent Setup</span></div>
      <div class="kv-row"><span>Mode</span><span>Claude Project (no external runtime)</span></div>
      <div class="kv-row"><span>Knowledge format</span><span>Markdown on disk</span></div>
      <div class="kv-row"><span>Agents</span><span>${AGENTS.length} (Danny + ${AGENTS.length - 1} specialists)</span></div>
      <div class="kv-row"><span>Agent prompts</span><span>.claude/agents/*.md</span></div>
      <div class="kv-row"><span>Orchestrator prompt</span><span>CLAUDE.md</span></div>
    </div>
    <div class="card" data-section="project">
      <div class="section-title">Persistence</div>
      <div class="kv-row"><span>Markdown edits</span><span>REAL — written to disk via local API</span></div>
      <div class="kv-row"><span>Status / market scope</span><span>interface/meta.json (sidecar, docs untouched)</span></div>
      <div class="kv-row"><span>Agent execution</span><span>REAL — Scheduler runs headless via claude -p (while server runs)</span></div>
      <div class="kv-row"><span>Skills</span><span>skills/company + skills/personal, activated via Skill Hub symlinks</span></div>
    </div>
    <div class="card" data-section="project">
      <div class="section-title">Approval Logic</div>
      <div class="kv-row"><span>States</span><span>idea → briefing → draft → review → strategy_check → approval_required → approved → final</span></div>
      <div class="kv-row"><span>Rule</span><span>Nothing is marked approved without explicit user approval</span></div>
    </div>` : ''}

    ${show('runtime') ? `
    <div class="card" data-section="runtime">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <div class="section-title" style="margin:0 0 4px">Runtime</div>
          <div class="stat-note" style="white-space:normal">
            Interface changes (guardrails enforcement, scheduler, skill hub) apply <strong>immediately</strong>.
            Claude Code permission/MCP changes apply to <strong>new Claude sessions</strong> — scheduler jobs pick them
            up automatically (each run is a fresh session); an open interactive Claude session must be restarted by you.
          </div>
        </div>
        <button class="btn btn-primary btn-small" data-act="restart-app">Restart App + Chat</button>
      </div>
    </div>` : ''}

    ${show('knowledge-spaces') ? `
    <div class="card" data-section="knowledge-spaces" ${ksDone ? '' : 'style="border-color:var(--apricot)"'}>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div class="section-title" style="flex:1;margin:0">Knowledge Spaces</div>
        <span class="badge ${ksDone ? 'badge-green' : 'badge-apricot'}">${ksDone ? 'READY' : 'CHECK PATHS'}</span>
      </div>
      <div class="form-field">
        <label for="ks-personal-root">Personal knowledge root (maps to <code>knowledge/personal/…</code>)</label>
        <input id="ks-personal-root" class="filter-input" type="text" value="${esc(appCfgSettings.personalKnowledgeRoot || '')}" placeholder="knowledge/personal">
      </div>
      <div class="stat-note" style="white-space:normal;margin-bottom:8px">
        Saved root: <code>${esc(personalSaved.path || 'knowledge/personal')}</code> · ${personalSaved.exists ? 'exists' : 'missing'}${personalSaved.isSymlink ? ' · symlink' : ''}<br>
        Active runtime root: <code>${esc(personalActive.path || personalSaved.path || 'knowledge/personal')}</code> · ${personalActive.exists ? 'exists' : 'missing'}${personalActive.isSymlink ? ' · symlink' : ''}
      </div>
      <div class="form-field">
        <label for="ks-shared-root">Shared company/team knowledge root (maps to <code>knowledge/company</code>, <code>knowledge/inbox</code>, <code>knowledge/team</code>)</label>
        <input id="ks-shared-root" class="filter-input" type="text" value="${esc(appCfgSettings.sharedKnowledgeRoot || '')}" placeholder="knowledge">
      </div>
      <div class="stat-note" style="white-space:normal;margin-bottom:8px">
        Saved root: <code>${esc(sharedSaved.path || 'knowledge')}</code> · ${sharedSaved.exists ? 'exists' : 'missing'}${sharedSaved.isSymlink ? ' · symlink' : ''}<br>
        Active runtime root: <code>${esc(sharedActive.path || sharedSaved.path || 'knowledge')}</code> · ${sharedActive.exists ? 'exists' : 'missing'}${sharedActive.isSymlink ? ' · symlink' : ''}<br>
        Shared subfolders detected: company ${sharedFolders.company ? '✓' : '—'} · inbox ${sharedFolders.inbox ? '✓' : '—'} · team ${sharedFolders.team ? '✓' : '—'}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-primary btn-small" data-act="save-knowledge-spaces">Save knowledge spaces</button>
        <span class="stat-note" id="ks-save-status">${appCfg.restartRequired ? 'Saved. Restart required to apply active runtime roots.' : 'Saved values shown above. Changes require restart to take effect.'}</span>
      </div>
      <div class="stat-note" style="margin-top:8px;white-space:normal">
        Personal knowledge remains available independently. If the shared root is missing, the app still runs and shows private folders.
      </div>
    </div>` : ''}

    ${show('ai-provider') ? `
    <div class="card" data-section="ai-provider">
      <div class="section-title">AI Provider</div>
      <div class="provider-grid">
        <div class="provider-card">
          <div class="section-title">Runtime mode</div>
          <div class="form-field">
            <label for="provider-runtime-mode">Provider runtime</label>
            <select id="provider-runtime-mode" class="filter-input">
              ${PROVIDER_MODES.map((m) => `<option value="${m.value}" ${provider.runtimeMode === m.value ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
            </select>
          </div>
          <div class="stat-note provider-note">Controls how chat startup actions adapt (Claude Code vs OpenCode runtime).</div>
        </div>

        <div class="provider-card">
          <div class="section-title">Binary override</div>
          <div class="form-field">
            <label for="provider-opencode-bin">OPENCODE_BIN</label>
            <input id="provider-opencode-bin" class="filter-input" type="text" value="${esc(provider.opencodeBin || '')}" placeholder="/opt/homebrew/bin/opencode">
          </div>
          <div class="stat-note provider-note">Optional absolute path to an OpenCode binary. Leave empty to use PATH lookup.</div>
        </div>

        <div class="provider-card">
          <div class="section-title">CLI bridge</div>
          <div class="form-check">
            <label><input id="provider-cli-bridge-enabled" type="checkbox" ${provider.cliBridgeEnabled ? 'checked' : ''}> Enable CLI bridge for browser chat runtime</label>
          </div>
          <div class="stat-note provider-note">Use only on trusted local machines. Browser sessions should never expose real secrets.</div>
        </div>

        <div class="provider-card provider-card-full">
          <div class="section-title">Env vault (machine-local)</div>
          <div id="provider-env-list" class="provider-env-list"></div>
          <button class="chip" type="button" data-act="provider-env-add">+ Add variable</button>
          <div class="stat-note provider-note">Local runtime env vault: values are stored machine-local in <code>interface/provider-settings.json</code>, masked in the UI and not logged. They apply to interface + chat runtime startup defaults and override same-name shell variables.</div>
        </div>
      </div>
      <div class="provider-actions">
        <button class="btn btn-primary btn-small" data-act="save-provider-settings">Save provider settings</button>
        <span class="stat-note" id="provider-save-status">${providerSavedLabel}</span>
      </div>
      <div class="stat-note" style="margin-top:8px;white-space:normal">Settings are machine-local (<code>interface/provider-settings.json</code>) and apply on restart. Use <strong>Runtime → Restart App + Chat</strong> after saving.</div>
    </div>` : ''}

    ${show('onboarding') ? onboardingCard : ''}

    ${show('profile') ? `
    <div class="card" data-section="profile">
      <div class="section-title">Profile &amp; Instructions</div>
      ${profileChecks.map((c) => `
        <div class="kv-row">
          <span>${c.exists ? '<span class="badge badge-green">OK</span>' : '<span class="badge badge-apricot">MISSING</span>'} ${esc(c.label)}${c.todos ? ` <span class="list-meta">· ${c.todos} TODOs open</span>` : ''}</span>
          <span>${c.id === 'memory-daily'
            ? '<button class="chip" data-act="mem-personal">OPEN</button>'
            : (editable[c.id]
              ? `<button class="chip" data-edit-file="${esc(c.path)}" data-check="${esc(c.id)}">${c.exists ? 'EDIT' : 'CREATE'}</button>`
              : `<span class="list-meta">${esc(c.hint)}</span>`)
          }</span>
        </div>`).join('')}
      <div class="stat-note" style="margin-top:8px;white-space:normal">
        Persona and company profiles are best filled through the interviews: <code>/personal-onboarding</code> and <code>/company-onboarding</code> in Claude Code.
        The editors here are for quick corrections.
      </div>
    </div>` : ''}

    ${show('plugins') ? `
    <div class="card" data-section="plugins">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div class="section-title" style="flex:1;margin:0">Plugins</div>
        <button class="btn btn-ghost btn-small" data-act="add-plugin">Add Plugin</button>
      </div>
      ${plugins.map((p) => `
        <div class="list-row" style="cursor:default;align-items:flex-start">
          <span class="badge ${p.enabled ? 'badge-green' : 'badge-gray'}">${p.enabled ? 'ON' : 'OFF'}</span>
          <span style="flex:1;min-width:0">
            <span class="list-title" style="display:block">${esc(p.name)} <span class="list-meta">· ${esc(p.kind)}${p.custom ? ' · custom' : ''}</span></span>
            <span class="stat-note" style="display:block;white-space:normal">${esc(p.description)} <em>${esc(p.effect)}</em></span>
          </span>
          <span style="display:flex;gap:6px;flex-shrink:0">
            <button class="chip" data-plugin-config="${esc(p.id)}">CONFIGURE</button>
            <button class="chip" data-plugin-toggle="${esc(p.id)}" data-enabled="${p.enabled ? '1' : ''}">${p.enabled ? 'DISABLE' : 'ENABLE'}</button>
            ${p.custom ? `<button class="chip" data-plugin-del="${esc(p.id)}" style="color:var(--apricot-deep)">DELETE</button>` : ''}
          </span>
        </div>`).join('') || '<div class="stat-note">Plugin manager unavailable.</div>'}
      <div class="stat-note" style="margin-top:8px;white-space:normal">
        MCP and permission plugins take effect in <strong>new</strong> runtime sessions (Claude/OpenCode). External plugins are config-only.
      </div>
    </div>` : ''}

    ${show('guardrails') ? '<div class="card" id="gr-card" data-section="guardrails"></div>' : ''}
  </div>`;

  $$('[data-section-tab]', el).forEach((b) => b.addEventListener('click', () => {
    settingsState.section = b.dataset.sectionTab;
    paintSettingsBody(el);
  }));

  $('[data-act="onboarding-guide"]', el)?.addEventListener('click', () => showOnboardingModal(settingsState.data.workspace, { force: true }));
  bindMemoryActions(el);

  $$('[data-edit-file]', el).forEach((b) => b.addEventListener('click', () => {
    const check = profileChecks.find((c) => c.path === b.dataset.editFile);
    const meta = {
      'user-profile': { title: 'Personal Profile', hint: 'private, never committed' },
      'claude-local': { title: 'Personal Instructions', hint: 'private, loaded with CLAUDE.md' },
      'claude-md': { title: 'General Instructions', hint: 'shared — changes go through review' },
      'memory-file': { title: 'Personal Memory', hint: 'private, gitignored local memory' },
      'operating-profile': { title: 'Company Operating Profile', hint: 'fill via /company-onboarding' },
    }[b.dataset.check] || { title: 'Edit File', hint: '' };
    if (b.dataset.check === 'memory-file') {
      openFileEditorDrawer(b.dataset.editFile, { ...meta, template: FILE_TEMPLATES[b.dataset.editFile] || '' });
      return;
    }
    if (check && check.exists) {
      // existing files open in the full Knowledge editor (edit + preview), like knowledge docs
      openInEditor(b.dataset.editFile, 'edit');
      return;
    }
    // missing files are created via the drawer with a starter template
    openFileEditorDrawer(b.dataset.editFile, { ...meta, template: FILE_TEMPLATES[b.dataset.editFile] || '' });
  }));

  $$('[data-plugin-toggle]', el).forEach((b) => b.addEventListener('click', async () => {
    try {
      await apiJson('/api/plugins/' + b.dataset.pluginToggle, { method: 'PUT', body: JSON.stringify({ enabled: !b.dataset.enabled }) });
      toast(b.dataset.pluginToggle.toUpperCase() + (b.dataset.enabled ? ' DISABLED' : ' ENABLED'));
      paintSettings(el);
    } catch (e) { toast(e.message.toUpperCase(), true); }
  }));

  $$('[data-plugin-config]', el).forEach((b) => b.addEventListener('click', () => {
    const p = plugins.find((x) => x.id === b.dataset.pluginConfig);
    openPluginDrawer(p, () => paintSettings(el));
  }));

  $$('[data-plugin-del]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Delete custom plugin "${b.dataset.pluginDel}"? Its managed entries are removed from .mcp.json / permissions.`)) return;
    try {
      await apiJson('/api/plugins/' + b.dataset.pluginDel, { method: 'DELETE' });
      toast('PLUGIN DELETED');
      paintSettings(el);
    } catch (e) { toast(e.message.toUpperCase(), true); }
  }));

  $('[data-act="add-plugin"]', el)?.addEventListener('click', () => openPluginCreateDrawer(() => paintSettings(el)));

  const envListEl = $('#provider-env-list', el);
  const renderProviderEnvRows = () => {
    if (!envListEl) return;
    envListEl.innerHTML = providerEnvRows.length
      ? providerEnvRows.map((row, idx) => `
        <div class="provider-env-row" data-env-row="${idx}">
          <input class="filter-input" data-env-key="${idx}" type="text" value="${esc(row.key)}" placeholder="ENV_KEY" maxlength="64" autocomplete="off" spellcheck="false">
          <div>
            <input class="filter-input" data-env-value="${idx}" type="password" value="" placeholder="${row.hasValue ? 'leave blank to keep existing value' : 'value'}" autocomplete="off" spellcheck="false">
            ${row.hasValue ? `<div class="provider-env-mask">Stored: ${esc(row.masked || '••••')}</div>` : ''}
          </div>
          <button class="chip" type="button" data-env-del="${idx}" style="color:var(--apricot-deep)">Remove</button>
        </div>`).join('')
      : '<div class="stat-note">No env variables saved.</div>';

    $$('[data-env-key]', envListEl).forEach((input) => input.addEventListener('input', () => {
      const idx = Number(input.dataset.envKey);
      if (!Number.isInteger(idx) || !providerEnvRows[idx]) return;
      providerEnvRows[idx].key = input.value.toUpperCase().replace(/\s+/g, '_');
      const status = $('#provider-save-status', el);
      if (status) status.textContent = 'Unsaved changes.';
    }));

    $$('[data-env-value]', envListEl).forEach((input) => input.addEventListener('input', () => {
      const idx = Number(input.dataset.envValue);
      if (!Number.isInteger(idx) || !providerEnvRows[idx]) return;
      providerEnvRows[idx].value = input.value;
      const status = $('#provider-save-status', el);
      if (status) status.textContent = 'Unsaved changes.';
    }));

    $$('[data-env-del]', envListEl).forEach((btn) => btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.envDel);
      if (!Number.isInteger(idx)) return;
      providerEnvRows.splice(idx, 1);
      renderProviderEnvRows();
      const status = $('#provider-save-status', el);
      if (status) status.textContent = 'Unsaved changes.';
    }));
  };
  renderProviderEnvRows();

  $('[data-act="provider-env-add"]', el)?.addEventListener('click', () => {
    providerEnvRows.push({ key: '', value: '', hasValue: false, masked: '' });
    renderProviderEnvRows();
    const status = $('#provider-save-status', el);
    if (status) status.textContent = 'Unsaved changes.';
  });

  $('[data-act="save-provider-settings"]', el)?.addEventListener('click', async () => {
    const modeEl = $('#provider-runtime-mode', el);
    const binEl = $('#provider-opencode-bin', el);
    const bridgeEl = $('#provider-cli-bridge-enabled', el);
    const statusEl = $('#provider-save-status', el);
    if (!modeEl || !binEl || !bridgeEl || !statusEl) return;
    const payload = {
      runtimeMode: modeEl.value,
      opencodeBin: binEl.value.trim(),
      cliBridgeEnabled: Boolean(bridgeEl.checked),
      envVault: providerEnvRows
        .map((row) => ({
          key: String(row.key || '').trim().toUpperCase(),
          value: String(row.value || ''),
          preserve: Boolean(row.hasValue && !String(row.value || '').length),
        }))
        .filter((row) => row.key),
    };
    try {
      statusEl.textContent = 'Saving…';
      const result = await apiJson('/api/provider-settings', { method: 'PUT', body: JSON.stringify(payload) });
      settingsState.data.providerSettings = { settings: result.settings };
      uiState.providerSettings = { ...DEFAULT_PROVIDER_SETTINGS, ...(result.settings || {}) };
      statusEl.textContent = `Saved. ${providerRestartStatusLabel(result.settings)}`;
      toast('PROVIDER SETTINGS SAVED');
      postChatRuntimeConfig();
      paintSettingsBody(el);
    } catch (e) {
      statusEl.textContent = `Save failed: ${e.message}`;
      toast(e.message.toUpperCase(), true);
    }
  });

  const modeEl = $('#provider-runtime-mode', el);
  const bridgeEl = $('#provider-cli-bridge-enabled', el);
  const statusEl = $('#provider-save-status', el);
  if (modeEl && bridgeEl && statusEl) {
    let bridgeManuallyTouched = false;
    bridgeEl.addEventListener('change', () => {
      bridgeManuallyTouched = true;
    });
    modeEl.addEventListener('change', () => {
      if (modeEl.value === 'opencode' && !bridgeEl.checked && !bridgeManuallyTouched) {
        bridgeEl.checked = true;
        statusEl.textContent = 'OpenCode mode selected: CLI bridge enabled by default (you can turn it off before saving).';
      }
      statusEl.textContent = 'Unsaved changes.';
    });
    bridgeEl.addEventListener('change', () => {
      statusEl.textContent = 'Unsaved changes.';
    });
    $('#provider-opencode-bin', el)?.addEventListener('input', () => {
      statusEl.textContent = 'Unsaved changes.';
    });
  }

  $('[data-act="restart-app"]', el)?.addEventListener('click', async () => {
    if (!confirm('Restart the interface and chat runtime? Running scheduler jobs are aborted; the page reloads automatically.')) return;
    try { await apiJson('/api/restart', { method: 'POST' }); } catch { /* connection drops during restart */ }
    toast('RESTARTING…');
    const tryReload = (attempt = 0) => setTimeout(async () => {
      try { await fetch('/api/system'); location.reload(); }
      catch { if (attempt < 20) tryReload(attempt + 1); else toast('SERVER DID NOT COME BACK — START IT MANUALLY', true); }
    }, 700);
    tryReload();
  });

  const grCard = $('#gr-card', el);
  if (grCard) {
    if (guardrails) paintGuardrailsCard(grCard, guardrails);
    else grCard.innerHTML = '<div class="section-title">Guardrails</div><div class="stat-note">Guardrails unavailable.</div>';
  }

  $('[data-act="save-knowledge-spaces"]', el)?.addEventListener('click', async () => {
    const personalEl = $('#ks-personal-root', el);
    const sharedEl = $('#ks-shared-root', el);
    const status = $('#ks-save-status', el);
    if (!personalEl || !sharedEl || !status) return;
    try {
      status.textContent = 'Saving…';
      const result = await apiJson('/api/app-settings', {
        method: 'PUT',
        body: JSON.stringify({
          personalKnowledgeRoot: personalEl.value.trim(),
          sharedKnowledgeRoot: sharedEl.value.trim(),
        }),
      });
      settingsState.data.appSettings = result;
      if (state.system) state.system.appSettings = result;
      status.textContent = result.restartRequired
        ? 'Saved. Restart required to apply active runtime roots.'
        : 'Saved.';
      toast('KNOWLEDGE SPACES SAVED');
      paintSettings(el);
    } catch (e) {
      status.textContent = `Save failed: ${e.message}`;
      toast(e.message.toUpperCase(), true);
    }
  });
}

// ---------------------------------------------------------------- Onboarding check (initial load)

function showOnboardingModal(workspace, { force = false } = {}) {
  const onb = workspace && workspace.onboarding;
  const ks = workspace && workspace.knowledgeSpaces;
  if (!onb) return;
  if (!force && (onb.complete || sessionStorage.getItem('onboarding-dismissed'))) return;
  $('#onboarding-modal')?.remove();

  const step = (done, title, desc, cmd) => `
    <div class="onb-step">
      <span class="badge ${done ? 'badge-green' : 'badge-apricot'}">${done ? 'DONE' : 'OPEN'}</span>
      <span style="flex:1;min-width:0">
        <span class="onb-step-title">${title}</span>
        <span class="stat-note" style="display:block;white-space:normal">${desc}</span>
        ${!done && cmd ? `<code class="onb-cmd">${cmd}</code>` : ''}
      </span>
    </div>`;

  const overlay = document.createElement('div');
  overlay.className = 'modal-scrim';
  overlay.id = 'onboarding-modal';
  overlay.innerHTML = `
    <div class="modal-card">
      <div class="drawer-dept">INITIAL ONBOARDING · ${onb.complete ? 'COMPLETE' : 'INCOMPLETE'}</div>
      <h2 class="onb-title">${onb.complete ? 'This AI OS is fully onboarded.' : 'This AI OS is not fully onboarded yet.'}</h2>
      <p class="stat-note" style="white-space:normal;margin-bottom:14px">
        The onboarding interviews give Danny and all agents the context they need. Without them,
        agents guess. Both run as guided interviews <strong>in Claude Code</strong>, not here.
      </p>
      ${step(onb.personalDone, '1 · Personal onboarding', 'Creates your private persona profile (knowledge/personal/user-profile.md) and your personal instructions (CLAUDE.local.md).', '/personal-onboarding')}
      ${step(onb.companyDone, '2 · Company onboarding', `Fills the company operating profile — the shared custom instruction for the whole team.${onb.companyTodos ? ' Currently ' + onb.companyTodos + ' TODO placeholders open.' : ''}`, '/company-onboarding')}
      ${step(onb.memoryDone, '3 · Memory setup', 'Required local memory paths exist: memory/MEMORY.md and memory/daily/. Edit memory/MEMORY.md in Settings -> Profile & Instructions.', '')}
      ${step(Boolean(ks?.personalReady && ks?.sharedReady), '4 · Knowledge spaces', 'Confirm personal and shared knowledge roots in Settings -> Knowledge Spaces. Missing shared roots are allowed, but should be configured for company docs visibility.', '')}
      <div class="onb-actions">
        <button class="btn btn-primary btn-small" data-onb="settings">Open Settings</button>
        <button class="btn btn-ghost btn-small" data-onb="later">${onb.complete ? 'Close' : 'Remind me later'}</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  $('[data-onb="later"]', overlay).addEventListener('click', () => {
    if (!onb.complete) sessionStorage.setItem('onboarding-dismissed', '1');
    close();
  });
  $('[data-onb="settings"]', overlay).addEventListener('click', () => { close(); setView('settings'); });
}

async function checkOnboarding() {
  try {
    const workspace = await apiJson('/api/workspace');
    showOnboardingModal(workspace);
  } catch { /* server-side check unavailable — never block the app */ }
}

// ---------------------------------------------------------------- Guardrails card

function paintGuardrailsCard(card, data) {
  const pending = {};
  for (const f of data.folders) pending[f.folder] = f.level;
  let entries = data.folders.map((f) => ({ ...f }));
  let dirty = false;
  let addOpen = false;

  const levelLabel = { write: 'WRITE', ask: 'ASK', read: 'READ', deny: 'DENY' };

  const render = () => {
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap">
        <div class="section-title" style="flex:1;margin:0">Guardrails — Folder Permissions</div>
        <button class="chip" data-gr-baseline>APPLY SECURE BASELINE</button>
        <button class="chip" data-gr-add>${addOpen ? 'CANCEL' : 'ADD FOLDER'}</button>
        ${dirty ? '<button class="btn btn-primary btn-small" data-gr-save>Save &amp; Apply</button>' : `<span class="list-meta">${data.updatedAt ? 'applied ' + timeAgo(data.updatedAt) : 'no custom rules yet'}</span>`}
      </div>
      <div class="stat-note" style="margin-bottom:10px;white-space:normal">
        Per-folder access level for agents and this interface: <strong>WRITE</strong> free access ·
        <strong>ASK</strong> read ok, every change asks first · <strong>READ</strong> read-only ·
        <strong>DENY</strong> no access. DEFAULT inherits from the parent folder (top level: normal Claude prompts).
        Saved rules are enforced by this interface <strong>immediately</strong> and written to
        <code>${esc(data.settingsFile)}</code> for Claude Code (<strong>new sessions</strong>; scheduler runs pick them up automatically).
      </div>
      ${addOpen ? `
      <div class="gr-add-row">
        <input class="filter-input" id="gr-add-path" type="text" placeholder="folder path, e.g. knowledge/company/commercial/clients/acme" style="flex:1;min-width:220px">
        <select class="filter-input" id="gr-add-level">
          ${['ask', 'read', 'deny', 'write'].map((l) => `<option value="${l}">${levelLabel[l]}</option>`).join('')}
        </select>
        <button class="chip" data-gr-add-confirm>ADD</button>
      </div>` : ''}
      ${entries.map((f) => {
        const depth = f.folder.split('/').length - 1;
        const current = pending[f.folder];
        const inheritedHint = !current && f.inherited ? ` <span class="list-meta">inherits ${esc(f.effective)}</span>` : '';
        const missing = f.exists === false ? ' <span class="badge badge-apricot">NOT FOUND</span>' : '';
        return `
        <div class="gr-row" style="padding-left:${Math.min(depth, 4) * 18}px">
          <span class="gr-folder">${esc(f.folder)}/</span>${inheritedHint}${missing}
          <span class="filter-tabs gr-tabs">
            <button class="filter-tab ${!current ? 'active' : ''}" data-gr="${esc(f.folder)}" data-level="">DEFAULT</button>
            ${['write', 'ask', 'read', 'deny'].map((l) => `<button class="filter-tab gr-${l} ${current === l ? 'active' : ''}" data-gr="${esc(f.folder)}" data-level="${l}">${levelLabel[l]}</button>`).join('')}
          </span>
          ${f.custom ? `<button class="chip" data-gr-remove="${esc(f.folder)}" style="color:var(--apricot-deep)">REMOVE</button>` : ''}
        </div>`;
      }).join('')}
      <div class="stat-note" style="margin-top:10px;white-space:normal">
        Recommended baseline is available through <strong>APPLY SECURE BASELINE</strong>. The most specific folder rule wins.
        ADD FOLDER covers paths the list does not show (e.g. a single client folder); setting a listed folder
        back to DEFAULT removes its rule on save.
      </div>`;

    $('[data-gr-baseline]', card)?.addEventListener('click', () => {
      for (const [folder, level] of Object.entries(data.recommendedBaseline || {})) pending[folder] = level;
      dirty = true;
      render();
    });

    $$('[data-gr]', card).forEach((b) => b.addEventListener('click', () => {
      pending[b.dataset.gr] = b.dataset.level || null;
      dirty = true;
      render();
    }));

    $('[data-gr-add]', card).addEventListener('click', () => {
      addOpen = !addOpen;
      render();
      if (addOpen) $('#gr-add-path', card)?.focus();
    });

    const confirmAdd = () => {
      const raw = ($('#gr-add-path', card)?.value || '').trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
      if (!raw) return toast('ENTER A FOLDER PATH', true);
      if (raw.includes('..') || raw.startsWith('/')) return toast('INVALID PATH — RELATIVE PROJECT PATHS ONLY', true);
      if (entries.some((f) => f.folder === raw)) return toast('FOLDER IS ALREADY IN THE LIST', true);
      const level = $('#gr-add-level', card).value;
      entries.push({ folder: raw, level, custom: true, exists: null, inherited: false, effective: level });
      entries.sort((a, b) => a.folder.localeCompare(b.folder));
      pending[raw] = level;
      dirty = true;
      addOpen = false;
      render();
    };
    $('[data-gr-add-confirm]', card)?.addEventListener('click', confirmAdd);
    $('#gr-add-path', card)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmAdd(); });

    $$('[data-gr-remove]', card).forEach((b) => b.addEventListener('click', () => {
      const folder = b.dataset.grRemove;
      delete pending[folder];
      entries = entries.filter((f) => f.folder !== folder);
      dirty = true;
      render();
    }));

    $('[data-gr-save]', card)?.addEventListener('click', async () => {
      const folders = {};
      for (const [f, l] of Object.entries(pending)) if (l) folders[f] = l;
      try {
        const result = await apiJson('/api/guardrails', { method: 'PUT', body: JSON.stringify({ folders }) });
        toast('GUARDRAILS APPLIED — ACTIVE HERE NOW, CLAUDE PICKS THEM UP IN NEW SESSIONS');
        data = result.status;
        entries = data.folders.map((f) => ({ ...f }));
        for (const k of Object.keys(pending)) delete pending[k];
        for (const f of data.folders) pending[f.folder] = f.level;
        dirty = false;
        addOpen = false;
        render();
      } catch (e) { toast(e.message.toUpperCase(), true); }
    });
  };
  render();
}

function openPluginCreateDrawer(onSaved) {
  openDrawer(`
    <div class="drawer-head">
      <button class="drawer-close">✕</button>
      <div class="drawer-dept">PLUGIN · NEW</div>
      <div class="drawer-name">Add Plugin</div>
      <div class="drawer-role">Register a new integration. MCP and permission plugins take real effect; external ones store config and setup notes.</div>
    </div>
    <div class="drawer-body">
      <div class="form-field"><label>ID (kebab-case)</label><input id="pc-id" placeholder="my-mcp-server"></div>
      <div class="form-field"><label>Name</label><input id="pc-name" placeholder="My MCP Server"></div>
      <div class="form-field"><label>Kind</label>
        <select id="pc-kind">
          <option value="mcp">mcp — server entry written to .mcp.json</option>
          <option value="permission">permission — tool rule allowed in settings.local.json</option>
          <option value="external">external — config + setup notes only</option>
        </select>
      </div>
      <div class="form-field"><label>Description</label><textarea id="pc-desc" rows="3" placeholder="What does this plugin provide?"></textarea></div>
      <div class="form-field" id="pc-perm-wrap" style="display:none"><label>Permission rule</label><input id="pc-perm" placeholder='e.g. WebSearch or Bash(gh:*)'></div>
      <div class="form-field" id="pc-mcp-wrap"><label>MCP command + args</label><input id="pc-cmd" placeholder="npx"><input id="pc-args" placeholder="-y my-mcp-package" style="margin-top:6px"></div>
      <div class="form-field"><label>Setup notes (optional)</label><textarea id="pc-setup" rows="2" placeholder="Install command or docs link"></textarea></div>
      <button class="btn btn-primary" id="pc-save">Add Plugin</button>
    </div>`);

  $('#pc-kind').addEventListener('change', () => {
    const kind = $('#pc-kind').value;
    $('#pc-perm-wrap').style.display = kind === 'permission' ? 'flex' : 'none';
    $('#pc-mcp-wrap').style.display = kind === 'mcp' ? 'flex' : 'none';
  });

  $('#pc-save').addEventListener('click', async () => {
    const kind = $('#pc-kind').value;
    try {
      await apiJson('/api/plugins', { method: 'POST', body: JSON.stringify({
        id: $('#pc-id').value.trim(),
        name: $('#pc-name').value,
        kind,
        description: $('#pc-desc').value,
        permission: $('#pc-perm').value,
        setup: $('#pc-setup').value,
        config: kind === 'mcp' ? { command: $('#pc-cmd').value.trim(), args: $('#pc-args').value.trim().split(/\s+/).filter(Boolean), env: {} } : {},
      }) });
      toast('PLUGIN ADDED — ENABLE + CONFIGURE IT IN THE LIST');
      closeDrawer();
      onSaved();
    } catch (e) { toast(e.message.toUpperCase(), true); }
  });
}

function openPluginDrawer(p, onSaved) {
  openDrawer(`
    <div class="drawer-head">
      <button class="drawer-close">✕</button>
      <div class="drawer-dept">PLUGIN · ${esc(p.kind.toUpperCase())}</div>
      <div class="drawer-name">${esc(p.name)}</div>
      <div class="drawer-role">${esc(p.description)}</div>
    </div>
    <div class="drawer-body">
      <div class="drawer-section">
        <div class="section-title">Effect when enabled</div>
        <div class="stat-note" style="white-space:normal">${esc(p.effect)}</div>
      </div>
      ${p.setup ? `<div class="drawer-section">
        <div class="section-title">Setup (outside this interface)</div>
        <pre class="run-log" style="max-height:120px">${esc(p.setup)}</pre>
      </div>` : ''}
      <div class="form-field">
        <label>Configuration (JSON)</label>
        <textarea id="pf-config" rows="8" spellcheck="false">${esc(JSON.stringify(p.config, null, 2))}</textarea>
        ${p.kind === 'mcp' ? '<div class="stat-note">Tip: keep secrets out of plugin JSON. Use <code>envKeys</code> (e.g. <code>["TWENTY_API_KEY"]</code>) to read values from local runtime env.</div>' : ''}
      </div>
      ${p.kind === 'mcp' ? `<div class="drawer-section">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <button class="btn btn-small" id="pf-test">Test MCP</button>
          <span class="stat-note">Runs a short MCP connectivity check with timeout, returns sanitized summary only.</span>
        </div>
        <pre class="run-log" id="pf-test-result" style="max-height:180px;margin-top:8px;display:none"></pre>
      </div>` : ''}
      <div class="form-field form-check"><label><input id="pf-enabled" type="checkbox" ${p.enabled ? 'checked' : ''}> Enabled</label></div>
      <button class="btn btn-primary" id="pf-save">Save Plugin Settings</button>
    </div>`);

  $('#pf-test')?.addEventListener('click', async () => {
    const out = $('#pf-test-result');
    const btn = $('#pf-test');
    if (!out || !btn) return;
    try {
      out.style.display = 'block';
      out.textContent = 'Testing MCP command…';
      btn.disabled = true;
      const result = await apiJson('/api/plugins/' + p.id + '/test', { method: 'POST', body: JSON.stringify({}) });
      out.textContent = JSON.stringify(result, null, 2);
      toast(`${p.name.toUpperCase()} TEST FINISHED`);
    } catch (e) {
      out.style.display = 'block';
      out.textContent = String(e.message || e);
      toast((`${p.name} TEST FAILED: ${e.message}`).toUpperCase(), true);
    } finally {
      btn.disabled = false;
    }
  });

  $('#pf-save').addEventListener('click', async () => {
    let config;
    try { config = JSON.parse($('#pf-config').value); }
    catch { return toast('CONFIG IS NOT VALID JSON', true); }
    try {
      await apiJson('/api/plugins/' + p.id, { method: 'PUT', body: JSON.stringify({ enabled: $('#pf-enabled').checked, config }) });
      toast(p.name.toUpperCase() + ' SAVED');
      closeDrawer();
      onSaved();
    } catch (e) { toast(e.message.toUpperCase(), true); }
  });
}

// ---------------------------------------------------------------- Markdown renderer

function mdToHtml(src) {
  let md = src;
  let fm = '';
  const fmMatch = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fmMatch) {
    fm = `<div class="fm">${esc(fmMatch[1])}</div>`;
    md = md.slice(fmMatch[0].length);
  }

  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0, inCode = false, codeBuf = [], listType = null, listBuf = [];

  const flushList = () => {
    if (listType) { out.push(`<${listType}>` + listBuf.join('') + `</${listType}>`); listType = null; listBuf = []; }
  };
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safe = safeHref(href);
      if (!safe) return label;
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      if (inCode) { out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>'); codeBuf = []; inCode = false; }
      else { flushList(); inCode = true; }
      i++; continue;
    }
    if (inCode) { codeBuf.push(line); i++; continue; }

    // table
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flushList();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      let html = '<table><thead><tr>' + cells(line).map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        html += '<tr>' + cells(lines[i]).map((c) => `<td>${c}</td>`).join('') + '</tr>';
        i++;
      }
      out.push(html + '</tbody></table>');
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { flushList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { flushList(); out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) { flushList(); out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); i++; continue; }

    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+\.\s+(.*)/);
    if (ul || ol) {
      const t = ul ? 'ul' : 'ol';
      if (listType !== t) flushList();
      listType = t;
      listBuf.push(`<li>${inline((ul || ol)[1])}</li>`);
      i++; continue;
    }

    if (line.trim() === '') { flushList(); i++; continue; }
    flushList();
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  flushList();
  if (inCode) out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
  return fm + out.join('\n');
}

// ---------------------------------------------------------------- Chat integration

const chatFrameState = { frame: null, ready: false, pendingRuntimeConfig: null, pendingPreset: null };

function chatSlug(agentId) {
  return CHAT_AGENT_MAP[agentId] || 'danny';
}

window.addEventListener('message', (e) => {
  if (e.origin !== CHAT_URL || e.data?.type !== 'steadymade-chat-ready') return;
  if (e.source !== chatFrameState.frame?.contentWindow) return;
  chatFrameState.ready = true;
  flushPendingChatMessages();
});

function chatRuntimeConfigPayload() {
  const providerMode = String(uiState.providerSettings?.runtimeMode || DEFAULT_PROVIDER_SETTINGS.runtimeMode);
  const provider = providerMode === 'opencode' ? 'opencode' : 'claude';
  return {
    type: 'steadymade-runtime-config',
    chatMode: uiState.chatMode,
    mode: uiState.chatMode,
    lockMode: true,
    providerMode,
    provider,
    cliBridgeEnabled: Boolean(uiState.providerSettings?.cliBridgeEnabled),
  };
}

function postToChat(msg, kind = 'runtime') {
  if (!msg) return;
  if (chatFrameState.ready && chatFrameState.frame?.contentWindow) {
    chatFrameState.frame.contentWindow.postMessage(msg, CHAT_URL);
    return;
  }
  if (kind === 'preset') chatFrameState.pendingPreset = msg;
  else chatFrameState.pendingRuntimeConfig = msg;
}

function flushPendingChatMessages() {
  if (!chatFrameState.ready || !chatFrameState.frame?.contentWindow) return;
  if (chatFrameState.pendingRuntimeConfig) {
    chatFrameState.frame.contentWindow.postMessage(chatFrameState.pendingRuntimeConfig, CHAT_URL);
    chatFrameState.pendingRuntimeConfig = null;
  }
  if (chatFrameState.pendingPreset) {
    chatFrameState.frame.contentWindow.postMessage(chatFrameState.pendingPreset, CHAT_URL);
    chatFrameState.pendingPreset = null;
  }
}

function postChatRuntimeConfig() {
  postToChat(chatRuntimeConfigPayload(), 'runtime');
}

function renderChat() {
  const holder = $('#chat-holder');
  if (!holder) return;

  if (!chatFrameState.frame) {
    chatFrameState.ready = false;
    holder.innerHTML = `<div class="chat-offline-note">
      <strong>Chat runtime:</strong> embedded from <code>${esc(CHAT_URL)}</code>.
      If this area stays blank, run <code>node chat/server.mjs</code> or restart with <code>node scripts/start.mjs</code>.
    </div>`;
    const frame = document.createElement('iframe');
    frame.className = 'chat-frame';
    frame.src = CHAT_URL;
    frame.title = 'Steadymade Danny Chat';
    frame.allow = 'clipboard-write';
    frame.addEventListener('load', () => {
      holder.querySelector('.chat-offline-note')?.remove();
    });
    holder.appendChild(frame);
    chatFrameState.frame = frame;
  }

  postChatRuntimeConfig();

  if (state.chatAgent || state.chatDraft) {
    const preset = {
      type: 'steadymade-preset',
      agent: state.chatAgent ? chatSlug(state.chatAgent) : null,
      draft: state.chatDraft || null,
    };
    postToChat(preset, 'preset');
  }

  state.chatDraft = null;
  state.chatAgent = null;
}

// ---------------------------------------------------------------- go

boot();
