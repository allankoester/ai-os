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

test('scheduler redacts runtime secret values from summary, log, and callback summary', async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scheduler-redaction-'));
  const rootDir = await fsp.realpath(tempDir);
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
      const run = scheduler.listRuns(1)[0];
      return run && run.status !== 'running';
    });
    assert.equal(done, true);

    const run = scheduler.listRuns(1)[0];
    assert.ok(run);
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
    await fsp.rm(rootDir, { recursive: true, force: true });
  }
});
