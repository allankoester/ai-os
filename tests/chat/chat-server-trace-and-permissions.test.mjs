import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const ROOT = process.cwd();
const SERVER_PATH = path.join(ROOT, 'chat', 'server.mjs');

async function mk(prefix) {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

function randomPort() {
  return 44000 + Math.floor(Math.random() * 9000);
}

async function waitForServerReady(port, { timeoutMs = 8000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`chat server did not become ready on port ${port}`);
}

async function stopChild(child) {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

// A fake `claude` that emits scripted stream-json. For the permission case it
// also plays the role of the PreToolUse hook: it POSTs to the server's
// permission-request endpoint using the per-run token the server injected into
// its environment, then reports the decision it received back as a tool_result.
async function writeFakeClaudeBin(dir) {
  const binPath = path.join(dir, 'fake-claude-trace.mjs');
  const rootJson = JSON.stringify(ROOT);
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
const promptIdx = args.indexOf('-p');
const prompt = promptIdx >= 0 ? String(args[promptIdx + 1] || '') : '';
const sessionId = 'sess_trace_test';
const ROOT = ${rootJson};
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  emit({ type: 'system', subtype: 'init', session_id: sessionId, model: 'sonnet' });

  if (prompt.includes('trace-case')) {
    emit({ type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'task_1', name: 'Task', input: { subagent_type: 'explorer', description: 'map things' } },
    ], usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } } });
    emit({ type: 'assistant', parent_tool_use_id: 'task_1', message: { content: [
      { type: 'tool_use', id: 'read_1', name: 'Read', input: { file_path: ROOT + '/memory/x.md' } },
    ] } });
    emit({ type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'read_1', is_error: false, content: 'file body here' },
    ] } });
    emit({ type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'task_1', is_error: false, content: 'explorer done' },
    ] } });
    emit({ type: 'result', session_id: sessionId, result: 'done', duration_ms: 2, total_cost_usd: 0, num_turns: 1, is_error: false });
    return;
  }

  if (prompt.includes('perm-allow')) {
    emit({ type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'write_1', name: 'Write', input: { file_path: '/tmp/nope.txt', content: 'x' } },
    ] } });
    await sleep(150); // let the server register the running tool
    let decision = 'error';
    try {
      const res = await fetch(process.env.CHAT_PERM_URL + '/api/chat/permission-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-perm-token': process.env.CHAT_PERM_TOKEN || '' },
        body: JSON.stringify({ runId: process.env.CHAT_PERM_RUN_ID, token: process.env.CHAT_PERM_TOKEN, toolName: 'Write', input: { file_path: '/tmp/nope.txt' } }),
      });
      const data = await res.json();
      decision = data.decision;
    } catch (err) {
      decision = 'fetch_error:' + (err && err.message);
    }
    emit({ type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'write_1', is_error: decision !== 'allow', content: 'decision:' + decision },
    ] } });
    emit({ type: 'result', session_id: sessionId, result: 'done ' + decision, duration_ms: 3, total_cost_usd: 0, num_turns: 1, is_error: false });
    return;
  }

  emit({ type: 'result', session_id: sessionId, result: 'ok', duration_ms: 1, total_cost_usd: 0, num_turns: 1, is_error: false });
}

main().then(() => setTimeout(() => process.exit(0), 20));
`;
  await fs.writeFile(binPath, script, { encoding: 'utf8', mode: 0o755 });
  await fs.chmod(binPath, 0o755);
  return binPath;
}

async function startServer({ port, runtimeRoot, claudeBin }) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      CHAT_PORT: String(port),
      STEADYMADE_PROVIDER_MODE: 'claude-subscription',
      CLAUDE_BIN: claudeBin,
      STEADYMADE_CHAT_STORAGE_TEST_ROOT: runtimeRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
  try {
    await waitForServerReady(port);
  } catch (err) {
    await stopChild(child);
    throw new Error(`${err.message}; server stderr=${stderr}`);
  }
  return child;
}

// Read the SSE stream from POST /api/chat. `onEvent` may trigger side effects
// (e.g. posting a permission decision) and can be async.
async function streamChatEvents(port, payload, onEvent) {
  const res = await fetch(`http://localhost:${port}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `http://localhost:${port}`, 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  let sawDone = false;
  while (!sawDone) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const lines = block.split('\n');
      const event = lines.find((l) => l.startsWith('event: '))?.slice(7)?.trim();
      const dataLine = lines.find((l) => l.startsWith('data: '));
      if (!event || !dataLine) continue;
      const data = JSON.parse(dataLine.slice(6));
      events.push({ event, data });
      if (onEvent) await onEvent({ event, data }, port);
      if (event === 'done') sawDone = true;
    }
  }
  return events;
}

test('tool events carry clean detail, input preview, status lifecycle and sub-agent parent_id', async () => {
  const tempRoot = await mk('chat-trace-');
  const runtimeRoot = path.join(tempRoot, 'runtime');
  const claudeBin = await writeFakeClaudeBin(tempRoot);
  const port = randomPort();
  let server = null;
  try {
    await fs.mkdir(runtimeRoot, { recursive: true });
    server = await startServer({ port, runtimeRoot, claudeBin });
    const events = await streamChatEvents(port, { message: 'trace-case please' });
    const tools = events.filter((e) => e.event === 'tool').map((e) => e.data);

    const taskRunning = tools.find((t) => t.id === 'task_1' && t.status === 'running');
    assert.ok(taskRunning, 'expected a running Task tool event');
    assert.equal(taskRunning.detail, 'explorer · map things');

    const readRunning = tools.find((t) => t.id === 'read_1' && t.status === 'running');
    assert.ok(readRunning, 'expected a running Read tool event');
    assert.equal(readRunning.detail, 'memory/x.md', 'Read detail should be a repo-relative path');
    assert.equal(readRunning.parent_id, 'task_1', 'sub-tool should carry its Task parent_id');
    assert.equal(readRunning.sub, true);
    assert.ok(String(readRunning.input || '').includes('memory/x.md'), 'input preview should be present');

    const readDone = tools.filter((t) => t.id === 'read_1').at(-1);
    assert.equal(readDone.status, 'completed');
    assert.ok(String(readDone.result || '').includes('file body here'), 'completed event should include a result preview');
  } finally {
    await stopChild(server);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('interactive permission: pending prompt is emitted and an Allow decision unblocks the tool', async () => {
  const tempRoot = await mk('chat-perm-');
  const runtimeRoot = path.join(tempRoot, 'runtime');
  const claudeBin = await writeFakeClaudeBin(tempRoot);
  const port = randomPort();
  let server = null;
  try {
    await fs.mkdir(runtimeRoot, { recursive: true });
    server = await startServer({ port, runtimeRoot, claudeBin });

    let decisionPosted = false;
    const events = await streamChatEvents(port, { message: 'perm-allow please' }, async ({ event, data }, p) => {
      if (event === 'permission' && data.status === 'pending' && !decisionPosted) {
        decisionPosted = true;
        assert.equal(data.tool, 'Write');
        assert.equal(data.call_id, 'write_1');
        assert.ok(data.run_id, 'permission event should carry run_id');
        const res = await fetch(`http://localhost:${p}/api/chat/permission-decision`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: `http://localhost:${p}`, 'sec-fetch-site': 'same-origin' },
          body: JSON.stringify({ runId: data.run_id, permissionId: data.id, decision: 'allow', scope: 'once' }),
        });
        assert.equal(res.status, 200);
      }
    });

    const perms = events.filter((e) => e.event === 'permission').map((e) => e.data);
    assert.ok(perms.some((p) => p.status === 'pending'), 'expected a pending permission event');
    assert.ok(perms.some((p) => p.status === 'allowed'), 'expected an allowed permission event');

    const writeTool = events.filter((e) => e.event === 'tool' && e.data.id === 'write_1').map((e) => e.data);
    assert.ok(writeTool.some((t) => t.status === 'awaiting_permission'), 'write tool should have paused awaiting permission');
    const writeDone = writeTool.at(-1);
    assert.equal(writeDone.status, 'completed');
    assert.ok(String(writeDone.result || '').includes('decision:allow'), 'the fake hook should have received allow');
  } finally {
    await stopChild(server);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('permission endpoints reject unknown runs and unknown permission ids', async () => {
  const tempRoot = await mk('chat-perm-guard-');
  const runtimeRoot = path.join(tempRoot, 'runtime');
  const claudeBin = await writeFakeClaudeBin(tempRoot);
  const port = randomPort();
  let server = null;
  try {
    await fs.mkdir(runtimeRoot, { recursive: true });
    server = await startServer({ port, runtimeRoot, claudeBin });

    // Unknown run: the hook endpoint answers a safe deny rather than hanging.
    const reqRes = await fetch(`http://localhost:${port}/api/chat/permission-request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-perm-token': 'whatever' },
      body: JSON.stringify({ runId: 'does-not-exist', token: 'whatever', toolName: 'Write', input: {} }),
    });
    assert.equal(reqRes.status, 200);
    assert.equal((await reqRes.json()).decision, 'deny');

    // Unknown run for a browser decision: 404.
    const decRes = await fetch(`http://localhost:${port}/api/chat/permission-decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://localhost:${port}`, 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ runId: 'nope', permissionId: 'perm_x', decision: 'allow' }),
    });
    assert.equal(decRes.status, 404);
  } finally {
    await stopChild(server);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
