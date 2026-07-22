import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { createBoardStorage } from '../../interface/board/storage.mjs';
import { createBoardService } from '../../interface/board/service.mjs';

const ROOT = process.cwd();
const SERVER_PATH = path.join(ROOT, 'chat', 'server.mjs');

async function mk(prefix) {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

function randomPort() {
  return 45000 + Math.floor(Math.random() * 10000);
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
  const binPath = path.join(dir, 'fake-claude-paula-l3.mjs');
  const script = `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess_paula_l3', model: 'sonnet' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'result', session_id: 'sess_paula_l3', result: 'generic-runtime-ok', duration_ms: 1, total_cost_usd: 0, num_turns: 1, is_error: false }) + '\\n');
`;
  await fs.writeFile(binPath, script, { encoding: 'utf8', mode: 0o755 });
  await fs.chmod(binPath, 0o755);
  return binPath;
}

async function writeFakeOpenCodeBin(dir) {
  const binPath = path.join(dir, 'fake-opencode-paula-l3.mjs');
  const script = `#!/usr/bin/env node
import fs from 'node:fs';

const args = process.argv.slice(2);
const logPath = process.env.TEST_MODEL_ARGS_LOG;
if (logPath) fs.appendFileSync(logPath, JSON.stringify(args) + '\\n', 'utf8');

process.stdout.write(JSON.stringify({ type: 'session', session_id: 'oc_paula_l3', model: 'anthropic/claude-sonnet-4-5' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'text', part: { text: 'generic-runtime-ok' } }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'step_finish', session_id: 'oc_paula_l3', duration_ms: 2, num_turns: 1, is_error: false }) + '\\n');
`;
  await fs.writeFile(binPath, script, { encoding: 'utf8', mode: 0o755 });
  await fs.chmod(binPath, 0o755);
  return binPath;
}

async function startServer({ port, runtimeRoot, boardWorkspaceRoot, boardRoot, providerMode, claudeBin, opencodeBin, argsLogPath, actorId }) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      CHAT_PORT: String(port),
      STEADYMADE_PROVIDER_MODE: providerMode,
      CLAUDE_BIN: claudeBin,
      OPENCODE_BIN: opencodeBin,
      STEADYMADE_CHAT_STORAGE_TEST_ROOT: runtimeRoot,
      STEADYMADE_CHAT_BOARD_ROOTDIR: boardWorkspaceRoot,
      STEADYMADE_CHAT_BOARD_PRIVATE_ROOT: boardRoot,
      STEADYMADE_CHAT_ACTOR_ID: actorId,
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

function getResultText(events) {
  const deltas = events.filter((ev) => ev.event === 'delta').map((ev) => String(ev.data?.text || ''));
  const merged = deltas.join('');
  if (merged.trim()) return merged.trim();
  const result = events.find((ev) => ev.event === 'result');
  return String(result?.data?.error_text || result?.data?.text || '').trim();
}

function extractConversationId(events) {
  return String(events.find((ev) => ev.event === 'conversation')?.data?.id || '').trim();
}

async function readInvocationCount(logPath) {
  const raw = await fs.readFile(logPath, 'utf8').catch(() => '');
  return raw.split('\n').filter(Boolean).length;
}

function createBoardReader({ rootDir, runtimeRoot, boardRoot }) {
  const storage = createBoardStorage({
    rootDir,
    runtimeRootOverride: runtimeRoot,
    resolveRoots: () => ({
      privateRoot: boardRoot,
      teamRoot: null,
      sharedKnowledgeRoot: path.join(rootDir, 'knowledge'),
      personalKnowledgeRoot: path.join(rootDir, 'knowledge', 'personal'),
    }),
  });
  return createBoardService({
    rootDir,
    guardrails: { check: () => ({ allowed: true }) },
    scheduler: {
      createJob: async () => ({ errors: ['not used'] }),
      runNow: async () => ({ errors: ['not used'] }),
      cancelRun: async () => ({ ok: true }),
      getRunLog: async () => null,
    },
    storage,
    resolveDeploymentState: async () => ({ requestedDeployment: 'local-only', effectiveDeployment: 'local-only', teamCapability: { status: 'disabled', reason: 'TEST' } }),
    getRuntimeSettingsRaw: async () => ({ runtimeMode: 'claude-subscription', envVault: [] }),
    listCanonicalAgentIds: async () => new Set(['danny', 'paula']),
    listCanonicalWorkflowIds: async () => new Set(),
  });
}

test('routes task/day intents to Paula lane and keeps generic chat behavior unchanged', async () => {
  const tempRoot = await mk('chat-paula-l3-routing-');
  const runtimeRoot = await mk('chat-paula-l3-routing-runtime-');
  const boardWorkspaceRoot = path.join(tempRoot, 'board-workspace');
  const boardRoot = path.join(tempRoot, 'board-private');
  const argsLogPath = path.join(tempRoot, 'opencode-args.log');
  const fakeClaudeBin = await writeFakeClaudeBin(tempRoot);
  const fakeOpenCodeBin = await writeFakeOpenCodeBin(tempRoot);
  const port = randomPort();

  let server = null;
  try {
    await fs.mkdir(boardWorkspaceRoot, { recursive: true });
    await fs.mkdir(boardRoot, { recursive: true });
    server = await startServer({
      port,
      runtimeRoot,
      boardWorkspaceRoot,
      boardRoot,
      providerMode: 'opencode',
      claudeBin: fakeClaudeBin,
      opencodeBin: fakeOpenCodeBin,
      argsLogPath,
      actorId: 'lane3_actor',
    });

    const dayEvents = await streamChatEvents(port, { message: 'what is my day?' });
    const dayInit = dayEvents.find((ev) => ev.event === 'init');
    assert.equal(dayInit?.data?.model, 'paula-board-adapter');
    const dayResult = getResultText(dayEvents);
    assert.match(dayResult, /Paula day summary/i);

    const afterDayInvocations = await readInvocationCount(argsLogPath);
    assert.equal(afterDayInvocations, 0, 'task/day intent should not invoke generic runtime');

    await streamChatEvents(port, { message: 'just a normal generic question' });
    const afterGenericInvocations = await readInvocationCount(argsLogPath);
    assert.equal(afterGenericInvocations, 1, 'generic chat should still use default runtime path');
  } finally {
    await stopChild(server);
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('create/update mutations are confirmation-gated and persisted with trusted actor context', async () => {
  const tempRoot = await mk('chat-paula-l3-confirm-');
  const runtimeRoot = await mk('chat-paula-l3-confirm-runtime-');
  const boardWorkspaceRoot = path.join(tempRoot, 'board-workspace');
  const boardRoot = path.join(tempRoot, 'board-private');
  const argsLogPath = path.join(tempRoot, 'opencode-args.log');
  const fakeClaudeBin = await writeFakeClaudeBin(tempRoot);
  const fakeOpenCodeBin = await writeFakeOpenCodeBin(tempRoot);
  const port = randomPort();
  const actorId = 'lane3_actor';

  let server = null;
  try {
    await fs.mkdir(boardWorkspaceRoot, { recursive: true });
    await fs.mkdir(boardRoot, { recursive: true });
    server = await startServer({
      port,
      runtimeRoot,
      boardWorkspaceRoot,
      boardRoot,
      providerMode: 'opencode',
      claudeBin: fakeClaudeBin,
      opencodeBin: fakeOpenCodeBin,
      argsLogPath,
      actorId,
    });

    const propose = await streamChatEvents(port, {
      message: 'add task prepare board demo due 2026-08-01',
      userId: 'forged_browser_user',
    });
    const conversationId = extractConversationId(propose);
    assert.ok(conversationId, 'expected synthetic conversation id');
    const proposeText = getResultText(propose);
    assert.match(proposeText, /Reply "confirm"/i);

    const beforeConfirmSummary = await streamChatEvents(port, {
      message: 'what is my day?',
      conversationId,
    });
    const beforeText = getResultText(beforeConfirmSummary);
    assert.match(beforeText, /total:\s*0/i);

    const confirm = await streamChatEvents(port, {
      message: 'confirm',
      conversationId,
    });
    const confirmText = getResultText(confirm);
    assert.match(confirmText, /created task/i);
    assert.match(confirmText, /actor lane3_actor/i);
    assert.ok(!confirmText.includes('forged_browser_user'));

    const boardReader = createBoardReader({ rootDir: boardWorkspaceRoot, runtimeRoot, boardRoot });
    const listed = await boardReader.listTasks({ desk_scope: 'my_desk' }, { id: actorId, isHuman: true, isInternal: false });
    assert.equal(listed.total, 1, 'task should be persisted in board storage after confirmation');
    assert.equal(listed.items[0].title, 'prepare board demo');
  } finally {
    await stopChild(server);
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('day summary reads actor-scoped My Desk tasks and reflects inbox/project locations', async () => {
  const tempRoot = await mk('chat-paula-l3-day-summary-');
  const runtimeRoot = await mk('chat-paula-l3-summary-runtime-');
  const boardWorkspaceRoot = path.join(tempRoot, 'board-workspace');
  const boardRoot = path.join(tempRoot, 'board-private');
  const argsLogPath = path.join(tempRoot, 'opencode-args.log');
  const fakeClaudeBin = await writeFakeClaudeBin(tempRoot);
  const fakeOpenCodeBin = await writeFakeOpenCodeBin(tempRoot);
  const port = randomPort();
  const actorId = 'lane3_actor';

  let server = null;
  try {
    await fs.mkdir(boardWorkspaceRoot, { recursive: true });
    await fs.mkdir(boardRoot, { recursive: true });

    const boardWriter = createBoardReader({ rootDir: boardWorkspaceRoot, runtimeRoot, boardRoot });
    const actor = { id: actorId, isHuman: true, isInternal: false };
    const project = await boardWriter.createProject({ id: 'proj_l3_summary', name: 'Lane3 Summary Project' }, actor);
    await boardWriter.createTask({
      id: 'task_project_lane3',
      project_id: project.id,
      title: 'Project lane task',
      assignee_type: 'human',
      assignee_id: actorId,
      human_assignee_label: 'Lane 3 Actor',
      status: 'todo',
    }, actor);

    server = await startServer({
      port,
      runtimeRoot,
      boardWorkspaceRoot,
      boardRoot,
      providerMode: 'opencode',
      claudeBin: fakeClaudeBin,
      opencodeBin: fakeOpenCodeBin,
      argsLogPath,
      actorId,
    });

    const add = await streamChatEvents(port, { message: 'add task inbox lane task' });
    const conversationId = extractConversationId(add);
    await streamChatEvents(port, { message: 'confirm', conversationId });

    const day = await streamChatEvents(port, { message: 'what is my day?', conversationId });
    const text = getResultText(day);
    assert.match(text, /total:\s*2/i);
    assert.match(text, /inbox:\s*1/i);
    assert.match(text, /project:\s*1/i);
  } finally {
    await stopChild(server);
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  }
});
