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

async function writeFakeClaudeBin(dir) {
  const binPath = path.join(dir, 'fake-claude.mjs');
  const script = `#!/usr/bin/env node
import fs from 'node:fs';

const args = process.argv.slice(2);
const logPath = process.env.TEST_MODEL_ARGS_LOG;
if (logPath) fs.appendFileSync(logPath, JSON.stringify(args) + '\\n', 'utf8');

const modelIndex = args.indexOf('--model');
const model = modelIndex >= 0 ? String(args[modelIndex + 1] || '') : '';
const sessionId = 'sess_model_test';

process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: sessionId, model }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'result', session_id: sessionId, result: 'ok', duration_ms: 1, total_cost_usd: 0, num_turns: 1, is_error: false }) + '\\n');
`;
  await fs.writeFile(binPath, script, { encoding: 'utf8', mode: 0o755 });
  await fs.chmod(binPath, 0o755);
  return binPath;
}

function randomPort() {
  return 42000 + Math.floor(Math.random() * 10000);
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

async function startServer({ port, fakeClaudeBin, runtimeRoot, argsLogPath }) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      CHAT_PORT: String(port),
      STEADYMADE_PROVIDER_MODE: 'claude-subscription',
      STEADYMADE_ENV_VAULT_KEYS: 'TEST_MODEL_ARGS_LOG',
      CLAUDE_BIN: fakeClaudeBin,
      STEADYMADE_CHAT_STORAGE_TEST_ROOT: runtimeRoot,
      TEST_MODEL_ARGS_LOG: argsLogPath,
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

async function runChatTurn(port, payload) {
  const res = await fetch(`http://localhost:${port}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: `http://localhost:${port}`,
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  assert.equal(res.status, 200, `expected /api/chat 200, got ${res.status}; body=${body}`);
}

async function readLastModelArg(logPath) {
  const raw = await fs.readFile(logPath, 'utf8');
  const lines = raw.trim().split('\n').filter(Boolean);
  assert.ok(lines.length > 0, 'expected at least one fake claude invocation');
  const argv = JSON.parse(lines[lines.length - 1]);
  const modelFlagIndex = argv.indexOf('--model');
  assert.notEqual(modelFlagIndex, -1, `expected --model in args: ${JSON.stringify(argv)}`);
  return String(argv[modelFlagIndex + 1] || '');
}

test('chat server passes explicit custom model through to claude args', async () => {
  const tempRoot = await mk('chat-model-explicit-');
  const runtimeRoot = path.join(tempRoot, 'runtime');
  const argsLogPath = path.join(tempRoot, 'model-args.log');
  const fakeClaudeBin = await writeFakeClaudeBin(tempRoot);
  const port = randomPort();

  let server = null;
  try {
    await fs.mkdir(runtimeRoot, { recursive: true });
    server = await startServer({ port, fakeClaudeBin, runtimeRoot, argsLogPath });
    await runChatTurn(port, { message: 'hello explicit model', model: 'opus' });
    const modelArg = await readLastModelArg(argsLogPath);
    assert.equal(modelArg, 'opus');
  } finally {
    await stopChild(server);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('chat server falls back to default model sonnet for missing/empty/default model payloads', async () => {
  const tempRoot = await mk('chat-model-default-');
  const runtimeRoot = path.join(tempRoot, 'runtime');
  const argsLogPath = path.join(tempRoot, 'model-args.log');
  const fakeClaudeBin = await writeFakeClaudeBin(tempRoot);
  const port = randomPort();

  let server = null;
  try {
    await fs.mkdir(runtimeRoot, { recursive: true });
    server = await startServer({ port, fakeClaudeBin, runtimeRoot, argsLogPath });

    await runChatTurn(port, { message: 'missing model' });
    assert.equal(await readLastModelArg(argsLogPath), 'sonnet');

    await runChatTurn(port, { message: 'empty model', model: '' });
    assert.equal(await readLastModelArg(argsLogPath), 'sonnet');

    await runChatTurn(port, { message: 'default model alias', model: 'default' });
    assert.equal(await readLastModelArg(argsLogPath), 'sonnet');
  } finally {
    await stopChild(server);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
