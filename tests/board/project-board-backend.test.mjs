import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import { createBoardStorage } from '../../interface/board/storage.mjs';
import { createBoardService } from '../../interface/board/service.mjs';
import { validateLinkedPaths } from '../../interface/board/validators.mjs';

const HUMAN_ACTOR = { id: 'user_alpha', isHuman: true, isInternal: false };
const REVIEWER_ACTOR = { id: 'reviewer_alpha', isHuman: true, isInternal: false };
const INTERNAL_ACTOR = { id: 'internal_callback', isHuman: false, isInternal: true };

const SYNC_PATH_HINTS = [
  'onedrive',
  'dropbox',
  'google drive',
  'icloud drive',
  'nextcloud',
  'syncthing',
  'synologydrive',
  'box',
  'sharepoint',
];

let testTempSeq = 0;

function pathLooksSyncLike(absPath) {
  const lower = String(absPath || '').toLowerCase();
  return SYNC_PATH_HINTS.some((hint) => lower.includes(hint));
}

async function createDeterministicTempDir(label, { requireNonSyncLike = false } = {}) {
  // Keep test paths deterministic and numeric-only to avoid accidental sync-hint
  // substrings (for example "box") from random temp suffixes.
  const candidateParents = [
    os.tmpdir(),
    '/private/tmp',
    '/tmp',
  ];

  for (const candidateParent of candidateParents) {
    const parent = path.resolve(candidateParent);
    if (requireNonSyncLike && pathLooksSyncLike(parent)) continue;

    const base = path.join(parent, 'steadymade-ai-os-tests', label);
    if (requireNonSyncLike && pathLooksSyncLike(base)) continue;

    try {
      await fsp.mkdir(base, { recursive: true });
    } catch {
      continue;
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      testTempSeq += 1;
      const suffix = `${Date.now()}-${process.pid}-${testTempSeq}`;
      const dir = path.join(base, suffix);
      if (requireNonSyncLike && pathLooksSyncLike(dir)) continue;
      try {
        await fsp.mkdir(dir, { recursive: false });
        return await fsp.realpath(dir);
      } catch {
        // try next deterministic suffix or parent candidate
      }
    }
  }

  throw new Error(`failed to allocate deterministic temp directory for ${label}`);
}

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

async function createHarness({ schedulerOptions, runtimeMode = 'claude-subscription', runtimeEnvVault = {}, boardRoots = null, deploymentState = null } = {}) {
  const rootDir = await createDeterministicTempDir('board-backend-tests', { requireNonSyncLike: true });
  const runtimeRoot = await createDeterministicTempDir('board-storage-kernel-runtime', { requireNonSyncLike: true });
  const scheduler = createFakeScheduler(schedulerOptions);
  if (boardRoots?.privateRoot) await fsp.mkdir(boardRoots.privateRoot, { recursive: true });
  if (boardRoots?.teamRoot) await fsp.mkdir(boardRoots.teamRoot, { recursive: true });
  const storage = createBoardStorage({
    rootDir,
    runtimeRootOverride: runtimeRoot,
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
    ...(deploymentState ? { resolveDeploymentState: async () => deploymentState } : {}),
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
    runtimeRoot,
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

async function createCompletedAttemptWithArtifact(h, { task, fileName = 'result.txt', content = 'ok' }) {
  const runResult = await h.service.runTask(task.id, {
    version: task.version,
    idempotency_key: `idem_${task.id}_${Date.now()}`,
  }, HUMAN_ACTOR);
  const outputRoot = resolveAttemptOutputRootAbs(h.rootDir, runResult.task.execution.output_root, h.boardRoots);
  await fsp.mkdir(outputRoot, { recursive: true });
  await fsp.writeFile(path.join(outputRoot, fileName), content, 'utf8');
  await h.service.executionCallback({
    task_id: task.id,
    attempt_id: runResult.task.execution.attempt_id,
    state: 'started',
    scheduler_job_id: 'job_1',
    scheduler_run_id: 'run_1',
  }, INTERNAL_ACTOR);
  const done = await h.service.executionCallback({
    task_id: task.id,
    attempt_id: runResult.task.execution.attempt_id,
    state: 'succeeded',
    scheduler_job_id: 'job_1',
    scheduler_run_id: 'run_1',
    result_summary: 'ok',
  }, INTERNAL_ACTOR);
  return { runResult, done, outputRoot };
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

test('activities CRUD lifecycle works', async () => {
  const h = await createHarness();
  try {
    const created = await h.service.createActivity({
      id: 'activity_alpha',
      name: 'Activity Alpha',
      description: 'ongoing stream',
      status: 'active',
      visibility: 'private',
      tags: ['ops'],
      custom_fields: { lane: 'delivery' },
    }, HUMAN_ACTOR);
    assert.equal(created.id, 'activity_alpha');

    const listed = await h.service.listActivities({}, HUMAN_ACTOR);
    assert.ok(listed.items.some((item) => item.id === created.id));

    const fetched = await h.service.getActivity(created.id, HUMAN_ACTOR);
    assert.equal(fetched.name, 'Activity Alpha');

    const patched = await h.service.patchActivity(created.id, {
      version: fetched.version,
      name: 'Activity Alpha Updated',
      status: 'paused',
    }, HUMAN_ACTOR);
    assert.equal(patched.name, 'Activity Alpha Updated');
    assert.equal(patched.status, 'paused');

    const deleted = await h.service.deleteActivity(created.id, {
      version: patched.version,
      confirm: true,
    }, HUMAN_ACTOR);
    assert.equal(deleted.deleted, true);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('task create supports inbox task without project/activity', async () => {
  const h = await createHarness();
  try {
    const task = await h.service.createTask({
      id: 'task_inbox_alpha',
      title: 'Inbox Task',
      assignee_type: 'unassigned',
      status: 'todo',
    }, HUMAN_ACTOR);

    assert.equal(task.project_id, null);
    assert.equal(task.activity_id, null);
    assert.equal(task.visibility, 'private');

    const fetched = await h.service.getTask(task.id, HUMAN_ACTOR);
    assert.equal(fetched.id, task.id);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('task create supports activity-linked tasks and activity_id filter', async () => {
  const h = await createHarness();
  try {
    const activity = await h.service.createActivity({
      id: 'activity_task_link',
      name: 'Activity Task Link',
      visibility: 'private',
    }, HUMAN_ACTOR);

    const task = await h.service.createTask({
      id: 'task_activity_alpha',
      activity_id: activity.id,
      title: 'Activity Task',
      assignee_type: 'unassigned',
      status: 'todo',
    }, HUMAN_ACTOR);
    assert.equal(task.activity_id, activity.id);
    assert.equal(task.project_id, null);

    const listed = await h.service.listTasks({ activity_id: activity.id }, HUMAN_ACTOR);
    assert.ok(listed.items.some((item) => item.id === task.id));
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('task create rejects invalid project/activity references', async () => {
  const h = await createHarness();
  try {
    const project = await h.service.createProject({ id: 'proj_ref_check', name: 'Ref Check' }, HUMAN_ACTOR);
    const activity = await h.service.createActivity({ id: 'activity_ref_check', name: 'Activity Ref Check' }, HUMAN_ACTOR);

    await expectBoardErrorStatus(h.service.createTask({
      id: 'task_bad_project_ref',
      title: 'Bad Project Ref',
      project_id: 'proj_missing',
    }, HUMAN_ACTOR), 422);

    await expectBoardErrorStatus(h.service.createTask({
      id: 'task_bad_activity_ref',
      title: 'Bad Activity Ref',
      activity_id: 'activity_missing',
    }, HUMAN_ACTOR), 422);

    await expectBoardErrorStatus(h.service.createTask({
      id: 'task_both_links',
      title: 'Both Links',
      project_id: project.id,
      activity_id: activity.id,
    }, HUMAN_ACTOR), 422);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('task create keeps existing project-linked flow working', async () => {
  const h = await createHarness();
  try {
    const project = await h.service.createProject({ id: 'proj_linked_flow', name: 'Linked Flow' }, HUMAN_ACTOR);
    const task = await h.service.createTask({
      id: 'task_project_linked_flow',
      project_id: project.id,
      title: 'Project Linked Task',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
    }, HUMAN_ACTOR);
    assert.equal(task.project_id, project.id);
    assert.equal(task.activity_id, null);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('task patch set_activity_id supports set and clear for inbox tasks', async () => {
  const h = await createHarness();
  try {
    const activity = await h.service.createActivity({
      id: 'activity_patch_link',
      name: 'Activity Patch Link',
      visibility: 'private',
    }, HUMAN_ACTOR);
    const task = await h.service.createTask({
      id: 'task_patch_activity_link',
      title: 'Task patch activity',
      assignee_type: 'unassigned',
      status: 'todo',
    }, HUMAN_ACTOR);

    const linked = await h.service.patchTask(task.id, {
      version: task.version,
      ops: [{ op: 'set_activity_id', value: activity.id }],
    }, HUMAN_ACTOR);
    assert.equal(linked.activity_id, activity.id);
    assert.equal(linked.project_id, null);

    const cleared = await h.service.patchTask(task.id, {
      version: linked.version,
      ops: [{ op: 'set_activity_id', value: '' }],
    }, HUMAN_ACTOR);
    assert.equal(cleared.activity_id, null);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('task patch set_activity_id enforces validation rules', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const teamRoot = path.join(os.tmpdir(), `board-team-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot } });
  try {
    const project = await h.service.createProject({ id: 'proj_patch_activity_rules', name: 'Patch Activity Rules' }, HUMAN_ACTOR);
    const privateActivity = await h.service.createActivity({ id: 'activity_patch_rules_private', name: 'Private Activity', visibility: 'private' }, HUMAN_ACTOR);
    const teamActivity = await h.service.createActivity({ id: 'activity_patch_rules_team', name: 'Team Activity', visibility: 'team' }, HUMAN_ACTOR);
    const projectTask = await h.service.createTask({
      id: 'task_patch_activity_project_linked',
      project_id: project.id,
      title: 'Project linked task',
      assignee_type: 'unassigned',
      status: 'todo',
    }, HUMAN_ACTOR);
    const inboxTask = await h.service.createTask({
      id: 'task_patch_activity_inbox',
      title: 'Inbox task',
      assignee_type: 'unassigned',
      status: 'todo',
    }, HUMAN_ACTOR);

    await expectBoardErrorStatus(h.service.patchTask(projectTask.id, {
      version: projectTask.version,
      ops: [{ op: 'set_activity_id', value: privateActivity.id }],
    }, HUMAN_ACTOR), 422);

    await expectBoardErrorStatus(h.service.patchTask(inboxTask.id, {
      version: inboxTask.version,
      ops: [{ op: 'set_activity_id', value: 'activity_missing' }],
    }, HUMAN_ACTOR), 422);

    await expectBoardErrorStatus(h.service.patchTask(inboxTask.id, {
      version: inboxTask.version,
      ops: [{ op: 'set_activity_id', value: teamActivity.id }],
    }, HUMAN_ACTOR), 422);
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
    await fsp.rm(teamRoot, { recursive: true, force: true });
  }
});

test('task patch set_project_id supports set and clear for inbox tasks', async () => {
  const h = await createHarness();
  try {
    const project = await h.service.createProject({
      id: 'proj_patch_link',
      name: 'Project Patch Link',
      visibility: 'private',
    }, HUMAN_ACTOR);
    const task = await h.service.createTask({
      id: 'task_patch_project_link',
      title: 'Task patch project',
      assignee_type: 'unassigned',
      status: 'todo',
    }, HUMAN_ACTOR);

    const linked = await h.service.patchTask(task.id, {
      version: task.version,
      ops: [{ op: 'set_project_id', value: project.id }],
    }, HUMAN_ACTOR);
    assert.equal(linked.project_id, project.id);
    assert.equal(linked.activity_id, null);

    const cleared = await h.service.patchTask(task.id, {
      version: linked.version,
      ops: [{ op: 'set_project_id', value: null }],
    }, HUMAN_ACTOR);
    assert.equal(cleared.project_id, null);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('task patch supports project/activity relinking with exclusivity and scope checks', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const teamRoot = path.join(os.tmpdir(), `board-team-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot } });
  try {
    const privateProject = await h.service.createProject({ id: 'proj_patch_relink_private', name: 'Private Relink Project', visibility: 'private' }, HUMAN_ACTOR);
    const teamProject = await h.service.createProject({ id: 'proj_patch_relink_team', name: 'Team Relink Project', visibility: 'team' }, HUMAN_ACTOR);
    const activity = await h.service.createActivity({ id: 'activity_patch_relink_private', name: 'Private Relink Activity', visibility: 'private' }, HUMAN_ACTOR);
    const task = await h.service.createTask({
      id: 'task_patch_relink_chain',
      title: 'Relink chain task',
      assignee_type: 'unassigned',
      status: 'todo',
    }, HUMAN_ACTOR);

    const projectLinked = await h.service.patchTask(task.id, {
      version: task.version,
      ops: [{ op: 'set_project_id', value: privateProject.id }],
    }, HUMAN_ACTOR);
    assert.equal(projectLinked.project_id, privateProject.id);
    assert.equal(projectLinked.activity_id, null);

    await expectBoardErrorStatus(h.service.patchTask(task.id, {
      version: projectLinked.version,
      ops: [{ op: 'set_activity_id', value: activity.id }],
    }, HUMAN_ACTOR), 422);

    const activityLinked = await h.service.patchTask(task.id, {
      version: projectLinked.version,
      ops: [
        { op: 'set_project_id', value: '' },
        { op: 'set_activity_id', value: activity.id },
      ],
    }, HUMAN_ACTOR);
    assert.equal(activityLinked.project_id, null);
    assert.equal(activityLinked.activity_id, activity.id);

    const relinkedProject = await h.service.patchTask(task.id, {
      version: activityLinked.version,
      ops: [
        { op: 'set_activity_id', value: null },
        { op: 'set_project_id', value: privateProject.id },
      ],
    }, HUMAN_ACTOR);
    assert.equal(relinkedProject.project_id, privateProject.id);
    assert.equal(relinkedProject.activity_id, null);

    const inboxAgain = await h.service.patchTask(task.id, {
      version: relinkedProject.version,
      ops: [{ op: 'set_project_id', value: '' }],
    }, HUMAN_ACTOR);
    assert.equal(inboxAgain.project_id, null);
    assert.equal(inboxAgain.activity_id, null);

    await expectBoardErrorStatus(h.service.patchTask(task.id, {
      version: inboxAgain.version,
      ops: [{ op: 'set_project_id', value: 'proj_missing' }],
    }, HUMAN_ACTOR), 422);

    await expectBoardErrorStatus(h.service.patchTask(task.id, {
      version: inboxAgain.version,
      ops: [{ op: 'set_project_id', value: teamProject.id }],
    }, HUMAN_ACTOR), 422);
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
    await fsp.rm(teamRoot, { recursive: true, force: true });
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

test('team scope mutations fail closed with TEAM_CAPABILITY_UNAVAILABLE when team capability is disabled', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({
    boardRoots: {
      privateRoot,
      teamRoot: null,
    },
    deploymentState: {
      requestedDeployment: 'team-server',
      effectiveDeployment: 'local-only',
      teamCapability: {
        status: 'disabled',
        reason: 'TEAM_ROOT_UNCONFIGURED',
      },
    },
  });
  try {
    await assert.rejects(
      h.service.createProject({
        id: 'proj_team_missing_root',
        name: 'Team Missing Root',
        visibility: 'team',
      }, HUMAN_ACTOR),
      (err) => err?.status === 503 && err?.code === 'TEAM_CAPABILITY_UNAVAILABLE',
    );

    const privateProject = await h.service.createProject({
      id: 'proj_private_ok_when_team_disabled',
      name: 'Private stays available',
      visibility: 'private',
    }, HUMAN_ACTOR);
    assert.equal(privateProject.visibility, 'private');

    const privateTask = await h.service.createTask({
      id: 'task_private_ok_when_team_disabled',
      project_id: privateProject.id,
      title: 'Private task works',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
    }, HUMAN_ACTOR);
    assert.equal(privateTask.visibility, 'private');
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
  }
});

test('metadata visibility options hide team in local-only deployment state', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const teamRoot = path.join(os.tmpdir(), `board-team-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({
    boardRoots: { privateRoot, teamRoot },
    deploymentState: {
      requestedDeployment: 'local-only',
      effectiveDeployment: 'local-only',
      teamCapability: {
        status: 'disabled',
        reason: 'USER_TYPE_LOCAL_ONLY',
      },
    },
  });
  try {
    const metadata = await h.service.getMetadata();
    assert.deepEqual(metadata.visibility_options, ['private']);
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
    await fsp.rm(teamRoot, { recursive: true, force: true });
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

test('opaque artifact ID lookup works and legacy resolver maps through catalog', async () => {
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();
    const { done } = await createCompletedAttemptWithArtifact(h, { task, fileName: 'opaque.txt', content: 'opaque ok' });
    const refreshed = await h.service.getTask(task.id, HUMAN_ACTOR);
    const attempt = refreshed.execution.attempts.find((a) => a.attempt_id === done.execution.attempt_id);
    assert.ok(attempt);
    assert.ok(Array.isArray(attempt.artifacts));
    assert.equal(attempt.artifacts.length, 1);
    const artifactId = attempt.artifacts[0].artifact_id;
    assert.ok(artifactId);

    const byId = await h.service.readArtifactById({ artifactId, actor: HUMAN_ACTOR });
    assert.ok(byId.abs.endsWith('opaque.txt'));
    assert.equal(byId.artifact_id, artifactId);

    const viaLegacy = await h.service.readTaskArtifact({
      taskId: task.id,
      attemptId: done.execution.attempt_id,
      artifactPath: 'opaque.txt',
      actor: HUMAN_ACTOR,
    });
    assert.equal(viaLegacy.artifact_id, artifactId);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('opaque artifact read revalidates hash and quarantines post-catalog replacement', async () => {
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();
    const { done, outputRoot } = await createCompletedAttemptWithArtifact(h, { task, fileName: 'replace.txt', content: 'v1' });
    const refreshed = await h.service.getTask(task.id, HUMAN_ACTOR);
    const attempt = refreshed.execution.attempts.find((a) => a.attempt_id === done.execution.attempt_id);
    const artifactId = attempt.artifacts[0].artifact_id;
    const artifactAbs = path.join(outputRoot, 'replace.txt');

    await fsp.writeFile(artifactAbs, 'tampered', 'utf8');

    await assert.rejects(
      h.service.readArtifactById({ artifactId, actor: HUMAN_ACTOR }),
      (err) => err?.status === 409 && err?.code === 'artifact_integrity_mismatch',
    );

    const stillAtOriginalPath = await fsp.stat(artifactAbs).then(() => true).catch(() => false);
    assert.equal(stillAtOriginalPath, false);

    const quarantineDir = path.join(h.boardRoots.privateRoot, 'artifacts', 'project-board', 'quarantine');
    const quarantinedEntries = await fsp.readdir(quarantineDir).catch(() => []);
    assert.ok(quarantinedEntries.length >= 1);
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('artifact traversal is rejected and symlink artifacts are not cataloged', async () => {
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();
    const run = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_symlink_reject',
    }, HUMAN_ACTOR);
    const outputRoot = resolveAttemptOutputRootAbs(h.rootDir, run.task.execution.output_root, h.boardRoots);
    await fsp.mkdir(outputRoot, { recursive: true });
    await fsp.writeFile(path.join(outputRoot, 'real.txt'), 'real', 'utf8');
    await fsp.symlink(path.join(outputRoot, 'real.txt'), path.join(outputRoot, 'link.txt'));

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

    const refreshed = await h.service.getTask(task.id, HUMAN_ACTOR);
    const attempt = refreshed.execution.attempts.find((a) => a.attempt_id === done.execution.attempt_id);
    assert.equal(attempt.artifacts.length, 1);
    assert.ok(attempt.artifacts[0].path.endsWith('real.txt'));

    await assert.rejects(
      h.service.readTaskArtifact({
        taskId: task.id,
        attemptId: done.execution.attempt_id,
        artifactPath: '../secrets.txt',
        actor: HUMAN_ACTOR,
      }),
      (err) => err?.status === 422,
    );
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('opaque artifact read denies cross-owner and writes audit rows without path leakage', async () => {
  const h = await createHarness();
  const otherActor = { id: 'user_beta', isHuman: true, isInternal: false };
  try {
    const { task } = await h.createProjectAndTask();
    const { done } = await createCompletedAttemptWithArtifact(h, { task, fileName: 'audit.txt', content: 'audit ok' });
    const refreshed = await h.service.getTask(task.id, HUMAN_ACTOR);
    const attempt = refreshed.execution.attempts.find((a) => a.attempt_id === done.execution.attempt_id);
    const artifactId = attempt.artifacts[0].artifact_id;

    await assert.rejects(
      h.service.readArtifactById({ artifactId, actor: otherActor }),
      (err) => err?.status === 403,
    );

    const db = new DatabaseSync(h.storage.getPrivateDbPath());
    try {
      const rows = db.prepare('SELECT operation, result, artifact_reference FROM board_artifact_access_audit ORDER BY id DESC LIMIT 5').all();
      assert.ok(rows.some((r) => r.operation === 'read' && r.result === 'denied'));
      assert.ok(rows.every((r) => !String(r.artifact_reference || '').includes(h.rootDir)));
    } finally {
      db.close();
    }
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('artifact policy rejects disallowed types and oversized payloads', async () => {
  const prevTypes = process.env.BOARD_ARTIFACT_ALLOWED_CONTENT_TYPES;
  const prevMax = process.env.BOARD_ARTIFACT_MAX_BYTES;
  process.env.BOARD_ARTIFACT_ALLOWED_CONTENT_TYPES = 'text/plain';
  process.env.BOARD_ARTIFACT_MAX_BYTES = '8';
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();

    const runType = await h.service.runTask(task.id, {
      version: task.version,
      idempotency_key: 'idem_type_reject',
    }, HUMAN_ACTOR);
    const outputType = resolveAttemptOutputRootAbs(h.rootDir, runType.task.execution.output_root, h.boardRoots);
    await fsp.mkdir(outputType, { recursive: true });
    await fsp.writeFile(path.join(outputType, 'result.json'), '{"ok":true}', 'utf8');
    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: runType.task.execution.attempt_id,
      state: 'started',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
    }, INTERNAL_ACTOR);
    await assert.rejects(
      h.service.executionCallback({
        task_id: task.id,
        attempt_id: runType.task.execution.attempt_id,
        state: 'succeeded',
        scheduler_job_id: 'job_1',
        scheduler_run_id: 'run_1',
        result_summary: 'nope',
      }, INTERNAL_ACTOR),
      (err) => err?.status === 422 && err?.code === 'artifact_type_rejected',
    );
    await fsp.unlink(path.join(outputType, 'result.json')).catch(() => {});
    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: runType.task.execution.attempt_id,
      state: 'failed',
      scheduler_job_id: 'job_1',
      scheduler_run_id: 'run_1',
      failure_summary: 'policy rejected type',
    }, INTERNAL_ACTOR);

    const taskAfterType = await h.service.getTask(task.id, HUMAN_ACTOR);
    const runSize = await h.service.retryTask(task.id, {
      version: taskAfterType.version,
      idempotency_key: 'idem_size_reject',
    }, HUMAN_ACTOR);
    const outputSize = resolveAttemptOutputRootAbs(h.rootDir, runSize.task.execution.output_root, h.boardRoots);
    await fsp.mkdir(outputSize, { recursive: true });
    await fsp.writeFile(path.join(outputSize, 'big.txt'), '0123456789abcdef', 'utf8');
    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: runSize.task.execution.attempt_id,
      state: 'started',
      scheduler_job_id: 'job_2',
      scheduler_run_id: 'run_2',
    }, INTERNAL_ACTOR);
    await assert.rejects(
      h.service.executionCallback({
        task_id: task.id,
        attempt_id: runSize.task.execution.attempt_id,
        state: 'succeeded',
        scheduler_job_id: 'job_2',
        scheduler_run_id: 'run_2',
        result_summary: 'too big',
      }, INTERNAL_ACTOR),
      (err) => err?.status === 422 && err?.code === 'artifact_size_rejected',
    );
    await fsp.unlink(path.join(outputSize, 'big.txt')).catch(() => {});
    await h.service.executionCallback({
      task_id: task.id,
      attempt_id: runSize.task.execution.attempt_id,
      state: 'failed',
      scheduler_job_id: 'job_2',
      scheduler_run_id: 'run_2',
      failure_summary: 'policy rejected size',
    }, INTERNAL_ACTOR);
  } finally {
    if (prevTypes === undefined) delete process.env.BOARD_ARTIFACT_ALLOWED_CONTENT_TYPES;
    else process.env.BOARD_ARTIFACT_ALLOWED_CONTENT_TYPES = prevTypes;
    if (prevMax === undefined) delete process.env.BOARD_ARTIFACT_MAX_BYTES;
    else process.env.BOARD_ARTIFACT_MAX_BYTES = prevMax;
    await cleanupRoot(h.rootDir);
  }
});

test('artifact delete applies retention semantics and marks catalog row deleted', async () => {
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();
    const { done, outputRoot } = await createCompletedAttemptWithArtifact(h, { task, fileName: 'delete.txt', content: 'delete me' });
    const refreshed = await h.service.getTask(task.id, HUMAN_ACTOR);
    const attempt = refreshed.execution.attempts.find((a) => a.attempt_id === done.execution.attempt_id);
    const artifactId = attempt.artifacts[0].artifact_id;
    const artifactAbs = path.join(outputRoot, 'delete.txt');
    assert.equal(await fsp.stat(artifactAbs).then(() => true).catch(() => false), true);

    const deleted = await h.service.deleteArtifactById({ artifactId, actor: HUMAN_ACTOR, reason: 'retention_cleanup' });
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.retention_class, 'task_attempt');
    assert.equal(deleted.deletion.guarantee, 'best_effort');
    assert.equal(await fsp.stat(artifactAbs).then(() => true).catch(() => false), false);

    const db = new DatabaseSync(h.storage.getPrivateDbPath());
    try {
      const row = db.prepare('SELECT deleted_at, deleted_reason, retention_class FROM board_task_execution_artifacts WHERE artifact_id = ?').get(artifactId);
      assert.ok(row.deleted_at);
      assert.equal(row.deleted_reason, 'retention_cleanup');
      assert.equal(row.retention_class, 'task_attempt');
    } finally {
      db.close();
    }
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

test('enhanced task management fields persist and read in private SQLite + team JSON scope', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const teamRoot = path.join(os.tmpdir(), `board-team-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot } });
  try {
    const privateProject = await h.service.createProject({ id: 'proj_enhanced_priv', name: 'Enhanced Private' }, HUMAN_ACTOR);
    const privateTask = await h.service.createTask({
      id: 'task_enhanced_priv',
      project_id: privateProject.id,
      title: 'Enhanced Private Task',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
      work_type: 'tech_debt',
      component_tags: ['api', 'worker'],
      sprint: 'Sprint 12',
      story_points: 8,
      completion_percent: 35,
      dependencies: ['task_alpha'],
      external_links: [{ label: 'Spec', url: 'https://example.com/spec' }],
      custom_fields: { env: 'staging', gated: true, budget: 123 },
    }, HUMAN_ACTOR);

    const privateRead = await h.service.getTask(privateTask.id, HUMAN_ACTOR);
    assert.equal(privateRead.work_type, 'tech_debt');
    assert.deepEqual(privateRead.component_tags, ['api', 'worker']);
    assert.equal(privateRead.sprint, 'Sprint 12');
    assert.equal(privateRead.story_points, 8);
    assert.equal(privateRead.completion_percent, 35);
    assert.deepEqual(privateRead.dependencies, ['task_alpha']);
    assert.deepEqual(privateRead.external_links, [{ label: 'Spec', url: 'https://example.com/spec' }]);
    assert.deepEqual(privateRead.custom_fields, { env: 'staging', gated: true, budget: 123 });

    const db = new DatabaseSync(h.storage.getPrivateDbPath());
    try {
      const row = db.prepare('SELECT work_type, sprint, story_points, completion_percent FROM board_tasks WHERE scope = ? AND id = ?').get('private', privateTask.id);
      assert.equal(row.work_type, 'tech_debt');
      assert.equal(row.sprint, 'Sprint 12');
      assert.equal(Number(row.story_points), 8);
      assert.equal(Number(row.completion_percent), 35);
    } finally {
      db.close();
    }

    const teamProject = await h.service.createProject({ id: 'proj_enhanced_team', name: 'Enhanced Team', visibility: 'team' }, HUMAN_ACTOR);
    const teamTask = await h.service.createTask({
      id: 'task_enhanced_team',
      project_id: teamProject.id,
      title: 'Enhanced Team Task',
      assignee_type: 'human',
      human_assignee_label: 'Team Owner',
      work_type: 'spike',
      component_tags: ['frontend'],
      sprint: 'Sprint Team',
      story_points: 3,
      completion_percent: 10,
      dependencies: ['task_alpha'],
      external_links: [{ label: 'Ticket', url: 'https://example.com/ticket/123' }],
      custom_fields: { flagged: false },
    }, HUMAN_ACTOR);
    const teamStored = await h.storage.readTask('team', teamTask.id);
    assert.equal(teamStored.work_type, 'spike');
    assert.deepEqual(teamStored.component_tags, ['frontend']);
    assert.equal(teamStored.sprint, 'Sprint Team');
    assert.equal(teamStored.story_points, 3);
    assert.equal(teamStored.completion_percent, 10);
    assert.deepEqual(teamStored.dependencies, ['task_alpha']);
    assert.deepEqual(teamStored.external_links, [{ label: 'Ticket', url: 'https://example.com/ticket/123' }]);
    assert.deepEqual(teamStored.custom_fields, { flagged: false });
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
    await fsp.rm(teamRoot, { recursive: true, force: true });
  }
});

test('enhanced patch ops validate ranges, ids, urls and custom field values', async () => {
  const h = await createHarness();
  try {
    const { task } = await h.createProjectAndTask();
    const updated = await h.service.patchTask(task.id, {
      version: task.version,
      ops: [
        { op: 'set_work_type', value: 'bug' },
        { op: 'set_component_tags', value: ['api', 'db'] },
        { op: 'set_sprint', value: 'Sprint Z' },
        { op: 'set_story_points', value: 13 },
        { op: 'set_completion_percent', value: 55 },
        { op: 'set_dependencies', value: ['task_alpha'] },
        { op: 'set_external_links', value: [{ label: 'Runbook', url: 'https://example.com/runbook' }] },
        { op: 'set_custom_fields', value: { complexity: 5, requires_qa: true, note: 'ready' } },
      ],
    }, HUMAN_ACTOR);
    assert.equal(updated.work_type, 'bug');
    assert.equal(updated.story_points, 13);
    assert.equal(updated.completion_percent, 55);

    await assert.rejects(
      h.service.patchTask(task.id, {
        version: updated.version,
        ops: [{ op: 'set_completion_percent', value: 101 }],
      }, HUMAN_ACTOR),
      (err) => err?.status === 422,
    );

    await assert.rejects(
      h.service.patchTask(task.id, {
        version: updated.version,
        ops: [{ op: 'set_dependencies', value: ['BAD-ID'] }],
      }, HUMAN_ACTOR),
      (err) => err?.status === 422,
    );

    await assert.rejects(
      h.service.patchTask(task.id, {
        version: updated.version,
        ops: [{ op: 'set_external_links', value: [{ label: 'Bad', url: 'ftp://example.com/nope' }] }],
      }, HUMAN_ACTOR),
      (err) => err?.status === 422,
    );

    await assert.rejects(
      h.service.patchTask(task.id, {
        version: updated.version,
        ops: [{ op: 'set_custom_fields', value: { nested: { a: 1 } } }],
      }, HUMAN_ACTOR),
      (err) => err?.status === 422,
    );
  } finally {
    await cleanupRoot(h.rootDir);
  }
});

test('project dashboard aggregates task tracking metrics', async () => {
  const h = await createHarness();
  try {
    const project = await h.service.createProject({ id: 'proj_dashboard', name: 'Dashboard Project' }, HUMAN_ACTOR);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await h.service.createTask({
      id: 'task_dash_001',
      project_id: project.id,
      title: 'Done Feature',
      status: 'done',
      priority: 'high',
      work_type: 'feature',
      completion_percent: 100,
      sprint: 'S1',
      due_at: past,
    }, HUMAN_ACTOR);
    await h.service.createTask({
      id: 'task_dash_002',
      project_id: project.id,
      title: 'In Progress Bug',
      status: 'in_progress',
      priority: 'medium',
      work_type: 'bug',
      completion_percent: 50,
      sprint: 'S1',
      due_at: past,
    }, HUMAN_ACTOR);
    await h.service.createTask({
      id: 'task_dash_003',
      project_id: project.id,
      title: 'Blocked Debt',
      status: 'blocked',
      priority: 'low',
      work_type: 'tech_debt',
      completion_percent: 20,
      sprint: 'S2',
    }, HUMAN_ACTOR);
    await h.service.createTask({
      id: 'task_dash_004',
      project_id: project.id,
      title: 'Todo Spike',
      status: 'todo',
      priority: 'high',
      work_type: 'spike',
      completion_percent: 0,
      due_at: future,
    }, HUMAN_ACTOR);

    const dashboard = await h.service.getProjectDashboard(project.id, HUMAN_ACTOR);
    assert.equal(dashboard.total_tasks, 4);
    assert.equal(dashboard.by_status.done, 1);
    assert.equal(dashboard.by_status.in_progress, 1);
    assert.equal(dashboard.by_status.blocked, 1);
    assert.equal(dashboard.by_status.todo, 1);
    assert.equal(dashboard.by_priority.high, 2);
    assert.equal(dashboard.by_priority.medium, 1);
    assert.equal(dashboard.by_priority.low, 1);
    assert.equal(dashboard.by_work_type.feature, 1);
    assert.equal(dashboard.by_work_type.bug, 1);
    assert.equal(dashboard.by_work_type.tech_debt, 1);
    assert.equal(dashboard.by_work_type.spike, 1);
    assert.equal(dashboard.blocked_count, 1);
    assert.equal(dashboard.overdue_count, 1);
    assert.equal(dashboard.in_progress_count, 1);
    assert.equal(dashboard.done_count, 1);
    assert.equal(dashboard.avg_completion_percent, 43);
    assert.deepEqual(dashboard.sprint_breakdown, { S1: 2, S2: 1 });
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

test('private board cutover imports current+legacy sources with authority marker and reconciliation ledger', async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'board-legacy-tasks-'));
  const rootDir = await fsp.realpath(tempDir);
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    await fsp.mkdir(path.join(rootDir, 'project-board', 'projects'), { recursive: true });
    await fsp.mkdir(path.join(rootDir, 'project-board', 'tasks'), { recursive: true });
    await fsp.writeFile(path.join(rootDir, 'project-board', 'projects', 'legacy_project.json'), JSON.stringify({
      id: 'legacy_project',
      name: 'Legacy Project',
      visibility: 'private',
      owner_id: HUMAN_ACTOR.id,
      status: 'active',
      description: '',
      review: { state: 'none', required: false, reviewers: [], decision: null, decided_at: null, decided_by: null },
      blocked: { is_blocked: false, reason: '', since: null },
      linked_paths: [],
      linked_runs: [],
      tags: [],
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }), 'utf8');
    await fsp.writeFile(path.join(rootDir, 'project-board', 'tasks', 'legacy_task.json'), JSON.stringify({
      id: 'legacy_task',
      project_id: 'legacy_project',
      title: 'Legacy Task',
      description: '',
      status: 'todo',
      priority: 'medium',
      assignee_type: 'unassigned',
      assignee_id: null,
      human_assignee_label: null,
      workflow_id: null,
      subtasks: [],
      due_at: null,
      linked_paths: [],
      linked_runs: [],
      review: { state: 'none', required: false, reviewers: [], decision: null, decided_at: null, decided_by: null },
      blocked: { is_blocked: false, reason: '', since: null },
      execution: {
        attempt_id: null,
        state: 'none',
        trigger: null,
        idempotency_key: null,
        requested_at: null,
        requested_by: null,
        runtime_mode: null,
        agent_id: null,
        workflow_id: null,
        scheduler_job_id: null,
        scheduler_run_id: null,
        output_root: null,
        started_at: null,
        completed_at: null,
        result_summary: null,
        failure_summary: null,
        artifact_paths: [],
        execution_updates: [],
        attempts: [],
      },
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }), 'utf8');

    await fsp.mkdir(path.join(privateRoot, 'projects'), { recursive: true });
    await fsp.writeFile(path.join(privateRoot, 'projects', 'current_project.json'), JSON.stringify({
      id: 'current_project',
      name: 'Current Project',
      visibility: 'private',
      owner_id: HUMAN_ACTOR.id,
      status: 'active',
      description: '',
      review: { state: 'none', required: false, reviewers: [], decision: null, decided_at: null, decided_by: null },
      blocked: { is_blocked: false, reason: '', since: null },
      linked_paths: [],
      linked_runs: [],
      tags: [],
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }), 'utf8');

    const storage = createBoardStorage({
      rootDir,
      runtimeRootOverride: await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'board-storage-kernel-'))),
      resolveRoots: () => ({
        privateRoot,
        teamRoot: null,
        sharedKnowledgeRoot: path.join(rootDir, 'knowledge'),
        personalKnowledgeRoot: path.join(rootDir, 'knowledge', 'personal'),
      }),
    });

    const authority = storage.getPrivateAuthorityState();
    assert.equal(authority.mode, 'sqlite_active');
    assert.equal(authority.marker, 'board.sqlite.authority.v1');

    const db = new DatabaseSync(storage.getPrivateDbPath());
    try {
      const ledger = db.prepare('SELECT source_name, status, reconciled FROM board_import_ledger ORDER BY id ASC').all();
      assert.ok(ledger.some((row) => row.source_name === 'private/entities' && row.status === 'imported' && Number(row.reconciled) === 1));
      assert.ok(ledger.some((row) => row.source_name === 'private/events' && row.status === 'imported' && Number(row.reconciled) === 1));
    } finally {
      db.close();
    }

    await fsp.writeFile(path.join(privateRoot, 'projects', 'stale_after_cutover.json'), JSON.stringify({ id: 'stale_after_cutover' }), 'utf8');
    const projects = await storage.listProjects('private');
    assert.ok(projects.some((p) => p.id === 'legacy_project'));
    assert.ok(projects.some((p) => p.id === 'current_project'));
    assert.equal(projects.some((p) => p.id === 'stale_after_cutover'), false);
    const tasks = await storage.listTasks('private');
    assert.ok(tasks.some((t) => t.id === 'legacy_task'));
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(privateRoot, { recursive: true, force: true });
  }
});

test('pre-change private board SQLite schema migrates transactionally with migration ledger + quick_check', async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'board-prechange-schema-'));
  const rootDir = await fsp.realpath(tempDir);
  const runtimeRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'board-storage-kernel-')));
  const dbDir = path.join(runtimeRoot, 'db');
  await fsp.mkdir(dbDir, { recursive: true });
  const legacyDbPath = path.join(dbDir, 'interface-board-private.sqlite');
  const legacyDb = new DatabaseSync(legacyDbPath);
  try {
    legacyDb.exec(`
      CREATE TABLE IF NOT EXISTS board_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        authority_mode TEXT NOT NULL DEFAULT 'legacy_pending',
        authority_marker TEXT,
        authority_activated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT OR REPLACE INTO board_state (id, authority_mode, authority_marker, authority_activated_at, created_at, updated_at)
      VALUES (1, 'legacy_pending', NULL, NULL, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');

      CREATE TABLE IF NOT EXISTS board_projects (
        scope TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        visibility TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        description TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        review_json TEXT NOT NULL,
        blocked_json TEXT NOT NULL,
        linked_paths_json TEXT NOT NULL,
        linked_runs_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, id)
      );

      CREATE TABLE IF NOT EXISTS board_tasks (
        scope TEXT NOT NULL,
        id TEXT NOT NULL,
        schema_version TEXT,
        project_id TEXT NOT NULL,
        activity_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        work_type TEXT NOT NULL DEFAULT 'feature',
        assignee_type TEXT NOT NULL,
        assignee_id TEXT,
        human_assignee_label TEXT,
        workflow_id TEXT,
        subtasks_json TEXT NOT NULL,
        component_tags_json TEXT NOT NULL DEFAULT '[]',
        sprint TEXT,
        story_points INTEGER,
        completion_percent INTEGER NOT NULL DEFAULT 0,
        dependencies_json TEXT NOT NULL DEFAULT '[]',
        external_links_json TEXT NOT NULL DEFAULT '[]',
        custom_fields_json TEXT NOT NULL DEFAULT '{}',
        due_at TEXT,
        review_json TEXT NOT NULL,
        blocked_json TEXT NOT NULL,
        visibility TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT,
        updated_at TEXT NOT NULL,
        updated_by TEXT,
        PRIMARY KEY (scope, id)
      );

      CREATE TABLE IF NOT EXISTS board_task_execution_artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        task_id TEXT NOT NULL,
        attempt_id TEXT,
        path TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      INSERT INTO board_projects (
        scope, id, name, status, visibility, owner_id, description,
        tags_json, review_json, blocked_json, linked_paths_json, linked_runs_json,
        version, created_at, updated_at
      ) VALUES (
        'private', 'proj_prechange', 'Legacy Project', 'active', 'private', 'human', '',
        '[]', '{"state":"none","required":false,"reviewers":[],"decision":null,"decided_at":null,"decided_by":null}',
        '{"is_blocked":false,"reason":"","since":null}', '[]', '[]',
        1, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'
      );

      INSERT INTO board_tasks (
        scope, id, schema_version, project_id, activity_id, title, description, status, priority,
        work_type, assignee_type, assignee_id, human_assignee_label, workflow_id, subtasks_json,
        component_tags_json, sprint, story_points, completion_percent, dependencies_json,
        external_links_json, custom_fields_json, due_at, review_json, blocked_json,
        visibility, version, created_at, created_by, updated_at, updated_by
      ) VALUES (
        'private', 'task_prechange', '1.0', 'proj_prechange', NULL, 'Legacy Task', '', 'todo', 'medium',
        'feature', 'human', 'human', NULL, NULL, '[]',
        '[]', NULL, NULL, 0, '[]',
        '[]', '{}', NULL,
        '{"state":"none","required":false,"reviewers":[],"decision":null,"decided_at":null,"decided_by":null}',
        '{"is_blocked":false,"reason":"","since":null}',
        'private', 1, '2024-01-01T00:00:00.000Z', 'human', '2024-01-01T00:00:00.000Z', 'human'
      );
    `);
  } finally {
    legacyDb.close();
  }

  try {
    const storage = createBoardStorage({ rootDir, runtimeRootOverride: runtimeRoot });
    const db = new DatabaseSync(storage.getPrivateDbPath());
    try {
      const migrationRows = db.prepare('SELECT version, name FROM board_schema_migrations ORDER BY version ASC').all();
      assert.ok(migrationRows.length >= 4);
      assert.ok(migrationRows.some((row) => Number(row.version) === 4102));
      assert.ok(migrationRows.some((row) => Number(row.version) === 4103));
      assert.ok(migrationRows.some((row) => Number(row.version) === 4104));

      const artifactColumns = db.prepare('PRAGMA table_info(board_task_execution_artifacts)').all();
      const artifactColumnNames = new Set(artifactColumns.map((row) => row.name));
      assert.ok(artifactColumnNames.has('artifact_id'));
      assert.ok(artifactColumnNames.has('storage_ref'));
      assert.ok(artifactColumnNames.has('hash_sha256'));

      const taskColumns = db.prepare('PRAGMA table_info(board_tasks)').all();
      const projectIdColumn = taskColumns.find((row) => row.name === 'project_id');
      const taskColumnNames = new Set(taskColumns.map((row) => row.name));
      assert.ok(taskColumnNames.has('activity_id'));
      assert.equal(Number(projectIdColumn?.notnull || 0), 0);

      const taskFks = db.prepare('PRAGMA foreign_key_list(board_tasks)').all();
      assert.ok(taskFks.some((row) => row.table === 'board_projects'));
      assert.ok(taskFks.some((row) => row.table === 'board_activities'));

      const idxRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'board_task_execution_artifacts'").all();
      const idx = new Set(idxRows.map((row) => row.name));
      assert.ok(idx.has('idx_board_exec_artifacts_artifact_id'));
      assert.ok(idx.has('idx_board_exec_artifacts_ref'));
    } finally {
      db.close();
    }

    const health = storage.getPrivateDbQuickCheck();
    assert.equal(health.ok, true);
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('project/task state and lifecycle event commit atomically in private SQLite', async () => {
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const h = await createHarness({ boardRoots: { privateRoot, teamRoot: null } });
  try {
    const project = await h.service.createProject({ id: 'proj_atomic_evt', name: 'Atomic Event' }, HUMAN_ACTOR);
    const duplicateEventId = 'evt_atomic_duplicate';
    await h.storage.writeProject('private', project.id, {
      ...project,
      name: 'Atomic Event V2',
      version: project.version + 1,
      updated_at: new Date().toISOString(),
      updated_by: HUMAN_ACTOR.id,
    }, {
      expectedVersion: project.version,
      event: {
        event_id: duplicateEventId,
        timestamp: new Date().toISOString(),
        entity_type: 'project',
        entity_id: project.id,
        project_id: project.id,
        action: 'patch_project',
        actor_id: HUMAN_ACTOR.id,
        old_version: project.version,
        new_version: project.version + 1,
        result: 'ok',
      },
    });

    const version2 = await h.service.getProject(project.id, HUMAN_ACTOR);
    await assert.rejects(
      h.storage.writeProject('private', project.id, {
        ...version2,
        name: 'Should Rollback',
        version: version2.version + 1,
        updated_at: new Date().toISOString(),
        updated_by: HUMAN_ACTOR.id,
      }, {
        expectedVersion: version2.version,
        event: {
          event_id: duplicateEventId,
          timestamp: new Date().toISOString(),
          entity_type: 'project',
          entity_id: project.id,
          project_id: project.id,
          action: 'patch_project',
          actor_id: HUMAN_ACTOR.id,
          old_version: version2.version,
          new_version: version2.version + 1,
          result: 'ok',
        },
      }),
      /UNIQUE constraint failed/,
    );

    const afterFailure = await h.service.getProject(project.id, HUMAN_ACTOR);
    assert.equal(afterFailure.version, version2.version);
    assert.equal(afterFailure.name, version2.name);
  } finally {
    await cleanupRoot(h.rootDir);
    await fsp.rm(privateRoot, { recursive: true, force: true });
  }
});

test('malformed legacy private entity aborts cutover safely with diagnostic (no authority activation)', async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'board-malformed-cutover-'));
  const rootDir = await fsp.realpath(tempDir);
  const privateRoot = path.join(os.tmpdir(), `board-private-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    await fsp.mkdir(path.join(rootDir, 'project-board', 'tasks'), { recursive: true });
    await fsp.writeFile(path.join(rootDir, 'project-board', 'tasks', 'legacy_task.json'), '{ bad json', 'utf8');

    const storage = createBoardStorage({
      rootDir,
      runtimeRootOverride: await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'board-storage-kernel-'))),
      resolveRoots: () => ({
        privateRoot,
        teamRoot: null,
        sharedKnowledgeRoot: path.join(rootDir, 'knowledge'),
        personalKnowledgeRoot: path.join(rootDir, 'knowledge', 'personal'),
      }),
    });

    await assert.rejects(
      storage.listProjects('private'),
      (err) => err?.code === 'board_authority_inactive',
    );

    const service = createBoardService({
      rootDir,
      guardrails: boardGuardrailsAllowAll(),
      scheduler: createFakeScheduler(),
      storage,
      getRuntimeSettingsRaw: async () => ({ runtimeMode: 'claude-subscription', envVault: {} }),
      listCanonicalAgentIds: async () => new Set(['agent_alpha', 'danny']),
      listCanonicalWorkflowIds: async () => new Set(['workflow_alpha']),
      resolveDeploymentState: async () => ({
        requestedDeployment: 'team-server',
        effectiveDeployment: 'team-server',
        teamCapability: { status: 'enabled', reason: null },
      }),
    });
    await assert.rejects(
      service.createProject({ id: 'blocked_after_malformed', name: 'Blocked' }, HUMAN_ACTOR),
      (err) => err?.code === 'board_authority_inactive',
    );

    const dbPath = storage.getPrivateDbPath();
    const db = new DatabaseSync(dbPath);
    try {
      const state = db.prepare('SELECT authority_mode, authority_marker FROM board_state WHERE id = 1').get();
      assert.equal(state.authority_mode, 'legacy_pending');
      assert.equal(state.authority_marker, null);
      const ledger = db.prepare('SELECT source_name, status FROM board_import_ledger ORDER BY id ASC').all();
      assert.ok(ledger.some((row) => row.source_name === 'private/entities' && row.status === 'failed'));
    } finally {
      db.close();
    }
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(privateRoot, { recursive: true, force: true });
  }
});

test('team divergence fails closed on malformed JSON, ambiguous entity ids, and non-English copy markers', async () => {
  const rootDir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'board-team-divergence-')));
  const runtimeRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'board-storage-kernel-')));
  const privateRoot = path.join(rootDir, 'private-board');
  const teamRoot = path.join(rootDir, 'team-board');
  await fsp.mkdir(path.join(teamRoot, 'projects'), { recursive: true });
  await fsp.writeFile(path.join(teamRoot, 'projects', 'broken.json'), '{ malformed', 'utf8');
  try {
    const storageMalformed = createBoardStorage({
      rootDir,
      runtimeRootOverride: runtimeRoot,
      resolveRoots: () => ({
        privateRoot,
        teamRoot,
        sharedKnowledgeRoot: path.join(rootDir, 'knowledge'),
        personalKnowledgeRoot: path.join(rootDir, 'knowledge', 'personal'),
      }),
    });
    await assert.rejects(storageMalformed.listProjects('team'), (err) => err?.code === 'team_scope_read_only');
  } finally {
    await fsp.rm(path.join(teamRoot, 'projects', 'broken.json'), { force: true });
  }

  await fsp.writeFile(path.join(teamRoot, 'projects', 'alpha.json'), JSON.stringify({
    id: 'beta',
    name: 'Ambiguous',
    visibility: 'team',
    owner_id: HUMAN_ACTOR.id,
    status: 'active',
    description: '',
    review: { state: 'none', required: false, reviewers: [], decision: null, decided_at: null, decided_by: null },
    blocked: { is_blocked: false, reason: '', since: null },
    linked_paths: [],
    linked_runs: [],
    tags: [],
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }), 'utf8');
  try {
    const storageAmbiguous = createBoardStorage({
      rootDir,
      runtimeRootOverride: runtimeRoot,
      resolveRoots: () => ({
        privateRoot,
        teamRoot,
        sharedKnowledgeRoot: path.join(rootDir, 'knowledge'),
        personalKnowledgeRoot: path.join(rootDir, 'knowledge', 'personal'),
      }),
    });
    await assert.rejects(storageAmbiguous.listProjects('team'), (err) => err?.code === 'team_scope_read_only');
  } finally {
    await fsp.rm(path.join(teamRoot, 'projects', 'alpha.json'), { force: true });
  }

  await fsp.writeFile(path.join(teamRoot, 'projects', 'proj_team (kopia).json'), '{}', 'utf8');
  try {
    const storageCopyMarker = createBoardStorage({
      rootDir,
      runtimeRootOverride: runtimeRoot,
      resolveRoots: () => ({
        privateRoot,
        teamRoot,
        sharedKnowledgeRoot: path.join(rootDir, 'knowledge'),
        personalKnowledgeRoot: path.join(rootDir, 'knowledge', 'personal'),
      }),
    });
    await assert.rejects(storageCopyMarker.listProjects('team'), (err) => err?.code === 'team_scope_read_only');
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('private board SQLite is anchored to storage-kernel runtime root and rejects unsafe runtime roots', async () => {
  const rootDir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'board-runtime-path-')));
  const runtimeRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'board-storage-kernel-')));
  try {
    const storage = createBoardStorage({ rootDir, runtimeRootOverride: runtimeRoot });
    const dbPath = storage.getPrivateDbPath();
    assert.equal(dbPath.startsWith(path.join(runtimeRoot, 'db') + path.sep), true);
    assert.equal(dbPath.includes(path.join(rootDir, 'project-board')), false);

    assert.throws(
      () => createBoardStorage({ rootDir, runtimeRootOverride: path.join(rootDir, 'runtime-inside-workspace') }),
      (err) => err?.code === 'unsafe_runtime_root' && Array.isArray(err?.issues) && err.issues.includes('runtime_root_inside_workspace'),
    );

    const syncLike = path.join(os.tmpdir(), `OneDrive-board-runtime-${Date.now()}`);
    await fsp.mkdir(syncLike, { recursive: true });
    assert.throws(
      () => createBoardStorage({ rootDir, runtimeRootOverride: syncLike }),
      (err) => err?.code === 'unsafe_runtime_root' && Array.isArray(err?.issues) && err.issues.includes('sync_like_path_detected'),
    );
    await fsp.rm(syncLike, { recursive: true, force: true });
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('team child path safety fails closed for symlinked projects/tasks/entity/audit paths', async () => {
  const rootDir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'board-team-safe-paths-')));
  const runtimeRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'board-storage-kernel-')));
  const privateRoot = path.join(rootDir, 'private-board');
  const teamRoot = path.join(rootDir, 'team-board');
  const outsideRoot = path.join(rootDir, 'outside');
  const mkStorage = () => createBoardStorage({
    rootDir,
    runtimeRootOverride: runtimeRoot,
    resolveRoots: () => ({
      privateRoot,
      teamRoot,
      sharedKnowledgeRoot: path.join(rootDir, 'knowledge'),
      personalKnowledgeRoot: path.join(rootDir, 'knowledge', 'personal'),
    }),
  });

  await fsp.mkdir(teamRoot, { recursive: true });
  await fsp.mkdir(outsideRoot, { recursive: true });
  try {
    await fsp.mkdir(path.join(outsideRoot, 'projects-safe'), { recursive: true });
    await fsp.symlink(path.join(outsideRoot, 'projects-safe'), path.join(teamRoot, 'projects'));
    await assert.rejects(
      mkStorage().listProjects('team'),
      (err) => err?.code === 'team_scope_read_only',
    );
    await fsp.rm(path.join(teamRoot, 'projects'), { recursive: true, force: true });

    await fsp.mkdir(path.join(outsideRoot, 'tasks-safe'), { recursive: true });
    await fsp.symlink(path.join(outsideRoot, 'tasks-safe'), path.join(teamRoot, 'tasks'));
    await assert.rejects(
      mkStorage().listTasks('team'),
      (err) => err?.code === 'team_scope_read_only',
    );
    await fsp.rm(path.join(teamRoot, 'tasks'), { recursive: true, force: true });

    await fsp.mkdir(path.join(teamRoot, 'projects'), { recursive: true });
    await fsp.writeFile(path.join(outsideRoot, 'proj_entity.json'), JSON.stringify({ id: 'proj_entity', name: 'Outside' }), 'utf8');
    await fsp.symlink(path.join(outsideRoot, 'proj_entity.json'), path.join(teamRoot, 'projects', 'proj_entity.json'));
    await assert.rejects(
      mkStorage().readProject('team', 'proj_entity'),
      (err) => err?.code === 'team_scope_read_only',
    );
    await fsp.rm(path.join(teamRoot, 'projects', 'proj_entity.json'), { force: true });

    await fsp.mkdir(path.join(teamRoot, 'projects'), { recursive: true });
    await fsp.mkdir(path.join(teamRoot, 'audit'), { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const outsideAudit = path.join(outsideRoot, `${day}.jsonl`);
    await fsp.writeFile(outsideAudit, 'outside-only\n', 'utf8');
    await fsp.symlink(outsideAudit, path.join(teamRoot, 'audit', `${day}.jsonl`));

    await assert.rejects(
      mkStorage().writeProject('team', 'proj_team_safe', {
        id: 'proj_team_safe',
        name: 'Team Safe',
        visibility: 'team',
        owner_id: HUMAN_ACTOR.id,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        event: {
          event_id: 'evt_team_safe_paths',
          timestamp: new Date().toISOString(),
          entity_type: 'project',
          entity_id: 'proj_team_safe',
          project_id: 'proj_team_safe',
          action: 'create_project',
          actor_id: HUMAN_ACTOR.id,
          result: 'ok',
        },
      }),
      (err) => err?.code === 'team_scope_read_only',
    );
    assert.equal(await fsp.readFile(outsideAudit, 'utf8'), 'outside-only\n');
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
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

test('system status API includes deployment and team capability diagnostics fields', async () => {
  const port = 45620 + Math.floor(Math.random() * 300);
  const server = spawn(process.execPath, ['interface/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      STEADYMADE_INTERFACE_TOKEN: '',
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
    const response = await fetch(`http://127.0.0.1:${port}/api/system`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(['local-only', 'team-server'].includes(body.requestedDeployment));
    assert.ok(['local-only', 'team-server'].includes(body.effectiveDeployment));
    assert.ok(body.teamCapability && typeof body.teamCapability === 'object');
    assert.ok(['enabled', 'disabled'].includes(body.teamCapability.status));
    assert.ok(body.teamCapability.reason === null || typeof body.teamCapability.reason === 'string');
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
