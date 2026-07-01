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
  departments: 'Departments',
  artifacts: 'Artifacts',
  settings: 'Settings',
};

const agentById = (id) => AGENTS.find((a) => a.id === id);
const deptById = (id) => DEPARTMENTS.find((d) => d.id === id);

// Preferred folder ordering for lists
const FOLDER_ORDER = ['strategy', 'steadymade Docs', 'marketing', 'offers', 'documents', 'creative', 'clients', 'archive'];
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
  if (status === 'needs review' || status === 'conflict') return 'badge-apricot';
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
  const live = state.system.agents.length + 1; // +1 = Danny (docs/)
  $('#status-agents').textContent = live + ' active';
  bindChrome();
  setView('command');
}

function bindChrome() {
  $$('#nav .nav-item').forEach((btn) =>
    btn.addEventListener('click', () => setView(btn.dataset.view)));

  $('#btn-new-workflow').addEventListener('click', () => {
    setView('workflows');
    toast('WORKFLOWS ARE DEFINED IN CLAUDE.MD — EDIT THERE, PROTOTYPE READS THEM AS FIXED', true);
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
     workflows: renderWorkflows, departments: renderDepartments,
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

  WORKFLOWS.filter((w) => w.name.toLowerCase().includes(ql))
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
  const needsReview = statuses.filter((s) => s === 'needs review' || s === 'conflict').length;
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
        <div class="stat-value">${WORKFLOWS.length}</div>
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
            One orchestrator, twelve specialists, knowledge as editable Markdown — nothing ships without review and approval.
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
  const folders = sortedFolders();

  // ring agents grouped by department order
  const order = ['strategy', 'knowledge', 'marketing', 'sales', 'documents', 'creative'];
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
    a.access.forEach((fname) => {
      const fp = mapState.folderPositions[fname];
      if (fp) edges += edge(p.x, p.y, fp.x, fp.y, 'acc', `${a.id}>${fname}`);
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
    const w = Math.max(120, f.name.length * 7.5 + 56), h = 46;
    return `<g class="node node-folder" data-node-folder="${esc(f.name)}" transform="translate(${p.x - (w * s) / 2},${p.y - (h * s) / 2}) scale(${s})">
      <rect class="node-box" width="${w}" height="${h}" rx="20"/>
      <path d="M 17 ${h / 2 - 5} h 4 l 2 2 h 6 v 8 h -12 z" fill="none" stroke="var(--green-light)" stroke-width="1.2"/>
      <text class="node-name" x="36" y="${h / 2 - 3}">${esc(f.name)}/</text>
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
      <div class="legend-row"><span class="legend-dot folder"></span> MARKDOWN FOLDER</div>
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
    const lit = a.access.includes(n.dataset.nodeFolder);
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
  const withAccess = AGENTS.filter((a) => a.access.includes(name)).map((a) => a.id);
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
  const restricted = state.system.folders.map((f) => f.name).filter((n) => !a.access.includes(n));
  const flows = WORKFLOWS.filter((w) => a.workflows.includes(w.id));
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
        <div class="section-title">Knowledge Access</div>
        <div class="tag-row">${a.access.map((f) => `<button class="chip" data-folder="${esc(f)}">${esc(f)}/</button>`).join('')}</div>
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
}

function openFolderDrawer(name) {
  const f = state.system.folders.find((x) => x.name === name);
  if (!f) return;
  const withAccess = AGENTS.filter((a) => a.access.includes(name));
  const flows = WORKFLOWS.filter((w) => w.chain.some((id) => withAccess.some((a) => a.id === id)));
  const last = f.docs.length ? Math.max(...f.docs.map((d) => d.mtime)) : null;

  openDrawer(`
    <div class="drawer-head">
      <button class="drawer-close">✕</button>
      <div class="drawer-dept">KNOWLEDGE FOLDER</div>
      <div class="drawer-name">${esc(name)}/</div>
      <div class="drawer-role">${f.docs.length} Markdown document${f.docs.length === 1 ? '' : 's'}${last ? ' · last modified ' + timeAgo(last) : ''}</div>
    </div>
    <div class="drawer-body">
      <div class="drawer-section">
        <div class="section-title">Agents With Access</div>
        <div class="tag-row">${withAccess.map((a) => `<button class="chip" data-agent="${a.id}">${esc(a.name)}</button>`).join('') || '<span class="stat-note">None</span>'}</div>
      </div>
      <div class="drawer-section">
        <div class="section-title">Documents</div>
        ${f.docs.map((doc) => `
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

function renderKnowledge(el) {
  el.innerHTML = `<div class="kn-layout">
    <div class="kn-folders" id="kn-folders"></div>
    <div class="kn-docs" id="kn-docs"></div>
    <div class="kn-editor" id="kn-editor"></div>
  </div>`;
  if (!state.kn.folder) state.kn.folder = knFolderList()[0].key;
  paintKnFolders();
  paintKnDocs();
  paintKnEditor();
}

function selectKnFolder(key) {
  state.kn.folder = key;
  state.kn.doc = null;
  if (state.view !== 'knowledge') setView('knowledge');
  else { paintKnFolders(); paintKnDocs(); paintKnEditor(); }
}

function paintKnFolders() {
  const el = $('#kn-folders');
  if (!el) return;
  el.innerHTML = `<div class="section-title" style="padding:0 12px">Folders</div>` +
    knFolderList().map((f) => `
      <button class="kn-folder-btn ${state.kn.folder === f.key ? 'active' : ''}" data-key="${esc(f.key)}">
        <span class="kn-folder-name"><span style="color:${f.kind === 'system' ? 'var(--muted)' : 'var(--green-light)'};font-family:var(--font-mono)">${f.kind === 'system' ? '·' : '▸'}</span> ${esc(f.label)}</span>
        <span class="kn-folder-meta">${f.docs.length} DOCS</span>
      </button>`).join('');
  $$('.kn-folder-btn', el).forEach((b) => b.addEventListener('click', () => {
    state.kn.folder = b.dataset.key; state.kn.doc = null;
    paintKnFolders(); paintKnDocs(); paintKnEditor();
  }));
}

function paintKnDocs() {
  const el = $('#kn-docs');
  if (!el) return;
  const folder = knFolderList().find((f) => f.key === state.kn.folder);
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
  state.kn.folder = folder ? folder.key : state.kn.folder;
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

async function saveDoc() {
  if (!state.kn.doc) return;
  const res = await fetch('/api/file', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: state.kn.doc, content: state.kn.content }),
  });
  if (res.ok) {
    state.kn.savedContent = state.kn.content;
    const entry = findDocEntry(state.kn.doc);
    if (entry) { entry.mtime = Date.now(); entry.words = state.kn.content.split(/\s+/).length; }
    paintKnEditor();
    paintKnDocs();
    toast('SAVED TO DISK · ' + state.kn.doc.split('/').pop().toUpperCase());
  } else {
    toast('SAVE FAILED', true);
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
    setView('knowledge');
    loadDoc(path, 'edit');
    toast('CREATED ' + path.toUpperCase());
  }
}

// ---------------------------------------------------------------- Workflows

function renderWorkflows(el) {
  el.innerHTML = `<div class="view-pad">
    ${WORKFLOWS.map((w) => `
      <div class="card wf-card">
        <div class="wf-head">
          <div class="wf-name">${esc(w.name)}</div>
          <span class="badge badge-dark">${w.id.toUpperCase()}</span>
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
            const t = TERMINALS[stepId];
            return `<span class="wf-step terminal">
              <span class="wf-step-name">${esc(t.name)}</span>
              <span class="wf-step-role">${esc(t.role)}</span>
            </span>${arrow}`;
          }).join('')}
        </div>
      </div>`).join('')}
  </div>`;
  $$('[data-agent]', el).forEach((b) => b.addEventListener('click', () => { setView('map'); selectMapAgent(b.dataset.agent); }));
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

// ---------------------------------------------------------------- Artifacts / Settings

function renderArtifacts(el) {
  el.innerHTML = `<div class="view-pad simple-list" style="max-width:760px">
    <div class="section-title">Artifacts (artifacts/)</div>
    ${state.system.artifacts.length ? state.system.artifacts.map((a) => `
      <div class="card">
        <div style="display:flex;align-items:center;gap:14px">
          <span class="badge badge-gray">${esc(a.name.split('.').pop().toUpperCase())}</span>
          <span style="font-weight:600;color:var(--headline);flex:1">${esc(a.name)}</span>
          <span class="list-meta">${(a.size / 1024).toFixed(1)} KB · ${timeAgo(a.mtime)}</span>
        </div>
      </div>`).join('') : '<div class="card">No artifacts in artifacts/ yet.</div>'}
  </div>`;
}

function renderSettings(el) {
  el.innerHTML = `<div class="view-pad settings-block">
    <div class="card">
      <div class="section-title">Project</div>
      <div class="kv-row"><span>Name</span><span>Steadymade AI OS — Agent Setup</span></div>
      <div class="kv-row"><span>Mode</span><span>Claude Project (no external runtime)</span></div>
      <div class="kv-row"><span>Knowledge format</span><span>Markdown on disk</span></div>
      <div class="kv-row"><span>Agents</span><span>${AGENTS.length} (Danny + ${AGENTS.length - 1} specialists)</span></div>
      <div class="kv-row"><span>Agent prompts</span><span>.claude/agents/*.md</span></div>
      <div class="kv-row"><span>Orchestrator prompt</span><span>docs/danny-orchestrator-system-prompt.md</span></div>
    </div>
    <div class="card">
      <div class="section-title">Persistence</div>
      <div class="kv-row"><span>Markdown edits</span><span>REAL — written to disk via local API</span></div>
      <div class="kv-row"><span>Status / market scope</span><span>interface/meta.json (sidecar, docs untouched)</span></div>
      <div class="kv-row"><span>Agent execution</span><span>PENDING — copy task briefs into Claude</span></div>
    </div>
    <div class="card">
      <div class="section-title">Approval Logic</div>
      <div class="kv-row"><span>States</span><span>idea → briefing → draft → review → strategy_check → approval_required → approved → final</span></div>
      <div class="kv-row"><span>Rule</span><span>Nothing is marked approved without explicit user approval</span></div>
    </div>
  </div>`;
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
