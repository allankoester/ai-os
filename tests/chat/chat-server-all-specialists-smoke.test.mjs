import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const ROOT = process.cwd();
const SERVER_PATH = path.join(ROOT, 'chat', 'server.mjs');
const EXPECTED_SPECIALISTS = ['atlas', 'nora', 'mara', 'ada', 'rosa', 'otto', 'paula', 'vera', 'simon', 'iris'];

async function mk(prefix) {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

function randomPort() {
  return 44000 + Math.floor(Math.random() * 10000);
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
  const binPath = path.join(dir, 'fake-claude-smoke.mjs');
  const script = `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess_unused', model: 'sonnet' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'result', session_id: 'sess_unused', result: 'unused', duration_ms: 1, total_cost_usd: 0, num_turns: 1, is_error: false }) + '\\n');
`;
  await fs.writeFile(binPath, script, { encoding: 'utf8', mode: 0o755 });
  await fs.chmod(binPath, 0o755);
  return binPath;
}

async function writeFakeOpenCodeBin(dir) {
  const binPath = path.join(dir, 'fake-opencode-specialists-smoke.mjs');
  const script = `#!/usr/bin/env node
import fs from 'node:fs';

const args = process.argv.slice(2);
const logPath = process.env.TEST_MODEL_ARGS_LOG;
if (logPath) fs.appendFileSync(logPath, JSON.stringify(args) + '\\n', 'utf8');

const agentIdx = args.indexOf('--agent');
const agent = agentIdx >= 0 ? String(args[agentIdx + 1] || 'none') : 'none';

process.stdout.write(JSON.stringify({ type: 'session', session_id: 'oc_sess_' + agent, model: 'anthropic/claude-sonnet-4-5' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'text', part: { text: 'smoke ok for ' + agent } }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'step_finish', session_id: 'oc_sess_' + agent, duration_ms: 2, num_turns: 1, is_error: false }) + '\\n');
`;
  await fs.writeFile(binPath, script, { encoding: 'utf8', mode: 0o755 });
  await fs.chmod(binPath, 0o755);
  return binPath;
}

async function startServer({ port, runtimeRoot, claudeBin, opencodeBin, argsLogPath }) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      CHAT_PORT: String(port),
      STEADYMADE_PROVIDER_MODE: 'opencode',
      CLAUDE_BIN: claudeBin,
      OPENCODE_BIN: opencodeBin,
      STEADYMADE_CHAT_STORAGE_TEST_ROOT: runtimeRoot,
      STEADYMADE_ENV_VAULT_KEYS: 'TEST_MODEL_ARGS_LOG',
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

async function readLastInvocationArgs(logPath) {
  const raw = await fs.readFile(logPath, 'utf8');
  const lines = raw.trim().split('\n').filter(Boolean);
  assert.ok(lines.length > 0, 'expected at least one fake opencode invocation');
  return JSON.parse(lines[lines.length - 1]);
}

test('offline smoke: all active specialists are listed and route with --agent', async () => {
  const tempRoot = await mk('chat-all-specialists-smoke-');
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
      claudeBin: fakeClaudeBin,
      opencodeBin: fakeOpenCodeBin,
      argsLogPath,
    });

    const agentsRes = await fetch(`http://localhost:${port}/api/agents`);
    assert.equal(agentsRes.status, 200);
    const agentsPayload = await agentsRes.json();
    const specialistIds = (agentsPayload?.agents || [])
      .filter((agent) => agent.mode === 'direct_specialist')
      .map((agent) => agent.id);

    assert.deepEqual(specialistIds, EXPECTED_SPECIALISTS);

    for (const specialistId of EXPECTED_SPECIALISTS) {
      const events = await streamChatEvents(port, {
        message: `smoke ${specialistId}`,
        agent: specialistId,
        model: 'default',
      });

      const init = events.find((ev) => ev.event === 'init');
      assert.ok(init, `expected init event for ${specialistId}`);

      const delta = events.find((ev) => ev.event === 'delta');
      assert.ok(delta, `expected streamed delta for ${specialistId}`);
      assert.match(String(delta.data?.text || ''), new RegExp(`smoke ok for ${specialistId}`));

      const result = events.find((ev) => ev.event === 'result');
      assert.ok(result, `expected result event for ${specialistId}`);
      assert.equal(result.data?.is_error, false, `expected non-error result for ${specialistId}`);

      const done = events.find((ev) => ev.event === 'done');
      assert.ok(done, `expected done event for ${specialistId}`);

      const argv = await readLastInvocationArgs(argsLogPath);
      const agentFlagIndex = argv.indexOf('--agent');
      assert.notEqual(agentFlagIndex, -1, `expected --agent flag for ${specialistId}; argv=${JSON.stringify(argv)}`);
      assert.equal(argv[agentFlagIndex + 1], specialistId);
    }
  } finally {
    await stopChild(server);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
