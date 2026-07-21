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
  return 43000 + Math.floor(Math.random() * 10000);
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

async function writeFakeClaudeBin(dir) {
  const binPath = path.join(dir, 'fake-claude-events.mjs');
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
const promptIdx = args.indexOf('-p');
const prompt = promptIdx >= 0 ? String(args[promptIdx + 1] || '') : '';
const sessionId = 'sess_events_test';

process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: sessionId, model: 'sonnet' }) + '\\n');

if (prompt.includes('tool-case')) {
  process.stdout.write(JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id: 'tool_1', name: 'Read', input: { filePath: '/tmp/demo.txt' } }],
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    },
  }) + '\\n');
  process.stdout.write(JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'tool_1', is_error: false, content: 'ok' }] },
  }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', session_id: sessionId, result: 'tool done', duration_ms: 2, total_cost_usd: 0, num_turns: 1, is_error: false }) + '\\n');
  process.exit(0);
}

if (prompt.includes('permission-case')) {
  process.stderr.write('Permission denied while running tool; API_KEY=super-secret-value\\n');
  process.stdout.write(JSON.stringify({ type: 'result', session_id: sessionId, result: 'permission required to continue', duration_ms: 2, total_cost_usd: 0, num_turns: 1, is_error: true }) + '\\n');
  process.exit(0);
}

process.stdout.write(JSON.stringify({ type: 'result', session_id: sessionId, result: 'ok', duration_ms: 1, total_cost_usd: 0, num_turns: 1, is_error: false }) + '\\n');
`;
  await fs.writeFile(binPath, script, { encoding: 'utf8', mode: 0o755 });
  await fs.chmod(binPath, 0o755);
  return binPath;
}

async function writeFakeOpenCodeBin(dir) {
  const binPath = path.join(dir, 'fake-opencode-events.mjs');
  const script = `#!/usr/bin/env node
import fs from 'node:fs';

const args = process.argv.slice(2);
const logPath = process.env.TEST_MODEL_ARGS_LOG;
if (logPath) fs.appendFileSync(logPath, JSON.stringify(args) + '\\n', 'utf8');

process.stdout.write(JSON.stringify({ type: 'session', session_id: 'oc_sess_1', model: 'anthropic/claude-sonnet-4-5' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'text', part: { text: 'hello from opencode' } }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'step_finish', session_id: 'oc_sess_1', duration_ms: 2, num_turns: 1, is_error: false }) + '\\n');
`;
  await fs.writeFile(binPath, script, { encoding: 'utf8', mode: 0o755 });
  await fs.chmod(binPath, 0o755);
  return binPath;
}

async function startServer({ port, runtimeRoot, providerMode, claudeBin, opencodeBin, argsLogPath }) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      CHAT_PORT: String(port),
      STEADYMADE_PROVIDER_MODE: providerMode,
      CLAUDE_BIN: claudeBin,
      OPENCODE_BIN: opencodeBin,
      STEADYMADE_CHAT_STORAGE_TEST_ROOT: runtimeRoot,
      STEADYMADE_ENV_VAULT_KEYS: 'TEST_MODEL_ARGS_LOG',
      TEST_MODEL_ARGS_LOG: argsLogPath || '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk || '');
  });
  try {
    await waitForServerReady(port);
  } catch (err) {
    await stopChild(child);
    throw new Error(`${err.message}; server stderr=${stderr}`);
  }
  return child;
}

async function streamChatEvents(port, payload) {
  const res = await fetch(`http://localhost:${port}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: `http://localhost:${port}`,
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 200);
  assert.ok(res.body, 'SSE response body missing');

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
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7)?.trim();
      const dataLine = lines.find((line) => line.startsWith('data: '));
      if (!event || !dataLine) continue;
      const data = JSON.parse(dataLine.slice(6));
      events.push({ event, data });
      if (event === 'done') sawDone = true;
    }
  }
  return events;
}

test('capabilities expose provider-aware model metadata; opencode forwards explicit aliases but not default requests', async () => {
  const tempRoot = await mk('chat-capabilities-opencode-');
  const runtimeRoot = path.join(tempRoot, 'runtime');
  const argsLogPath = path.join(tempRoot, 'opencode-args.log');
  const fakeClaudeBin = await writeFakeClaudeBin(tempRoot);
  const fakeOpenCodeBin = await writeFakeOpenCodeBin(tempRoot);
  const port = randomPort();

  let server = null;
  try {
    await fs.mkdir(runtimeRoot, { recursive: true });
    server = await startServer({
      port,
      runtimeRoot,
      providerMode: 'opencode',
      claudeBin: fakeClaudeBin,
      opencodeBin: fakeOpenCodeBin,
      argsLogPath,
    });

    const capsRes = await fetch(`http://localhost:${port}/api/capabilities`);
    assert.equal(capsRes.status, 200);
    const caps = await capsRes.json();
    assert.equal(caps.active_chat_runtime, 'opencode');
    assert.equal(caps.model_capabilities.style, 'provider/model');
    assert.ok(caps.model_capabilities.supported_models.length >= 1);
    for (const model of caps.model_capabilities.supported_models) {
      assert.ok(String(model).includes('/'), `expected provider/model entry, got ${model}`);
    }

    await streamChatEvents(port, { message: 'opencode model alias mapping', model: 'sonnet' });
    const aliasRaw = await fs.readFile(argsLogPath, 'utf8');
    const aliasArgv = JSON.parse(aliasRaw.trim().split('\n').filter(Boolean).at(-1));
    const aliasIdx = aliasArgv.indexOf('--model');
    assert.notEqual(aliasIdx, -1, `expected --model in opencode args: ${JSON.stringify(aliasArgv)}`);
    assert.equal(aliasArgv[aliasIdx + 1], 'anthropic/claude-sonnet-4-5');

    const defaultEvents = await streamChatEvents(port, { message: 'opencode runtime default model', model: 'default' });
    const defaultRaw = await fs.readFile(argsLogPath, 'utf8');
    const defaultArgv = JSON.parse(defaultRaw.trim().split('\n').filter(Boolean).at(-1));
    const defaultIdx = defaultArgv.indexOf('--model');
    assert.equal(defaultIdx, -1, `did not expect --model in opencode args: ${JSON.stringify(defaultArgv)}`);

    const init = defaultEvents.find((ev) => ev.event === 'init');
    assert.ok(init, 'expected init event');
    assert.equal(init.data.model_requested, 'default');
    assert.equal(init.data.model_forwarded, false);
    assert.equal(init.data.model_effective, 'anthropic/claude-sonnet-4-5');
  } finally {
    await stopChild(server);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('stream includes structured permission/error metadata with redaction', async () => {
  const tempRoot = await mk('chat-permission-metadata-');
  const runtimeRoot = path.join(tempRoot, 'runtime');
  const fakeClaudeBin = await writeFakeClaudeBin(tempRoot);
  const fakeOpenCodeBin = await writeFakeOpenCodeBin(tempRoot);
  const port = randomPort();

  let server = null;
  try {
    await fs.mkdir(runtimeRoot, { recursive: true });
    server = await startServer({
      port,
      runtimeRoot,
      providerMode: 'claude-subscription',
      claudeBin: fakeClaudeBin,
      opencodeBin: fakeOpenCodeBin,
    });

    const events = await streamChatEvents(port, { message: 'permission-case' });
    const stderr = events.find((ev) => ev.event === 'stderr');
    assert.ok(stderr, 'expected stderr event');
    assert.equal(stderr.data.error?.category, 'permission_required');
    assert.equal(stderr.data.error?.permission_required, true);
    assert.ok(!String(stderr.data.text || '').includes('super-secret-value'), 'stderr should be redacted');

    const result = events.find((ev) => ev.event === 'result');
    assert.ok(result, 'expected result event');
    assert.equal(result.data.is_error, true);
    assert.equal(result.data.error?.category, 'permission_required');

    const done = events.find((ev) => ev.event === 'done');
    assert.ok(done, 'expected done event');
    assert.equal(done.data.error?.category, 'permission_required');
    assert.equal(done.data.permission_required, true);
  } finally {
    await stopChild(server);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('tool events include lifecycle metadata and stable ids', async () => {
  const tempRoot = await mk('chat-tool-lifecycle-');
  const runtimeRoot = path.join(tempRoot, 'runtime');
  const fakeClaudeBin = await writeFakeClaudeBin(tempRoot);
  const fakeOpenCodeBin = await writeFakeOpenCodeBin(tempRoot);
  const port = randomPort();

  let server = null;
  try {
    await fs.mkdir(runtimeRoot, { recursive: true });
    server = await startServer({
      port,
      runtimeRoot,
      providerMode: 'claude-subscription',
      claudeBin: fakeClaudeBin,
      opencodeBin: fakeOpenCodeBin,
    });

    const events = await streamChatEvents(port, { message: 'tool-case' });
    const toolEvents = events.filter((ev) => ev.event === 'tool').map((ev) => ev.data);
    assert.ok(toolEvents.length >= 2, `expected at least running+completed tool events, got ${toolEvents.length}`);

    const running = toolEvents.find((event) => event.status === 'running');
    const completed = toolEvents.find((event) => event.status === 'completed');
    assert.ok(running, 'expected running tool event');
    assert.ok(completed, 'expected completed tool event');
    assert.equal(running.id, completed.id);
    assert.equal(typeof running.started_at, 'string');
    assert.equal(typeof completed.duration_ms, 'number');
    assert.equal(typeof running._ts, 'string');
    assert.equal(typeof completed._seq, 'number');
  } finally {
    await stopChild(server);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
