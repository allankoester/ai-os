import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

import { createScheduler } from '../../interface/scheduler.mjs';

async function waitUntil(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return false;
}

function withTestRuntimeRoot(testRuntimeRoot) {
  const previous = process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT;
  process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT = testRuntimeRoot;
  return () => {
    if (previous === undefined) delete process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT;
    else process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT = previous;
  };
}

test('scheduler redacts runtime secret values from summary, log, and callback summary', async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scheduler-redaction-'));
  const rootDir = await fsp.realpath(tempDir);
  const runtimeRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'scheduler-redaction-runtime-')));
  const restoreEnv = withTestRuntimeRoot(runtimeRoot);
  const secret = 'scheduler_runtime_secret_123';
  const fakeBin = path.join(rootDir, 'fake-opencode.sh');
  await fsp.writeFile(fakeBin, `#!/bin/sh\nprintf 'stdout secret=%s\\n' "$SCHED_SECRET"\nprintf 'stderr secret=%s\\n' "$SCHED_SECRET" 1>&2\nexit 0\n`, 'utf8');
  await fsp.chmod(fakeBin, 0o755);

  const events = [];
  const scheduler = createScheduler({
    rootDir,
    onRunEvent: async (event) => { events.push(event); },
    resolveRuntimeContext: async () => ({
      runtimeMode: 'opencode',
      opencodeBin: fakeBin,
      envVault: { SCHED_SECRET: secret },
    }),
  });

  try {
    const created = await scheduler.createJob({
      name: 'Redaction Test',
      prompt: 'run',
      scheduleType: 'once',
      runAt: Date.now() + 60_000,
      enabled: true,
      timeoutMinutes: 1,
    });
    assert.ok(created.job?.id);

    const started = await scheduler.runNow(created.job.id);
    assert.ok(started.run?.id);

    const done = await waitUntil(() => {
      const run = scheduler.listRuns(50).find((row) => row.id === started.run.id);
      return run && run.status !== 'running';
    });
    assert.equal(done, true);

    const run = scheduler.listRuns(50).find((row) => row.id === started.run.id);
    assert.ok(run);
    assert.equal(run.id, started.run.id);
    assert.ok(!run.summary.includes(secret));
    assert.ok(run.summary.includes('****'));

    const log = await scheduler.getRunLog(run.id);
    assert.ok(typeof log === 'string' && log.length > 0);
    assert.ok(!log.includes(secret));
    assert.ok(log.includes('****'));

    const terminal = events.find((e) => ['ok', 'error', 'timeout', 'cancelled'].includes(e.type));
    assert.ok(terminal);
    assert.ok(!String(terminal.summary || '').includes(secret));
  } finally {
    restoreEnv();
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('opencode NDJSON error event marks run as error even with exit code 0', async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scheduler-opencode-error-'));
  const rootDir = await fsp.realpath(tempDir);
  const runtimeRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'scheduler-opencode-error-runtime-')));
  const restoreEnv = withTestRuntimeRoot(runtimeRoot);
  const fakeBin = path.join(rootDir, 'fake-opencode-error.sh');
  await fsp.writeFile(
    fakeBin,
    `#!/bin/sh\nprintf '{"type":"info","message":"starting"}\\n'\nprintf '{"type":"error","message":"structured failure"}\\n'\nexit 0\n`,
    'utf8',
  );
  await fsp.chmod(fakeBin, 0o755);

  const scheduler = createScheduler({
    rootDir,
    resolveRuntimeContext: async () => ({
      runtimeMode: 'opencode',
      opencodeBin: fakeBin,
      envVault: {},
    }),
  });

  try {
    const created = await scheduler.createJob({
      name: 'OpenCode Error Event Test',
      prompt: 'run',
      scheduleType: 'once',
      runAt: Date.now() + 60_000,
      enabled: true,
      timeoutMinutes: 1,
    });
    assert.ok(created.job?.id);

    const started = await scheduler.runNow(created.job.id);
    assert.ok(started.run?.id);

    const done = await waitUntil(() => {
      const run = scheduler.listRuns(50).find((row) => row.id === started.run.id);
      return run && run.status !== 'running';
    });
    assert.equal(done, true);

    const run = scheduler.listRuns(50).find((row) => row.id === started.run.id);
    assert.ok(run);
    assert.equal(run.id, started.run.id);
    assert.equal(run.status, 'error');
    assert.equal(run.exitCode, 0);
    assert.match(String(run.summary || ''), /structured failure/i);
  } finally {
    restoreEnv();
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});
