#!/usr/bin/env node
/**
 * Steadymade AI OS — Danny Chat Frontend
 * Zero-dependency Node server. Spawnt den Claude-Code-CLI headless
 * (stream-json) und streamt die Events als SSE an das Chat-UI.
 *
 * Start:  node chat/server.mjs   →  http://localhost:4012
 *
 * Im Frontend ist Danny IMMER der Orchestrator (via --append-system-prompt).
 * Projekt-Kontext (CLAUDE.md, .claude/agents, Skills, Memory) lädt der CLI
 * automatisch, weil cwd = Projektroot.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(__dirname, "public");
const PORT = 4012;

// ── Konfiguration ─────────────────────────────────────────────────────────────
const PERMISSION_MODE = "acceptEdits";
const ALLOWED_TOOLS =
  "Task,Read,Glob,Grep,Write,Edit,TodoWrite,WebFetch,WebSearch,Skill," +
  "Bash(python3:*),Bash(ls:*),Bash(cat:*),Bash(node:*)";

// Subagents, die der User im Chat direkt adressieren darf (Direkt-Routing).
const ALLOWED_AGENTS = new Set([
  "atlas-strategic-advisor",
  "nora-knowledge-agent",
  "mara-setup-agent",
  "ada-marketing-strategy",
  "clara-writer",
  "rosa-review",
  "jonas-calendar-agent",
  "otto-proposal-agent",
  "dora-document-agent",
  "vera-visual-concept",
  "noah-image-prompt-router",
  "kira-image-generation-agent",
]);

const DANNY_PROMPT = `FRONTEND-MODUS (Steadymade AI OS Chat). Hier gilt ohne Ausnahme:
- Du bist Danny, der zentrale Orchestrator. Der User spricht nur mit dir.
- Orchestrierung gemäß CLAUDE.md und docs/agent-routing.md ist obligatorisch. Klassifiziere jede Anfrage als Workflow. Triviale Auskünfte beantwortest du direkt; jede inhaltliche Arbeit routest du über das Task-Tool an die zuständigen Subagents.
- Externe Texte (Angebote, Posts, Dokumente, Website-Copy): immer Writer (clara-writer / otto-proposal-agent / dora-document-agent) und danach rosa-review, bevor du sie zurückgibst.
- Bilder: Creative-Workflow (nora → vera → noah → kira), Ausführung real via scripts/kie_generate.py.
- Harte Stilregeln für alle Texte: keine Em-Dashes (—), keine "nicht A, sondern B"-Konstruktionen.
- Artefakte tragen einen Status (draft / review / approval_required / final). Nichts ist final ohne explizite User-Freigabe.
- Gemeinsames Agent-Memory: agent-memory.md im Projektroot (NICHT das Harness-Memory-Verzeichnis; Regeln siehe CLAUDE.md). Dauerhafte Fakten dort speichern, bei "merk dir das" immer; bei Kunden-/Präferenz-Themen vorher reinschauen.
- Nenne am Ende kurz, welche Subagents du eingesetzt hast. Antworte auf Deutsch, knapp und klar.`;

// Kurznamen der Subagents (für die Direkt-Ansprache).
const AGENT_NAMES = {
  "atlas-strategic-advisor": "Atlas",
  "nora-knowledge-agent": "Nora",
  "mara-setup-agent": "Mara",
  "ada-marketing-strategy": "Ada",
  "clara-writer": "Clara",
  "rosa-review": "Rosa",
  "jonas-calendar-agent": "Jonas",
  "otto-proposal-agent": "Otto",
  "dora-document-agent": "Dora",
  "vera-visual-concept": "Vera",
  "noah-image-prompt-router": "Noah",
  "kira-image-generation-agent": "Kira",
};

// Lädt den System-Prompt eines Subagents aus .claude/agents/<id>.md (ohne Frontmatter).
function loadAgentPrompt(id) {
  try {
    const file = path.join(ROOT, ".claude", "agents", id + ".md");
    const raw = fs.readFileSync(file, "utf8");
    return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
  } catch {
    return null;
  }
}

// System-Prompt für Direkt-Gespräch mit einem Subagent (kein Danny, kein Task-Routing).
function directAgentPrompt(id) {
  const body = loadAgentPrompt(id);
  if (!body) return null;
  const name = AGENT_NAMES[id] || id;
  return `FRONTEND-MODUS (Steadymade AI OS Chat). Du sprichst hier direkt mit dem User als ${name} — nicht über Danny, kein Orchestrator dazwischen. Antworte selbst, auf Deutsch, knapp und klar. Harte Stilregeln: keine Em-Dashes (—), keine "nicht A, sondern B"-Konstruktionen. Bleibe in deiner Rolle; liegt eine Anfrage klar außerhalb, sag das kurz und nenne den passenden Kollegen.
Gemeinsames Agent-Memory: agent-memory.md im Projektroot (NICHT das Harness-Memory-Verzeichnis; Regeln siehe CLAUDE.md). Speichere dauerhafte Fakten dort (Eintrag: "- YYYY-MM-DD | ${name} | Fakt"), bei "merk dir das" immer; bei Kunden-/Präferenz-Themen vorher reinschauen.

---

${body}`;
}

// ── Claude-Binary finden ──────────────────────────────────────────────────────
function findClaudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const base = path.join(
    os.homedir(),
    "Library/Application Support/Claude/claude-code"
  );
  try {
    const versions = fs
      .readdirSync(base)
      .filter((v) => /^\d+\.\d+/.test(v))
      .sort((a, b) =>
        b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" })
      );
    for (const v of versions) {
      const p = path.join(base, v, "claude.app/Contents/MacOS/claude");
      if (fs.existsSync(p)) return p;
    }
  } catch {}
  return "claude"; // Fallback: PATH
}
const CLAUDE_BIN = findClaudeBin();

// ── Stil-Gate (deterministisch, zusätzlich zu Rosa) ───────────────────────────
function lintText(text) {
  const issues = [];
  const emDashes = (text.match(/—/g) || []).length;
  if (emDashes) issues.push(`${emDashes}× Em-Dash (—)`);
  const bad = text.match(/\b(nicht|kein[e]?)\b[^.?!\n]{0,60}\bsondern\b/gi);
  if (bad) issues.push(`„nicht/kein … sondern"-Konstruktion: ${bad.length}×`);
  return issues;
}

// ── SSE helpers ───────────────────────────────────────────────────────────────
function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ── Chat handler ──────────────────────────────────────────────────────────────
function handleChat(req, res) {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let payload = {};
    try {
      payload = JSON.parse(body || "{}");
    } catch {}
    const { message, sessionId, model, agent } = payload;
    if (!message || typeof message !== "string") {
      res.writeHead(400).end("message required");
      return;
    }

    // Agent-Auswahl: "danny" → Orchestrator-Modus. Ein Subagent → Direkt-Gespräch
    // mit dessen eigenem System-Prompt (kein Danny, kein Task-Routing dazwischen).
    let systemPrompt = DANNY_PROMPT;
    if (agent && agent !== "danny" && ALLOWED_AGENTS.has(agent)) {
      const direct = directAgentPrompt(agent);
      if (direct) systemPrompt = direct;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const args = [
      "-p",
      message,
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--permission-mode",
      PERMISSION_MODE,
      "--allowedTools",
      ALLOWED_TOOLS,
      "--append-system-prompt",
      systemPrompt,
    ];
    if (sessionId) args.push("--resume", sessionId);
    if (model && model !== "default") args.push("--model", model);

    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    delete env.CLAUDE_CODE_SSE_PORT;

    const child = spawn(CLAUDE_BIN, args, { cwd: ROOT, env });
    child.stdin.end(); // CLI wartet sonst 3s auf stdin
    child.on("error", (e) => {
      sse(res, "stderr", { text: "spawn error: " + e.message });
      sse(res, "done", { code: -1 });
      res.end();
    });
    let finalText = "";
    let buf = "";

    child.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) forward(line);
      }
    });
    child.stderr.on("data", (d) => sse(res, "stderr", { text: String(d) }));
    child.on("close", (code) => {
      sse(res, "done", { code });
      res.end();
    });
    // Nur killen, wenn der Client die Verbindung vorzeitig trennt.
    // (req "close" feuert in modernem Node bereits nach Body-Empfang!)
    res.on("close", () => {
      if (!res.writableEnded) {
        try {
          child.kill("SIGTERM");
        } catch {}
      }
    });

    function forward(line) {
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      const isSub = !!ev.parent_tool_use_id;

      if (ev.type === "system" && ev.subtype === "init") {
        sse(res, "init", { session_id: ev.session_id, model: ev.model });
        return;
      }
      if (ev.type === "stream_event" && !isSub) {
        const e = ev.event;
        if (
          e?.type === "content_block_delta" &&
          e.delta?.type === "text_delta"
        ) {
          finalText += e.delta.text;
          sse(res, "delta", { text: e.delta.text });
        }
        return;
      }
      if (ev.type === "assistant") {
        const blocks = ev.message?.content || [];
        for (const b of blocks) {
          if (b.type === "tool_use") {
            sse(res, "tool", {
              name: b.name,
              sub: isSub,
              detail: toolDetail(b),
            });
          }
        }
        return;
      }
      if (ev.type === "result") {
        const text = ev.result || finalText;
        sse(res, "result", {
          session_id: ev.session_id,
          cost_usd: ev.total_cost_usd,
          duration_ms: ev.duration_ms,
          num_turns: ev.num_turns,
          is_error: !!ev.is_error,
          // Surfaced only when nothing streamed (auth/rate-limit/etc. failures
          // return their message here instead of via content_block_delta) —
          // without this the frontend has nothing to show but a generic fallback.
          error_text: ev.is_error && !finalText ? text : undefined,
        });
        const issues = lintText(text);
        sse(res, "gate", { issues });
      }
    }
  });
}

function toolDetail(b) {
  const inp = b.input || {};
  switch (b.name) {
    case "Task":
      return `${inp.subagent_type || "agent"} · ${inp.description || ""}`;
    case "Skill":
      return inp.skill || "";
    case "Bash":
      return inp.description || (inp.command || "").slice(0, 80);
    case "Read":
    case "Write":
    case "Edit":
      return path.basename(inp.file_path || "");
    case "WebFetch":
    case "WebSearch":
      return inp.url || inp.query || "";
    default:
      return "";
  }
}

// ── Static files ──────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
function serveStatic(req, res) {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  const file = path.join(PUBLIC, path.normalize(p));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
  });
  fs.createReadStream(file).pipe(res);
}

// ── Server ────────────────────────────────────────────────────────────────────
http
  .createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/chat")
      return handleChat(req, res);
    if (req.method === "GET" && req.url === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, claude_bin: CLAUDE_BIN }));
      return;
    }
    serveStatic(req, res);
  })
  .listen(PORT, () => {
    console.log(`Steadymade AI OS Chat  →  http://localhost:${PORT}`);
    console.log(`claude binary: ${CLAUDE_BIN}`);
    console.log(`project root:  ${ROOT}`);
  });
