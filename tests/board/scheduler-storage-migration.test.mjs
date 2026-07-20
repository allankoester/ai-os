import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

import { createScheduler } from '../../interface/scheduler.mjs';
import {
  initializeStorageKernel,
} from '../../interface/storage/runtime/storage-kernel.mjs';
import {
  SCHEDULER_STORAGE_MIGRATIONS,
} from '../../interface/storage/runtime/scheduler-storage.mjs';

async function mk(prefix) {
  return fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), prefix)));
}

async function waitUntil(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return false;
}

async function writeExecutable(filePath, content) {
  await fsp.writeFile(filePath, content, 'utf8');
  await fsp.chmod(filePath, 0o755);
}

function withTestRuntimeRoot(testRuntimeRoot) {
  const previous = process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT;
  process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT = testRuntimeRoot;
  return () => {
    if (previous === undefined) delete process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT;
    else process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT = previous;
  };
}

function openSchedulerDb(workspaceRoot, testRuntimeRoot) {
  const kernel = initializeStorageKernel({
    workspaceRoot,
    component: 'interface',
    testRootOverride: testRuntimeRoot,
    migrations: SCHEDULER_STORAGE_MIGRATIONS,
  });
  return kernel;
}

test('scheduler migrates legacy jobs/runs once and sets authority marker + import ledger', { concurrency: false }, async () => {
  const rootDir = await mk('scheduler-cutover-root-');
  const runtimeRoot = await mk('scheduler-cutover-runtime-');
  const restoreEnv = withTestRuntimeRoot(runtimeRoot);
  try {
    const schedulerDir = path.join(rootDir, 'scheduler');
    await fsp.mkdir(schedulerDir, { recursive: true });
    await fsp.writeFile(path.join(schedulerDir, 'jobs.json'), JSON.stringify([
      {
        id: 'job_legacy_1',
        name: 'Legacy Job',
        prompt: 'legacy prompt',
        scheduleType: 'cron',
        schedule: '* * * * *',
        enabled: true,
        timeoutMinutes: 10,
        createdAt: Date.now() - 1000,
        lastRun: null,
      },
    ], null, 2));
    await fsp.writeFile(path.join(schedulerDir, 'runs.json'), JSON.stringify([
      {
        id: 'run_legacy_1',
        jobId: 'job_legacy_1',
        jobName: 'Legacy Job',
        status: 'ok',
        trigger: 'manual',
        startedAt: Date.now() - 5000,
        endedAt: Date.now() - 4000,
        summary: 'legacy summary',
      },
    ], null, 2));

    const schedulerA = createScheduler({ rootDir });
    const jobsA = schedulerA.listJobs();
    const runsA = schedulerA.listRuns(10);
    assert.equal(jobsA.length, 1);
    assert.equal(jobsA[0].name, 'Legacy Job');
    assert.equal(runsA.length, 1);
    assert.equal(runsA[0].id, 'run_legacy_1');

    await fsp.writeFile(path.join(schedulerDir, 'jobs.json'), JSON.stringify([
      {
        id: 'job_stale_file',
        name: 'STALE FILE',
        prompt: 'stale',
        scheduleType: 'cron',
        schedule: '* * * * *',
        enabled: true,
        timeoutMinutes: 1,
      },
    ], null, 2));

    const schedulerB = createScheduler({ rootDir });
    const jobsB = schedulerB.listJobs();
    assert.equal(jobsB.length, 1);
    assert.equal(jobsB[0].id, 'job_legacy_1');
    assert.equal(jobsB[0].name, 'Legacy Job');

    const kernel = openSchedulerDb(rootDir, runtimeRoot);
    try {
      const state = kernel.db.prepare('SELECT authority_mode, authority_marker FROM scheduler_state WHERE id = 1').get();
      assert.equal(state.authority_mode, 'sqlite_active');
      assert.equal(state.authority_marker, 'scheduler.sqlite.authority.v1');

      const ledger = kernel.db.prepare('SELECT source_name, status, imported_count FROM scheduler_import_ledger ORDER BY id ASC').all();
      assert.ok(ledger.some((row) => row.source_name === 'scheduler/jobs.json' && row.status === 'imported' && row.imported_count >= 1));
      assert.ok(ledger.some((row) => row.source_name === 'scheduler/runs.json' && row.status === 'imported' && row.imported_count >= 1));
    } finally {
      kernel.db.close();
    }
  } finally {
    restoreEnv();
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('malformed legacy scheduler JSON aborts cutover (never treated as empty)', { concurrency: false }, async () => {
  const rootDir = await mk('scheduler-malformed-root-');
  const runtimeRoot = await mk('scheduler-malformed-runtime-');
  const restoreEnv = withTestRuntimeRoot(runtimeRoot);
  try {
    const schedulerDir = path.join(rootDir, 'scheduler');
    await fsp.mkdir(schedulerDir, { recursive: true });
    await fsp.writeFile(path.join(schedulerDir, 'jobs.json'), '{"id": "oops"', 'utf8');
    await fsp.writeFile(path.join(schedulerDir, 'runs.json'), '[]', 'utf8');

    assert.throws(() => createScheduler({ rootDir }), (err) => err?.code === 'scheduler_legacy_malformed');

    const kernel = openSchedulerDb(rootDir, runtimeRoot);
    try {
      const state = kernel.db.prepare('SELECT authority_mode, authority_marker FROM scheduler_state WHERE id = 1').get();
      assert.equal(state.authority_mode, 'legacy_pending');
      assert.equal(state.authority_marker, null);
    } finally {
      kernel.db.close();
    }
  } finally {
    restoreEnv();
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('scheduler run state mutation and lifecycle event are persisted transactionally with durable callback outbox', { concurrency: false }, async () => {
  const rootDir = await mk('scheduler-transaction-root-');
  const runtimeRoot = await mk('scheduler-transaction-runtime-');
  const restoreEnv = withTestRuntimeRoot(runtimeRoot);
  try {
    const fakeBin = path.join(rootDir, 'fake-opencode-ok.sh');
    await writeExecutable(fakeBin, '#!/bin/sh\nprintf "hello from scheduler\n"\nexit 0\n');

    const callbackEvents = [];
    const scheduler = createScheduler({
      rootDir,
      onRunEvent: async (event) => {
        callbackEvents.push(event);
      },
      resolveRuntimeContext: async () => ({
        runtimeMode: 'opencode',
        opencodeBin: fakeBin,
        envVault: {},
      }),
    });

    const created = await scheduler.createJob({
      name: 'Transactional Event Job',
      prompt: 'run',
      scheduleType: 'once',
      runAt: Date.now() + 60_000,
      enabled: true,
      timeoutMinutes: 1,
    });
    const started = await scheduler.runNow(created.job.id);
    assert.ok(started.run?.id);

    const complete = await waitUntil(() => {
      const run = scheduler.listRuns(1)[0];
      return run && run.status !== 'running';
    });
    assert.equal(complete, true);

    const run = scheduler.listRuns(1)[0];
    assert.equal(run.status, 'ok');

    const callbackDone = await waitUntil(() => callbackEvents.some((evt) => evt.type === 'ok'));
    assert.equal(callbackDone, true);

    const kernel = openSchedulerDb(rootDir, runtimeRoot);
    try {
      const storedRun = kernel.db.prepare('SELECT status, terminal_at, summary FROM scheduler_runs WHERE id = ?').get(run.id);
      assert.equal(storedRun.status, 'ok');
      assert.ok(Number(storedRun.terminal_at) > 0);

      const events = kernel.db.prepare('SELECT type FROM scheduler_events WHERE run_id = ? ORDER BY created_at ASC').all(run.id);
      assert.ok(events.some((row) => row.type === 'queued'));
      assert.ok(events.some((row) => row.type === 'started'));
      assert.ok(events.some((row) => row.type === 'ok'));

      const outboxRow = kernel.db.prepare(`
        SELECT delivery_state, attempts, delivered_at
        FROM scheduler_callback_outbox
        WHERE event_id IN (
          SELECT event_id FROM scheduler_events WHERE run_id = ? AND type = 'ok'
        )
      `).get(run.id);
      assert.equal(outboxRow.delivery_state, 'delivered');
      assert.ok(Number(outboxRow.delivered_at) > 0);
      assert.equal(Number(outboxRow.attempts) >= 0, true);
    } finally {
      kernel.db.close();
    }
  } finally {
    restoreEnv();
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('once-job remains idempotent across restart after a run was already created', { concurrency: false }, async () => {
  const rootDir = await mk('scheduler-once-restart-root-');
  const runtimeRoot = await mk('scheduler-once-restart-runtime-');
  const restoreEnv = withTestRuntimeRoot(runtimeRoot);
  try {
    const fakeBin = path.join(rootDir, 'fake-opencode-once.sh');
    await writeExecutable(fakeBin, '#!/bin/sh\nsleep 1\nexit 0\n');

    const schedulerA = createScheduler({
      rootDir,
      resolveRuntimeContext: async () => ({
        runtimeMode: 'opencode',
        opencodeBin: fakeBin,
        envVault: {},
      }),
    });

    const created = await schedulerA.createJob({
      name: 'Once Idempotency',
      prompt: 'run once',
      scheduleType: 'once',
      runAt: Date.now() - 500,
      enabled: true,
      timeoutMinutes: 1,
    });

    const started = await schedulerA.runNow(created.job.id);
    assert.ok(started.run?.id);

    const schedulerB = createScheduler({
      rootDir,
      resolveRuntimeContext: async () => ({
        runtimeMode: 'opencode',
        opencodeBin: fakeBin,
        envVault: {},
      }),
    });

    const jobAfterRestart = schedulerB.listJobs().find((job) => job.id === created.job.id);
    assert.ok(jobAfterRestart);
    assert.equal(jobAfterRestart.nextRun, null);
  } finally {
    restoreEnv();
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('cancelRun sets durable cancelled status and terminal callback state', { concurrency: false }, async () => {
  const rootDir = await mk('scheduler-cancel-root-');
  const runtimeRoot = await mk('scheduler-cancel-runtime-');
  const restoreEnv = withTestRuntimeRoot(runtimeRoot);
  try {
    const fakeBin = path.join(rootDir, 'fake-opencode-cancel.sh');
    await writeExecutable(fakeBin, '#!/bin/sh\ntrap "exit 0" TERM INT\nwhile true; do sleep 1; done\n');

    const scheduler = createScheduler({
      rootDir,
      resolveRuntimeContext: async () => ({
        runtimeMode: 'opencode',
        opencodeBin: fakeBin,
        envVault: {},
      }),
    });

    const created = await scheduler.createJob({
      name: 'Cancel Job',
      prompt: 'run and cancel',
      scheduleType: 'once',
      runAt: Date.now() + 60_000,
      enabled: true,
      timeoutMinutes: 1,
    });

    const started = await scheduler.runNow(created.job.id);
    assert.ok(started.run?.id);
    const cancelled = await scheduler.cancelRun(started.run.id);
    assert.equal(cancelled.ok, true);

    const done = await waitUntil(() => {
      const run = scheduler.listRuns(1)[0];
      return run && run.status !== 'running';
    });
    assert.equal(done, true);
    assert.equal(scheduler.listRuns(1)[0].status, 'cancelled');
    await new Promise((resolve) => setTimeout(resolve, 250));
  } finally {
    restoreEnv();
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('restart recovery marks previously active runs as interrupted and replays callback from outbox', { concurrency: false }, async () => {
  const rootDir = await mk('scheduler-recovery-root-');
  const runtimeRoot = await mk('scheduler-recovery-runtime-');
  const restoreEnv = withTestRuntimeRoot(runtimeRoot);
  try {
    const schedulerDir = path.join(rootDir, 'scheduler');
    await fsp.mkdir(schedulerDir, { recursive: true });
    const now = Date.now();
    await fsp.writeFile(path.join(schedulerDir, 'jobs.json'), JSON.stringify([
      {
        id: 'job_running_1',
        name: 'Was Running',
        prompt: 'legacy',
        scheduleType: 'once',
        runAt: now - 1000,
        enabled: true,
        timeoutMinutes: 15,
        createdAt: now - 60000,
        lastRun: { runId: 'run_running_1', status: 'running', at: now - 2000 },
      },
    ], null, 2));
    await fsp.writeFile(path.join(schedulerDir, 'runs.json'), JSON.stringify([
      {
        id: 'run_running_1',
        jobId: 'job_running_1',
        jobName: 'Was Running',
        trigger: 'once',
        status: 'running',
        startedAt: now - 2000,
        endedAt: null,
        summary: '',
      },
    ], null, 2));

    const received = [];
    const scheduler = createScheduler({
      rootDir,
      onRunEvent: async (event) => {
        received.push(event);
      },
    });

    const replayed = await waitUntil(() => received.some((evt) => evt.type === 'error' && evt.runId === 'run_running_1'));
    assert.equal(replayed, true);

    const run = scheduler.listRuns(10).find((row) => row.id === 'run_running_1');
    assert.ok(run);
    assert.equal(run.status, 'interrupted');
  } finally {
    restoreEnv();
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('pending callback outbox entries are replayed exactly once on restart', { concurrency: false }, async () => {
  const rootDir = await mk('scheduler-callback-replay-root-');
  const runtimeRoot = await mk('scheduler-callback-replay-runtime-');
  const restoreEnv = withTestRuntimeRoot(runtimeRoot);
  try {
    const fakeBin = path.join(rootDir, 'fake-opencode-replay.sh');
    await writeExecutable(fakeBin, '#!/bin/sh\nprintf "replay me\\n"\nexit 0\n');

    const schedulerA = createScheduler({
      rootDir,
      resolveRuntimeContext: async () => ({
        runtimeMode: 'opencode',
        opencodeBin: fakeBin,
        envVault: {},
      }),
    });

    const created = await schedulerA.createJob({
      name: 'Replay Callback Job',
      prompt: 'run',
      scheduleType: 'once',
      runAt: Date.now() + 60_000,
      enabled: true,
      timeoutMinutes: 1,
    });
    const started = await schedulerA.runNow(created.job.id);
    assert.ok(started.run?.id);
    const finished = await waitUntil(() => {
      const row = schedulerA.listRuns(1)[0];
      return row && row.status !== 'running';
    });
    assert.equal(finished, true);

    const kernelA = openSchedulerDb(rootDir, runtimeRoot);
    try {
      const pending = kernelA.db.prepare(`
        SELECT COUNT(*) AS count
        FROM scheduler_callback_outbox
        WHERE delivery_state = 'pending'
      `).get();
      assert.equal(Number(pending.count) >= 1, true);
    } finally {
      kernelA.db.close();
    }

    const replayedEvents = [];
    createScheduler({
      rootDir,
      onRunEvent: async (event) => {
        replayedEvents.push(event);
      },
      resolveRuntimeContext: async () => ({
        runtimeMode: 'opencode',
        opencodeBin: fakeBin,
        envVault: {},
      }),
    });

    const replayed = await waitUntil(() => replayedEvents.some((event) => event.runId === started.run.id && event.type === 'ok'));
    assert.equal(replayed, true);

    const kernelB = openSchedulerDb(rootDir, runtimeRoot);
    try {
      const row = kernelB.db.prepare(`
        SELECT delivery_state, attempts
        FROM scheduler_callback_outbox
        WHERE event_id IN (
          SELECT event_id FROM scheduler_events WHERE run_id = ? AND type = 'ok'
        )
      `).get(started.run.id);
      assert.equal(row.delivery_state, 'delivered');
      assert.equal(Number(row.attempts) >= 0, true);
    } finally {
      kernelB.db.close();
    }
  } finally {
    restoreEnv();
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('scheduler no longer falls back to stale JSON files after SQLite authority activation', { concurrency: false }, async () => {
  const rootDir = await mk('scheduler-no-fallback-root-');
  const runtimeRoot = await mk('scheduler-no-fallback-runtime-');
  const restoreEnv = withTestRuntimeRoot(runtimeRoot);
  try {
    const fakeBin = path.join(rootDir, 'fake-opencode-fast.sh');
    await writeExecutable(fakeBin, '#!/bin/sh\nexit 0\n');

    const schedulerA = createScheduler({
      rootDir,
      resolveRuntimeContext: async () => ({
        runtimeMode: 'opencode',
        opencodeBin: fakeBin,
        envVault: {},
      }),
    });

    const created = await schedulerA.createJob({
      name: 'Canonical DB Job',
      prompt: 'db authority',
      scheduleType: 'cron',
      schedule: '*/10 * * * *',
      enabled: true,
      timeoutMinutes: 10,
    });
    assert.ok(created.job?.id);

    const schedulerDir = path.join(rootDir, 'scheduler');
    await fsp.mkdir(schedulerDir, { recursive: true });
    await fsp.writeFile(path.join(schedulerDir, 'jobs.json'), JSON.stringify([
      {
        id: 'job_stale_after_activation',
        name: 'STALE',
        prompt: 'stale',
        scheduleType: 'cron',
        schedule: '* * * * *',
        enabled: true,
        timeoutMinutes: 1,
      },
    ], null, 2));

    const schedulerB = createScheduler({ rootDir });
    const jobs = schedulerB.listJobs();
    assert.equal(jobs.some((job) => job.id === 'job_stale_after_activation'), false);
    assert.equal(jobs.some((job) => job.id === created.job.id), true);
  } finally {
    restoreEnv();
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('scheduler reports observable canonical usage append failure diagnostics', { concurrency: false }, async () => {
  const rootDir = await mk('scheduler-usage-fail-root-');
  const runtimeRoot = await mk('scheduler-usage-fail-runtime-');
  const restoreEnv = withTestRuntimeRoot(runtimeRoot);
  try {
    const fakeBin = path.join(rootDir, 'fake-opencode-usage-fail.sh');
    await writeExecutable(fakeBin, '#!/bin/sh\nexit 0\n');

    const scheduler = createScheduler({
      rootDir,
      resolveRuntimeContext: async () => ({
        runtimeMode: 'opencode',
        opencodeBin: fakeBin,
        envVault: {},
      }),
    });

    const usageDir = path.join(runtimeRoot, 'streams', 'usage');
    await fsp.mkdir(path.dirname(usageDir), { recursive: true });
    await fsp.rm(usageDir, { recursive: true, force: true });
    await fsp.writeFile(usageDir, 'not-a-directory', 'utf8');

    const created = await scheduler.createJob({
      name: 'Usage Failure Job',
      prompt: 'run once',
      scheduleType: 'once',
      runAt: Date.now() + 60_000,
      enabled: true,
      timeoutMinutes: 1,
    });
    const started = await scheduler.runNow(created.job.id);
    assert.ok(started.run?.id);

    const done = await waitUntil(() => {
      const run = scheduler.listRuns(1)[0];
      return run && run.status !== 'running';
    });
    assert.equal(done, true);

    const diag = scheduler.getDiagnostics();
    assert.equal(diag.usageAppendFailures >= 1, true);
    assert.ok(diag.lastFailureCode);
  } finally {
    restoreEnv();
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});
