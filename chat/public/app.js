/* Steadymade AI OS — Danny Chat Frontend */
const stageEl = document.getElementById("stage");
const chatEl = document.getElementById("chat");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const statusEl = document.getElementById("status");
const sessEl = document.getElementById("sess");
const modelSel = document.getElementById("model");
const agentSel = document.getElementById("agent");
const newBtn = document.getElementById("newChat");

agentSel.addEventListener("change", () => {
  const name = agentSel.selectedOptions[0].text.split(" · ")[0];
  inputEl.placeholder = "Nachricht an " + name + " …";
  // Agentwechsel = neues Gespräch mit dieser Rolle (kein Vermischen der Sessions).
  resetConversation();
});

const state = {
  sessionId: null,
  running: false,
  abort: null,
};

function selectAgent(id) {
  const opt = [...agentSel.options].find((o) => o.value === id);
  if (!opt) return false;
  agentSel.value = id;
  inputEl.placeholder = "Nachricht an " + opt.text.split(" · ")[0] + " …";
  return true;
}

// A stored session is only resumed for the agent it was started with. Otherwise
// --resume would continue a foreign conversation under a different system
// prompt (e.g. an old Danny session answered by Nora). The stored agent is
// re-selected first so a reload continues the conversation seamlessly.
(function restoreSession() {
  const sid = localStorage.getItem("danny_session");
  if (!sid) return;
  const sidAgent = localStorage.getItem("danny_session_agent") || "danny";
  if (selectAgent(sidAgent)) {
    state.sessionId = sid;
    sessEl.textContent = "Session " + sid.slice(0, 8);
  } else {
    localStorage.removeItem("danny_session");
    localStorage.removeItem("danny_session_agent");
  }
})();

// Presets from the interface (Agent Map "Chat" action, "Ask Nora/Mara/Atlas"
// on a knowledge document): select an agent and/or prefill a draft message.
// The draft is only prefilled, never auto-sent — the user reviews and hits Send.
function applyPreset(agent, draft) {
  if (agent && agent !== agentSel.value && selectAgent(agent)) {
    // Same rule as a manual agent switch: new role = new conversation.
    resetConversation();
  }
  if (draft) {
    inputEl.value = draft;
    autosize();
    inputEl.focus();
  }
}

// URL params still work for direct/first loads, e.g. ?agent=atlas-strategic-advisor&msg=…
(function applyUrlPreset() {
  const params = new URLSearchParams(location.search);
  applyPreset(params.get("agent"), params.get("msg"));
})();

// Embedded in the interface, presets arrive via postMessage because the iframe
// is kept alive across view switches (no reload = no fresh URL params).
window.addEventListener("message", (e) => {
  if (e.data?.type !== "steadymade-preset") return;
  applyPreset(e.data.agent, e.data.draft);
});
if (window.parent !== window) {
  window.parent.postMessage({ type: "steadymade-chat-ready" }, "*");
}

// ── Mini-Markdown-Renderer ────────────────────────────────────────────────────
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => "<code>" + c + "</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
}
function renderMd(src) {
  const lines = esc(src).split("\n");
  let html = "", i = 0, para = [];
  const flush = () => {
    if (para.length) { html += "<p>" + inline(para.join("<br>")) + "</p>"; para = []; }
  };
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      flush(); let code = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      html += "<pre><code>" + code.join("\n") + "</code></pre>"; i++; continue;
    }
    if (/^#{1,3} /.test(l)) {
      flush(); const lvl = l.match(/^#+/)[0].length;
      html += `<h${lvl}>` + inline(l.replace(/^#+ /, "")) + `</h${lvl}>`; i++; continue;
    }
    if (/^\s*[-*] /.test(l)) {
      flush(); let items = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i]))
        items.push("<li>" + inline(lines[i++].replace(/^\s*[-*] /, "")) + "</li>");
      html += "<ul>" + items.join("") + "</ul>"; continue;
    }
    if (/^\s*\d+\. /.test(l)) {
      flush(); let items = [];
      while (i < lines.length && /^\s*\d+\. /.test(lines[i]))
        items.push("<li>" + inline(lines[i++].replace(/^\s*\d+\. /, "")) + "</li>");
      html += "<ol>" + items.join("") + "</ol>"; continue;
    }
    if (/^\|.+\|$/.test(l.trim())) {
      flush(); let rows = [];
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim()))
        rows.push(lines[i++].trim());
      const cells = (r) => r.slice(1, -1).split("|").map((c) => c.trim());
      let t = "<table>";
      rows.forEach((r, ri) => {
        if (/^[\s|:-]+$/.test(r)) return;
        const tag = ri === 0 ? "th" : "td";
        t += "<tr>" + cells(r).map((c) => `<${tag}>` + inline(c) + `</${tag}>`).join("") + "</tr>";
      });
      html += t + "</table>"; continue;
    }
    if (l.trim() === "") { flush(); i++; continue; }
    para.push(l); i++;
  }
  flush();
  return html;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function clearWelcome() {
  const w = chatEl.querySelector(".welcome");
  if (w) w.remove();
  stageEl.classList.remove("centered");
}
function addUserMsg(text) {
  clearWelcome();
  const div = document.createElement("div");
  div.className = "msg user";
  div.innerHTML = '<div class="speaker">Du</div>';
  const b = document.createElement("div");
  b.className = "bubble";
  b.textContent = text;
  div.appendChild(b);
  chatEl.appendChild(div);
  scroll();
}
function currentSpeaker() {
  if (agentSel.value === "danny") return "Danny · steadymade OS";
  return agentSel.selectedOptions[0].text.split(" · ")[0] + " · steadymade OS";
}
function addAssistantShell() {
  const div = document.createElement("div");
  div.className = "msg assistant";
  div.innerHTML =
    '<div class="speaker">' + esc(currentSpeaker()) + "</div>" +
    '<div class="activity"></div>' +
    '<div class="bubble"><span class="typing"><span></span><span></span><span></span></span></div>';
  chatEl.appendChild(div);
  scroll();
  return div;
}
function scroll() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

// ── Send flow ─────────────────────────────────────────────────────────────────
async function send() {
  const text = inputEl.value.trim();
  if (!text) return;
  if (state.running) return;

  addUserMsg(text);
  inputEl.value = "";
  autosize();
  state.running = true;
  setBusy(true);
  statusEl.textContent = "Danny arbeitet …";

  const shell = addAssistantShell();
  const bubble = shell.querySelector(".bubble");
  const activity = shell.querySelector(".activity");
  let raw = "";
  let gotDelta = false;

  const ctrl = new AbortController();
  state.abort = ctrl;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        sessionId: state.sessionId,
        model: modelSel.value,
        agent: agentSel.value,
      }),
      signal: ctrl.signal,
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        handleEvent(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
      }
    }
  } catch (e) {
    if (e.name !== "AbortError")
      bubble.textContent = "Verbindungsfehler: " + e.message;
  }

  if (!gotDelta && bubble.querySelector(".typing"))
    bubble.innerHTML = "<em>Keine Antwort erhalten.</em>";
  state.running = false;
  state.abort = null;
  setBusy(false);
  statusEl.textContent = "bereit";

  function handleEvent(chunk) {
    let ev = "message", data = "";
    for (const line of chunk.split("\n")) {
      if (line.startsWith("event: ")) ev = line.slice(7).trim();
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    let d = {};
    try { d = data ? JSON.parse(data) : {}; } catch {}

    switch (ev) {
      case "init":
        state.sessionId = d.session_id;
        localStorage.setItem("danny_session", d.session_id);
        localStorage.setItem("danny_session_agent", agentSel.value);
        sessEl.textContent = "Session " + d.session_id.slice(0, 8) + " · " + (d.model || "");
        break;
      case "delta":
        if (!gotDelta) { bubble.innerHTML = ""; gotDelta = true; }
        raw += d.text;
        bubble.textContent = raw;
        scroll();
        break;
      case "tool": {
        const chip = document.createElement("span");
        chip.className = "chip" + (d.sub ? " sub" : "");
        const label =
          d.name === "Task" ? "→ " + (d.detail || "Subagent")
          : d.name + (d.detail ? " · " + d.detail : "");
        chip.innerHTML = '<span class="ico"></span>' + esc(label);
        activity.appendChild(chip);
        scroll();
        break;
      }
      case "result": {
        if (raw) bubble.innerHTML = renderMd(raw);
        else if (d.error_text) bubble.innerHTML = '<em>' + esc(d.error_text) + '</em>';
        const meta = document.createElement("div");
        meta.className = "meta";
        const cost = d.cost_usd != null ? "$" + d.cost_usd.toFixed(3) : "";
        const dur = d.duration_ms != null ? (d.duration_ms / 1000).toFixed(1) + "s" : "";
        meta.textContent = [dur, cost, d.num_turns ? d.num_turns + " turns" : ""]
          .filter(Boolean).join(" · ");
        shell.appendChild(meta);
        scroll();
        break;
      }
      case "gate": {
        // Only surface the gate when it actually found issues; a passing
        // gate is the expected default and doesn't need its own pill.
        if (d.issues && d.issues.length) {
          const g = document.createElement("div");
          g.className = "gate warn";
          g.textContent = "⚠ Stil-Gate: " + d.issues.join(" · ");
          shell.appendChild(g);
          scroll();
        }
        break;
      }
      case "stderr":
        console.warn("[claude]", d.text);
        break;
    }
  }
}

function setBusy(busy) {
  sendBtn.classList.toggle("stop", busy);
  sendBtn.innerHTML = busy
    ? '<svg width="12" height="12" viewBox="0 0 12 12"><rect width="12" height="12" rx="2" fill="currentColor"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8h11M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

sendBtn.addEventListener("click", () => {
  if (state.running && state.abort) { state.abort.abort(); return; }
  send();
});
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
function autosize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + "px";
}
inputEl.addEventListener("input", autosize);

function resetConversation() {
  if (state.abort) state.abort.abort();
  state.sessionId = null;
  localStorage.removeItem("danny_session");
  localStorage.removeItem("danny_session_agent");
  sessEl.textContent = "";
  chatEl.innerHTML = "";
  stageEl.classList.add("centered");
  statusEl.textContent = "bereit";
}

newBtn.addEventListener("click", resetConversation);
