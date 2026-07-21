#!/usr/bin/env node
// PreToolUse permission bridge for the Steadymade chat runtime.
//
// Claude Code runs this hook before every tool call (matcher "*"). It reads the
// PreToolUse payload on stdin and prints a permission decision on stdout:
//   { hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason } }
//
// Safe, read-only tools are auto-approved locally (no round trip). Everything
// else is referred to the chat server, which prompts the user in the UI and
// holds the answer until they decide. On any failure we deny — a headless run
// must never silently perform a gated action.
import process from 'node:process';
import path from 'node:path';

const URL_BASE = String(process.env.CHAT_PERM_URL || '').replace(/\/+$/, '');
const TOKEN = String(process.env.CHAT_PERM_TOKEN || '');
const RUN_ID = String(process.env.CHAT_PERM_RUN_ID || '');
const TIMEOUT_MS = Math.max(5000, Number(process.env.CHAT_PERM_TIMEOUT_MS || 300000) || 300000);
const SAFE_TOOLS = new Set(
  String(process.env.CHAT_PERM_SAFE_TOOLS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
const PROJECT_DIR = String(process.env.CHAT_PERM_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || '');
const PROTECTED_MEMORY = 'memory/MEMORY.md';

function decide(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: reason || '',
      },
    }),
  );
  process.exit(0);
}

// The curated long-term memory file is never editable from the chat runtime,
// even with user approval (memory-poisoning defense). Deny before prompting.
function targetsProtectedMemory(toolName, input) {
  const writeish = ['write', 'edit', 'multiedit', 'notebookedit'].includes(String(toolName).toLowerCase());
  if (!writeish) return false;
  const raw = String(input?.file_path || input?.filePath || input?.notebook_path || '');
  if (!raw) return false;
  const abs = path.isAbsolute(raw) ? raw : (PROJECT_DIR ? path.join(PROJECT_DIR, raw) : raw);
  const norm = abs.replace(/\\/g, '/');
  return norm === PROTECTED_MEMORY || norm.endsWith(`/${PROTECTED_MEMORY}`);
}

async function main() {
  let raw = '';
  try {
    for await (const chunk of process.stdin) raw += chunk;
  } catch {
    return decide('deny', 'Could not read permission request.');
  }
  let payload = {};
  try { payload = JSON.parse(raw || '{}'); } catch {}
  const toolName = String(payload.tool_name || payload.toolName || '').trim();
  const input = payload.tool_input || payload.toolInput || payload.input || {};

  if (!toolName) return decide('ask', 'No tool name provided.');
  if (targetsProtectedMemory(toolName, input)) {
    return decide('deny', 'memory/MEMORY.md is protected from direct edits in the chat runtime.');
  }
  if (SAFE_TOOLS.has(toolName.toLowerCase())) return decide('allow', 'Auto-approved (safe tool).');

  if (!URL_BASE || !TOKEN || !RUN_ID) {
    return decide('deny', 'This tool needs approval, but the permission bridge is not configured.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS + 5000);
  try {
    const res = await fetch(`${URL_BASE}/api/chat/permission-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-perm-token': TOKEN },
      body: JSON.stringify({ runId: RUN_ID, token: TOKEN, toolName, input }),
      signal: controller.signal,
    });
    if (!res.ok) return decide('deny', `Permission request failed (${res.status}).`);
    const data = await res.json().catch(() => ({}));
    if (data && data.decision === 'allow') return decide('allow', data.message || 'Approved by user.');
    return decide('deny', (data && data.message) || 'Denied by user.');
  } catch (err) {
    return decide('deny', `Permission bridge unavailable: ${String(err?.message || err)}`);
  } finally {
    clearTimeout(timer);
  }
}

main();
