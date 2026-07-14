import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { createBoardStorage } from '../../interface/board/storage.mjs';
import { createBoardService } from '../../interface/board/service.mjs';
import { validateLinkedPaths } from '../../interface/board/validators.mjs';

const HUMAN_ACTOR = { id: 'user_alpha', isHuman: true, isInternal: false };
const REVIEWER_ACTOR = { id: 'reviewer_alpha', isHuman: true, isInternal: false };
const INTERNAL_ACTOR = { id: 'internal_callback', isHuman: false, isInternal: true };

function boardGuardrailsAllowAll() {
  return {
    check() {
      return { allowed: true };
    },
  };
}

function createFakeScheduler(options = {}) {
  const {
    failCreateJob = false,
    failRunNow = false,
    runLogs = {},
  } = options;
  const calls = {
    createJob: [],
    runNow: [],
    cancelRun: [],
  };

  return {
    calls,
    async createJob(payload) {
      calls.createJob.push(payload);
      if (failCreateJob) return { errors: ['create failed'] };
      return { job: { id: `job_${calls.createJob.length}` } };
    },
    async runNow(jobId) {
      calls.runNow.push(jobId);
      if (failRunNow) return { errors: ['run failed'] };
      return { run: { id: `run_${calls.runNow.length}` } };
    },
    async cancelRun(runId) {
      calls.cancelRun.push(runId);
      return { ok: true };
    },
    async getRunLog(runId) {
      return runLogs[runId] || null;
    },
  };
}

async function createHarness({ schedulerOptions, runtimeMode = 'claude-subscription', runtimeEnvVault = {}, boardRoots = null } = {}) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'board-backend-tests-'));
  const rootDir = await fsp.realpath(tempDir);
  const scheduler = createFakeScheduler(schedulerOptions);
  if (boardRoots?.privateRoot) await fsp.mkdir(boardRoots.privateRoot, { recursive: true });
  if (boardRoots?.teamRoot) await fsp.mkdir(boardRoots.teamRoot, { recursive: true });
  const storage = createBoardStorage({
    rootDir,
    ...(boardRoots ? {
      resolveRoots: () => ({
        privateRoot: boardRoots.privateRoot,
        teamRoot: boardRoots.teamRoot ?? null,
        sharedKnowledgeRoot: boardRoots.sharedKnowledgeRoot ?? path.join(rootDir, 'knowledge'),
        personalKnowledgeRoot: boardRoots.personalKnowledgeRoot ?? path.join(rootDir, 'knowledge', 'personal'),
      }),
    } : {}),
  });
  const service = createBoardService({
    rootDir,
    guardrails: boardGuardrailsAllowAll(),
    scheduler,
    storage,
    getRuntimeSettingsRaw: async () => ({ runtimeMode, envVault: runtimeEnvVault }),
    listCanonicalAgentIds: async () => new Set(['agent_alpha', 'danny']),
    listCanonicalWorkflowIds: async () => new Set(['workflow_alpha', 'workflow_beta']),
  });

  async function createProjectAndTask() {
    const project = await service.createProject({
      id: 'proj_alpha',
      name: 'Project Alpha',
      owner_id: 'owner_alpha',
    }, HUMAN_ACTOR);
    const task = await service.createTask({
      id: 'task_alpha',
      project_id: project.id,
      title: 'Task Alpha',
      status: 'todo',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
    }, HUMAN_ACTOR);
    return { project, task };
  }

  return {
    rootDir,
    scheduler,
    service,
    storage,
    boardRoots: {
      privateRoot: boardRoots?.privateRoot || path.join(rootDir, 'project-board'),
      teamRoot: boardRoots?.teamRoot || null,
    },
    createProjectAndTask,
  };
}

async function cleanupRoot(rootDir) {
  await fsp.rm(rootDir, { recursive: true, force: true });
}

function resolveAttemptOutputRootAbs(rootDir, outputRoot, boardRoots = {}) {
  const value = String(outputRoot || '');
  if (path.isAbsolute(value)) return value;
  const normalized = value.split(path.sep).join('/');
  if (normalized.startsWith('artifacts/project-board/team/')) {
    return path.join(boardRoots.teamRoot || rootDir, value);
  }
  if (normalized.startsWith('artifacts/project-board/private/')) {
    return path.join(boardRoots.privateRoot || rootDir, value);
  }
  return path.join(rootDir, value);
}

function isPathWithin(parentAbs, targetAbs) {
  const rel = path.relative(parentAbs, targetAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function expectBoardErrorStatus(promise, status) {
  await assert.rejects(promise, (err) => err?.status === status);
}

test('assignment metadata change does not dispatch execution', async () => {
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();

    const patched = await h.service.patchTask(task.id, {
      version: task.version,
      ops: [{
        op: 'set_assignee',
        value: {
          assignee_type: 'agent',
          assignee_id: 'agent_alpha',
          workflow_id: 'workflow_beta',
        },
      }],
    }, HUMAN_ACTOR);

    assert.equal(h.scheduler.calls.createJob.length, 0);
    assert.equal(h.scheduler.calls.runNow.length, 0);
    assert.equal(patched.execution.attempts.length, 0);
    assert.equal(patched.execution.state, 'none');
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('explicit run creates one attempt/job', async () => {
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();
    const result = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_001',
    }, HUMAN_ACTOR);

    assert.equal(result.statusCode, 202);
    assert.equal(result.task.execution.attempts.length, 1);
    assert.equal(result.task.execution.state, 'queued');
    assert.equal(h.scheduler.calls.createJob.length, 1);
    assert.equal(h.scheduler.calls.runNow.length, 1);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('run snapshots task description into attempt and dispatch prompt', async () => {
  const h = await createHarness();
  try {
    const project = await h.service.createProject({ id: 'proj_instruction_snap', name: 'Instruction Snapshot' }, HUMAN_ACTOR);
    const task = await h.service.createTask({
      id: 'task_instruction_snap',
      project_id: project.id,
      title: 'Instruction Task',
      description: 'Instruction v1',
      status: 'todo',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
    }, HUMAN_ACTOR);

    const run = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_instruction_snapshot',
    }, HUMAN_ACTOR);

    assert.equal(run.task.execution.instruction_snapshot, 'Instruction v1');
    assert.match(h.scheduler.calls.createJob[0].prompt, /Instruction v1/);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('idempotency key replay does not duplicate attempt', async () => {
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();
    const first = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_replay',
    }, HUMAN_ACTOR);

    const replay = await h.service.runTask(task.id, {
      version: first.task.version,
      idempotency_key: 'idem_replay',
    }, HUMAN_ACTOR);

    assert.equal(replay.statusCode, 202);
    assert.equal(replay.task.execution.attempts.length, 1);
    assert.equal(h.scheduler.calls.createJob.length, 1);
    assert.equal(h.scheduler.calls.runNow.length, 1);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('same idempotency key replay after terminal state returns same attempt', async () => {
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();
    const first = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_terminal_replay',
    }, HUMAN_ACTOR);

    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: first.task.execution.attempt_id,
      state: 'started',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
    }, INTERNAL_ACTOR);

    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: first.task.execution.attempt_id,
      state: 'failed',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
      failure_summary: 'failed once',
    }, INTERNAL_ACTOR);

    const replay = await h.service.runTask(task.id, {
      version: first.task.version,
      idempotency_key: 'idem_terminal_replay',
    }, HUMAN_ACTOR);

    assert.equal(replay.statusCode, 202);
    assert.equal(replay.task.execution.attempts.length, 1);
    assert.equal(h.scheduler.calls.createJob.length, 1);
    assert.equal(h.scheduler.calls.runNow.length, 1);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('partial dispatch failure persists failed attempt and idempotency replay stays deduplicated', async () => {
  const h = await createHarness({ schedulerOptions: { failRunNow: true } });
  try {
    const { task } = await h.createProjectAndTask();
    await assert.rejects(
      h.service.runTask(task.id, {
        version: task.version,
        idempotency_key: 'idem_partial_dispatch',
      }, HUMAN_ACTOR),
      (err) => err?.status === 422 && err?.code === 'scheduler_error',
    );

    const afterFailure = await h.service.getTask(task.id);
    const persisted = afterFailure.execution.attempts.find((a) => a.idempotency_key === 'idem_partial_dispatch');
    assert.ok(persisted);
    assert.equal(afterFailure.execution.state, 'failed');
    assert.equal(afterFailure.status, 'blocked');
    assert.equal(afterFailure.blocked.is_blocked, true);
    assert.equal(h.scheduler.calls.createJob.length, 1);
    assert.equal(h.scheduler.calls.runNow.length, 1);

    const replay = await h.service.runTask(task.id, {
      version: afterFailure.version,
      idempotency_key: 'idem_partial_dispatch',
    }, HUMAN_ACTOR);
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.task.execution.attempts.filter((a) => a.idempotency_key === 'idem_partial_dispatch').length, 1);
    assert.equal(h.scheduler.calls.createJob.length, 1);
    assert.equal(h.scheduler.calls.runNow.length, 1);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('active attempt conflict on concurrent run', async () => {
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();
    const first = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_first',
    }, HUMAN_ACTOR);

    await assert.rejects(
      h.service.runTask(task.id, {
        version: first.task.version,
        idempotency_key: 'idem_second',
      }, HUMAN_ACTOR),
      (err) => err?.status === 409 && err?.code === 'execution_active',
    );
    assert.equal(h.scheduler.calls.createJob.length, 1);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('lifecycle callback success transitions task to needs_review and writes linked run/artifacts', async () => {
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();
    const runResult = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_success',
    }, HUMAN_ACTOR);

    const outputRoot = resolveAttemptOutputRootAbs(h.rootDir, runResult.task.execution.output_root, h.boardRoots);
    const artifactPath = path.join(outputRoot, 'result.txt');
    await fsp.mkdir(outputRoot, { recursive: true });
    await fsp.writeFile(artifactPath, 'ok', 'utf8');

    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: runResult.task.execution.attempt_id,
      state: 'started',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
    }, INTERNAL_ACTOR);

    const updated = await h.service.executionCallback({
      task_id: task.id,
      attempt_id: runResult.task.execution.attempt_id,
      state: 'succeeded',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
      result_summary: 'all good',
    }, INTERNAL_ACTOR);

    const expectedLinkedArtifact = `${runResult.task.execution.output_root}/result.txt`;
    assert.equal(updated.status, 'needs_review');
    assert.equal(updated.review.state, 'needs_review');
    assert.equal(updated.execution.state, 'succeeded');
    assert.ok(updated.linked_runs.some((r) => r.source === 'scheduler' && r.id === 'run_1'));
    assert.ok(updated.linked_paths.some((p) => p.path === expectedLinkedArtifact && p.kind === 'file'));
    assert.ok(updated.execution.artifact_paths.includes(expectedLinkedArtifact));
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('callback success does not auto-write server summary/transcript artifacts', async () => {
  const h = await createHarness({ schedulerOptions: { runLogs: { run_1: 'scheduler transcript line' } } });
  try {
    const { task } = await h.createProjectAndTask();
    const runResult = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_server_artifacts',
    }, HUMAN_ACTOR);

    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: runResult.task.execution.attempt_id,
      state: 'started',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
    }, INTERNAL_ACTOR);

    const updated = await h.service.executionCallback({
      task_id: task.id,
      attempt_id: runResult.task.execution.attempt_id,
      state: 'succeeded',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
      result_summary: 'fallback summary',
    }, INTERNAL_ACTOR);

    const summaryPath = `${runResult.task.execution.output_root}/server-summary.txt`;
    const transcriptPath = `${runResult.task.execution.output_root}/server-transcript.log`;
    assert.ok(!updated.execution.artifact_paths.includes(summaryPath));
    assert.ok(!updated.execution.artifact_paths.includes(transcriptPath));
    assert.ok(!updated.linked_paths.some((p) => p.path === summaryPath));
    assert.ok(!updated.linked_paths.some((p) => p.path === transcriptPath));

    const summaryAbs = path.join(h.rootDir, summaryPath);
    const transcriptAbs = path.join(h.rootDir, transcriptPath);
    const summaryExists = await fsp.stat(summaryAbs).then(() => true).catch(() => false);
    const transcriptExists = await fsp.stat(transcriptAbs).then(() => true).catch(() => false);
    assert.equal(summaryExists, false);
    assert.equal(transcriptExists, false);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('execution-linked references keep newest entries when bounded', async () => {
  const h = await createHarness();
  try {
    const project = await h.service.createProject({
      id: 'proj_linked_bound',
      name: 'Linked Bound',
      owner_id: 'owner_alpha',
    }, HUMAN_ACTOR);
    const linkedRuns = Array.from({ length: 30 }, (_, i) => ({ source: 'scheduler', id: `run_old_${i}` }));
    await fsp.mkdir(path.join(h.rootDir, 'artifacts', 'project-board', 'seed'), { recursive: true });
    const linkedPaths = [];
    for (let i = 0; i < 30; i += 1) {
      const rel = `artifacts/project-board/seed/${i}.txt`;
      linkedPaths.push({ path: rel, kind: 'file' });
      await fsp.writeFile(path.join(h.rootDir, rel), `seed ${i}`, 'utf8');
    }
    const task = await h.service.createTask({
      id: 'task_linked_bound',
      project_id: project.id,
      title: 'Linked Bound Task',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
      linked_runs: linkedRuns,
      linked_paths: linkedPaths,
    }, HUMAN_ACTOR);

    const run = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_linked_bound',
    }, HUMAN_ACTOR);
    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: run.task.execution.attempt_id,
      state: 'started',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
    }, INTERNAL_ACTOR);
    await fsp.writeFile(path.join(resolveAttemptOutputRootAbs(h.rootDir, run.task.execution.output_root, h.boardRoots), 'result.txt'), 'bounded output', 'utf8');
    const updated = await h.service.executionCallback({
      task_id: task.id,
      attempt_id: run.task.execution.attempt_id,
      state: 'succeeded',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
      result_summary: 'bound check',
    }, INTERNAL_ACTOR);

    assert.equal(updated.linked_runs.length, 30);
    assert.ok(updated.linked_runs.some((r) => r.id === 'run_1'));
    assert.ok(!updated.linked_runs.some((r) => r.id === 'run_old_0'));
    assert.equal(updated.linked_paths.length, 30);
    assert.ok(updated.linked_paths.some((p) => p.path.endsWith('/result.txt')));
    assert.ok(!updated.linked_paths.some((p) => p.path === 'artifacts/project-board/seed/0.txt'));
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

for (const callbackState of ['failed', 'timed_out', 'cancelled']) {
  test(`callback ${callbackState} transitions task to blocked`, async () => {
    const h = await createHarness();
    try {
      const { task } = await h.createProjectAndTask();
      const runResult = await h.service.runTask(task.id, {
        version: task.version,
        idempotency_key: `idem_${callbackState}`,
      }, HUMAN_ACTOR);

      if (callbackState === 'cancelled') {
        await h.service.cancelTask(task.id, { version: runResult.task.version }, HUMAN_ACTOR);
      } else {
        await h.service.executionCallback({
          task_id: task.id,
          attempt_id: runResult.task.execution.attempt_id,
          state: 'started',
          scheduler_job_id: 'job_1',
          scheduler_run_id: 'run_1',
        }, INTERNAL_ACTOR);
      }

      const updated = await h.service.executionCallback({
        task_id: task.id,
        attempt_id: runResult.task.execution.attempt_id,
        state: callbackState,
        scheduler_job_id: 'job_1',
        scheduler_run_id: 'run_1',
        failure_summary: `${callbackState} happened`,
      }, INTERNAL_ACTOR);

      assert.equal(updated.status, 'blocked');
      assert.equal(updated.blocked.is_blocked, true);
      assert.equal(updated.execution.state, callbackState);
    } finally {
      await cleanupRoot(h.rootDir);
    }
  });
}

test('retry from blocked clears blocked fields and stays clear on success', async () => {
  const h = await createHarness({ schedulerOptions: { runLogs: { run_2: 'retry transcript output' } } });
  try {
    const { task } = await h.createProjectAndTask();
    const first = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_blocked_retry_1',
    }, HUMAN_ACTOR);

    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: first.task.execution.attempt_id,
      state: 'started',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
    }, INTERNAL_ACTOR);

    const blocked = await h.service.executionCallback({
      task_id: task.id,
      attempt_id: first.task.execution.attempt_id,
      state: 'failed',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
      failure_summary: 'boom',
    }, INTERNAL_ACTOR);
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.blocked.is_blocked, true);

    const retried = await h.service.retryTask(task.id, {
      version: blocked.version,
      idempotency_key: 'idem_blocked_retry_2',
    }, HUMAN_ACTOR);
    assert.equal(retried.task.status, 'in_progress');
    assert.equal(retried.task.blocked.is_blocked, false);

    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: retried.task.execution.attempt_id,
      state: 'started',
      scheduler_job_id: 'job_2',
      scheduler_run_id: 'run_2',
    }, INTERNAL_ACTOR);

    const succeeded = await h.service.executionCallback({
      task_id: task.id,
      attempt_id: retried.task.execution.attempt_id,
      state: 'succeeded',
      scheduler_job_id: 'job_2',
      scheduler_run_id: 'run_2',
      result_summary: 'ok now',
    }, INTERNAL_ACTOR);
    assert.equal(succeeded.execution.state, 'succeeded');
    assert.equal(succeeded.status, 'needs_review');
    assert.equal(succeeded.blocked.is_blocked, false);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('stale callback does not mutate current task', async () => {
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();
    const runResult = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_stale',
    }, HUMAN_ACTOR);

    const before = await h.service.getTask(task.id);
    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: 'wrongattempt123',
      state: 'failed',
      failure_summary: 'old callback',
    }, INTERNAL_ACTOR);
    const after = await h.service.getTask(task.id);

    assert.equal(after.version, before.version);
    assert.equal(after.status, before.status);
    assert.equal(after.execution.attempt_id, runResult.task.execution.attempt_id);
    assert.equal(after.execution.state, 'queued');
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('out-of-order callback is ignored and does not mutate task', async () => {
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();
    const runResult = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_out_of_order',
    }, HUMAN_ACTOR);

    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: runResult.task.execution.attempt_id,
      state: 'started',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
    }, INTERNAL_ACTOR);

    const before = await h.service.getTask(task.id);
    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: runResult.task.execution.attempt_id,
      state: 'queued',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
    }, INTERNAL_ACTOR);
    const after = await h.service.getTask(task.id);

    assert.equal(after.version, before.version);
    assert.equal(after.status, before.status);
    assert.equal(after.execution.state, 'running');
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('callback auth rejection for unauthenticated internal callback', async () => {
  const h = await createHarness();
  try {
    await expectBoardErrorStatus(
      h.service.executionCallback({
        task_id: 'task_alpha',
        attempt_id: 'attempt_1',
        state: 'queued',
      }, { id: 'anon', isInternal: false }),
      403,
    );
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('forged internal callback API requests are rejected without dedicated token', async () => {
  const port = 45100 + Math.floor(Math.random() * 400);
  const server = spawn(process.execPath, ['interface/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      STEADYMADE_INTERFACE_TOKEN: 'token_for_test',
      BOARD_INTERNAL_TOKEN: 'board_secret_test_token',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const waitUntilReady = async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/system`);
        if (response.ok) return;
      } catch {
        // startup race
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('server did not start in time');
  };

  try {
    await waitUntilReady();
    const missingToken = await fetch(`http://127.0.0.1:${port}/api/internal/tasks/execution-callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task_id: 'task_alpha', attempt_id: 'a1', state: 'queued' }),
    });
    const missingBody = await missingToken.json();
    assert.equal(missingToken.status, 401);
    assert.equal(missingBody.ok, false);
    assert.equal(missingBody.error.code, 'unauthorized');

    const forgedToken = await fetch(`http://127.0.0.1:${port}/api/internal/tasks/execution-callback`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-board-token': 'wrong_token',
      },
      body: JSON.stringify({ task_id: 'task_alpha', attempt_id: 'a1', state: 'queued' }),
    });
    const forgedBody = await forgedToken.json();
    assert.equal(forgedToken.status, 403);
    assert.equal(forgedBody.ok, false);
    assert.equal(forgedBody.error.code, 'forbidden');
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
});

test('run rejects archived project parent', async () => {
  const h = await createHarness();
  try {
    const project = await h.service.createProject({
      id: 'proj_archived',
      name: 'Archived Project',
      owner_id: 'owner_alpha',
      status: 'archived',
    }, HUMAN_ACTOR);
    const task = await h.service.createTask({
      id: 'task_archived',
      project_id: project.id,
      title: 'Task Archived',
      status: 'todo',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
    }, HUMAN_ACTOR);

    await assert.rejects(
      h.service.runTask(task.id, {
        version: task.version,
        idempotency_key: 'idem_archived',
      }, HUMAN_ACTOR),
      (err) => err?.status === 409 && err?.code === 'project_archived',
    );
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('review decision requires authorized reviewer and gates done state', async () => {
  const h = await createHarness();
  try {
    const project = await h.service.createProject({
      id: 'proj_review_gate',
      name: 'Review Gate',
      owner_id: 'owner_alpha',
    }, HUMAN_ACTOR);
    const task = await h.service.createTask({
      id: 'task_review_gate',
      project_id: project.id,
      title: 'Review Task',
      status: 'needs_review',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
      review: {
        required: true,
        reviewers: ['reviewer_alpha'],
      },
    }, HUMAN_ACTOR);

    await expectBoardErrorStatus(h.service.patchTask(task.id, {
      version: task.version,
      ops: [{ op: 'set_status', value: 'done' }],
    }, HUMAN_ACTOR), 422);

    await assert.rejects(
      h.service.decideTaskReview(task.id, {
        version: task.version,
        decision: 'approve',
      }, HUMAN_ACTOR),
      (err) => err?.status === 403,
    );

    const approved = await h.service.decideTaskReview(task.id, {
      version: task.version,
      decision: 'approve',
    }, REVIEWER_ACTOR);

    assert.equal(approved.review.state, 'approved');
    assert.equal(approved.review.decision, 'approve');
    assert.equal(approved.review.decided_by, REVIEWER_ACTOR.id);
    assert.equal(approved.status, 'done');
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('review roster mutation is restricted to task creator or project owner', async () => {
  const h = await createHarness();
  try {
    const project = await h.service.createProject({
      id: 'proj_review_authz',
      name: 'Review Authz',
      owner_id: 'owner_alpha',
    }, HUMAN_ACTOR);
    const task = await h.service.createTask({
      id: 'task_review_authz',
      project_id: project.id,
      title: 'Review Authz Task',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
    }, HUMAN_ACTOR);

    await assert.rejects(
      h.service.patchTask(task.id, {
        version: task.version,
        ops: [{ op: 'set_reviewers', value: ['reviewer_alpha'] }],
      }, REVIEWER_ACTOR),
      (err) => err?.status === 403,
    );

    const ownerActor = { id: 'user_alpha', isHuman: true, isInternal: false };
    const ownerUpdated = await h.service.patchTask(task.id, {
      version: task.version,
      ops: [{ op: 'set_review_required', value: true }, { op: 'set_reviewers', value: ['reviewer_alpha'] }],
    }, ownerActor);
    assert.equal(ownerUpdated.review.required, true);
    assert.deepEqual(ownerUpdated.review.reviewers, ['reviewer_alpha']);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('review decision endpoint path completes needs_review task to done', async () => {
  const h = await createHarness();
  try {
    const project = await h.service.createProject({
      id: 'proj_review_endpoint',
      name: 'Review Endpoint',
      owner_id: 'owner_alpha',
    }, HUMAN_ACTOR);
    const task = await h.service.createTask({
      id: 'task_review_endpoint',
      project_id: project.id,
      title: 'Review Endpoint Task',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
      review: { required: true, reviewers: ['reviewer_alpha'] },
    }, HUMAN_ACTOR);

    const run = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_review_endpoint',
    }, HUMAN_ACTOR);

    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: run.task.execution.attempt_id,
      state: 'started',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
    }, INTERNAL_ACTOR);

    const needsReview = await h.service.executionCallback({
      task_id: task.id,
      attempt_id: run.task.execution.attempt_id,
      state: 'succeeded',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
      result_summary: 'ready for review',
    }, INTERNAL_ACTOR);
    assert.equal(needsReview.status, 'needs_review');
    assert.equal(needsReview.review.state, 'needs_review');

    const approved = await h.service.decideTaskReview(task.id, {
      version: needsReview.version,
      decision: 'approve',
    }, REVIEWER_ACTOR);
    assert.equal(approved.status, 'done');
    assert.equal(approved.review.state, 'approved');
    assert.equal(approved.review.decided_by, REVIEWER_ACTOR.id);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('linked path validation rejects traversal, absolute path, and symlink escape', async () => {
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'board-linked-path-tests-'));
  try {
    await fsp.mkdir(path.join(rootDir, 'knowledge', 'company'), { recursive: true });
    const outsideRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'board-outside-'));
    const outsideFile = path.join(outsideRoot, 'secret.txt');
    await fsp.writeFile(outsideFile, 'secret', 'utf8');
    const symlinkPath = path.join(rootDir, 'knowledge', 'company', 'symlink_escape.txt');
    await fsp.symlink(outsideFile, symlinkPath);

    const guardrails = boardGuardrailsAllowAll();

    await expectBoardErrorStatus(validateLinkedPaths({
      items: [{ path: '../knowledge/company/file.md', kind: 'file' }],
      rootDir,
      guardrails,
    }), 422);

    await expectBoardErrorStatus(validateLinkedPaths({
      items: [{ path: '/etc/passwd', kind: 'file' }],
      rootDir,
      guardrails,
    }), 422);

    await expectBoardErrorStatus(validateLinkedPaths({
      items: [{ path: 'knowledge/company/symlink_escape.txt', kind: 'file' }],
      rootDir,
      guardrails,
    }), 422);

    await fsp.rm(outsideRoot, { recursive: true, force: true });
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
  }
});

test('validation enum/limit errors return 422 semantics at service layer', async () => {
  const h = await createHarness();
  try {
    const project = await h.service.createProject({
      id: 'proj_limit',
      name: 'Project Limit',
      owner_id: 'owner_limit',
    }, HUMAN_ACTOR);

    await expectBoardErrorStatus(h.service.createTask({
      id: 'task_bad_enum',
      project_id: project.id,
      title: 'Bad Enum Task',
      priority: 'urgent',
    }, HUMAN_ACTOR), 422);

    const task = await h.service.createTask({
      id: 'task_limit',
      project_id: project.id,
      title: 'Task Limit',
      status: 'todo',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
    }, HUMAN_ACTOR);

    const tooManyReviewers = Array.from({ length: 11 }, (_, i) => `rev_${String(i).padStart(2, '0')}`);
    await expectBoardErrorStatus(h.service.patchTask(task.id, {
      version: task.version,
      ops: [{ op: 'set_reviewers', value: tooManyReviewers }],
    }, HUMAN_ACTOR), 422);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('project owner is server-derived and ignores client owner_id', async () => {
  const h = await createHarness();
  try {
    const project = await h.service.createProject({
      id: 'proj_owner_derived',
      name: 'Owner Derived',
      owner_id: 'forged_owner',
    }, HUMAN_ACTOR);
    assert.equal(project.owner_id, HUMAN_ACTOR.id);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('visibility filtering and cross-scope denial are enforced', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const teamRoot = path.join(os.tmpdir(), `board-team-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({
    boardRoots: {
      privateRoot,
      teamRoot,
    },
  });
  const otherActor = { id: 'user_beta', isHuman: true, isInternal: false };
  try {
    const privateProject = await h.service.createProject({
      id: 'proj_private_scope',
      name: 'Private Scope',
      visibility: 'private',
    }, HUMAN_ACTOR);
    const teamProject = await h.service.createProject({
      id: 'proj_team_scope',
      name: 'Team Scope',
      visibility: 'team',
    }, HUMAN_ACTOR);

    const listed = await h.service.listProjects({}, otherActor);
    assert.ok(listed.items.some((p) => p.id === teamProject.id));
    assert.ok(!listed.items.some((p) => p.id === privateProject.id));

    await assert.rejects(
      h.service.getProject(privateProject.id, otherActor),
      (err) => err?.status === 403,
    );
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
    await fsp.rm(teamRoot, { recursive: true, force: true });
  }
});

test('team scope create fails when team root is not configured', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({
    boardRoots: {
      privateRoot,
      teamRoot: null,
    },
  });
  try {
    await assert.rejects(
      h.service.createProject({
        id: 'proj_team_missing_root',
        name: 'Team Missing Root',
        visibility: 'team',
      }, HUMAN_ACTOR),
      (err) => err?.status === 503,
    );
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
  }
});

test('team task artifacts are written under configured team board root', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const teamRoot = path.join(os.tmpdir(), `board-team-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot } });
  try {
    const teamProject = await h.service.createProject({
      id: 'proj_team_artifacts',
      name: 'Team Artifacts',
      visibility: 'team',
    }, HUMAN_ACTOR);
    const teamTask = await h.service.createTask({
      id: 'task_team_artifacts',
      project_id: teamProject.id,
      title: 'Team Artifact Task',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
    }, HUMAN_ACTOR);

    const run = await h.service.runTask(teamTask.id, {
      version: teamTask.version,
      idempotency_key: 'idem_team_artifacts',
    }, HUMAN_ACTOR);

    const outputAbs = resolveAttemptOutputRootAbs(h.rootDir, run.task.execution.output_root, h.boardRoots);
    assert.equal(isPathWithin(teamRoot, outputAbs), true);
    assert.equal(isPathWithin(path.join(h.rootDir, 'artifacts'), outputAbs), false);
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
    await fsp.rm(teamRoot, { recursive: true, force: true });
  }
});

test('private task artifacts remain under local repo artifacts root', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const teamRoot = path.join(os.tmpdir(), `board-team-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot } });
  try {
    const { task } = await h.createProjectAndTask();
    const run = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_private_artifacts',
    }, HUMAN_ACTOR);

    const outputAbs = resolveAttemptOutputRootAbs(h.rootDir, run.task.execution.output_root, h.boardRoots);
    assert.equal(isPathWithin(privateRoot, outputAbs), true);
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
    await fsp.rm(teamRoot, { recursive: true, force: true });
  }
});

test('team artifact reads resolve through board artifact service path semantics', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const teamRoot = path.join(os.tmpdir(), `board-team-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot } });
  try {
    const teamProject = await h.service.createProject({
      id: 'proj_team_read_artifacts',
      name: 'Team Read Artifacts',
      visibility: 'team',
    }, HUMAN_ACTOR);
    const teamTask = await h.service.createTask({
      id: 'task_team_read_artifacts',
      project_id: teamProject.id,
      title: 'Team Read Artifact Task',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
    }, HUMAN_ACTOR);

    const run = await h.service.runTask(teamTask.id, {
      version: teamTask.version,
      idempotency_key: 'idem_team_read_artifacts',
    }, HUMAN_ACTOR);
    const outputRoot = resolveAttemptOutputRootAbs(h.rootDir, run.task.execution.output_root, h.boardRoots);
    await fsp.mkdir(outputRoot, { recursive: true });
    const artifactAbs = path.join(outputRoot, 'result.txt');
    await fsp.writeFile(artifactAbs, 'team ok', 'utf8');

    await h.service.executionCallback({
      task_id: teamTask.id,
      attempt_id: run.task.execution.attempt_id,
      state: 'started',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
    }, INTERNAL_ACTOR);
    await h.service.executionCallback({
      task_id: teamTask.id,
      attempt_id: run.task.execution.attempt_id,
      state: 'succeeded',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
      result_summary: 'team success',
    }, INTERNAL_ACTOR);

    const artifact = await h.service.readTaskArtifact({
      taskId: teamTask.id,
      attemptId: run.task.execution.attempt_id,
      artifactPath: 'result.txt',
      actor: HUMAN_ACTOR,
    });
    assert.equal(await fsp.realpath(artifact.abs), await fsp.realpath(artifactAbs));
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
    await fsp.rm(teamRoot, { recursive: true, force: true });
  }
});

test('team divergence detection fails closed in read-only mode', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const teamRoot = path.join(os.tmpdir(), `board-team-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fsp.mkdir(path.join(teamRoot, 'projects'), { recursive: true });
  await fsp.writeFile(path.join(teamRoot, 'projects', 'proj_divergent (conflict copy).json'), '{}', 'utf8');
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot } });
  try {
    await assert.rejects(
      h.service.createProject({
        id: 'proj_divergent',
        name: 'Divergent Team Project',
        visibility: 'team',
      }, HUMAN_ACTOR),
      (err) => err?.status === 503 && err?.code === 'team_scope_read_only',
    );
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
    await fsp.rm(teamRoot, { recursive: true, force: true });
  }
});

test('migration blocks active execution and supports private->team move', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const teamRoot = path.join(os.tmpdir(), `board-team-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot } });
  try {
    const project = await h.service.createProject({
      id: 'proj_migrate',
      name: 'Migrate Project',
      visibility: 'private',
    }, HUMAN_ACTOR);
    const task = await h.service.createTask({
      id: 'task_migrate',
      project_id: project.id,
      title: 'Migrate Task',
      status: 'todo',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
    }, HUMAN_ACTOR);

    const running = await h.service.runTask(task.id, { version: task.version, idempotency_key: 'idem_migrate_active' }, HUMAN_ACTOR);
    await assert.rejects(
      h.service.migrateProjectVisibility(project.id, {
        version: project.version,
        to_visibility: 'team',
        operation_id: 'mig_active',
        action: 'start',
      }, HUMAN_ACTOR),
      (err) => err?.status === 409 && err?.code === 'execution_active',
    );

    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: running.task.execution.attempt_id,
      state: 'started',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
    }, INTERNAL_ACTOR);
    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: running.task.execution.attempt_id,
      state: 'failed',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
      failure_summary: 'stop for migration',
    }, INTERNAL_ACTOR);

    const refreshed = await h.service.getProject(project.id, HUMAN_ACTOR);
    const migrated = await h.service.migrateProjectVisibility(project.id, {
      version: refreshed.version,
      to_visibility: 'team',
      operation_id: 'mig_done',
      action: 'start',
    }, HUMAN_ACTOR);
    assert.equal(migrated.visibility, 'team');
    assert.equal(migrated.scope_migration.state, 'completed');
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
    await fsp.rm(teamRoot, { recursive: true, force: true });
  }
});

test('artifact authorization enforces private scope ownership', async () => {
  const h = await createHarness();
  const otherActor = { id: 'user_beta', isHuman: true, isInternal: false };
  try {
    const { task } = await h.createProjectAndTask();
    const runResult = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_artifact_auth',
    }, HUMAN_ACTOR);
    const outputRoot = resolveAttemptOutputRootAbs(h.rootDir, runResult.task.execution.output_root, h.boardRoots);
    await fsp.mkdir(outputRoot, { recursive: true });
    await fsp.writeFile(path.join(outputRoot, 'result.txt'), 'ok', 'utf8');
    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: runResult.task.execution.attempt_id,
      state: 'started',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
    }, INTERNAL_ACTOR);
    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: runResult.task.execution.attempt_id,
      state: 'succeeded',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
      result_summary: 'ok',
    }, INTERNAL_ACTOR);

    const ownerRead = await h.service.readTaskArtifact({
      taskId: task.id,
      attemptId: runResult.task.execution.attempt_id,
      artifactPath: 'result.txt',
      actor: HUMAN_ACTOR,
    });
    assert.ok(ownerRead.abs.endsWith('result.txt'));

    await assert.rejects(
      h.service.readTaskArtifact({
        taskId: task.id,
        attemptId: runResult.task.execution.attempt_id,
        artifactPath: 'result.txt',
        actor: otherActor,
      }),
      (err) => err?.status === 403,
    );
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('runtime mode dispatch snapshots include opencode and anthropic-api', async () => {
  const opencodeHarness = await createHarness({ runtimeMode: 'opencode' });
  const anthropicHarness = await createHarness({ runtimeMode: 'anthropic-api' });
  try {
    const opencodeSeed = await opencodeHarness.createProjectAndTask();
    const opencodeRun = await opencodeHarness.service.runTask(opencodeSeed.task.id, {
      version: opencodeSeed.task.version,
      idempotency_key: 'idem_opencode_runtime',
    }, HUMAN_ACTOR);
    assert.equal(opencodeRun.task.execution.runtime_mode, 'opencode');
    assert.equal(opencodeHarness.scheduler.calls.createJob[0].meta.runtime_mode, 'opencode');

    const anthropicSeed = await anthropicHarness.createProjectAndTask();
    const anthropicRun = await anthropicHarness.service.runTask(anthropicSeed.task.id, {
      version: anthropicSeed.task.version,
      idempotency_key: 'idem_anthropic_runtime',
    }, HUMAN_ACTOR);
    assert.equal(anthropicRun.task.execution.runtime_mode, 'anthropic-api');
    assert.equal(anthropicHarness.scheduler.calls.createJob[0].meta.runtime_mode, 'anthropic-api');
  } finally {
    await cleanupRoot(opencodeHarness.rootDir);
    await cleanupRoot(anthropicHarness.rootDir);
  }
});

test('metadata and Danny default assignee are exposed and enforced', async () => {
  const h = await createHarness();
  try {
    const metadata = await h.service.getMetadata();
    assert.equal(metadata.defaults.assignee_id, 'danny');

    const project = await h.service.createProject({ id: 'proj_meta', name: 'Meta Project' }, HUMAN_ACTOR);
    const task = await h.service.createTask({
      id: 'task_meta',
      project_id: project.id,
      title: 'Default Danny',
      assignee_type: 'agent',
      workflow_id: 'workflow_alpha',
    }, HUMAN_ACTOR);
    assert.equal(task.assignee_id, 'danny');
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('blocked -> todo status transition clears blocked metadata', async () => {
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();
    const blocked = await h.service.patchTask(task.id, {
      version: task.version,
      ops: [
        { op: 'set_blocked', value: { is_blocked: true, reason: 'waiting' } },
      ],
    }, HUMAN_ACTOR);
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.blocked.is_blocked, true);

    const unblocked = await h.service.patchTask(task.id, {
      version: blocked.version,
      ops: [{ op: 'set_status', value: 'todo' }],
    }, HUMAN_ACTOR);
    assert.equal(unblocked.status, 'todo');
    assert.equal(unblocked.blocked.is_blocked, false);
    assert.equal(unblocked.blocked.since, null);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('project and task rename/description patch ops are supported', async () => {
  const h = await createHarness();
  try {
    const { project, task } = await h.createProjectAndTask();
    const renamedProject = await h.service.patchProject(project.id, {
      version: project.version,
      ops: [
        { op: 'set_name', value: 'Project Alpha Renamed' },
        { op: 'set_description', value: 'Updated project description' },
      ],
    }, HUMAN_ACTOR);
    assert.equal(renamedProject.name, 'Project Alpha Renamed');
    assert.equal(renamedProject.description, 'Updated project description');
    assert.equal(renamedProject.id, project.id);

    const updatedTask = await h.service.patchTask(task.id, {
      version: task.version,
      ops: [
        { op: 'set_title', value: 'Task Alpha Renamed' },
        { op: 'set_description', value: 'Use this exact instruction snapshot text.' },
      ],
    }, HUMAN_ACTOR);
    assert.equal(updatedTask.title, 'Task Alpha Renamed');
    assert.equal(updatedTask.description, 'Use this exact instruction snapshot text.');
    assert.equal(updatedTask.id, task.id);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('task patch supports workflow/subtasks and human assignee label', async () => {
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();
    const patched = await h.service.patchTask(task.id, {
      version: task.version,
      ops: [
        {
          op: 'set_assignee',
          value: {
            assignee_type: 'human',
            assignee_id: null,
            human_assignee_label: 'Allan K. (Ops)',
          },
        },
        { op: 'set_workflow_id', value: 'workflow_beta' },
        {
          op: 'set_subtasks',
          value: [
            { id: 'st_1', text: 'Prep brief', completed: false, order: 1 },
            { id: 'st_2', text: 'Review output', completed: true, order: 2 },
          ],
        },
      ],
    }, HUMAN_ACTOR);

    assert.equal(patched.assignee_type, 'human');
    assert.equal(patched.human_assignee_label, 'Allan K. (Ops)');
    assert.equal(patched.workflow_id, 'workflow_beta');
    assert.deepEqual(patched.subtasks, [
      { id: 'st_1', text: 'Prep brief', completed: false, order: 1 },
      { id: 'st_2', text: 'Review output', completed: true, order: 2 },
    ]);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('task can move back to backlog from done when execution is not active', async () => {
  const h = await createHarness();
  try {
    const project = await h.service.createProject({ id: 'proj_backlog_return', name: 'Backlog Return' }, HUMAN_ACTOR);
    const task = await h.service.createTask({
      id: 'task_backlog_return',
      project_id: project.id,
      title: 'Backlog Return Task',
      status: 'done',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
      review: { required: false },
    }, HUMAN_ACTOR);
    const moved = await h.service.patchTask(task.id, {
      version: task.version,
      ops: [{ op: 'set_status', value: 'backlog' }],
    }, HUMAN_ACTOR);
    assert.equal(moved.status, 'backlog');
    assert.equal(moved.blocked.is_blocked, false);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('delete task requires confirm/version and rejects active execution', async () => {
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();
    await assert.rejects(
      h.service.deleteTask(task.id, { version: task.version }, HUMAN_ACTOR),
      (err) => err?.status === 422,
    );

    const run = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_delete_active',
    }, HUMAN_ACTOR);
    await assert.rejects(
      h.service.deleteTask(task.id, { version: run.task.version, confirm: true }, HUMAN_ACTOR),
      (err) => err?.status === 409 && err?.code === 'execution_active',
    );

    const done = await h.service.executionCallback({
      task_id: task.id,
      attempt_id: run.task.execution.attempt_id,
      state: 'failed',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
      failure_summary: 'failed for deletion',
    }, INTERNAL_ACTOR);

    const deleted = await h.service.deleteTask(task.id, { version: done.version, confirm: true }, HUMAN_ACTOR);
    assert.equal(deleted.deleted, true);
    await assert.rejects(
      h.service.getTask(task.id, HUMAN_ACTOR),
      (err) => err?.status === 404,
    );
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('delete project cascades tasks and rejects active task execution', async () => {
  const h = await createHarness();
  try {
    const project = await h.service.createProject({ id: 'proj_delete_cascade', name: 'Delete Cascade' }, HUMAN_ACTOR);
    const activeTask = await h.service.createTask({
      id: 'task_delete_active',
      project_id: project.id,
      title: 'Active Task',
      status: 'todo',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
    }, HUMAN_ACTOR);
    const passiveTask = await h.service.createTask({
      id: 'task_delete_passive',
      project_id: project.id,
      title: 'Passive Task',
      status: 'todo',
      assignee_type: 'human',
      human_assignee_label: 'Manual owner',
    }, HUMAN_ACTOR);
    const run = await h.service.runTask(activeTask.id, {
      version: activeTask.version,
      idempotency_key: 'idem_project_delete_active',
    }, HUMAN_ACTOR);

    await assert.rejects(
      h.service.deleteProject(project.id, { version: project.version, confirm: true }, HUMAN_ACTOR),
      (err) => err?.status === 409 && err?.code === 'execution_active',
    );

    await h.service.executionCallback({
      task_id: activeTask.id,
      attempt_id: run.task.execution.attempt_id,
      state: 'failed',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
      failure_summary: 'done running',
    }, INTERNAL_ACTOR);

    const projectNow = await h.service.getProject(project.id, HUMAN_ACTOR);
    const deleted = await h.service.deleteProject(project.id, { version: projectNow.version, confirm: true }, HUMAN_ACTOR);
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.cascade_deleted_tasks, 2);

    await assert.rejects(h.service.getProject(project.id, HUMAN_ACTOR), (err) => err?.status === 404);
    await assert.rejects(h.service.getTask(activeTask.id, HUMAN_ACTOR), (err) => err?.status === 404);
    await assert.rejects(h.service.getTask(passiveTask.id, HUMAN_ACTOR), (err) => err?.status === 404);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('metadata visibility options hide team when team root is unavailable', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const missingTeamRoot = path.join(os.tmpdir(), `board-team-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot: missingTeamRoot } });
  try {
    await fsp.rm(missingTeamRoot, { recursive: true, force: true });
    const metadata = await h.service.getMetadata();
    assert.equal(metadata.visibility.team_root_configured, true);
    assert.equal(metadata.visibility.team_root_available, false);
    assert.deepEqual(metadata.visibility_options, ['private']);
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
    await fsp.rm(missingTeamRoot, { recursive: true, force: true });
  }
});

test('migration replay to same visibility is a no-op and keeps tasks', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const teamRoot = path.join(os.tmpdir(), `board-team-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot } });
  try {
    const { project, task } = await h.createProjectAndTask();
    const migrated = await h.service.migrateProjectVisibility(project.id, {
      version: project.version,
      to_visibility: 'team',
      operation_id: 'mig_replay_1',
      action: 'start',
    }, HUMAN_ACTOR);
    assert.equal(migrated.visibility, 'team');

    const replay = await h.service.migrateProjectVisibility(project.id, {
      version: migrated.version,
      to_visibility: 'team',
      operation_id: 'mig_replay_1',
      action: 'resume',
    }, HUMAN_ACTOR);
    assert.equal(replay.version, migrated.version);
    assert.equal(replay.visibility, 'team');

    const listed = await h.service.listTasks({ project_id: project.id }, HUMAN_ACTOR);
    assert.ok(listed.items.some((t) => t.id === task.id));
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
    await fsp.rm(teamRoot, { recursive: true, force: true });
  }
});

test('historical attempt artifacts remain readable after visibility migration', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const teamRoot = path.join(os.tmpdir(), `board-team-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot } });
  try {
    const { project, task } = await h.createProjectAndTask();
    const run = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_hist_art',
    }, HUMAN_ACTOR);
    const outputRoot = resolveAttemptOutputRootAbs(h.rootDir, run.task.execution.output_root, h.boardRoots);
    await fsp.mkdir(outputRoot, { recursive: true });
    await fsp.writeFile(path.join(outputRoot, 'result.txt'), 'ok', 'utf8');

    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: run.task.execution.attempt_id,
      state: 'started',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
    }, INTERNAL_ACTOR);
    const done = await h.service.executionCallback({
      task_id: task.id,
      attempt_id: run.task.execution.attempt_id,
      state: 'succeeded',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
      result_summary: 'ok',
    }, INTERNAL_ACTOR);

    const migrated = await h.service.migrateProjectVisibility(project.id, {
      version: (await h.service.getProject(project.id, HUMAN_ACTOR)).version,
      to_visibility: 'team',
      operation_id: 'mig_hist_art',
      action: 'start',
    }, HUMAN_ACTOR);
    assert.equal(migrated.visibility, 'team');

    const artifact = await h.service.readTaskArtifact({
      taskId: task.id,
      attemptId: done.execution.attempt_id,
      artifactPath: 'result.txt',
      actor: HUMAN_ACTOR,
    });
    assert.ok(artifact.abs.endsWith('result.txt'));
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
    await fsp.rm(teamRoot, { recursive: true, force: true });
  }
});

test('legacy private fallback includes tasks when primary root has none', async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'board-legacy-tasks-'));
  const rootDir = await fsp.realpath(tempDir);
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    const storage = createBoardStorage({
      rootDir,
      resolveRoots: () => ({
        privateRoot,
        teamRoot: null,
        sharedKnowledgeRoot: path.join(rootDir, 'knowledge'),
        personalKnowledgeRoot: path.join(rootDir, 'knowledge', 'personal'),
      }),
    });
    await fsp.mkdir(path.join(rootDir, 'project-board', 'tasks'), { recursive: true });
    await fsp.writeFile(path.join(rootDir, 'project-board', 'tasks', 'legacy_task.json'), JSON.stringify({
      id: 'legacy_task',
      project_id: 'legacy_project',
      title: 'Legacy Task',
      version: 1,
    }), 'utf8');

    const tasks = await storage.listTasks('private');
    assert.ok(tasks.some((t) => t.id === 'legacy_task'));
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(privateRoot, { recursive: true, force: true });
  }
});

test('legacy private fallback project can be deleted via service deleteProject', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot: null } });
  try {
    await fsp.mkdir(path.join(h.rootDir, 'project-board', 'projects'), { recursive: true });
    await fsp.mkdir(path.join(h.rootDir, 'project-board', 'tasks'), { recursive: true });
    await fsp.writeFile(path.join(h.rootDir, 'project-board', 'projects', 'legacy_project.json'), JSON.stringify({
      id: 'legacy_project',
      name: 'Legacy Project',
      visibility: 'private',
      owner_id: HUMAN_ACTOR.id,
      status: 'active',
      description: '',
      version: 1,
    }), 'utf8');
    await fsp.writeFile(path.join(h.rootDir, 'project-board', 'tasks', 'legacy_task.json'), JSON.stringify({
      id: 'legacy_task',
      project_id: 'legacy_project',
      title: 'Legacy Task',
      status: 'todo',
      priority: 'medium',
      assignee_type: 'unassigned',
      assignee_id: null,
      version: 1,
    }), 'utf8');

    const projectsBefore = await h.service.listProjects({}, HUMAN_ACTOR);
    assert.ok(projectsBefore.items.some((p) => p.id === 'legacy_project'));

    const deleted = await h.service.deleteProject('legacy_project', { version: 1, confirm: true }, HUMAN_ACTOR);
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.cascade_deleted_tasks, 1);

    const projectsAfter = await h.service.listProjects({}, HUMAN_ACTOR);
    assert.ok(!projectsAfter.items.some((p) => p.id === 'legacy_project'));
    const tasksAfter = await h.service.listTasks({ project_id: 'legacy_project' }, HUMAN_ACTOR);
    assert.equal(tasksAfter.items.length, 0);
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
  }
});

test('malformed task entity fails closed as storage corruption on direct read', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot: null } });
  try {
    const { task } = await h.createProjectAndTask();
    await fsp.writeFile(path.join(privateRoot, 'tasks', `${task.id}.json`), '{not json', 'utf8');
    await assert.rejects(
      h.service.getTask(task.id, HUMAN_ACTOR),
      (err) => err?.status === 500 && err?.code === 'storage_corruption',
    );
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
  }
});

test('board GET endpoints require auth when API token is configured', async () => {
  const port = 45500 + Math.floor(Math.random() * 400);
  const server = spawn(process.execPath, ['interface/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      STEADYMADE_INTERFACE_TOKEN: 'token_for_get_tests',
      BOARD_INTERNAL_TOKEN: 'board_secret_test_token',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const waitUntilReady = async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/system`);
        if (response.ok) return;
      } catch {
        // startup race
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('server did not start in time');
  };

  try {
    await waitUntilReady();
    const metadataNoToken = await fetch(`http://127.0.0.1:${port}/api/board/metadata`);
    assert.equal(metadataNoToken.status, 401);
    const projectsNoToken = await fetch(`http://127.0.0.1:${port}/api/projects`);
    assert.equal(projectsNoToken.status, 401);

    const metadataWithToken = await fetch(`http://127.0.0.1:${port}/api/board/metadata`, {
      headers: { 'x-steadymade-token': 'token_for_get_tests' },
    });
    assert.equal(metadataWithToken.status, 200);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
});

test('forged Origin/Referer headers do not bypass board auth when token is configured', async () => {
  const port = 45650 + Math.floor(Math.random() * 300);
  const server = spawn(process.execPath, ['interface/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      STEADYMADE_INTERFACE_TOKEN: 'token_for_origin_test',
      BOARD_INTERNAL_TOKEN: 'board_secret_test_token',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const waitUntilReady = async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/system`);
        if (response.ok) return;
      } catch {
        // startup race
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('server did not start in time');
  };

  try {
    await waitUntilReady();
    const forgedOrigin = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      headers: {
        origin: `http://localhost:${port}`,
        referer: `http://127.0.0.1:${port}/projects`,
      },
    });
    assert.equal(forgedOrigin.status, 401);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
});

test('DELETE project/task API routes enforce confirm/version and return board envelope', async () => {
  const port = 45780 + Math.floor(Math.random() * 300);
  const server = spawn(process.execPath, ['interface/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      STEADYMADE_INTERFACE_TOKEN: 'token_for_delete_routes',
      BOARD_INTERNAL_TOKEN: 'board_secret_test_token',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const headers = { 'content-type': 'application/json', 'x-steadymade-token': 'token_for_delete_routes' };

  const waitUntilReady = async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/system`);
        if (response.ok) return;
      } catch {
        // startup race
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('server did not start in time');
  };

  try {
    await waitUntilReady();
    const createdProjectRes = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: 'proj_api_delete', name: 'API Delete Project' }),
    });
    const createdProject = await createdProjectRes.json();
    assert.equal(createdProjectRes.status, 201);

    const createdTaskRes = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: 'task_api_delete',
        project_id: 'proj_api_delete',
        title: 'API Delete Task',
        status: 'todo',
        assignee_type: 'human',
        human_assignee_label: 'Manual owner',
      }),
    });
    const createdTask = await createdTaskRes.json();
    assert.equal(createdTaskRes.status, 201);

    const deleteTaskRes = await fetch(`http://127.0.0.1:${port}/api/tasks/task_api_delete`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ version: createdTask.data.version, confirm: true }),
    });
    const deleteTaskBody = await deleteTaskRes.json();
    assert.equal(deleteTaskRes.status, 200);
    assert.equal(deleteTaskBody.ok, true);
    assert.equal(deleteTaskBody.data.deleted, true);

    const deleteProjectRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj_api_delete`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ version: createdProject.data.version, confirm: true }),
    });
    const deleteProjectBody = await deleteProjectRes.json();
    assert.equal(deleteProjectRes.status, 200);
    assert.equal(deleteProjectBody.ok, true);
    assert.equal(deleteProjectBody.data.deleted, true);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
});

test('queued then directly succeeded callback transitions task to needs_review', async () => {
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();
    const run = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_queued_direct_success',
    }, HUMAN_ACTOR);

    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: run.task.execution.attempt_id,
      state: 'queued',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
    }, INTERNAL_ACTOR);

    const updated = await h.service.executionCallback({
      task_id: task.id,
      attempt_id: run.task.execution.attempt_id,
      state: 'succeeded',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
      result_summary: 'finished without started callback',
    }, INTERNAL_ACTOR);

    assert.equal(updated.execution.state, 'succeeded');
    assert.equal(updated.status, 'needs_review');
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('execution callback stores lifecycle updates and does not auto-link server artifacts', async () => {
  const secret = 'board_super_secret_value';
  const h = await createHarness({
    runtimeEnvVault: { BOARD_SECRET: secret },
    schedulerOptions: { runLogs: { run_1: `scheduler log includes ${secret}` } },
  });
  try {
    const { task } = await h.createProjectAndTask();
    const runResult = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_secret_redaction',
    }, HUMAN_ACTOR);

    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: runResult.task.execution.attempt_id,
      state: 'started',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
    }, INTERNAL_ACTOR);

    const updated = await h.service.executionCallback({
      task_id: task.id,
      attempt_id: runResult.task.execution.attempt_id,
      state: 'succeeded',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
      result_summary: `result carries ${secret}`,
    }, INTERNAL_ACTOR);

    assert.ok(Array.isArray(updated.execution.execution_updates));
    assert.ok(updated.execution.execution_updates.some((u) => u.state === 'running'));
    assert.ok(updated.execution.execution_updates.some((u) => u.state === 'succeeded'));
    assert.ok(!updated.linked_paths.some((p) => p.path.endsWith('/server-summary.txt')));
    assert.ok(!updated.linked_paths.some((p) => p.path.endsWith('/server-transcript.log')));

    const summaryPath = path.join(resolveAttemptOutputRootAbs(h.rootDir, runResult.task.execution.output_root, h.boardRoots), 'server-summary.txt');
    const transcriptPath = path.join(resolveAttemptOutputRootAbs(h.rootDir, runResult.task.execution.output_root, h.boardRoots), 'server-transcript.log');
    const summaryExists = await fsp.stat(summaryPath).then(() => true).catch(() => false);
    const transcriptExists = await fsp.stat(transcriptPath).then(() => true).catch(() => false);
    assert.equal(summaryExists, false);
    assert.equal(transcriptExists, false);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('migration resume resolves duplicated cross-scope project and keeps tasks', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const teamRoot = path.join(os.tmpdir(), `board-team-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot } });
  try {
    const { project, task } = await h.createProjectAndTask();
    const privateProject = {
      ...(await h.storage.readProject('private', project.id)),
      scope_migration: {
        operation_id: 'mig_resume_partial',
        from_visibility: 'private',
        to_visibility: 'team',
        from_scope: 'private',
        to_scope: 'team',
        state: 'staged',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };
    await h.storage.writeProject('private', project.id, privateProject, { expectedVersion: privateProject.version });
    const copied = { ...privateProject, visibility: 'team', version: 1 };
    await h.storage.writeProject('team', project.id, copied, { expectedVersion: null });
    await h.storage.writeTask('team', task.id, { ...(await h.storage.readTask('private', task.id)), visibility: 'team' }, { expectedVersion: null });

    const resumed = await h.service.migrateProjectVisibility(project.id, {
      version: privateProject.version,
      to_visibility: 'team',
      operation_id: 'mig_resume_partial',
      action: 'resume',
    }, HUMAN_ACTOR);

    assert.equal(resumed.visibility, 'team');
    assert.equal(resumed.scope_migration.state, 'completed');
    assert.equal(await h.storage.readProject('private', project.id), null);
    const listed = await h.service.listTasks({ project_id: project.id }, HUMAN_ACTOR);
    assert.ok(listed.items.some((t) => t.id === task.id));
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
    await fsp.rm(teamRoot, { recursive: true, force: true });
  }
});

test('migration rollback from duplicated partial state restores source scope', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const teamRoot = path.join(os.tmpdir(), `board-team-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot } });
  try {
    const { project, task } = await h.createProjectAndTask();
    const privateProject = {
      ...(await h.storage.readProject('private', project.id)),
      scope_migration: {
        operation_id: 'mig_rollback_partial',
        from_visibility: 'private',
        to_visibility: 'team',
        from_scope: 'private',
        to_scope: 'team',
        state: 'copied',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };
    await h.storage.writeProject('private', project.id, privateProject, { expectedVersion: privateProject.version });
    await h.storage.writeProject('team', project.id, { ...privateProject, visibility: 'team', version: 1 }, { expectedVersion: null });
    await h.storage.writeTask('team', task.id, { ...(await h.storage.readTask('private', task.id)), visibility: 'team' }, { expectedVersion: null });

    const rolledBack = await h.service.migrateProjectVisibility(project.id, {
      version: privateProject.version,
      to_visibility: 'team',
      operation_id: 'mig_rollback_partial',
      action: 'rollback',
    }, HUMAN_ACTOR);

    assert.equal(rolledBack.visibility, 'private');
    assert.equal(rolledBack.scope_migration.state, 'rolled_back');
    assert.equal(await h.storage.readProject('team', project.id), null);
    const listed = await h.service.listTasks({ project_id: project.id }, HUMAN_ACTOR);
    assert.ok(listed.items.some((t) => t.id === task.id));
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
    await fsp.rm(teamRoot, { recursive: true, force: true });
  }
});

test('migration resume preserves target-only tasks and copies missing source tasks', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const teamRoot = path.join(os.tmpdir(), `board-team-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot } });
  try {
    const project = await h.service.createProject({ id: 'proj_resume_tasks', name: 'Resume Tasks', visibility: 'private' }, HUMAN_ACTOR);
    const taskA = await h.service.createTask({
      id: 'task_resume_a',
      project_id: project.id,
      title: 'Task A',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
    }, HUMAN_ACTOR);
    const taskB = await h.service.createTask({
      id: 'task_resume_b',
      project_id: project.id,
      title: 'Task B',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
    }, HUMAN_ACTOR);

    const sourceProject = {
      ...(await h.storage.readProject('private', project.id)),
      scope_migration: {
        operation_id: 'mig_resume_no_loss',
        from_visibility: 'private',
        to_visibility: 'team',
        from_scope: 'private',
        to_scope: 'team',
        state: 'copied',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };
    await h.storage.writeProject('private', project.id, sourceProject, { expectedVersion: sourceProject.version });
    await h.storage.writeProject('team', project.id, { ...sourceProject, visibility: 'team', version: 1 }, { expectedVersion: null });
    await h.storage.writeTask('team', taskA.id, { ...(await h.storage.readTask('private', taskA.id)), visibility: 'team' }, { expectedVersion: null });
    await h.storage.writeTask('team', 'task_resume_c', {
      ...(await h.storage.readTask('private', taskA.id)),
      id: 'task_resume_c',
      title: 'Task C (target-only)',
      visibility: 'team',
    }, { expectedVersion: null });

    await h.service.migrateProjectVisibility(project.id, {
      version: sourceProject.version,
      to_visibility: 'team',
      operation_id: 'mig_resume_no_loss',
      action: 'resume',
    }, HUMAN_ACTOR);

    const listed = await h.service.listTasks({ project_id: project.id }, HUMAN_ACTOR);
    const ids = listed.items.map((t) => t.id);
    assert.ok(ids.includes(taskA.id));
    assert.ok(ids.includes(taskB.id));
    assert.ok(ids.includes('task_resume_c'));
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
    await fsp.rm(teamRoot, { recursive: true, force: true });
  }
});

test('team divergence fail-closed applies to list and read operations', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const teamRoot = path.join(os.tmpdir(), `board-team-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fsp.mkdir(path.join(teamRoot, 'projects'), { recursive: true });
  await fsp.mkdir(path.join(teamRoot, 'tasks'), { recursive: true });
  await fsp.writeFile(path.join(teamRoot, 'projects', 'proj_team_read.json'), JSON.stringify({
    id: 'proj_team_read',
    name: 'Team Read',
    visibility: 'team',
    owner_id: HUMAN_ACTOR.id,
    version: 1,
  }), 'utf8');
  await fsp.writeFile(path.join(teamRoot, 'projects', 'proj_team_read (conflict copy).json'), '{}', 'utf8');
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot } });
  try {
    await assert.rejects(
      h.service.listProjects({}, HUMAN_ACTOR),
      (err) => err?.status === 503 && err?.code === 'team_scope_read_only',
    );
    await assert.rejects(
      h.service.getProject('proj_team_read', HUMAN_ACTOR),
      (err) => err?.status === 503 && err?.code === 'team_scope_read_only',
    );
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
    await fsp.rm(teamRoot, { recursive: true, force: true });
  }
});
