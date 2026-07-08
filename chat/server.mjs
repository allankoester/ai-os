#!/usr/bin/env node
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.CHAT_PORT || 4012);
const USAGE_LOG = path.join(ROOT, 'runs', 'chat-usage.jsonl');

const PERMISSION_MODE = process.env.CHAT_PERMISSION_MODE || 'default';
const ALLOWED_TOOLS = process.env.CHAT_ALLOWED_TOOLS || 'Task,Read,Glob,Grep,Skill,WebFetch';

const AGENT_MAP = {
  danny: { label: 'Danny', specialist: false },
  atlas: { label: 'Atlas', specialist: true },
  nora: { label: 'Nora', specialist: true },
  mara: { label: 'Mara', specialist: true },
  ada: { label: 'Ada', specialist: true },
  clara: { label: 'Clara', specialist: true },
  rosa: { label: 'Rosa', specialist: true },
  jonas: { label: 'Jonas', specialist: true },
  otto: { label: 'Otto', specialist: true },
  dora: { label: 'Dora', specialist: true },
  vera: { label: 'Vera', specialist: true },
  noah: { label: 'Noah', specialist: true },
  kira: { label: 'Kira', specialist: true },
  simon: { label: 'Simon', specialist: true },
  iris: { label: 'Iris', specialist: true },
};

const DANNY_PROMPT = `FRONTEND MODE (Steadymade AI OS Chat).
You are Danny, the central orchestrator. The user always talks to Danny.

Rules:
- Do not bypass orchestration and do not impersonate specialists.
- If a specialist is requested, route work via Task tool and synthesize back as Danny.
- Follow CLAUDE.md workflow, strategy gate, and approval logic.
- Never claim external execution (including image generation) unless truly executed.
- Keep responses clear, grounded, and concise.`;

function findClaudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const base = path.join(os.homedir(), 'Library/Application Support/Claude/claude-code');
  try {
    const versions = fs.readdirSync(base)
      .filter((v) => /^\d+\.\d+/.test(v))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
    for (const v of versions) {
      const p = path.join(base, v, 'claude.app/Contents/MacOS/claude');
      if (fs.existsSync(p)) return p;
    }
  } catch {}
  return 'claude';
}
const CLAUDE_BIN = findClaudeBin();

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function lintText(text) {
  const issues = [];
  const emDashes = (text.match(/—/g) || []).length;
  if (emDashes) issues.push(`${emDashes}× Em-Dash (—)`);
  const bad = text.match(/\b(nicht|kein[e]?)\b[^.?!\n]{0,60}\bsondern\b/gi);
  if (bad) issues.push(`„nicht/kein … sondern" pattern: ${bad.length}×`);
  return issues;
}

function appendUsageLog(entry) {
  try {
    fs.mkdirSync(path.dirname(USAGE_LOG), { recursive: true });
    fs.appendFileSync(USAGE_LOG, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // never fail chat flow because of local logging
  }
}

function routeMessage(message, selectedAgent) {
  const agent = AGENT_MAP[selectedAgent] || AGENT_MAP.danny;
  if (!agent.specialist) return message;
  return [
    `[Routing instruction] User selected specialist "${agent.label}" in chat UI.`,
    'Remain Danny. Route this request to that specialist via Task tool, then synthesize the final answer as Danny.',
    '',
    message,
  ].join('\n');
}

function toolDetail(block) {
  const input = block.input || {};
  switch (block.name) {
    case 'Task': return `${input.subagent_type || 'agent'}${input.description ? ` · ${input.description}` : ''}`;
    case 'Skill': return input.skill || '';
    case 'Read':
    case 'Write':
    case 'Edit': return path.basename(input.file_path || input.filePath || '');
    case 'WebFetch':
    case 'WebSearch': return input.url || input.query || '';
    default: return input.command ? String(input.command).slice(0, 80) : '';
  }
}

function handleChat(req, res) {
  const startedAt = Date.now();
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let payload = {};
    try { payload = JSON.parse(body || '{}'); } catch {}

    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
    const model = typeof payload.model === 'string' ? payload.model.trim() : '';
    const selectedAgent = AGENT_MAP[payload.agent] ? payload.agent : 'danny';
    const mode = selectedAgent === 'danny' ? 'danny' : 'via_danny_specialist';

    if (!message) {
      res.writeHead(400).end('message required');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const args = [
      '-p', routeMessage(message, selectedAgent),
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--permission-mode', PERMISSION_MODE,
      '--allowedTools', ALLOWED_TOOLS,
      '--append-system-prompt', DANNY_PROMPT,
    ];
    if (sessionId) args.push('--resume', sessionId);
    if (model && model !== 'default') args.push('--model', model);

    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    delete env.CLAUDE_CODE_SSE_PORT;

    const child = spawn(CLAUDE_BIN, args, { cwd: ROOT, env });
    child.stdin.end();

    let buffer = '';
    let finalText = '';
    let meta = {
      session_id: sessionId || null,
      model: model || 'default',
      duration_ms: null,
      cost_usd: null,
      num_turns: null,
      input_tokens: null,
      output_tokens: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      total_tokens: null,
      is_error: false,
    };
    let tokenUsage = {};
    let logged = false;

    const finalizeLog = (override = {}) => {
      if (logged) return;
      logged = true;
      appendUsageLog({
        timestamp: new Date().toISOString(),
        session_id: override.session_id ?? meta.session_id,
        selected_agent: selectedAgent,
        mode,
        model: override.model ?? meta.model,
        duration_ms: override.duration_ms ?? meta.duration_ms ?? (Date.now() - startedAt),
        cost_usd: override.cost_usd ?? meta.cost_usd,
        num_turns: override.num_turns ?? meta.num_turns,
        input_tokens: override.input_tokens ?? meta.input_tokens,
        output_tokens: override.output_tokens ?? meta.output_tokens,
        cache_creation_input_tokens: override.cache_creation_input_tokens ?? meta.cache_creation_input_tokens,
        cache_read_input_tokens: override.cache_read_input_tokens ?? meta.cache_read_input_tokens,
        total_tokens: override.total_tokens ?? meta.total_tokens,
        is_error: Boolean(override.is_error ?? meta.is_error),
      });
    };

    child.on('error', (err) => {
      sse(res, 'stderr', { text: `spawn error: ${err.message}` });
      finalizeLog({ is_error: true, duration_ms: Date.now() - startedAt });
      sse(res, 'done', { code: -1 });
      res.end();
    });

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) forwardLine(line);
      }
    });

    child.stderr.on('data', (chunk) => {
      sse(res, 'stderr', { text: String(chunk) });
    });

    child.on('close', (code) => {
      finalizeLog({ is_error: code !== 0 && !meta.duration_ms, duration_ms: Date.now() - startedAt });
      sse(res, 'done', { code });
      res.end();
    });

    res.on('close', () => {
      if (!res.writableEnded) {
        try { child.kill('SIGTERM'); } catch {}
      }
    });

    function forwardLine(line) {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      const isSub = !!ev.parent_tool_use_id;

      if (ev.type === 'system' && ev.subtype === 'init') {
        meta.session_id = ev.session_id || meta.session_id;
        meta.model = ev.model || meta.model;
        sse(res, 'init', { session_id: ev.session_id, model: ev.model });
        return;
      }

      if (ev.type === 'stream_event' && !isSub) {
        const e = ev.event;
        if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
          finalText += e.delta.text;
          sse(res, 'delta', { text: e.delta.text });
        }
        return;
      }

      if (ev.type === 'assistant') {
        if (ev.message?.usage) tokenUsage = ev.message.usage;
        const blocks = ev.message?.content || [];
        for (const b of blocks) {
          if (b.type === 'tool_use') {
            sse(res, 'tool', { name: b.name, sub: isSub, detail: toolDetail(b) });
          }
        }
        return;
      }

      if (ev.type === 'result') {
        const text = ev.result || finalText;
        meta = {
          session_id: ev.session_id || meta.session_id,
          model: meta.model,
          duration_ms: ev.duration_ms,
          cost_usd: ev.total_cost_usd,
          num_turns: ev.num_turns,
          input_tokens: tokenUsage.input_tokens ?? null,
          output_tokens: tokenUsage.output_tokens ?? null,
          cache_creation_input_tokens: tokenUsage.cache_creation_input_tokens ?? null,
          cache_read_input_tokens: tokenUsage.cache_read_input_tokens ?? null,
          total_tokens: tokenUsage.total_tokens ?? (
            tokenUsage.input_tokens != null || tokenUsage.output_tokens != null
              ? Number(tokenUsage.input_tokens || 0) + Number(tokenUsage.output_tokens || 0) + Number(tokenUsage.cache_creation_input_tokens || 0) + Number(tokenUsage.cache_read_input_tokens || 0)
              : null
          ),
          is_error: Boolean(ev.is_error),
        };
        sse(res, 'result', {
          session_id: meta.session_id,
          model: meta.model,
          duration_ms: meta.duration_ms,
          cost_usd: meta.cost_usd,
          num_turns: meta.num_turns,
          input_tokens: meta.input_tokens,
          output_tokens: meta.output_tokens,
          total_tokens: meta.total_tokens,
          is_error: meta.is_error,
          error_text: meta.is_error && !finalText ? text : undefined,
        });
        sse(res, 'gate', { issues: lintText(text) });
        finalizeLog();
      }
    }
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function serveStatic(req, res) {
  let reqPath = req.url.split('?')[0] || '/';
  if (reqPath === '/') reqPath = '/index.html';
  const decoded = decodeURIComponent(reqPath);
  const normalized = path.normalize(decoded).replace(/^\/+/, '');
  const file = path.join(PUBLIC, normalized);
  if (!file.startsWith(PUBLIC + path.sep) && file !== path.join(PUBLIC, 'index.html')) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!fs.existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/chat') return handleChat(req, res);
  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, port: PORT, claude_bin: CLAUDE_BIN }));
    return;
  }
  serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`Steadymade AI OS Chat → http://localhost:${PORT}`);
  console.log(`claude binary: ${CLAUDE_BIN}`);
});
