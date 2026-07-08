const stageEl = document.getElementById('stage');
const chatEl = document.getElementById('chat');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const statusEl = document.getElementById('status');
const sessEl = document.getElementById('sess');
const modelSel = document.getElementById('model');
const agentSel = document.getElementById('agent');
const newBtn = document.getElementById('newChat');

const state = {
  sessionId: null,
  running: false,
  abort: null,
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

function currentSpeaker() {
  const selected = agentSel.selectedOptions[0]?.text || 'Danny';
  if (agentSel.value === 'danny') return 'Danny · Steadymade OS';
  return `${selected.replace(' · via Danny', '')} · via Danny`;
}

function clearWelcome() {
  const welcome = chatEl.querySelector('.welcome');
  if (welcome) welcome.remove();
  stageEl.classList.remove('centered');
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

function addAssistantShell() {
  const row = document.createElement('div');
  row.className = 'msg assistant';
  row.innerHTML = `<div class="speaker">${esc(currentSpeaker())}</div><div class="activity"></div><div class="bubble"><span class="typing"><span></span><span></span><span></span></span></div>`;
  chatEl.appendChild(row);
  scrollDown();
  return row;
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

(function restoreSession() {
  const sid = localStorage.getItem('steadymade_chat_session');
  const sidAgent = localStorage.getItem('steadymade_chat_agent') || 'danny';
  if (!sid) return;
  selectAgent(sidAgent);
  state.sessionId = sid;
  sessEl.textContent = `Session ${sid.slice(0, 8)}`;
})();

(function applyUrlPreset() {
  const params = new URLSearchParams(location.search);
  applyPreset(params.get('agent'), params.get('msg'));
})();

window.addEventListener('message', (e) => {
  if (e.data?.type !== 'steadymade-preset') return;
  applyPreset(e.data.agent, e.data.draft);
});
if (window.parent !== window) {
  window.parent.postMessage({ type: 'steadymade-chat-ready' }, '*');
}

async function send() {
  const text = inputEl.value.trim();
  if (!text || state.running) return;

  addUserMsg(text);
  inputEl.value = '';
  autosize();

  state.running = true;
  setBusy(true);
  statusEl.textContent = 'working…';

  const shell = addAssistantShell();
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
      body: JSON.stringify({
        message: text,
        sessionId: state.sessionId,
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
      case 'init':
        state.sessionId = d.session_id;
        localStorage.setItem('steadymade_chat_session', d.session_id);
        localStorage.setItem('steadymade_chat_agent', agentSel.value);
        sessEl.textContent = `Session ${String(d.session_id || '').slice(0, 8)}${d.model ? ` · ${d.model}` : ''}`;
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
      case 'tool': {
        const chip = document.createElement('span');
        chip.className = `chip${d.sub ? ' sub' : ''}`;
        chip.textContent = d.name === 'Task' ? `→ ${d.detail || 'Task'}` : `${d.name}${d.detail ? ` · ${d.detail}` : ''}`;
        activity.appendChild(chip);
        scrollDown();
        break;
      }
      case 'result': {
        if (raw) bubble.innerHTML = renderMd(raw);
        else if (d.error_text) bubble.innerHTML = `<em>${esc(d.error_text)}</em>`;
        const meta = document.createElement('div');
        meta.className = 'meta';
        const dur = d.duration_ms != null ? `${(d.duration_ms / 1000).toFixed(1)}s` : '';
        const cost = d.cost_usd != null ? `$${Number(d.cost_usd).toFixed(3)}` : '';
        const turns = d.num_turns ? `${d.num_turns} turns` : '';
        const tokens = d.total_tokens ? `${Number(d.total_tokens).toLocaleString()} tokens` : '';
        meta.textContent = [dur, cost, turns, tokens].filter(Boolean).join(' · ');
        shell.appendChild(meta);
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
  state.sessionId = null;
  localStorage.removeItem('steadymade_chat_session');
  localStorage.removeItem('steadymade_chat_agent');
  sessEl.textContent = '';
  chatEl.innerHTML = `<div class="welcome"><div class="w-label">STEADYMADE AI OS</div><h1>Danny Chat</h1><p>Select a specialist if needed. Messages are always routed through Danny.</p></div>`;
  stageEl.classList.add('centered');
  statusEl.textContent = 'ready';
}

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
