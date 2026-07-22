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
const termStatusEl = document.getElementById('termStatus');
const termEmptyEl = document.getElementById('termEmpty');
const terminalHostEl = document.getElementById('terminalHost');

const CONV_KEY = 'steadymade_chat_conversation';
const SIDEBAR_WIDTH_KEY = 'steadymade_chat_sidebar_width';
const UI_MODE_KEY = 'steadymade_chat_ui_mode';
const TERMINAL_TARGETS = new Set(['claude', 'opencode']);
const PARENT_PORT = location.port || (location.protocol === 'https:' ? '443' : '80');
const TRUSTED_PARENT_ORIGINS = new Set([
  `${location.protocol}//localhost:${PARENT_PORT}`,
  `${location.protocol}//127.0.0.1:${PARENT_PORT}`,
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

const queuePanel = document.getElementById('queuePanel');
const queueList = document.getElementById('queueList');
const queueCount = document.getElementById('queueCount');
const clearQueueBtn = document.getElementById('clearQueue');

state.messageQueue = [];

function renderQueue() {
  if (state.messageQueue.length === 0) {
    queuePanel.classList.add('hidden');
    return;
  }
  queuePanel.classList.remove('hidden');
  queueCount.textContent = state.messageQueue.length;
  queueList.innerHTML = '';
  state.messageQueue.forEach((msg, idx) => {
    const el = document.createElement('div');
    el.className = 'queue-item';
    el.innerHTML = `
      <div class="queue-item-text">${esc(msg.text)}</div>
      <div class="queue-item-meta">${esc(msg.agent)}</div>
      <button class="queue-item-remove" data-idx="${idx}">×</button>
    `;
    el.querySelector('.queue-item-remove').addEventListener('click', () => {
      state.messageQueue.splice(idx, 1);
      renderQueue();
    });
    queueList.appendChild(el);
  });
}

clearQueueBtn.addEventListener('click', () => {
  state.messageQueue = [];
  renderQueue();
});

function processQueue() {
  if (!state.running && state.messageQueue.length > 0) {
    const next = state.messageQueue.shift();
    renderQueue();
    inputEl.value = next.text;
    agentSel.value = next.agent;
    modelSel.value = next.model;
    send();
  }
}

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
  const sameHost = `${location.protocol}//${location.hostname}:${PARENT_PORT}`;
  if (TRUSTED_PARENT_ORIGINS.has(sameHost)) return sameHost;
  return `${location.protocol}//localhost:${PARENT_PORT}`;
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

// Inline formatting. Input is already HTML-escaped. Order matters: protect code
// spans first, then links, then emphasis — so no raw markdown markers survive
// into the rendered bubble (the "MD relics" we are eliminating).
function inline(s) {
  const codes = [];
  let out = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, href) => {
      const safe = safeHref(href);
      return safe ? `<img src="${safe}" alt="${alt}" loading="lazy">` : alt;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safe = safeHref(href);
      if (!safe) return label;
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    })
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    .replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  // restore protected code spans
  return out.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${codes[+n]}</code>`);
}

// A small, dependency-free block renderer covering the Markdown that agents
// actually emit: headings h1–h6, fenced code, ordered/unordered nested lists,
// blockquotes, GFM tables, horizontal rules, and paragraphs. The goal is zero
// stray markers ("relics") in the output.
function renderMd(src) {
  return renderBlocks(esc(src).replace(/\r\n?/g, '\n'));
}

// Core block renderer. Operates on already-escaped text so it can recurse
// (e.g. blockquote bodies) without double-escaping.
function renderBlocks(escaped) {
  const lines = escaped.split('\n');
  let html = '';
  let i = 0;
  let para = [];
  const flush = () => {
    if (para.length) { html += `<p>${inline(para.join('<br>'))}</p>`; para = []; }
  };
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l);
  const splitRow = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

  while (i < lines.length) {
    const l = lines[i];

    // fenced code block
    if (/^\s*```/.test(l)) {
      flush();
      const code = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      html += `<pre><code>${code.join('\n')}</code></pre>`;
      i += 1;
      continue;
    }

    // horizontal rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) {
      flush();
      html += '<hr>';
      i += 1;
      continue;
    }

    // heading (ATX, 1–6)
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      const lvl = h[1].length;
      html += `<h${lvl}>${inline(h[2].replace(/\s+#+\s*$/, ''))}</h${lvl}>`;
      i += 1;
      continue;
    }

    // GFM table: header row + separator row
    if (l.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flush();
      const headers = splitRow(l);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      html += '<table><thead><tr>'
        + headers.map((c) => `<th>${inline(c)}</th>`).join('')
        + '</tr></thead><tbody>'
        + rows.map((r) => '<tr>' + headers.map((_, ci) => `<td>${inline(r[ci] || '')}</td>`).join('') + '</tr>').join('')
        + '</tbody></table>';
      continue;
    }

    // blockquote (collapse consecutive > lines). NB: source is HTML-escaped up
    // front, so a leading ">" now reads as "&gt;".
    if (/^\s*&gt;\s?/.test(l)) {
      flush();
      const quote = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*&gt;\s?/, ''));
        i += 1;
      }
      html += `<blockquote>${renderBlocks(quote.join('\n'))}</blockquote>`;
      continue;
    }

    // lists (ordered / unordered) with indentation-based nesting
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const consumed = renderList(lines, i);
      html += consumed.html;
      i = consumed.next;
      continue;
    }

    if (l.trim() === '') { flush(); i += 1; continue; }

    para.push(l);
    i += 1;
  }
  flush();
  return html;
}

// Recursive list parser. Groups consecutive list items at the current indent
// level; deeper-indented items become nested lists inside the previous <li>.
function renderList(lines, start) {
  const first = lines[start].match(/^(\s*)([-*+]|\d+[.)])\s+/);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const tag = ordered ? 'ol' : 'ul';
  let i = start;
  let out = `<${tag}>`;
  const sameType = (mk) => /\d/.test(mk) === ordered;
  while (i < lines.length) {
    const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (!m) {
      // bridge a single blank line only if the next item continues THIS list
      // (same indent + same marker type); otherwise the list ends here
      const nx = i + 1 < lines.length && lines[i + 1].match(/^(\s*)([-*+]|\d+[.)])\s+/);
      if (lines[i].trim() === '' && nx && nx[1].length >= baseIndent && (nx[1].length > baseIndent || sameType(nx[2]))) { i += 1; continue; }
      break;
    }
    const indent = m[1].length;
    if (indent < baseIndent) break;
    // a different marker type at the same level begins a separate list
    if (indent === baseIndent && !sameType(m[2])) break;
    if (indent > baseIndent) {
      const nested = renderList(lines, i);
      out = out.replace(/<\/li>$/, '') + nested.html + '</li>';
      i = nested.next;
      continue;
    }
    out += `<li>${inline(m[3])}</li>`;
    i += 1;
  }
  out += `</${tag}>`;
  return { html: out, next: i };
}

// While streaming, close any open code fence and drop a dangling table
// separator so a half-arrived block never renders as raw markers.
function mdStreamSafe(src) {
  let s = src;
  const fences = (s.match(/^\s*```/gm) || []).length;
  if (fences % 2) s += '\n```';
  return s;
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

// Turn a raw subagent slug (e.g. "clara-writer") into a full display name.
// Prefer the known roster ("Clara — Writer"); otherwise prettify the whole
// slug ("kira-image-generation-agent" → "Kira Image Generation Agent") —
// never truncate to a fragment.
function prettyAgent(slug) {
  const raw = String(slug || '').trim();
  const id = raw.split('-')[0].toLowerCase();
  const a = state.agentById.get(id);
  if (a) return a.function ? `${a.name} — ${a.function}` : a.name;
  if (!raw) return 'Subagent';
  return raw.replace(/[-_]+/g, ' ').replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

function prettyServer(server) {
  return String(server || '')
    .replace(/^(claude_ai_|plugin_)/i, '')
    .replace(/_/g, ' ')
    .trim() || 'MCP';
}

// Classify a tool event into a typed trace token. Case-insensitive so both the
// Claude runtime (PascalCase names) and OpenCode (lowercase) resolve the same.
function classifyTool(d) {
  const name = String(d.name || '');
  const key = name.toLowerCase();
  const detail = String(d.detail || '');
  if (key === 'task') {
    const [who, ...rest] = detail.split(' · ');
    const agentName = prettyAgent(who);
    return { kind: 'agent', type: 'DELEGATE', target: agentName, note: rest.join(' · '), initial: (agentName[0] || 'A').toUpperCase() };
  }
  if (key === 'skill') return { kind: 'skill', type: 'SKILL', target: detail || 'skill' };
  if (key.startsWith('mcp__')) {
    const parts = name.slice(5).split('__');
    const server = prettyServer(parts[0]);
    const method = parts.slice(1).join('__');
    return { kind: 'mcp', type: 'MCP', target: method ? `${server} · ${method}` : server };
  }
  if (key === 'read' || key === 'glob' || key === 'notebookread') return { kind: 'read', type: 'READ', target: detail || name };
  if (key === 'grep') return { kind: 'read', type: 'SEARCH', target: detail || 'grep' };
  if (key === 'write' || key === 'edit' || key === 'multiedit' || key === 'notebookedit') return { kind: 'edit', type: name.toUpperCase(), target: detail };
  if (key === 'webfetch' || key === 'websearch') return { kind: 'web', type: 'WEB', target: detail || name };
  if (key === 'bash') return { kind: 'bash', type: 'RUN', target: detail };
  if (key === 'todowrite') return { kind: 'tool', type: 'TODO', target: detail || 'update task list' };
  return { kind: 'tool', type: (name || 'TOOL').toUpperCase(), target: detail };
}

// A trace is one collapsible activity block per assistant turn. The head is
// always visible and shows the *current* step (refreshing as steps change) or,
// when done, a one-line summary. Expanding reveals the full step timeline;
// sub-agent tool calls nest under their Task; permission prompts appear inline.
function statusInfo(status) {
  switch (String(status || 'running')) {
    case 'completed': return { cls: 'st-done', icon: '<span class="st-glyph ok">✓</span>' };
    case 'error': return { cls: 'st-error', icon: '<span class="st-glyph bad">✕</span>' };
    case 'permission_required': return { cls: 'st-blocked', icon: '<span class="st-glyph warn">⊘</span>' };
    case 'awaiting_permission': return { cls: 'st-awaiting', icon: '<span class="st-glyph warn">!</span>' };
    default: return { cls: 'st-running', icon: '<span class="spinner"></span>' };
  }
}

function durLabel(d) {
  return d.duration_ms != null ? `${(d.duration_ms / 1000).toFixed(1)}s` : '';
}

function ensureTraceForActivity(activity) {
  if (activity.__trace) return activity.__trace;
  const el = document.createElement('div');
  el.className = 'trace';
  el.innerHTML = `
    <button type="button" class="trace-head" aria-expanded="false">
      <span class="th-icon"></span>
      <span class="th-label"></span>
      <span class="th-badge"></span>
      <span class="th-caret" aria-hidden="true">▸</span>
    </button>
    <div class="trace-steps"></div>`;
  const trace = {
    el,
    headEl: el.querySelector('.trace-head'),
    iconEl: el.querySelector('.th-icon'),
    labelEl: el.querySelector('.th-label'),
    badgeEl: el.querySelector('.th-badge'),
    stepsEl: el.querySelector('.trace-steps'),
    steps: new Map(),
    perms: new Map(),
    stepCounter: 0,
    done: false,
  };
  trace.headEl.addEventListener('click', () => setTraceOpen(trace, !trace.el.classList.contains('open')));
  activity.appendChild(el);
  activity.__trace = trace;
  return trace;
}

function setTraceOpen(trace, open) {
  trace.el.classList.toggle('open', open);
  trace.headEl.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function stepCallId(d) {
  return String(d.id || d.call_id || d.callId || '').trim() || `anon_${Math.random().toString(36).slice(2)}`;
}

function upsertStep(trace, d) {
  const callId = stepCallId(d);
  let step = trace.steps.get(callId);
  if (!step) {
    const el = document.createElement('div');
    el.className = 'trace-step';
    el.innerHTML = `
      <div class="step-row">
        <span class="step-n"></span>
        <span class="step-status"></span>
        <span class="step-type"></span>
        <span class="step-target"></span>
        <span class="step-dur"></span>
        <span class="step-caret" aria-hidden="true">▸</span>
      </div>
      <div class="step-body"></div>`;
    step = {
      callId,
      index: ++trace.stepCounter,
      data: {},
      el,
      rowEl: el.querySelector('.step-row'),
      bodyEl: el.querySelector('.step-body'),
      substepsEl: null,
      parentId: d.parent_id ? String(d.parent_id) : null,
    };
    step.rowEl.addEventListener('click', () => {
      if (step.el.classList.contains('no-body')) return;
      step.el.classList.toggle('expanded');
    });
    trace.steps.set(callId, step);
    const parent = step.parentId ? trace.steps.get(step.parentId) : null;
    if (parent) {
      if (!parent.substepsEl) {
        parent.substepsEl = document.createElement('div');
        parent.substepsEl.className = 'trace-substeps';
        parent.el.appendChild(parent.substepsEl);
        parent.el.classList.add('has-substeps');
      }
      parent.substepsEl.appendChild(el);
    } else {
      trace.stepsEl.appendChild(el);
    }
  }
  step.data = { ...step.data, ...d };
  renderStep(step);
  updateHead(trace);
  return step;
}

function renderStep(step) {
  const d = step.data;
  const c = classifyTool(d);
  const st = statusInfo(d.status);
  step.el.className = `trace-step ti-${c.kind} ${st.cls}${step.parentId ? ' sub' : ''}`;
  step.rowEl.querySelector('.step-n').textContent = step.index;
  step.rowEl.querySelector('.step-status').innerHTML = st.icon;
  step.rowEl.querySelector('.step-type').textContent = c.type;
  step.rowEl.querySelector('.step-target').textContent = c.target || '';
  step.rowEl.querySelector('.step-dur').textContent = durLabel(d);
  const parts = [];
  if (c.note) parts.push(`<div class="sb-note">${esc(c.note)}</div>`);
  if (d.input) parts.push(`<div class="sb-block"><div class="sb-h">Input</div><pre>${esc(d.input)}</pre></div>`);
  if (d.error && d.error.message) {
    parts.push(`<div class="sb-block sb-err"><div class="sb-h">${esc(d.error.category || 'Error')}</div><pre>${esc(d.error.message)}</pre></div>`);
  } else if (d.result) {
    parts.push(`<div class="sb-block"><div class="sb-h">Result</div><pre>${esc(d.result)}</pre></div>`);
  }
  step.bodyEl.innerHTML = parts.join('');
  if (!parts.length) step.el.classList.add('no-body');
}

function currentStep(trace) {
  let active = null;
  for (const step of trace.steps.values()) {
    const s = String(step.data.status || 'running');
    if (s === 'running' || s === 'awaiting_permission') active = step;
  }
  return active;
}

// The full identity of a step for the head/summary: agent hand-offs read
// "Delegating to X"; sub-agent tool calls are prefixed with the running agent
// ("Explorer › MCP m365-readonly · m365_auth_status") so it is always clear
// which agent is working.
function stepLabel(trace, step) {
  const c = classifyTool(step.data);
  let label = c.kind === 'agent' ? `Delegating to ${c.target}` : (c.target ? `${c.type} ${c.target}` : c.type);
  if (step.parentId) {
    const parent = trace.steps.get(step.parentId);
    const who = parent ? classifyTool(parent.data).target : 'Agent';
    label = `${who} › ${label}`;
  }
  return label;
}

function updateHead(trace) {
  const pending = [...trace.perms.values()].find((p) => p.status === 'pending');
  const steps = [...trace.steps.values()];
  const total = steps.length;
  if (pending) {
    trace.el.classList.add('needs-action');
    trace.iconEl.innerHTML = '<span class="st-glyph warn">!</span>';
    trace.labelEl.textContent = 'Action required';
    trace.badgeEl.textContent = pending.tool ? `Allow ${pending.tool}?` : 'Permission needed';
    trace.badgeEl.hidden = false;
    setTraceOpen(trace, true);
    return;
  }
  trace.el.classList.remove('needs-action');
  trace.badgeEl.hidden = true;
  if (!trace.done) {
    // Live turn: overwrite the head each cycle with the current step (or the
    // most recent one while the model works between tools) + its number. Never
    // fall back to the done-summary while the turn is still running.
    const active = currentStep(trace) || steps[total - 1];
    trace.iconEl.innerHTML = '<span class="spinner"></span>';
    trace.labelEl.innerHTML = active
      ? `<span class="th-step">Step ${active.index}</span> · ${esc(stepLabel(trace, active))}`
      : 'Working…';
    return;
  }
  // Done: lead with the last concrete step, then a muted count.
  const hasError = steps.some((s) => String(s.data.status) === 'error' || String(s.data.status) === 'permission_required');
  trace.iconEl.innerHTML = hasError ? '<span class="st-glyph bad">✕</span>' : '<span class="st-glyph ok">✓</span>';
  const last = steps[total - 1];
  const agents = steps.filter((s) => classifyTool(s.data).kind === 'agent').length;
  const countBits = [`${total} step${total === 1 ? '' : 's'}`];
  if (agents) countBits.push(`${agents} agent${agents === 1 ? '' : 's'}`);
  if (last) {
    trace.labelEl.innerHTML = `${esc(stepLabel(trace, last))} <span class="th-count">· ${countBits.join(' · ')}</span>`;
  } else {
    trace.labelEl.textContent = countBits.join(' · ');
  }
}

function finalizeTrace(activity) {
  const trace = activity && activity.__trace;
  if (!trace) return;
  trace.done = true;
  updateHead(trace);
}

// Inline Allow / Allow-for-run / Deny prompt for a gated tool call.
function applyPermission(activity, d) {
  const trace = ensureTraceForActivity(activity);
  const permId = String(d.id || '');
  if (!permId) return;
  if (d.status === 'pending') {
    const typeLabel = classifyTool({ name: d.tool, detail: d.detail }).type;
    const rec = trace.perms.get(permId) || { id: permId, status: 'pending' };
    rec.status = 'pending';
    rec.tool = typeLabel;
    rec.runId = d.run_id || rec.runId || null;
    trace.perms.set(permId, rec);
    rec.el = buildPermPrompt(trace, rec, d);
    setTraceOpen(trace, true);
    updateHead(trace);
  } else {
    const rec = trace.perms.get(permId);
    if (rec) {
      rec.status = d.status;
      if (rec.el) {
        rec.el.classList.add('resolved', d.status);
        const actions = rec.el.querySelector('.perm-actions');
        if (actions) actions.innerHTML = `<span class="perm-result ${d.status}">${d.status === 'allowed' ? '✓ Allowed' : '✕ Denied'}</span>`;
      }
    }
    updateHead(trace);
  }
}

function buildPermPrompt(trace, rec, d) {
  const step = d.call_id ? trace.steps.get(String(d.call_id)) : null;
  let wrap = rec.el;
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'perm-prompt';
    const target = d.detail ? ` <code>${esc(d.detail)}</code>` : '';
    wrap.innerHTML = `
      <div class="pp-head"><span class="pp-badge">Permission</span> Danny wants to run <b>${esc(rec.tool || d.tool || 'a tool')}</b>${target}</div>
      ${d.input ? `<pre class="pp-input">${esc(d.input)}</pre>` : ''}
      <div class="perm-actions">
        <button type="button" class="pp-btn pp-allow">Allow once</button>
        <button type="button" class="pp-btn pp-always">Allow for this run</button>
        <button type="button" class="pp-btn pp-deny">Deny</button>
      </div>`;
    const decide = async (decision, scope, btn) => {
      wrap.querySelectorAll('button').forEach((b) => (b.disabled = true));
      if (btn) btn.classList.add('busy');
      try {
        await apiJson('/api/chat/permission-decision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: rec.runId, conversationId: state.conversationId, permissionId: rec.id, decision, scope }),
        });
      } catch (err) {
        wrap.querySelectorAll('button').forEach((b) => (b.disabled = false));
        if (btn) btn.classList.remove('busy');
        const note = wrap.querySelector('.pp-error') || wrap.appendChild(Object.assign(document.createElement('div'), { className: 'pp-error' }));
        note.textContent = `Could not send decision: ${err.message || err}`;
      }
    };
    wrap.querySelector('.pp-allow').addEventListener('click', (e) => decide('allow', 'once', e.currentTarget));
    wrap.querySelector('.pp-always').addEventListener('click', (e) => decide('allow', 'always', e.currentTarget));
    wrap.querySelector('.pp-deny').addEventListener('click', (e) => decide('deny', 'once', e.currentTarget));
    if (step) {
      step.el.classList.add('expanded', 'awaiting-perm');
      step.el.appendChild(wrap);
    } else {
      trace.stepsEl.prepend(wrap);
    }
  }
  return wrap;
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

function canAddTaskHandoff() {
  if (window.parent === window) return false;
  if (incogEl.checked) return false;
  return Boolean(state.conversationId);
}



function boundedText(raw) {
  return String(raw || '').trim().slice(0, 4000);
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
  if (cliHintEl) {
    cliHintEl.className = `cli-hint${kind ? ` ${kind}` : ''}`;
    cliHintEl.textContent = text;
  }
  if (termStatusEl) {
    termStatusEl.className = `term-status${kind ? ` ${kind}` : ''}`;
    termStatusEl.textContent = text || '';
  }
}

function ensureTerminal() {
  if (cliState.term) return true;
  if (!window.Terminal || !window.FitAddon || !window.FitAddon.FitAddon) {
    cliState.unsupportedReason = 'Local PTY terminal assets unavailable. Please reinstall dependencies and reload.';
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
    const tab = document.createElement('div');
    tab.setAttribute('role', 'tab');
    tab.tabIndex = 0;
    tab.className = `term-tab${s.id === cliState.activeSessionId ? ' active' : ''}`;
    tab.innerHTML = `<span class="term-tab-label">${esc(`${s.target} · ${s.id.slice(0, 6)}${s.running ? '' : ' · stopped'}`)}</span><button class="term-tab-stop" type="button" title="Close session" aria-label="Close session">×</button>`;
    tab.addEventListener('click', () => switchTerminalSession(s.id));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchTerminalSession(s.id);
      }
    });
    const close = tab.querySelector('.term-tab-stop');
    if (close) close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTerminalSession(s.id);
    });
    termSessionsEl.appendChild(tab);
  }
}

function updateTerminalControls() {
  const active = activeTerminalSession();
  const running = !!active?.running;
  termStartBtn.disabled = !cliState.bridgeEnabled || !!cliState.unsupportedReason;
  termStartBtn.textContent = `Start ${cliState.provider}`;
  if (termStopBtn) termStopBtn.disabled = !running;

  if (!cliState.bridgeEnabled) {
    setCliHint('Local PTY disabled. Enable it in Settings → AI Provider and restart.', 'warn');
  } else if (cliState.unsupportedReason) {
    setCliHint(`Provider not ready: ${cliState.unsupportedReason}`, 'warn');
  } else if (!active) {
    setCliHint(`Local PTY ready. Provider target: ${cliState.provider}. Create a session to start the terminal.`, '');
  } else if (!active.running) {
    setCliHint(`Local PTY session ${active.id.slice(0, 8)} exited${active.exitCode != null ? ` (code ${active.exitCode})` : ''}.`, 'warn');
  } else {
    setCliHint(`Local WebSocket connected to PTY. Provider: ${active.target} (session ${active.id.slice(0, 8)}).`, 'ok');
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
    setCliHint('Local PTY websocket error. Check local bridge settings and retry.', 'warn');
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

async function closeTerminalSession(sessionId = null) {
  const active = sessionId ? cliState.sessions.find((s) => s.id === sessionId) : activeTerminalSession();
  if (!active) return;
  const prevSessions = cliState.sessions.slice();
  const closedId = active.id;
  const closedIdx = prevSessions.findIndex((s) => s.id === closedId);
  try {
    const data = await apiJson(`/api/terminal/sessions/${encodeURIComponent(active.id)}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    cliState.sessions = Array.isArray(data.sessions) ? data.sessions : [];
    const hasActive = cliState.sessions.some((s) => s.id === cliState.activeSessionId);
    if (!hasActive || cliState.activeSessionId === closedId) {
      const fallbackOrder = closedIdx >= 0
        ? [...prevSessions.slice(closedIdx + 1), ...prevSessions.slice(0, closedIdx)].map((s) => s.id)
        : [];
      const nextFromOrder = fallbackOrder.find((id) => cliState.sessions.some((s) => s.id === id));
      const firstRunning = cliState.sessions.find((s) => s.running);
      cliState.activeSessionId = nextFromOrder || firstRunning?.id || cliState.sessions[0]?.id || null;
    }
    renderTerminalTabs();
    updateTerminalControls();
    if (cliState.activeSessionId) connectTerminalWebSocket();
    else {
      closeTerminalWs();
      setTerminalEmptyVisible(true, 'No terminal session yet. Click Start to launch the current provider target.');
    }
  } catch (err) {
    const msg = err.payload?.error || err.message || 'failed to close terminal session';
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


async function loadCapabilities() {
  try {
    const caps = await apiJson('/api/capabilities');
    if (caps && caps.models) {
      modelSel.innerHTML = '<option value="default">Default</option>';
      for (const m of caps.models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name || m.id;
        modelSel.appendChild(opt);
      }
    }
  } catch(e) {}
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
      upsertStep(ensureTraceForActivity(ensureShell().querySelector('.activity')), e);
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
      upsertStep(ensureTraceForActivity(live.activity), d);
      scrollDown();
      break;
    }
    case 'permission': {
      const live = ensureLive(streamAgentId || agentSel.value || 'danny');
      applyPermission(live.activity, d);
      scrollDown();
      break;
    }
    case 'result': {
      const live = ensureLive(streamAgentId || agentSel.value || 'danny');
      finalizeTrace(live.activity);
      if (live.raw) live.bubble.innerHTML = renderMd(live.raw);
      else if (d.error_text || d.error) {
        let errStr = typeof d.error === 'object' ? JSON.stringify(d.error) : String(d.error || d.error_text);
        live.bubble.innerHTML = `<em>${esc(errStr)}</em>`;
      }
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
      if (state.live) {
        const note = document.createElement('div');
        note.className = 'trace-syslog';
        note.textContent = String(d.text || '');
        state.live.activity.appendChild(note);
        scrollDown();
      }
      break;
    case 'done':
      setTimeout(processQueue, 500);
      if (state.live) finalizeTrace(state.live.activity);
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
  if (!text) return;
  if (state.running) {
    state.messageQueue.push({ text, agent: agentSel.value, model: modelSel.value });
    renderQueue();
    inputEl.value = '';
    autosize();
    return;
  }

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
  await loadCapabilities();
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
if (termStopBtn) termStopBtn.addEventListener('click', () => closeTerminalSession());
agentSel.addEventListener('change', () => {
  const id = agentSel.value;
  const meta = agentMeta(id);
  inputEl.placeholder = id === 'danny' ? 'Message Danny…' : `Message ${meta.name}…`;
});
