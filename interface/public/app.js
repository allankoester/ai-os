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
  kn: {
    folder: null,        // active folder key in Knowledge view
    level: '',           // folder level shown in the folder column ('' = root)
    doc: null,           // active doc path
    content: '',
    savedContent: '',
    mode: 'edit',        // edit | preview
  },
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const VIEW_TITLES = {
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
  bindChrome();
  setView('command');
  checkOnboarding(); // non-blocking: shows the onboarding guide if the workspace is not fully onboarded
}

function bindChrome() {
  $$('#nav .nav-item').forEach((btn) =>
    btn.addEventListener('click', () => setView(btn.dataset.view)));

  $('#btn-new-workflow').addEventListener('click', () => {
    setView('workflows');
    requestAnimationFrame(() => openWorkflowDrawer(null));
  });
  $('#btn-add-knowledge').addEventListener('click', addKnowledge);

  // true browser fullscreen — hides browser chrome entirely
  $('#btn-fullscreen').addEventListener('click', toggleFullscreen);

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
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => toast('FULLSCREEN BLOCKED BY BROWSER', true));
}

function setView(view) {
  state.view = view;
  state.selectedAgent = state.selectedFolder = null;
  if (mapState.observer && view !== 'map') { mapState.observer.disconnect(); mapState.observer = null; }
  $$('#nav .nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#view-title').textContent = VIEW_TITLES[view];
  closeDrawer();
  const el = $('#view');
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
  const needsReview = statuses.filter((s) => s === 'needs_review' || s === 'needs review' || s === 'conflict').length;
  const approved = statuses.filter((s) => s === 'approved').length;
  const recent = [...docs].sort((a, b) => b.mtime - a.mtime).slice(0, 7);

  el.innerHTML = `
  <div class="view-pad">
    <div class="cc-grid">
      <div class="card card-dark stat-card">
        <div class="mono-label" style="color:#7E978A">AGENTS ONLINE</div>
        <div class="stat-value">${AGENTS.length}</div>
        <div class="stat-note">Danny + ${AGENTS.length - 1} specialists, ${DEPARTMENTS.length} departments</div>
      </div>
      <div class="card stat-card">
        <div class="mono-label">KNOWLEDGE DOCS</div>
        <div class="stat-value">${docs.length}</div>
        <div class="stat-note">${state.system.folders.length} folders, Markdown on disk</div>
      </div>
      <div class="card stat-card">
        <div class="mono-label">OPEN REVIEW ITEMS</div>
        <div class="stat-value" style="color:${needsReview ? 'var(--apricot-deep)' : 'var(--headline)'}">${needsReview}</div>
        <div class="stat-note">${approved} approved · ${docs.length - approved - needsReview} draft</div>
      </div>
      <div class="card stat-card">
        <div class="mono-label">WORKFLOWS</div>
        <div class="stat-value">${FLOWS.length}</div>
        <div class="stat-note">All routed through Danny</div>
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
          <div class="section-title">Knowledge Health</div>
          ${sortedFolders().map((f) => {
            const ok = f.docs.filter((d) => docMeta(d.path).status === 'approved').length;
            const pct = f.docs.length ? Math.round((ok / f.docs.length) * 100) : 0;
            return `<div class="kh-row">
              <span style="font-weight:600;color:var(--headline)">${esc(f.name)}</span>
              <span class="kh-bar"><i style="width:${pct}%"></i></span>
              <span class="list-meta">${ok}/${f.docs.length} approved</span>
            </div>`;
          }).join('')}
        </div>
        <div class="card">
          <div class="section-title">Recent Artifacts</div>
          ${state.system.artifacts.length ? state.system.artifacts.map((a) => `
            <div class="list-row">
              <span class="badge badge-gray">FILE</span>
              <span class="list-title">${esc(a.name)}</span>
              <span class="list-meta">${timeAgo(a.mtime)}</span>
            </div>`).join('') : '<div class="stat-note">No artifacts yet.</div>'}
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
        <button class="btn btn-green btn-small" data-act="open-prompt">Open prompt</button>
        <button class="btn btn-small" data-act="edit-prompt">Edit prompt</button>
        <button class="btn btn-small" data-act="view-knowledge">View connected knowledge</button>
        <button class="btn btn-small" data-act="test-task">Run test task</button>
      </div>
    </div>`);

  const d = $('#drawer');
  $$('[data-folder]', d).forEach((b) => b.addEventListener('click', () => { setView('knowledge'); selectKnFolder(b.dataset.folder); }));
  $$('[data-flow]', d).forEach((b) => b.addEventListener('click', () => setView('workflows')));
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

function renderKnowledge(el) {
  el.innerHTML = `<div class="kn-layout">
    <div class="kn-folders" id="kn-folders"></div>
    <div class="kn-docs" id="kn-docs"></div>
    <div class="kn-editor" id="kn-editor"></div>
  </div>`;
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
  state.kn.doc = null;
  state.kn.level = knChildren(key).length ? key : knParent(key);
  if (state.view !== 'knowledge') setView('knowledge');
  else { paintKnFolders(); paintKnDocs(); paintKnEditor(); }
}

function paintKnFolders() {
  const el = $('#kn-folders');
  if (!el) return;
  const level = state.kn.level || '';
  const segs = level ? level.split('/') : [];
  const crumbs = [`<button class="kn-crumb ${level ? '' : 'current'}" data-level="">knowledge</button>`]
    .concat(segs.map((s, i) => `<button class="kn-crumb ${i === segs.length - 1 ? 'current' : ''}" data-level="${esc(segs.slice(0, i + 1).join('/'))}">${esc(s)}</button>`))
    .join('<span class="kn-crumb-sep">/</span>');
  const children = knChildren(level);

  el.innerHTML = `
    <div class="section-title" style="padding:0 12px">Folders</div>
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
    state.kn.doc = null;
    if (b.dataset.children) state.kn.level = b.dataset.key; // drill in: clicked folder becomes the level
    paintKnFolders(); paintKnDocs(); paintKnEditor();
  }));
}

function paintKnDocs() {
  const el = $('#kn-docs');
  if (!el) return;
  const folder = knFolderList().find((f) => f.key === state.kn.folder);
  if (!folder) {
    // container folder without direct documents (exists only as a path prefix)
    el.innerHTML = `<div class="section-title" style="padding:0 12px">${esc((state.kn.folder || '—') + '/')}</div>
      <div class="stat-note" style="padding:0 12px">No documents at this level — open a subfolder.</div>`;
    return;
  }
  el.innerHTML = `<div class="section-title" style="padding:0 12px">${esc(folder.label)}</div>` +
    (folder.docs.length ? folder.docs.map((d) => `
      <button class="kn-doc-btn ${state.kn.doc === d.path ? 'active' : ''}" data-path="${esc(d.path)}">
        <div class="kn-doc-title">${esc(d.title)}</div>
        <div class="kn-doc-meta">
          <span class="badge ${statusBadgeClass(docMeta(d.path).status)}">${docMeta(d.path).status.toUpperCase()}</span>
          <span>${timeAgo(d.mtime)}</span><span>${d.words}w</span>
        </div>
      </button>`).join('') : '<div class="stat-note" style="padding:0 12px">Empty folder.</div>');
  $$('.kn-doc-btn', el).forEach((b) => b.addEventListener('click', () => loadDoc(b.dataset.path)));
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
    state.kn.level = knChildren(folder.key).length ? folder.key : knParent(folder.key);
  }
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
    const who = { nora: 'Nora (Knowledge Agent)', mara: 'Mara (Knowledge Governance)', atlas: 'Atlas (Strategic Advisor)' }[b.dataset.ask];
    const verbs = { nora: 'Summarize this document and list its key facts with sources.', mara: 'Classify this document: type, market scope, duplicates, canonical status.', atlas: 'Review the strategic relevance of this document for Steadymade.' };
    navigator.clipboard?.writeText(`Task for ${who}:\n${verbs[b.dataset.ask]}\nDocument: ${state.kn.doc}`);
    toast('TASK BRIEF COPIED — PASTE INTO CLAUDE (LIVE AGENT EXECUTION PENDING)', true);
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

async function addKnowledge() {
  const folders = state.system.folders.map((f) => f.name);
  const folder = prompt('Folder:\n' + folders.join(', '), folders[0]);
  if (!folder || !folders.includes(folder)) return;
  const name = prompt('File name (without .md):', 'new-document');
  if (!name) return;
  const path = `knowledge/${folder}/${name.replace(/\.md$/, '')}.md`;
  const content = `# ${name}\n\nStatus: draft\n\n`;
  const res = await fetch('/api/file', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content }) });
  if (res.ok) {
    state.system = await (await fetch('/api/system')).json();
    state.kn.folder = folder;
    state.kn.level = knParent(folder);
    setView('knowledge');
    loadDoc(path, 'edit');
    toast('CREATED ' + path.toUpperCase());
  }
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
  el.innerHTML = `<div class="view-pad"><div class="dept-grid">
    ${DEPARTMENTS.map((d) => {
      const members = AGENTS.filter((a) => a.dept === d.id);
      return `<div class="card dept-card">
        <div class="dept-name">${esc(d.name)}</div>
        <div class="dept-sub">${esc(d.note)} · ${members.length} agent${members.length === 1 ? '' : 's'}</div>
        ${members.map((a) => `
          <button class="dept-agent-row" data-agent="${a.id}">
            <span class="dept-agent-avatar">${a.name[0]}</span>
            <span>
              <div class="dept-agent-name">${esc(a.name)} — ${esc(a.title)}</div>
              <div class="dept-agent-role">${esc(a.role)}</div>
            </span>
          </button>`).join('')}
      </div>`;
    }).join('')}
  </div></div>`;
  $$('[data-agent]', el).forEach((b) => b.addEventListener('click', () => openAgentDrawer(b.dataset.agent)));
}

// ---------------------------------------------------------------- Scheduler

const schedState = { data: null, el: null, timer: null };

const AGENT_OPTIONS = AGENTS
  .filter((a) => a.promptPath.startsWith('.claude/agents/'))
  .map((a) => ({ value: a.promptPath.replace('.claude/agents/', '').replace(/\.md$/, ''), label: `${a.name} — ${a.title}` }));

async function apiJson(path, opts) {
  const res = await fetch(path, opts);
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
          <button class="chip" data-log="${r.id}">LOG</button>
        </div>`).join('') : '<div class="stat-note">No runs yet.</div>'}
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
  market: null,        // /api/marketplace result
  marketQ: '',
  marketCat: '',
  marketScope: 'personal', // install target workspace
  marketOpen: false,
  installing: null,
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
      ${visible.length ? visible.map((s) => `
        <div class="list-row" style="cursor:default;align-items:flex-start">
          <span class="badge ${s.active ? 'badge-green' : 'badge-gray'}">${s.active ? 'ACTIVE' : 'OFF'}</span>
          <span style="flex:1;min-width:0">
            <span class="list-title" style="display:block">/${esc(s.name)}</span>
            <span class="stat-note" style="display:block;white-space:normal">${esc((s.description || 'No description in SKILL.md frontmatter.').slice(0, 220))}</span>
          </span>
          <span style="display:flex;gap:6px;flex-shrink:0">
            <button class="chip" data-customize="${esc(s.path)}">CUSTOMIZE</button>
            <button class="chip" data-skill="${esc(s.scope)}:${esc(s.name)}" data-active="${s.active ? '1' : ''}">${s.active ? 'DEACTIVATE' : 'ACTIVATE'}</button>
          </span>
        </div>`).join('') : `<div class="stat-note">${esc(skills.length ? 'No skills match the current filter.' : empties[scope.name] || 'No skills in this workspace yet.')}</div>`}
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
    try {
      await apiJson('/api/skills/toggle', { method: 'POST', body: JSON.stringify({ scope, name, active: !b.dataset.active }) });
      toast(`/${name.toUpperCase()} ${b.dataset.active ? 'DEACTIVATED' : 'ACTIVATED'}`);
      skillState.data = await apiJson('/api/skills');
      paintSkillBody();
    } catch (e) { toast(e.message.toUpperCase(), true); }
  }));
  $$('[data-customize]', body).forEach((b) => b.addEventListener('click', () => openFileEditorDrawer(b.dataset.customize, { title: 'Customize Skill', hint: 'Edits the local SKILL.md — adapt triggers, instructions and constraints to Steadymade.' })));
}

function paintSkills() {
  const el = skillState.el;
  if (!el || state.view !== 'skills') return;

  const scopes = skillState.data.scopes;
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
        <button class="btn btn-ghost btn-small" data-act="market">${skillState.marketOpen ? 'Hide Marketplace' : 'Browse Marketplace'}</button>
      </div>
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
  $('[data-act="market"]', el).addEventListener('click', () => { skillState.marketOpen = !skillState.marketOpen; paintSkills(); if (skillState.marketOpen) loadMarketplace(); });
  paintSkillBody();
  if (skillState.marketOpen && skillState.market) paintMarketplace();
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
          <span class="badge ${s.installable ? 'badge-green' : 'badge-gray'}">${s.installable ? 'INSTALLABLE' : 'EXTERNAL'}</span>
          <span style="flex:1;min-width:0">
            <span class="list-title" style="display:block">${esc(s.name)} <span class="list-meta">· ${esc(s.category)}</span></span>
            <span class="stat-note" style="display:block;white-space:normal">${esc(s.description.slice(0, 200))}</span>
          </span>
          <span style="display:flex;gap:6px;flex-shrink:0">
            <a class="chip" href="${esc(s.url)}" target="_blank" rel="noopener" style="text-decoration:none">OPEN</a>
            ${s.installable ? `<button class="chip" data-install="${i}">${skillState.installing === s.url ? 'INSTALLING…' : 'INSTALL'}</button>` : ''}
          </span>
        </div>`).join('') || '<div class="stat-note">No marketplace entries match.</div>'}
      ${skills.length > 40 && visible.length === 40 ? '<div class="stat-note" style="margin-top:6px">Showing first 40 matches — refine the search.</div>' : ''}`;

  $$('[data-install]', listEl).forEach((b) => b.addEventListener('click', async () => {
    const s = visible[+b.dataset.install];
    if (skillState.installing) return;
    skillState.installing = s.url;
    paintMarketplaceList();
    try {
      const result = await apiJson('/api/marketplace/install', { method: 'POST', body: JSON.stringify({ url: s.url, scope: skillState.marketScope || 'personal' }) });
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

async function openFileEditorDrawer(path, { title = 'Edit File', hint = '', template = '' } = {}) {
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
      await putFileGuarded(path, $('#fe-content').value);
      toast('SAVED ' + path.toUpperCase());
      closeDrawer();
      // refresh the system model so a newly created file shows up in the Knowledge view immediately
      try { state.system = await apiJson('/api/system'); } catch { /* keep stale model */ }
      if (state.view === 'settings') renderSettings($('#view'));
    } catch (e) { toast(e.message.toUpperCase(), true); }
  });
}

// ---------------------------------------------------------------- Artifacts / Settings

const artState = { q: '', range: 'all' };

const ART_RANGES = [
  ['24h', 24 * 3600e3, 'Last 24h'],
  ['7d', 7 * 24 * 3600e3, 'Last 7 days'],
  ['30d', 30 * 24 * 3600e3, 'Last 30 days'],
  ['all', Infinity, 'All time'],
];

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
  const items = [...state.system.artifacts]
    .sort((a, b) => (b.ctime || b.mtime) - (a.ctime || a.mtime)) // newest generated first
    .filter((a) => (a.ctime || a.mtime) >= Date.now() - rangeMs)
    .filter((a) => !q || (a.name + ' ' + (a.folder || '')).toLowerCase().includes(q));

  el.innerHTML = `<div class="view-pad simple-list" style="max-width:860px">
    <div class="card">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div class="section-title" style="margin:0">Artifacts <span class="list-meta">${items.length} of ${state.system.artifacts.length}</span></div>
        <input id="art-search" class="filter-input" type="text" placeholder="Search artifacts…" value="${esc(artState.q)}" style="flex:1;min-width:160px">
        <span class="filter-tabs">
          ${ART_RANGES.map(([id, , label]) => `<button class="filter-tab ${artState.range === id ? 'active' : ''}" data-range="${id}">${label}</button>`).join('')}
        </span>
      </div>
      <div class="stat-note" style="margin-top:6px;white-space:normal">Generated files under <code>artifacts/</code> (incl. subfolders), newest first by creation date.</div>
    </div>
    ${items.length ? items.map((a) => `
      <div class="card">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <span class="badge badge-gray">${esc((a.name.includes('.') ? a.name.split('.').pop() : 'file').toUpperCase())}</span>
          <span style="flex:1;min-width:180px">
            <span style="display:block;font-weight:600;color:var(--headline)">${esc(a.name)}</span>
            <span class="list-meta">${esc(a.folder || 'artifacts')}/</span>
          </span>
          <span class="list-meta">${(a.size / 1024).toFixed(1)} KB</span>
          <span class="list-meta" title="${new Date(a.ctime || a.mtime).toLocaleString()}">created ${timeAgo(a.ctime || a.mtime)}</span>
          <button class="chip" data-art-open="${esc(a.path)}">OPEN</button>
        </div>
      </div>`).join('') : `<div class="card">${state.system.artifacts.length ? 'No artifacts match the current filter.' : 'No artifacts in artifacts/ yet — agent runs place generated files there.'}</div>`}
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
  $$('[data-art-open]', el).forEach((b) => b.addEventListener('click', () => {
    window.open('/api/artifact?path=' + encodeURIComponent(b.dataset.artOpen), '_blank');
  }));
}

const FILE_TEMPLATES = {
  'knowledge/personal/user-profile.md': `# User Profile — <Name>\n\n- **Rolle:** TODO\n- **Märkte:** TODO (DACH / Australia / Both)\n- **Sprache:** TODO (de / en)\n\n## Verantwortung & Aufgaben\n\n- TODO\n\n## Arbeitsweise\n\n- Entscheidungen: TODO\n- Detailtiefe: TODO\n\n## Kommunikation\n\n- Ton: TODO\n\n## Schmerzpunkte & Ziele\n\n- TODO\n\n> Tipp: /personal-onboarding füllt dieses Profil im Interview.\n`,
  'CLAUDE.local.md': `<!-- persona:start -->\n# Persönliche Instructions — <Name>\n\n- Ich bin TODO (Rolle). Vollständiges Profil: knowledge/personal/user-profile.md\n- Antworte auf TODO (de/en); Ton: TODO.\n- Detailtiefe: TODO.\n- Standard-Markt: TODO.\n<!-- persona:end -->\n`,
};

const settingsState = { section: 'all', el: null, data: null };

const SETTINGS_SECTIONS = [
  ['all', 'All'],
  ['onboarding', 'Onboarding'],
  ['runtime', 'Runtime'],
  ['profile', 'Profile & Instructions'],
  ['guardrails', 'Guardrails'],
  ['plugins', 'Plugins'],
  ['project', 'Project Info'],
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
  try {
    [workspace, { plugins }, guardrails] = await Promise.all([
      apiJson('/api/workspace'), apiJson('/api/plugins'), apiJson('/api/guardrails'),
    ]);
  } catch { /* server-side features unavailable */ }
  if (state.view !== 'settings') return;
  settingsState.data = { workspace, plugins, guardrails };
  paintSettingsBody(el);
}

function paintSettingsBody(el) {
  const { workspace, plugins, guardrails } = settingsState.data;
  const show = (section) => settingsState.section === 'all' || settingsState.section === section;
  const onb = workspace.onboarding;

  const editable = {
    'user-profile': { title: 'Personal Profile', hint: 'Your persona profile — private, never committed.' },
    'claude-local': { title: 'Personal Instructions', hint: 'Loaded by Claude Code in addition to CLAUDE.md — private.' },
    'claude-md': { title: 'General Instructions', hint: 'Shared project instructions — changes go through review.' },
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

    ${show('onboarding') ? onboardingCard : ''}

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
        <button class="btn btn-primary btn-small" data-act="restart-app">Restart Interface</button>
      </div>
    </div>` : ''}

    ${show('profile') ? `
    <div class="card" data-section="profile">
      <div class="section-title">Profile &amp; Instructions</div>
      ${workspace.checks.map((c) => `
        <div class="kv-row">
          <span>${c.exists ? '<span class="badge badge-green">OK</span>' : '<span class="badge badge-apricot">MISSING</span>'} ${esc(c.label)}${c.todos ? ` <span class="list-meta">· ${c.todos} TODOs open</span>` : ''}</span>
          <span>${editable[c.id] ? `<button class="chip" data-edit-file="${esc(c.path)}" data-check="${esc(c.id)}">${c.exists ? 'EDIT' : 'CREATE'}</button>` : `<span class="list-meta">${esc(c.hint)}</span>`}</span>
        </div>`).join('')}
      <div class="stat-note" style="margin-top:8px;white-space:normal">
        Persona and company profiles are best filled through the interviews: <code>/personal-onboarding</code> and <code>/company-onboarding</code> in Claude Code.
        The editors here are for quick corrections.
      </div>
    </div>` : ''}

    ${show('guardrails') ? '<div class="card" id="gr-card" data-section="guardrails"></div>' : ''}

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
        MCP and permission plugins take effect in <strong>new</strong> Claude sessions. External plugins are config-only.
      </div>
    </div>` : ''}

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
  </div>`;

  $$('[data-section-tab]', el).forEach((b) => b.addEventListener('click', () => {
    settingsState.section = b.dataset.sectionTab;
    paintSettingsBody(el);
  }));

  $('[data-act="onboarding-guide"]', el)?.addEventListener('click', () => showOnboardingModal(settingsState.data.workspace, { force: true }));

  $$('[data-edit-file]', el).forEach((b) => b.addEventListener('click', () => {
    const check = workspace.checks.find((c) => c.path === b.dataset.editFile);
    if (check && check.exists) {
      // existing files open in the full Knowledge editor (edit + preview), like knowledge docs
      openInEditor(b.dataset.editFile, 'edit');
      return;
    }
    // missing files are created via the drawer with a starter template
    const meta = {
      'user-profile': { title: 'Personal Profile', hint: 'private, never committed' },
      'claude-local': { title: 'Personal Instructions', hint: 'private, loaded with CLAUDE.md' },
      'claude-md': { title: 'General Instructions', hint: 'shared — changes go through review' },
      'operating-profile': { title: 'Company Operating Profile', hint: 'fill via /company-onboarding' },
    }[b.dataset.check] || { title: 'Edit File', hint: '' };
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

  $('[data-act="restart-app"]', el)?.addEventListener('click', async () => {
    if (!confirm('Restart the interface server? Running scheduler jobs are aborted; the page reloads automatically.')) return;
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
}

// ---------------------------------------------------------------- Onboarding check (initial load)

function showOnboardingModal(workspace, { force = false } = {}) {
  const onb = workspace && workspace.onboarding;
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
      </div>
      <div class="form-field form-check"><label><input id="pf-enabled" type="checkbox" ${p.enabled ? 'checked' : ''}> Enabled</label></div>
      <button class="btn btn-primary" id="pf-save">Save Plugin Settings</button>
    </div>`);

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
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

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

// ---------------------------------------------------------------- go

boot();
