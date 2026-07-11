const layoutEl = document.getElementById('layout');
const sidebarEl = document.getElementById('sidebar');
const sidebarResizeEl = document.getElementById('sidebarResize');
const stageEl = document.getElementById('stage');
const chatEl = document.getElementById('chat');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const statusEl = document.getElementById('status');
const sessEl = document.getElementById('sess');
const modelSel = document.getElementById('model');
const agentSel = document.getElementById('agent');
const chatHeaderEl = document.getElementById('chatHeader');
const cliHeaderEl = document.getElementById('cliHeader');
const newBtn = document.getElementById('newChat');
const convListEl = document.getElementById('convList');
const convSearchEl = document.getElementById('convSearch');
const incogEl = document.getElementById('incognito');
const composerWrapEl = document.querySelector('.composer-wrap');
const viewChatBtn = document.getElementById('viewChat');
const viewCliBtn = document.getElementById('viewCli');
const cliPanelEl = document.getElementById('cliPanel');
const termStartBtn = document.getElementById('termStart');
const termStopBtn = document.getElementById('termStop');
const termSessionsEl = document.getElementById('termSessions');
const cliHintEl = document.getElementById('cliHint');
const termEmptyEl = document.getElementById('termEmpty');
const terminalHostEl = document.getElementById('terminalHost');

const CONV_KEY = 'steadymade_chat_conversation';
const SIDEBAR_WIDTH_KEY = 'steadymade_chat_sidebar_width';
const UI_MODE_KEY = 'steadymade_chat_ui_mode';
const TERMINAL_TARGETS = new Set(['claude', 'opencode']);
const TRUSTED_PARENT_ORIGINS = new Set([
  `${location.protocol}//localhost:4011`,
  `${location.protocol}//127.0.0.1:4011`,
]);

const MOBILE_MEDIA = window.matchMedia('(max-width: 720px)');
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 560;

const state = {
  conversationId: null,
  incognitoSessionId: null,
  running: false,
  abort: null,
  streamConversationId: null,
  streamIncognito: false,
  sessions: [],
  agents: [],
  agentById: new Map(),
  seqByConversation: {},
  live: null,
  uiMode: 'chat',
};

const cliState = {
  bridgeEnabled: false,
  sessions: [],
  activeSessionId: null,
  ws: null,
  provider: 'claude',
  modeLocked: false,
  unsupportedReason: '',
  term: null,
  fitAddon: null,
  resizeObserver: null,
};

if (window.parent !== window) {
  cliState.modeLocked = true;
}

function trustedParentOrigin() {
  try {
    const ref = document.referrer ? new URL(document.referrer).origin : '';
    if (TRUSTED_PARENT_ORIGINS.has(ref)) return ref;
  } catch {}
  const sameHost = `${location.protocol}//${location.hostname}:4011`;
  if (TRUSTED_PARENT_ORIGINS.has(sameHost)) return sameHost;
  return `${location.protocol}//localhost:4011`;
}

function isTrustedParentMessage(event) {
  if (window.parent === window) return true;
  return event.source === window.parent && TRUSTED_PARENT_ORIGINS.has(String(event.origin || ''));
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safe = safeHref(href);
      if (!safe) return label;
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
}

function renderMd(src) {
  const lines = esc(src).split('\n');
  let html = '';
  let i = 0;
  let para = [];
  const flush = () => {
    if (para.length) {
      html += `<p>${inline(para.join('<br>'))}</p>`;
      para = [];
    }
  };
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      flush();
      const code = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      html += `<pre><code>${code.join('\n')}</code></pre>`;
      i += 1;
      continue;
    }
    if (/^#{1,3} /.test(l)) {
      flush();
      const lvl = l.match(/^#+/)[0].length;
      html += `<h${lvl}>${inline(l.replace(/^#+ /, ''))}</h${lvl}>`;
      i += 1;
      continue;
    }
    if (/^\s*[-*] /.test(l)) {
      flush();
      const items = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) {
        items.push(`<li>${inline(lines[i++].replace(/^\s*[-*] /, ''))}</li>`);
      }
      html += `<ul>${items.join('')}</ul>`;
      continue;
    }
    if (l.trim() === '') {
      flush();
      i += 1;
      continue;
    }
    para.push(l);
    i += 1;
  }
  flush();
  return html;
}

function mdStreamSafe(src) {
  const fences = (src.match(/^```/gm) || []).length;
  return fences % 2 ? src + '\n```' : src;
}

function renderStreamingMd(bubble, raw) {
  bubble._raw = raw;
  if (bubble._mdQueued) return;
  bubble._mdQueued = true;
  requestAnimationFrame(() => {
    bubble._mdQueued = false;
    bubble.innerHTML = renderMd(mdStreamSafe(bubble._raw));
  });
}

function agentMeta(id) {
  return state.agentById.get(id) || { id: 'danny', name: 'Danny', function: 'Orchestrator' };
}

function speakerLabel(agentId) {
  const a = agentMeta(agentId);
  return `${a.name} — ${a.function}`;
}

function currentSpeaker() {
  return speakerLabel(agentSel.value || 'danny');
}

function timeAgo(iso) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function clearWelcome() {
  const welcome = chatEl.querySelector('.welcome');
  if (welcome) welcome.remove();
  stageEl.classList.remove('centered');
}

function showWelcome() {
  chatEl.innerHTML = `<div class="welcome"><div class="w-label">STEADYMADE AI OS</div><h1>Danny Chat</h1><p>Danny is the default orchestrator. You can switch to direct specialist mode in the selector.</p></div>`;
  stageEl.classList.add('centered');
}

function scrollDown() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addUserMsg(text) {
  clearWelcome();
  const row = document.createElement('div');
  row.className = 'msg user';
  row.innerHTML = '<div class="speaker">You</div>';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  row.appendChild(bubble);
  chatEl.appendChild(row);
  scrollDown();
}

function addAssistantShell(speaker, withTyping = true) {
  clearWelcome();
  const row = document.createElement('div');
  row.className = 'msg assistant';
  const typing = withTyping ? '<span class="typing"><span></span><span></span><span></span></span>' : '';
  row.innerHTML = `<div class="speaker">${esc(speaker || currentSpeaker())}</div><div class="activity"></div><div class="bubble">${typing}</div>`;
  chatEl.appendChild(row);
  scrollDown();
  return row;
}

function addToolChip(activity, d) {
  const chip = document.createElement('span');
  chip.className = `chip${d.sub ? ' sub' : ''}`;
  chip.textContent = d.name === 'Task' ? `→ ${d.detail || 'Task'}` : `${d.name}${d.detail ? ` · ${d.detail}` : ''}`;
  activity.appendChild(chip);
}

function addMetaLine(shell, d) {
  const meta = document.createElement('div');
  meta.className = 'meta';
  const dur = d.duration_ms != null ? `${(d.duration_ms / 1000).toFixed(1)}s` : '';
  const cost = d.cost_usd != null ? `$${Number(d.cost_usd).toFixed(3)}` : '';
  const turns = d.num_turns ? `${d.num_turns} turns` : '';
  const tokens = d.total_tokens ? `${Number(d.total_tokens).toLocaleString()} tokens` : '';
  meta.textContent = [dur, cost, turns, tokens].filter(Boolean).join(' · ');
  shell.appendChild(meta);
}

function autosize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 180)}px`;
}

function setBusy(busy) {
  sendBtn.classList.toggle('stop', busy);
  sendBtn.innerHTML = busy
    ? '<svg width="12" height="12" viewBox="0 0 12 12"><rect width="12" height="12" rx="2" fill="currentColor"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8h11M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function selectAgent(id) {
  const opt = [...agentSel.options].find((o) => o.value === id);
  if (!opt) return false;
  agentSel.value = id;
  const meta = agentMeta(id);
  inputEl.placeholder = id === 'danny' ? 'Message Danny…' : `Message ${meta.name}…`;
  return true;
}

function applyPreset(agent, draft) {
  if (agent) selectAgent(agent);
  if (draft) {
    inputEl.value = draft;
    autosize();
    inputEl.focus();
  }
}

async function apiJson(url, opts) {
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data?.error || `${res.status}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function sidebarMaxForViewport() {
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.floor(window.innerWidth * 0.5)));
}

function applySidebarWidth(rawWidth) {
  if (MOBILE_MEDIA.matches) return;
  const width = clamp(Number(rawWidth) || 250, SIDEBAR_MIN, sidebarMaxForViewport());
  sidebarEl.style.width = `${width}px`;
  return width;
}

function initSidebarResize() {
  const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  if (!MOBILE_MEDIA.matches) applySidebarWidth(Number.isFinite(stored) ? stored : 250);

  let dragging = false;

  const onMove = (e) => {
    if (!dragging || MOBILE_MEDIA.matches) return;
    const w = applySidebarWidth(e.clientX - layoutEl.getBoundingClientRect().left);
    if (Number.isFinite(w)) localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
  };

  const stop = () => {
    if (!dragging) return;
    dragging = false;
    sidebarResizeEl.classList.remove('dragging');
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', stop);
  };

  sidebarResizeEl.addEventListener('mousedown', (e) => {
    if (MOBILE_MEDIA.matches) return;
    dragging = true;
    sidebarResizeEl.classList.add('dragging');
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stop);
    e.preventDefault();
  });

  window.addEventListener('resize', () => {
    if (MOBILE_MEDIA.matches) {
      sidebarEl.style.removeProperty('width');
      return;
    }
    const current = Number.parseInt(sidebarEl.style.width || '', 10);
    const storedWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    const base = Number.isFinite(current) ? current : (Number.isFinite(storedWidth) ? storedWidth : 250);
    const w = applySidebarWidth(base);
    if (Number.isFinite(w)) localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
  });
}

function setUiMode(mode) {
  const next = mode === 'cli' ? 'cli' : 'chat';
  state.uiMode = next;
  localStorage.setItem(UI_MODE_KEY, next);
  viewChatBtn.classList.toggle('active', next === 'chat');
  viewCliBtn.classList.toggle('active', next === 'cli');
  layoutEl.classList.toggle('cli-mode', next === 'cli');
  const modeSwitch = viewChatBtn?.closest('.view-switch');
  if (modeSwitch) modeSwitch.classList.toggle('hidden', cliState.modeLocked);
  chatHeaderEl.classList.toggle('hidden', next !== 'chat');
  cliHeaderEl.classList.toggle('hidden', next !== 'cli');
  chatEl.classList.toggle('hidden', next !== 'chat');
  composerWrapEl.classList.toggle('hidden', next !== 'chat');
  cliPanelEl.classList.toggle('hidden', next !== 'cli');
  sidebarEl.classList.toggle('hidden', next === 'cli');
  sidebarResizeEl.classList.toggle('hidden', next === 'cli');
  if (next === 'cli') {
    stageEl.classList.remove('centered');
    statusEl.textContent = 'ready';
    ensureTerminal();
    refreshTerminalSessions();
  } else {
    if (!chatEl.querySelector('.msg')) showWelcome();
    inputEl.focus();
  }
}

function setCliHint(text, kind = '') {
  cliHintEl.className = `cli-hint${kind ? ` ${kind}` : ''}`;
  cliHintEl.textContent = text;
}

function ensureTerminal() {
  if (cliState.term) return true;
  if (!window.Terminal || !window.FitAddon || !window.FitAddon.FitAddon) {
    cliState.unsupportedReason = 'Embedded terminal assets unavailable. Please reinstall dependencies and reload.';
    setCliHint(cliState.unsupportedReason, 'warn');
    return false;
  }
  cliState.term = new window.Terminal({
    convertEol: false,
    cursorBlink: true,
    fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace',
    fontSize: 12,
    theme: {
      background: '#111111',
      foreground: '#E6ECE6',
    },
  });
  cliState.fitAddon = new window.FitAddon.FitAddon();
  cliState.term.loadAddon(cliState.fitAddon);
  cliState.term.open(terminalHostEl);
  cliState.fitAddon.fit();
  cliState.term.onData((data) => {
    if (!cliState.ws || cliState.ws.readyState !== WebSocket.OPEN) return;
    cliState.ws.send(JSON.stringify({ type: 'input', data }));
  });
  cliState.resizeObserver = new ResizeObserver(() => {
    fitTerminalAndNotify();
  });
  cliState.resizeObserver.observe(terminalHostEl);
  return true;
}

function activeTerminalSession() {
  return cliState.sessions.find((s) => s.id === cliState.activeSessionId) || null;
}

function fitTerminalAndNotify() {
  if (!cliState.term || !cliState.fitAddon) return;
  cliState.fitAddon.fit();
  const active = activeTerminalSession();
  if (!active) return;
  const cols = cliState.term.cols;
  const rows = cliState.term.rows;
  if (cliState.ws && cliState.ws.readyState === WebSocket.OPEN) {
    cliState.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  } else {
    apiJson(`/api/terminal/sessions/${encodeURIComponent(active.id)}/resize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols, rows }),
    }).catch(() => {});
  }
}

function renderTerminalTabs() {
  termSessionsEl.innerHTML = '';
  if (!cliState.sessions.length) {
    const empty = document.createElement('span');
    empty.className = 'term-tab';
    empty.textContent = 'No sessions';
    empty.style.cursor = 'default';
    termSessionsEl.appendChild(empty);
    return;
  }
  for (const s of cliState.sessions) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = `term-tab${s.id === cliState.activeSessionId ? ' active' : ''}`;
    tab.textContent = `${s.target} · ${s.id.slice(0, 6)}${s.running ? '' : ' · stopped'}`;
    tab.addEventListener('click', () => switchTerminalSession(s.id));
    termSessionsEl.appendChild(tab);
  }
}

function updateTerminalControls() {
  const active = activeTerminalSession();
  const running = !!active?.running;
  termStartBtn.disabled = !cliState.bridgeEnabled || !!cliState.unsupportedReason;
  termStartBtn.textContent = `Start ${cliState.provider}`;
  termStopBtn.disabled = !running;

  if (!cliState.bridgeEnabled) {
    setCliHint('CLI bridge is disabled. Enable it in Settings → AI Provider and restart.', 'warn');
  } else if (cliState.unsupportedReason) {
    setCliHint(cliState.unsupportedReason, 'warn');
  } else if (!active) {
    setCliHint(`Ready. Provider target: ${cliState.provider}. Create a session to start the embedded terminal.`, '');
  } else if (!active.running) {
    setCliHint(`Session ${active.id.slice(0, 8)} exited${active.exitCode != null ? ` (code ${active.exitCode})` : ''}.`, 'warn');
  } else {
    setCliHint(`Connected to ${active.target} session ${active.id.slice(0, 8)}${active.pid ? ` (pid ${active.pid})` : ''}.`, 'ok');
  }
}

function setTerminalEmptyVisible(visible, message) {
  termEmptyEl.classList.toggle('hidden', !visible);
  if (message) termEmptyEl.textContent = message;
}

function closeTerminalWs() {
  if (cliState.ws) {
    cliState.ws.onclose = null;
    cliState.ws.onerror = null;
    cliState.ws.onmessage = null;
    try { cliState.ws.close(); } catch {}
    cliState.ws = null;
  }
}

function switchTerminalSession(sessionId) {
  if (!sessionId || cliState.activeSessionId === sessionId) {
    renderTerminalTabs();
    updateTerminalControls();
    return;
  }
  cliState.activeSessionId = sessionId;
  renderTerminalTabs();
  connectTerminalWebSocket();
}

function connectTerminalWebSocket() {
  closeTerminalWs();
  const active = activeTerminalSession();
  updateTerminalControls();
  if (!active) {
    setTerminalEmptyVisible(true, 'No terminal session yet. Click Start to launch the current provider target.');
    return;
  }
  if (!ensureTerminal()) return;

  cliState.term.reset();
  setTerminalEmptyVisible(false);
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/api/terminal/ws?sessionId=${encodeURIComponent(active.id)}`);
  cliState.ws = ws;

  ws.onopen = () => {
    fitTerminalAndNotify();
    updateTerminalControls();
  };

  ws.onmessage = (event) => {
    let payload = {};
    try { payload = JSON.parse(event.data || '{}'); } catch {}
    if (payload.type === 'output' && typeof payload.data === 'string') {
      if (cliState.term) cliState.term.write(payload.data);
      return;
    }
    if (payload.type === 'status' && payload.session) {
      const idx = cliState.sessions.findIndex((s) => s.id === payload.session.id);
      if (idx >= 0) cliState.sessions[idx] = payload.session;
      else cliState.sessions.unshift(payload.session);
      renderTerminalTabs();
      updateTerminalControls();
      return;
    }
    if (payload.type === 'error' && payload.error) {
      setCliHint(payload.error, 'warn');
    }
  };

  ws.onerror = () => {
    setCliHint('Embedded terminal websocket error. Check local bridge settings and retry.', 'warn');
  };

  ws.onclose = () => {
    if (cliState.ws === ws) cliState.ws = null;
    refreshTerminalSessions();
  };
}

async function refreshTerminalSessions() {
  try {
    const data = await apiJson('/api/terminal/sessions');
    cliState.bridgeEnabled = data.bridgeEnabled !== false;
    cliState.sessions = Array.isArray(data.sessions) ? data.sessions : [];
    const hasActive = cliState.sessions.some((s) => s.id === cliState.activeSessionId);
    if (!hasActive) {
      const firstRunning = cliState.sessions.find((s) => s.running);
      cliState.activeSessionId = firstRunning?.id || cliState.sessions[0]?.id || null;
    }
    renderTerminalTabs();
    updateTerminalControls();
    if (cliState.activeSessionId) connectTerminalWebSocket();
    else setTerminalEmptyVisible(true, 'No terminal session yet. Click Start to launch the current provider target.');
  } catch (err) {
    cliState.bridgeEnabled = false;
    cliState.sessions = [];
    cliState.activeSessionId = null;
    renderTerminalTabs();
    const msg = err.payload?.reason || err.message || 'Terminal API unavailable';
    setCliHint(msg, 'warn');
    setTerminalEmptyVisible(true, msg);
    updateTerminalControls();
  }
}

async function startTerminalSession() {
  if (!ensureTerminal()) return;
  const target = TERMINAL_TARGETS.has(cliState.provider) ? cliState.provider : 'claude';
  try {
    const data = await apiJson('/api/terminal/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, cols: cliState.term.cols, rows: cliState.term.rows }),
    });
    cliState.sessions = Array.isArray(data.sessions) ? data.sessions : cliState.sessions;
    cliState.activeSessionId = data.session?.id || cliState.activeSessionId;
    renderTerminalTabs();
    connectTerminalWebSocket();
  } catch (err) {
    const msg = err.payload?.error || err.payload?.reason || err.message || 'failed to start terminal session';
    setCliHint(msg, 'warn');
    setTerminalEmptyVisible(true, msg);
  }
}

async function stopTerminalSession() {
  const active = activeTerminalSession();
  if (!active) return;
  try {
    await apiJson(`/api/terminal/sessions/${encodeURIComponent(active.id)}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    await refreshTerminalSessions();
  } catch (err) {
    const msg = err.payload?.error || err.message || 'failed to stop terminal session';
    setCliHint(msg, 'warn');
  }
}

function renderConvList(items, { searchMode = false } = {}) {
  convListEl.innerHTML = '';
  if (!items.length) {
    convListEl.innerHTML = `<div class="conv-empty">${searchMode ? 'No matches.' : 'No conversations yet.'}</div>`;
    return;
  }
  for (const s of items) {
    const item = document.createElement('div');
    item.className = `conv-item${s.id === state.conversationId ? ' active' : ''}`;
    item.innerHTML = `
      <div class="conv-title">${esc(s.title || 'Untitled')}</div>
      ${searchMode && s.snippet ? `<div class="conv-snippet">${esc(s.snippet)}</div>` : ''}
      <div class="conv-meta"><span>${esc(agentMeta(s.agent).name)}</span><span>${timeAgo(s.updatedAt)}</span>${s.running ? '<span class="run-badge">RUNNING</span>' : ''}${s.archived ? '<span>archived</span>' : ''}</div>
      <div class="conv-actions">
        <button data-act="rename">RENAME</button>
        <button data-act="archive">${s.archived ? 'RESTORE' : 'ARCHIVE'}</button>
      </div>`;
    item.addEventListener('click', (e) => {
      const act = e.target?.dataset?.act;
      if (act === 'rename') {
        e.stopPropagation();
        const title = prompt('Conversation title:', s.title || '');
        if (title && title.trim()) {
          apiJson('/api/session/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: s.id, title: title.trim() }),
          }).then(() => loadSessions()).catch(() => {});
        }
        return;
      }
      if (act === 'archive') {
        e.stopPropagation();
        apiJson('/api/session/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: s.id, archived: !s.archived }),
        }).then(() => {
          if (s.id === state.conversationId && !s.archived) resetConversation();
          loadSessions();
        }).catch(() => {});
        return;
      }
      loadConversation(s.id);
    });
    convListEl.appendChild(item);
  }
}

async function loadAgents() {
  const { agents } = await apiJson('/api/agents');
  state.agents = agents;
  state.agentById = new Map(agents.map((a) => [a.id, a]));
  agentSel.innerHTML = '';
  for (const a of agents) {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = `${a.name} — ${a.function}`;
    agentSel.appendChild(opt);
  }
  selectAgent('danny');
}

async function loadSessions() {
  try {
    const { sessions } = await apiJson('/api/sessions');
    state.sessions = sessions;
    if (!convSearchEl.value.trim()) renderConvList(sessions);
  } catch {
    convListEl.innerHTML = '<div class="conv-empty">History unavailable.</div>';
  }
}

function renderEvents(events, session) {
  let shell = null;
  let turnAgent = session.agent;
  const ensureShell = () => {
    if (!shell) {
      shell = addAssistantShell(speakerLabel(turnAgent), false);
      shell.querySelector('.bubble').innerHTML = '';
    }
    return shell;
  };
  for (const e of events) {
    if (e.t === 'user') {
      shell = null;
      turnAgent = e.agent || turnAgent;
      addUserMsg(e.text || '');
    } else if (e.t === 'tool') {
      addToolChip(ensureShell().querySelector('.activity'), e);
    } else if (e.t === 'assistant') {
      const row = ensureShell();
      row.querySelector('.bubble').innerHTML = e.text ? renderMd(e.text) : '<em>(no text)</em>';
      if (e.meta) addMetaLine(row, e.meta);
      shell = null;
    }
  }
}

function detachStream() {
  if (state.abort) state.abort.abort();
  state.abort = null;
  state.running = false;
  state.streamConversationId = null;
  state.streamIncognito = false;
  state.live = null;
  setBusy(false);
}

function ensureLive(agentId) {
  if (state.live) return state.live;
  const shell = addAssistantShell(speakerLabel(agentId));
  state.live = {
    agentId,
    shell,
    bubble: shell.querySelector('.bubble'),
    activity: shell.querySelector('.activity'),
    raw: '',
    gotDelta: false,
  };
  return state.live;
}

function parseSseChunk(chunk) {
  let ev = 'message';
  let data = '';
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event: ')) ev = line.slice(7).trim();
    if (line.startsWith('data: ')) data += line.slice(6);
  }
  let payload = {};
  try { payload = data ? JSON.parse(data) : {}; } catch {}
  return { ev, payload };
}

function handleStreamEvent(ev, d, streamAgentId) {
  if (state.streamConversationId && Number.isFinite(d._seq)) {
    state.seqByConversation[state.streamConversationId] = d._seq;
  }
  switch (ev) {
    case 'conversation':
      if (d.id) {
        state.conversationId = d.id;
        state.streamConversationId = d.id;
        localStorage.setItem(CONV_KEY, d.id);
      }
      break;
    case 'init':
      if (d.incognito) {
        state.incognitoSessionId = d.session_id || state.incognitoSessionId;
        sessEl.textContent = `Incognito${d.model ? ` · ${d.model}` : ''}`;
      } else {
        sessEl.textContent = `Conversation ${String(state.streamConversationId || state.conversationId || '').slice(0, 8)}${d.model ? ` · ${d.model}` : ''}`;
      }
      break;
    case 'delta': {
      const live = ensureLive(streamAgentId || agentSel.value || 'danny');
      if (!live.gotDelta) {
        live.bubble.innerHTML = '';
        live.gotDelta = true;
      }
      live.raw += d.text || '';
      renderStreamingMd(live.bubble, live.raw);
      scrollDown();
      break;
    }
    case 'tool': {
      const live = ensureLive(streamAgentId || agentSel.value || 'danny');
      addToolChip(live.activity, d);
      scrollDown();
      break;
    }
    case 'result': {
      const live = ensureLive(streamAgentId || agentSel.value || 'danny');
      if (live.raw) live.bubble.innerHTML = renderMd(live.raw);
      else if (d.error_text) live.bubble.innerHTML = `<em>${esc(d.error_text)}</em>`;
      addMetaLine(live.shell, d);
      scrollDown();
      break;
    }
    case 'gate': {
      if (!state.live) break;
      if (Array.isArray(d.issues) && d.issues.length) {
        const note = document.createElement('div');
        note.className = 'gate note';
        note.title = 'Editorial style check for client-facing drafts (em-dash / „nicht … sondern" pattern)';
        note.textContent = `Style check: ${d.issues.join(' · ')}`;
        state.live.shell.appendChild(note);
        scrollDown();
      }
      break;
    }
    case 'stderr':
      console.warn('[chat]', d.text);
      break;
    case 'done':
      state.live = null;
      state.running = false;
      state.abort = null;
      setBusy(false);
      statusEl.textContent = 'ready';
      loadSessions();
      break;
    default:
      break;
  }
}

async function streamFetch(url, opts, streamAgentId) {
  const ctrl = new AbortController();
  state.abort = ctrl;
  state.running = true;
  setBusy(true);
  const res = await fetch(url, { ...opts, signal: ctrl.signal });
  if (!res.ok) {
    const txt = await res.text();
    const err = new Error(txt || `${res.status}`);
    err.status = res.status;
    throw err;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const { ev, payload } = parseSseChunk(buf.slice(0, idx));
      handleStreamEvent(ev, payload, streamAgentId);
      buf = buf.slice(idx + 2);
    }
  }
}

async function attachConversation(id, agentId) {
  detachStream();
  state.streamConversationId = id;
  state.streamIncognito = false;
  statusEl.textContent = 'reattached…';
  const after = Number(state.seqByConversation[id] || 0);
  try {
    await streamFetch(`/api/chat/attach?conversationId=${encodeURIComponent(id)}&after=${after}`, { method: 'GET' }, agentId || 'danny');
  } catch (err) {
    if (err.name !== 'AbortError') statusEl.textContent = 'attach failed';
  } finally {
    if (!state.running) {
      setBusy(false);
      statusEl.textContent = 'ready';
    }
  }
}

async function loadConversation(id) {
  detachStream();
  if (incogEl.checked) {
    incogEl.checked = false;
    incogEl.parentElement.classList.remove('on');
    state.incognitoSessionId = null;
  }
  try {
    const { session, events } = await apiJson(`/api/session?id=${encodeURIComponent(id)}`);
    state.conversationId = id;
    localStorage.setItem(CONV_KEY, id);
    selectAgent(session.agent || 'danny');
    sessEl.textContent = `Conversation ${id.slice(0, 8)} · ${session.turns || 0} turns`;
    chatEl.innerHTML = '';
    stageEl.classList.remove('centered');
    renderEvents(events, session);
    renderConvList(state.sessions);
    statusEl.textContent = session.running ? 'running…' : 'ready';
    scrollDown();
    if (session.running) attachConversation(id, session.agent || 'danny');
  } catch {
    statusEl.textContent = 'could not load conversation';
  }
}

async function send() {
  if (state.uiMode !== 'chat') return;
  const text = inputEl.value.trim();
  if (!text || state.running) return;

  addUserMsg(text);
  inputEl.value = '';
  autosize();

  state.live = null;
  ensureLive(agentSel.value || 'danny');
  statusEl.textContent = 'working…';

  const incognito = incogEl.checked;
  state.streamIncognito = incognito;
  state.streamConversationId = incognito ? null : state.conversationId;

  try {
    await streamFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(incognito ? {
        message: text,
        sessionId: state.incognitoSessionId,
        incognito: true,
        model: modelSel.value,
        agent: agentSel.value,
      } : {
        message: text,
        conversationId: state.conversationId,
        model: modelSel.value,
        agent: agentSel.value,
      }),
    }, agentSel.value || 'danny');
  } catch (err) {
    if (err.name !== 'AbortError') {
      const live = ensureLive(agentSel.value || 'danny');
      if (err.status === 409) live.bubble.innerHTML = '<em>This conversation already has an active run. Re-open it to attach.</em>';
      else live.bubble.textContent = `Connection error: ${err.message}`;
      state.live = null;
    }
    state.running = false;
    state.abort = null;
    setBusy(false);
    statusEl.textContent = 'ready';
    loadSessions();
  }
}

async function stopActiveRun() {
  if (!state.streamConversationId) {
    detachStream();
    return;
  }
  try {
    await apiJson('/api/chat/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: state.streamConversationId }),
    });
  } catch {
    detachStream();
    statusEl.textContent = 'stop failed';
  }
}

function resetConversation() {
  detachStream();
  state.conversationId = null;
  state.incognitoSessionId = null;
  if (incogEl.checked) {
    incogEl.checked = false;
    incogEl.parentElement.classList.remove('on');
  }
  localStorage.removeItem(CONV_KEY);
  sessEl.textContent = '';
  showWelcome();
  statusEl.textContent = 'ready';
  renderConvList(state.sessions);
}

(async function boot() {
  localStorage.removeItem('steadymade_chat_session');
  initSidebarResize();
  updateTerminalControls();
  const params = new URLSearchParams(location.search);
  await loadAgents();
  applyPreset(params.get('agent'), params.get('msg'));
  await loadSessions();
  const stored = localStorage.getItem(CONV_KEY);
  if (stored && state.sessions.some((s) => s.id === stored) && !params.get('msg')) {
    loadConversation(stored);
  }

  const savedMode = localStorage.getItem(UI_MODE_KEY);
  setUiMode(savedMode === 'cli' ? 'cli' : 'chat');
})();

window.addEventListener('message', (e) => {
  if (!isTrustedParentMessage(e)) return;
  const data = e.data || {};
  if (data.type === 'steadymade-preset') {
    applyPreset(data.agent, data.draft);
    return;
  }

  if (
    data.type === 'steadymade-runtime-config'
    || data.type === 'steadymade-cli-config'
    || data.type === 'steadymade-mode'
    || data.type === 'steadymade-provider'
  ) {
    const mode = String(data.chatMode || data.mode || '').toLowerCase();
    if (mode === 'cli' || mode === 'chat') {
      setUiMode(mode);
      if (data.lockMode === true) cliState.modeLocked = true;
      if (data.lockMode === false) cliState.modeLocked = false;
    }

    const providerMode = String(data.providerMode || '').toLowerCase();
    const providerFromMode = providerMode === 'opencode' ? 'opencode' : 'claude';
    const provider = String(data.provider || providerFromMode).toLowerCase();
    if (TERMINAL_TARGETS.has(provider)) {
      cliState.provider = provider;
      updateTerminalControls();
    }

    if (data.unsupportedReason) {
      cliState.unsupportedReason = String(data.unsupportedReason);
      setCliHint(cliState.unsupportedReason, 'warn');
      setTerminalEmptyVisible(true, cliState.unsupportedReason);
      updateTerminalControls();
    }
  }
});
if (window.parent !== window) {
  window.parent.postMessage({ type: 'steadymade-chat-ready' }, trustedParentOrigin());
}

let searchTimer = null;
convSearchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = convSearchEl.value.trim();
  searchTimer = setTimeout(async () => {
    if (!q) {
      renderConvList(state.sessions);
      return;
    }
    try {
      const { results } = await apiJson(`/api/sessions/search?q=${encodeURIComponent(q)}`);
      renderConvList(results, { searchMode: true });
    } catch {}
  }, 250);
});

incogEl.addEventListener('change', () => {
  incogEl.parentElement.classList.toggle('on', incogEl.checked);
  detachStream();
  state.incognitoSessionId = null;
  if (incogEl.checked) {
    state.conversationId = null;
    sessEl.textContent = 'Incognito — leaves no trace';
    showWelcome();
    renderConvList(state.sessions);
  } else {
    sessEl.textContent = '';
    showWelcome();
  }
  statusEl.textContent = 'ready';
});

sendBtn.addEventListener('click', () => {
  if (state.uiMode !== 'chat') return;
  if (state.running) {
    if (!state.streamIncognito && state.streamConversationId) stopActiveRun();
    else detachStream();
    return;
  }
  send();
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
inputEl.addEventListener('input', autosize);
newBtn.addEventListener('click', resetConversation);
viewChatBtn.addEventListener('click', () => {
  if (cliState.modeLocked) return;
  setUiMode('chat');
});
viewCliBtn.addEventListener('click', () => {
  if (cliState.modeLocked) return;
  setUiMode('cli');
});
termStartBtn.addEventListener('click', startTerminalSession);
termStopBtn.addEventListener('click', stopTerminalSession);
agentSel.addEventListener('change', () => {
  const id = agentSel.value;
  const meta = agentMeta(id);
  inputEl.placeholder = id === 'danny' ? 'Message Danny…' : `Message ${meta.name}…`;
});
