const stageEl = document.getElementById('stage');
const chatEl = document.getElementById('chat');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const statusEl = document.getElementById('status');
const sessEl = document.getElementById('sess');
const modelSel = document.getElementById('model');
const agentSel = document.getElementById('agent');
const newBtn = document.getElementById('newChat');
const convListEl = document.getElementById('convList');
const convSearchEl = document.getElementById('convSearch');
const incogEl = document.getElementById('incognito');

const CONV_KEY = 'steadymade_chat_conversation';

const state = {
  conversationId: null,
  incognitoSessionId: null, // in-memory only — never persisted
  running: false,
  abort: null,
  sessions: [],
};

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
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

function speakerLabel(agentId) {
  if (!agentId || agentId === 'danny') return 'Danny · Steadymade OS';
  const opt = [...agentSel.options].find((o) => o.value === agentId);
  const name = opt ? opt.text.split(' · ')[0] : agentId;
  return `${name} · via Danny`;
}

function currentSpeaker() {
  return speakerLabel(agentSel.value);
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
  chatEl.innerHTML = `<div class="welcome"><div class="w-label">STEADYMADE AI OS</div><h1>Danny Chat</h1><p>Select a specialist if needed. Messages are always routed through Danny.</p></div>`;
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
  inputEl.placeholder = id === 'danny' ? 'Message Danny…' : `Message ${opt.text.split(' · ')[0]} (via Danny)…`;
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

// ---------- conversation list ----------

async function apiJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
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
      <div class="conv-meta"><span>${esc(speakerLabel(s.agent).split(' · ')[0])}</span><span>${timeAgo(s.updatedAt)}</span>${s.archived ? '<span>archived</span>' : ''}</div>
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

async function loadSessions() {
  try {
    const { sessions } = await apiJson('/api/sessions');
    state.sessions = sessions;
    if (!convSearchEl.value.trim()) renderConvList(sessions);
  } catch {
    convListEl.innerHTML = '<div class="conv-empty">History unavailable.</div>';
  }
}

async function loadConversation(id) {
  if (state.running && state.abort) state.abort.abort();
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
    statusEl.textContent = 'ready';
    scrollDown();
  } catch {
    statusEl.textContent = 'could not load conversation';
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

// ---------- boot ----------

(function boot() {
  localStorage.removeItem('steadymade_chat_session'); // legacy key
  const params = new URLSearchParams(location.search);
  applyPreset(params.get('agent'), params.get('msg'));
  loadSessions().then(() => {
    const stored = localStorage.getItem(CONV_KEY);
    if (stored && state.sessions.some((s) => s.id === stored) && !params.get('msg')) {
      loadConversation(stored);
    }
  });
})();

window.addEventListener('message', (e) => {
  if (e.data?.type !== 'steadymade-preset') return;
  applyPreset(e.data.agent, e.data.draft);
});
if (window.parent !== window) {
  window.parent.postMessage({ type: 'steadymade-chat-ready' }, '*');
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

// ---------- send ----------

async function send() {
  const text = inputEl.value.trim();
  if (!text || state.running) return;

  addUserMsg(text);
  inputEl.value = '';
  autosize();

  state.running = true;
  setBusy(true);
  statusEl.textContent = 'working…';

  const shell = addAssistantShell(currentSpeaker());
  const bubble = shell.querySelector('.bubble');
  const activity = shell.querySelector('.activity');
  let raw = '';
  let gotDelta = false;
  const ctrl = new AbortController();
  state.abort = ctrl;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(incogEl.checked ? {
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
      signal: ctrl.signal,
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        handleEvent(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') bubble.textContent = `Connection error: ${err.message}`;
  }

  if (!gotDelta && bubble.querySelector('.typing')) bubble.innerHTML = '<em>No response received.</em>';
  state.running = false;
  state.abort = null;
  setBusy(false);
  statusEl.textContent = 'ready';
  loadSessions();

  function handleEvent(chunk) {
    let ev = 'message';
    let data = '';
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event: ')) ev = line.slice(7).trim();
      if (line.startsWith('data: ')) data += line.slice(6);
    }
    let d = {};
    try { d = data ? JSON.parse(data) : {}; } catch {}

    switch (ev) {
      case 'conversation':
        if (d.id) {
          state.conversationId = d.id;
          localStorage.setItem(CONV_KEY, d.id);
        }
        break;
      case 'init':
        if (d.incognito) {
          state.incognitoSessionId = d.session_id || state.incognitoSessionId;
          sessEl.textContent = `Incognito${d.model ? ` · ${d.model}` : ''}`;
        } else {
          sessEl.textContent = `Conversation ${String(state.conversationId || '').slice(0, 8)}${d.model ? ` · ${d.model}` : ''}`;
        }
        break;
      case 'delta':
        if (!gotDelta) {
          bubble.innerHTML = '';
          gotDelta = true;
        }
        raw += d.text || '';
        bubble.textContent = raw;
        scrollDown();
        break;
      case 'tool':
        addToolChip(activity, d);
        scrollDown();
        break;
      case 'result': {
        if (raw) bubble.innerHTML = renderMd(raw);
        else if (d.error_text) bubble.innerHTML = `<em>${esc(d.error_text)}</em>`;
        addMetaLine(shell, d);
        scrollDown();
        break;
      }
      case 'gate':
        if (Array.isArray(d.issues) && d.issues.length) {
          const warn = document.createElement('div');
          warn.className = 'gate warn';
          warn.textContent = `⚠ Style gate: ${d.issues.join(' · ')}`;
          shell.appendChild(warn);
          scrollDown();
        }
        break;
      case 'stderr':
        console.warn('[chat]', d.text);
        break;
      default:
        break;
    }
  }
}

function resetConversation() {
  if (state.abort) state.abort.abort();
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

incogEl.addEventListener('change', () => {
  incogEl.parentElement.classList.toggle('on', incogEl.checked);
  if (state.abort) state.abort.abort();
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
  if (state.running && state.abort) {
    state.abort.abort();
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
agentSel.addEventListener('change', () => {
  inputEl.placeholder = agentSel.value === 'danny'
    ? 'Message Danny…'
    : `Message ${agentSel.selectedOptions[0].text.split(' · ')[0]} (via Danny)…`;
});
