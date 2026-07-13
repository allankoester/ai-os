import path from 'node:path';
import fsp from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  ACTIVE_EXECUTION_STATES,
  ASSIGNEE_TYPES,
  CALLBACK_STATES,
  LIMITS,
  PATCH_OPS,
  PRIORITIES,
  PROJECT_STATUSES,
  PROJECT_VISIBILITIES,
  SCHEMA_VERSION,
  TASK_STATUS_TRANSITIONS,
  TASK_STATUSES,
  TERMINAL_EXECUTION_STATES,
} from './constants.mjs';
import { boardError } from './errors.mjs';
import {
  ensureEnum,
  ensureLength,
  ensureId,
  normalizeDueAt,
  sanitizeReviewers,
  validateLinkedPaths,
  validateLinkedRuns,
  validateProjectCreate,
  validateTaskCreate,
} from './validators.mjs';
import { assertReviewStateTransition, assertTaskStatusTransition } from './transitions.mjs';

function nowIso() { return new Date().toISOString(); }

const SUPPORTED_RUNTIME_MODES = new Set(['claude-subscription', 'anthropic-api', 'opencode']);
const CALLBACK_TO_EXECUTION_STATE = {
  queued: 'queued',
  started: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  timed_out: 'timed_out',
  cancelled: 'cancelled',
};
const EXECUTION_CALLBACK_TRANSITIONS = {
  none: new Set([]),
  prepared: new Set(['queued', 'running', 'cancel_requested']),
  queued: new Set(['running', 'cancel_requested', 'succeeded', 'failed', 'timed_out', 'cancelled']),
  running: new Set(['succeeded', 'failed', 'timed_out']),
  cancel_requested: new Set(['cancelled']),
  succeeded: new Set([]),
  failed: new Set([]),
  timed_out: new Set([]),
  cancelled: new Set([]),
};

function actorIdFrom(actor) {
  const raw = String(actor?.id || 'unknown').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  return ensureId(raw || 'unknown', 'actor_id');
}

function isPathWithin(parentAbs, targetAbs) {
  const rel = path.relative(parentAbs, targetAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function asItemList(items, { limit = 50, offset = 0 } = {}) {
  return items.slice(offset, offset + limit);
}

function sortByUpdatedDesc(items) {
  return [...items].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

function clearBlockedState(task) {
  task.blocked = {
    is_blocked: false,
    reason: '',
    since: null,
  };
}

function appendNewestBounded(existing, incoming, max, keyFor) {
  const ordered = new Map();
  for (const item of [...existing, ...incoming]) {
    const key = keyFor(item);
    if (ordered.has(key)) ordered.delete(key);
    ordered.set(key, item);
  }
  const out = [...ordered.values()];
  // Required execution references must be retained when at capacity.
  // Keep the newest references deterministically by trimming from the front.
  return out.length <= max ? out : out.slice(out.length - max);
}

function makeEvent({ entityType, entityId, projectId, action, actorId, oldVersion, newVersion, result = 'ok', details = null }) {
  return {
    event_id: randomUUID(),
    timestamp: nowIso(),
    entity_type: entityType,
    entity_id: entityId,
    project_id: projectId || null,
    action,
    actor_id: actorId,
    old_version: oldVersion,
    new_version: newVersion,
    result,
    ...(details ? { details } : {}),
  };
}

export function createBoardService({ rootDir, guardrails, scheduler, storage, getRuntimeSettingsRaw, listCanonicalAgentIds, listCanonicalWorkflowIds }) {
  async function appendEvents(scope, record) {
    await storage.appendActivity(scope, record);
    await storage.appendAudit(scope, record);
  }

  function canReadProject(project, actor) {
    if (!actor) return true;
    if (actor?.isInternal) return true;
    if (project.visibility === 'team') return Boolean(actor?.id);
    return String(project.owner_id) === actorIdFrom(actor);
  }

  function canWriteProject(project, actor) {
    if (!actor) return true;
    if (actor?.isInternal) return true;
    if (!actor?.isHuman) return false;
    if (project.visibility === 'team') return true;
    return String(project.owner_id) === actorIdFrom(actor);
  }

  async function findProjectScoped(id) {
    const pid = ensureId(id);
    const hits = [];
    for (const scope of ['private', 'team']) {
      let project = null;
      try {
        project = await storage.readProject(scope, pid);
      } catch (err) {
        if (!(scope === 'team' && (err?.code === 'team_root_unconfigured' || err?.code === 'team_root_unavailable'))) {
          throw err;
        }
      }
      if (project) hits.push({ scope, project });
    }
    if (!hits.length) return null;
    if (hits.length > 1) {
      throw boardError(409, 'conflict', `project id ${pid} exists in multiple scopes`);
    }
    return hits[0];
  }

  async function findTaskScoped(id) {
    const tid = ensureId(id);
    const hits = [];
    for (const scope of ['private', 'team']) {
      let task = null;
      try {
        task = await storage.readTask(scope, tid);
      } catch (err) {
        if (!(scope === 'team' && (err?.code === 'team_root_unconfigured' || err?.code === 'team_root_unavailable'))) {
          throw err;
        }
      }
      if (task) hits.push({ scope, task });
    }
    if (!hits.length) return null;
    if (hits.length > 1) {
      throw boardError(409, 'conflict', `task id ${tid} exists in multiple scopes`);
    }
    return hits[0];
  }

  async function assertProjectReadable(projectId, actor) {
    const located = await findProjectScoped(projectId);
    if (!located) throw boardError(404, 'not_found', 'project not found');
    if (!canReadProject(located.project, actor)) throw boardError(403, 'forbidden', 'project access denied');
    return located;
  }

  async function assertTaskReadable(taskId, actor) {
    const located = await findTaskScoped(taskId);
    if (!located) throw boardError(404, 'not_found', 'task not found');
    const projectInfo = await findProjectScoped(located.task.project_id);
    if (!projectInfo) throw boardError(404, 'not_found', 'project not found');
    if (projectInfo.scope !== located.scope) {
      throw boardError(409, 'conflict', 'task/project scope mismatch');
    }
    const actorId = actor ? actorIdFrom(actor) : null;
    const canRead = canReadProject(projectInfo.project, actor)
      || actorId === located.task.created_by
      || (located.task.review?.reviewers || []).includes(actorId);
    if (!canRead) throw boardError(403, 'forbidden', 'project access denied');
    return { ...located, project: projectInfo.project };
  }

  async function listScopeProjectsSafe(scope) {
    try {
      return await storage.listProjects(scope);
    } catch (err) {
      if (scope === 'team' && (err?.code === 'team_root_unconfigured' || err?.code === 'team_root_unavailable')) {
        return [];
      }
      throw err;
    }
  }

  async function listScopeTasksSafe(scope) {
    try {
      return await storage.listTasks(scope);
    } catch (err) {
      if (scope === 'team' && (err?.code === 'team_root_unconfigured' || err?.code === 'team_root_unavailable')) {
        return [];
      }
      throw err;
    }
  }

  async function mutateProject(id, actor, mutator, action) {
    return storage.withLock(`project:${id}`, async () => {
      const actorId = actorIdFrom(actor);
      const located = await findProjectScoped(id);
      if (!located) throw boardError(404, 'not_found', 'project not found');
      if (!canWriteProject(located.project, actor)) throw boardError(403, 'forbidden', 'project access denied');
      const existing = located.project;
      const before = existing.version;
      const next = await mutator(existing);
      next.schema_version = SCHEMA_VERSION;
      next.updated_at = nowIso();
      next.updated_by = actorId;
      next.version = before + 1;
      await storage.writeProject(located.scope, id, next, { expectedVersion: before });
      await appendEvents(located.scope, makeEvent({
        entityType: 'project',
        entityId: id,
        projectId: id,
        action,
        actorId,
        oldVersion: before,
        newVersion: next.version,
      }));
      return next;
    });
  }

  async function mutateTask(id, actor, mutator, action, options = {}) {
    return storage.withLock(`task:${id}`, async () => {
      const actorId = actorIdFrom(actor);
      const located = await assertTaskReadable(id, actor);
      if (!options.skipProjectWriteCheck && !canWriteProject(located.project, actor)) {
        throw boardError(403, 'forbidden', 'task access denied');
      }
      const existing = located.task;
      const before = existing.version;
      const next = await mutator(existing);
      next.schema_version = SCHEMA_VERSION;
      next.updated_at = nowIso();
      next.updated_by = actorId;
      next.version = before + 1;
      await storage.writeTask(located.scope, id, next, { expectedVersion: before });
      await appendEvents(located.scope, makeEvent({
        entityType: 'task',
        entityId: id,
        projectId: next.project_id,
        action,
        actorId,
        oldVersion: before,
        newVersion: next.version,
      }));
      return next;
    });
  }

  async function assertCanonicalTaskRouting(task) {
    if (task.assignee_type === 'agent') {
      if (!task.assignee_id) throw boardError(422, 'validation_error', 'assignee_id required for assignee_type=agent');
      const agents = await listCanonicalAgentIds();
      if (!agents.has(task.assignee_id)) throw boardError(422, 'unknown_assignee', `unknown agent assignee_id: ${task.assignee_id}`);
    }
    if (task.assignee_type !== 'agent' && task.assignee_id) {
      ensureId(task.assignee_id, 'assignee_id');
    }
    if (task.workflow_id) {
      const workflows = await listCanonicalWorkflowIds();
      if (!workflows.has(task.workflow_id)) throw boardError(422, 'unknown_workflow', `unknown workflow_id: ${task.workflow_id}`);
    }
  }

  function applyInvariants(task) {
    if (task.status === 'blocked') task.blocked.is_blocked = true;
    if (task.blocked?.is_blocked) {
      task.status = 'blocked';
      task.blocked.since = task.blocked.since || nowIso();
    } else if (task.blocked) {
      task.blocked.since = null;
    }
    if (task.status === 'needs_review') task.review.state = 'needs_review';
    if (task.execution?.state === 'succeeded' && task.blocked?.is_blocked) clearBlockedState(task);
    if (task.review.required && task.status === 'done' && task.review.state !== 'approved') {
      throw boardError(422, 'review_required', 'task cannot be done until review.state=approved');
    }
  }

  async function registerAttemptArtifacts(visibility, taskId, attemptId) {
    const relRoot = path.posix.join('artifacts/project-board', visibility, taskId, attemptId);
    const absRoot = path.join(rootDir, relRoot);
    const out = [];
    const stack = [absRoot];
    while (stack.length) {
      const current = stack.pop();
      const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const abs = path.join(current, entry.name);
        const lst = await fsp.lstat(abs).catch(() => null);
        if (!lst) continue;
        if (lst.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          stack.push(abs);
          continue;
        }
        if (!entry.isFile()) continue;
        const real = await fsp.realpath(abs).catch(() => null);
        if (!real || !isPathWithin(absRoot, real)) continue;
        const rel = path.relative(rootDir, real).split(path.sep).join('/');
        out.push({ path: rel, kind: 'file' });
      }
    }
    return out;
  }

  function outputRootForAttempt(visibility, taskId, attemptId) {
    const rel = path.posix.join('artifacts/project-board', visibility, taskId, attemptId);
    const abs = path.join(rootDir, rel);
    return { rel, abs };
  }

  async function createExecutionAttempt(task, actorId, idempotencyKey, trigger = 'manual') {
    const runtime = await getRuntimeSettingsRaw();
    if (!runtime?.runtimeMode) throw boardError(503, 'runtime_unavailable', 'runtime mode unavailable');
    if (!SUPPORTED_RUNTIME_MODES.has(runtime.runtimeMode)) {
      throw boardError(503, 'runtime_unavailable', `runtime mode ${runtime.runtimeMode} is not supported by scheduler adapter`);
    }
    const current = task.execution || {};
    const existingAttempt = (current.attempts || []).find((a) => a.idempotency_key === idempotencyKey);
    if (existingAttempt) return { task, sameAttempt: true, attempt: existingAttempt };
    if (ACTIVE_EXECUTION_STATES.has(current.state)) {
      if (current.idempotency_key === idempotencyKey) return { task, sameAttempt: true };
      throw boardError(409, 'execution_active', 'active execution attempt already exists');
    }
    const attemptId = randomUUID().replace(/-/g, '').slice(0, 16);
    const visibility = task.visibility || 'private';
    const { rel: outputRootRel, abs: outputRootAbs } = outputRootForAttempt(visibility, task.id, attemptId);
    const writeGate = guardrails.check(outputRootRel, 'write');
    if (!writeGate.allowed || writeGate.confirmRequired) {
      throw boardError(403, 'guardrail_denied', writeGate.reason || 'guardrail denied', { path: outputRootRel });
    }
    await fsp.mkdir(outputRootAbs, { recursive: true });
    const real = await fsp.realpath(outputRootAbs).catch(() => null);
    if (!real || !isPathWithin(path.join(rootDir, 'artifacts', 'project-board', visibility), real)) {
      throw boardError(422, 'output_root_invalid', 'attempt output root escaped confinement');
    }

    const attempt = {
      attempt_id: attemptId,
      state: 'prepared',
      trigger,
      idempotency_key: idempotencyKey,
      requested_at: nowIso(),
      requested_by: actorId,
      runtime_mode: runtime.runtimeMode,
      agent_id: task.assignee_id,
      workflow_id: task.workflow_id,
      scheduler_job_id: null,
      scheduler_run_id: null,
      output_root: outputRootRel,
      started_at: null,
      completed_at: null,
      result_summary: null,
      failure_summary: null,
      artifact_paths: [],
      task_version: task.version,
    };

    task.execution = {
      ...current,
      ...attempt,
      attempts: [...(current.attempts || []), attempt],
    };
    task.status = 'in_progress';
    clearBlockedState(task);
    applyInvariants(task);
    return { task, attempt, sameAttempt: false };
  }

  async function ensureRunnableProject(task) {
    const located = await findProjectScoped(task.project_id);
    const project = located?.project;
    if (!project) throw boardError(422, 'validation_error', 'project_id does not exist');
    if (project.status === 'archived') throw boardError(409, 'project_archived', 'cannot run task for archived project');
    if (project.scope_migration && project.scope_migration.state && project.scope_migration.state !== 'completed') {
      throw boardError(409, 'project_migration_active', 'cannot run task while project visibility migration is in progress');
    }
    return project;
  }

  async function appendIgnoredCallbackEvent({ scope, task, taskId, actorId, attemptId, reason, details = {} }) {
    await appendEvents(scope, makeEvent({
      entityType: 'task',
      entityId: taskId,
      projectId: task.project_id,
      action: 'execution_callback_ignored',
      actorId,
      oldVersion: task.version,
      newVersion: task.version,
      result: 'ignored',
      details: { attempt_id: attemptId, reason, ...details },
    }));
  }

  function buildDispatchPayload(task, attempt, actorId) {
    return {
      name: `board_${task.id}_${attempt.attempt_id}`,
      agent: task.assignee_id,
      workflow: task.workflow_id || null,
      prompt: [
        `Board task ${task.id} (${task.title})`,
        task.description || '',
        `Project: ${task.project_id}`,
        `Output root: ${attempt.output_root}`,
      ].filter(Boolean).join('\n'),
      scheduleType: 'once',
      runAt: Date.now(),
      enabled: false,
      timeoutMinutes: 30,
      meta: {
        source: 'project-board',
        task_id: task.id,
        project_id: task.project_id,
        attempt_id: attempt.attempt_id,
        task_version: task.version,
        actor_id: actorId,
        runtime_mode: attempt.runtime_mode,
      },
    };
  }

  async function getRuntimeSecretValues() {
    const runtime = await getRuntimeSettingsRaw().catch(() => null);
    const envVault = runtime?.envVault && typeof runtime.envVault === 'object' && !Array.isArray(runtime.envVault)
      ? runtime.envVault
      : {};
    const out = [];
    for (const value of Object.values(envVault)) {
      const str = String(value ?? '');
      if (str) out.push(str);
    }
    return out;
  }

  function redactSecretsInText(text, secretValues) {
    let out = String(text || '');
    for (const rawSecret of secretValues || []) {
      const secret = String(rawSecret || '');
      if (!secret) continue;
      out = out.split(secret).join('****');
    }
    return out;
  }

  async function writeServerGeneratedAttemptArtifacts(task, attemptId, callbackState, summary, schedulerRunId, secretValues = []) {
    const visibility = task.visibility || 'private';
    const { rel: outputRootRel, abs: outputRootAbs } = outputRootForAttempt(visibility, task.id, attemptId);
    await fsp.mkdir(outputRootAbs, { recursive: true });
    const real = await fsp.realpath(outputRootAbs).catch(() => null);
    if (!real || !isPathWithin(path.join(rootDir, 'artifacts', 'project-board', visibility), real)) {
      throw boardError(422, 'output_root_invalid', 'attempt output root escaped confinement');
    }
    const generated = [];
    const summaryText = [
      `state: ${callbackState}`,
      `task_id: ${task.id}`,
      `attempt_id: ${attemptId}`,
      `scheduler_run_id: ${schedulerRunId || ''}`,
      '',
      redactSecretsInText(String(summary || '').trim() || '(no summary)', secretValues),
    ].join('\n');
    const summaryRel = path.posix.join(outputRootRel, 'server-summary.txt');
    await fsp.writeFile(path.join(outputRootAbs, 'server-summary.txt'), summaryText, 'utf8');
    generated.push({ path: summaryRel, kind: 'file' });

    if (schedulerRunId && typeof scheduler.getRunLog === 'function') {
      const log = await scheduler.getRunLog(String(schedulerRunId));
      if (typeof log === 'string' && log.length) {
        const transcriptRel = path.posix.join(outputRootRel, 'server-transcript.log');
        await fsp.writeFile(path.join(outputRootAbs, 'server-transcript.log'), redactSecretsInText(log, secretValues), 'utf8');
        generated.push({ path: transcriptRel, kind: 'file' });
      }
    }
    return generated;
  }

  async function persistTaskMutation(scope, taskId, task, actorId, action, details = null) {
    const before = task.version;
    task.version = before + 1;
    task.updated_at = nowIso();
    task.updated_by = actorId;
    await storage.writeTask(scope, taskId, task, { expectedVersion: before });
    await appendEvents(scope, makeEvent({
      entityType: 'task',
      entityId: taskId,
      projectId: task.project_id,
      action,
      actorId,
      oldVersion: before,
      newVersion: task.version,
      ...(details ? { details } : {}),
    }));
  }

  async function reconcileDispatchFailure(task, summary) {
    await updateAttemptRecord(task, {
      state: 'failed',
      completed_at: nowIso(),
      failure_summary: ensureLength(summary || 'dispatch failed', 'failure_summary', 0, LIMITS.failureSummaryMax),
    });
    task.status = 'blocked';
    task.blocked = {
      is_blocked: true,
      reason: ensureLength(summary || 'dispatch failed', 'blocked.reason', 0, LIMITS.descriptionMax),
      since: task.blocked?.since || nowIso(),
    };
    applyInvariants(task);
  }

  async function updateAttemptRecord(task, partial) {
    const cur = task.execution || {};
    const attemptId = cur.attempt_id;
    const attempts = (cur.attempts || []).map((a) => (a.attempt_id === attemptId ? { ...a, ...partial } : a));
    task.execution = { ...cur, ...partial, attempts };
  }

  return {
    async listProjects(query, actor) {
      const allRaw = [
        ...(await listScopeProjectsSafe('private')),
        ...(await listScopeProjectsSafe('team')),
      ];
      const all = sortByUpdatedDesc(allRaw.filter((p) => canReadProject(p, actor)));
      const status = query?.status ? ensureEnum(String(query.status), PROJECT_STATUSES, 'status') : null;
      const visibility = query?.visibility ? ensureEnum(String(query.visibility), PROJECT_VISIBILITIES, 'visibility') : null;
      const q = String(query?.q || '').trim().toLowerCase();
      let filtered = all;
      if (status) filtered = filtered.filter((p) => p.status === status);
      if (visibility) filtered = filtered.filter((p) => p.visibility === visibility);
      if (q) filtered = filtered.filter((p) => p.name.toLowerCase().includes(q) || String(p.description || '').toLowerCase().includes(q));
      const limit = Math.max(1, Math.min(200, Number(query?.limit || 50)));
      const offset = Math.max(0, Number(query?.offset || 0));
      return { items: asItemList(filtered, { limit, offset }), total: filtered.length };
    },

    async createProject(body, actor) {
      const actorId = actorIdFrom(actor);
      const project = validateProjectCreate(body);
      const scope = project.visibility === 'team' ? 'team' : 'private';
      project.schema_version = SCHEMA_VERSION;
      project.created_by = actorId;
      project.updated_by = actorId;
      project.owner_id = actorId;
      project.linked_paths = await validateLinkedPaths({ items: body?.linked_paths || [], rootDir, guardrails });
      project.linked_runs = validateLinkedRuns(body?.linked_runs || []);
      await storage.withLock(`project:${project.id}`, async () => {
        if (!actor?.isHuman) throw boardError(403, 'forbidden', 'project create requires authenticated human');
        const existing = await findProjectScoped(project.id);
        if (existing) throw boardError(409, 'conflict', 'project id already exists');
        await storage.writeProject(scope, project.id, project, { expectedVersion: null });
        await appendEvents(scope, makeEvent({
          entityType: 'project',
          entityId: project.id,
          projectId: project.id,
          action: 'create_project',
          actorId,
          oldVersion: 0,
          newVersion: project.version,
        }));
      });
      return project;
    },

    async getProject(id, actor) {
      const located = await assertProjectReadable(id, actor);
      return located.project;
    },

    async patchProject(id, body, actor) {
      const requestedVersion = Number(body?.version);
      if (!Number.isInteger(requestedVersion) || requestedVersion < 1) throw boardError(422, 'validation_error', 'version is required');
      const ops = Array.isArray(body?.ops) ? body.ops : [];
      for (const op of ops) {
        if (!PATCH_OPS.has(op?.op)) throw boardError(422, 'validation_error', `unsupported patch op: ${op?.op}`);
      }
      return mutateProject(ensureId(id), actor, async (project) => {
        if (project.version !== requestedVersion) throw boardError(409, 'conflict', 'Version mismatch', { expected: project.version, got: requestedVersion });
        for (const op of ops) {
          switch (op.op) {
            case 'set_status':
              project.status = ensureEnum(op.value, PROJECT_STATUSES, 'status');
              break;
            case 'set_linked_paths':
              project.linked_paths = await validateLinkedPaths({ items: op.value, rootDir, guardrails });
              break;
            case 'set_linked_runs':
              project.linked_runs = validateLinkedRuns(op.value);
              break;
            default:
              throw boardError(422, 'validation_error', `op not valid for project: ${op.op}`);
          }
        }
        return project;
      }, 'patch_project');
    },

    async listTasks(query, actor) {
      const allRaw = [
        ...(await listScopeTasksSafe('private')),
        ...(await listScopeTasksSafe('team')),
      ];
      const allProjects = [
        ...(await listScopeProjectsSafe('private')),
        ...(await listScopeProjectsSafe('team')),
      ];
      const visibleProjects = new Set(allProjects.filter((p) => canReadProject(p, actor)).map((p) => p.id));
      let all = sortByUpdatedDesc(allRaw.filter((t) => visibleProjects.has(t.project_id)));
      if (query?.project_id) all = all.filter((t) => t.project_id === query.project_id);
      if (query?.status) {
        const status = ensureEnum(String(query.status), TASK_STATUSES, 'status');
        all = all.filter((t) => t.status === status);
      }
      if (query?.assignee_id) all = all.filter((t) => t.assignee_id === query.assignee_id);
      const q = String(query?.q || '').trim().toLowerCase();
      if (q) all = all.filter((t) => t.title.toLowerCase().includes(q) || String(t.description || '').toLowerCase().includes(q));
      const limit = Math.max(1, Math.min(200, Number(query?.limit || 50)));
      const offset = Math.max(0, Number(query?.offset || 0));
      return { items: asItemList(all, { limit, offset }), total: all.length };
    },

    async createTask(body, actor) {
      const actorId = actorIdFrom(actor);
      const task = validateTaskCreate(body);
      const locatedProject = await findProjectScoped(task.project_id);
      const project = locatedProject?.project;
      if (!project) throw boardError(422, 'validation_error', 'project_id does not exist');
      if (!canWriteProject(project, actor)) throw boardError(403, 'forbidden', 'project access denied');
      if (task.assignee_type === 'agent' && !task.assignee_id) task.assignee_id = 'danny';
      task.schema_version = SCHEMA_VERSION;
      task.created_by = actorId;
      task.updated_by = actorId;
      task.visibility = project.visibility || 'private';
      task.linked_paths = await validateLinkedPaths({ items: body?.linked_paths || [], rootDir, guardrails });
      task.linked_runs = validateLinkedRuns(body?.linked_runs || []);
      await assertCanonicalTaskRouting(task);
      applyInvariants(task);

      await storage.withLock(`task:${task.id}`, async () => {
        const existing = await findTaskScoped(task.id);
        if (existing) throw boardError(409, 'conflict', 'task id already exists');
        await storage.writeTask(locatedProject.scope, task.id, task, { expectedVersion: null });
        await appendEvents(locatedProject.scope, makeEvent({
          entityType: 'task',
          entityId: task.id,
          projectId: task.project_id,
          action: 'create_task',
          actorId,
          oldVersion: 0,
          newVersion: task.version,
        }));
      });
      return task;
    },

    async getTask(id, actor) {
      const located = await assertTaskReadable(id, actor);
      return located.task;
    },

    async patchTask(id, body, actor) {
      const requestedVersion = Number(body?.version);
      if (!Number.isInteger(requestedVersion) || requestedVersion < 1) throw boardError(422, 'validation_error', 'version is required');
      const ops = Array.isArray(body?.ops) ? body.ops : [];
      for (const op of ops) {
        if (!PATCH_OPS.has(op?.op)) throw boardError(422, 'validation_error', `unsupported patch op: ${op?.op}`);
      }
      return mutateTask(ensureId(id), actor, async (task) => {
        const actorId = actorIdFrom(actor);
        const touchesReviewRoster = ops.some((op) => op.op === 'set_review_required' || op.op === 'set_reviewers');
        if (touchesReviewRoster) {
          const project = (await findProjectScoped(task.project_id))?.project;
          const canMutate = actorId === task.created_by || actorId === project?.owner_id;
          if (!canMutate) {
            throw boardError(403, 'forbidden', 'only task creator or project owner may modify review roster/requirement');
          }
        }
        if (task.version !== requestedVersion) throw boardError(409, 'conflict', 'Version mismatch', { expected: task.version, got: requestedVersion });
        for (const op of ops) {
          switch (op.op) {
            case 'set_status': {
              const nextStatus = ensureEnum(op.value, TASK_STATUSES, 'status');
              assertTaskStatusTransition(task.status, nextStatus);
              if (task.status === 'blocked' && nextStatus !== 'blocked') {
                clearBlockedState(task);
              }
              task.status = nextStatus;
              if (nextStatus === 'needs_review') task.review.state = 'needs_review';
              break;
            }
            case 'set_priority':
              task.priority = ensureEnum(op.value, PRIORITIES, 'priority');
              break;
            case 'set_assignee': {
              const type = ensureEnum(op?.value?.assignee_type, ASSIGNEE_TYPES, 'assignee_type');
              task.assignee_type = type;
              task.assignee_id = op?.value?.assignee_id ? ensureId(op.value.assignee_id, 'assignee_id') : null;
              task.workflow_id = op?.value?.workflow_id ? ensureId(op.value.workflow_id, 'workflow_id') : task.workflow_id;
              await assertCanonicalTaskRouting(task);
              break;
            }
            case 'set_due_at':
              task.due_at = normalizeDueAt(op.value);
              break;
            case 'set_review_required':
              task.review.required = Boolean(op.value);
              break;
            case 'set_reviewers':
              task.review.reviewers = sanitizeReviewers(op.value);
              break;
            case 'set_blocked':
              task.blocked = {
                is_blocked: Boolean(op?.value?.is_blocked),
                reason: ensureLength(op?.value?.reason || '', 'blocked.reason', 0, LIMITS.descriptionMax),
                since: op?.value?.is_blocked ? (task.blocked.since || nowIso()) : null,
              };
              break;
            case 'set_linked_paths':
              task.linked_paths = await validateLinkedPaths({ items: op.value, rootDir, guardrails });
              break;
            case 'set_linked_runs':
              task.linked_runs = validateLinkedRuns(op.value);
              break;
            default:
              throw boardError(422, 'validation_error', `unsupported op: ${op.op}`);
          }
        }
        applyInvariants(task);
        await assertCanonicalTaskRouting(task);
        return task;
      }, 'patch_task');
    },

    async runTask(taskId, body, actor) {
      const actorId = actorIdFrom(actor);
      if (!actor?.isHuman) throw boardError(403, 'forbidden', 'run requires authenticated human');
      const requestedVersion = Number(body?.version);
      const idempotencyKey = String(body?.idempotency_key || '').trim();
      if (!Number.isInteger(requestedVersion) || requestedVersion < 1) throw boardError(422, 'validation_error', 'version is required');
      if (!idempotencyKey) throw boardError(422, 'validation_error', 'idempotency_key is required');
      const id = ensureId(taskId);
      return storage.withLock(`task:${id}`, async () => {
        const located = await assertTaskReadable(id, actor);
        if (!canWriteProject(located.project, actor)) throw boardError(403, 'forbidden', 'task access denied');
        const task = located.task;
        const priorAttempt = (task.execution?.attempts || []).find((a) => a.idempotency_key === idempotencyKey);
        if (priorAttempt) return { task, statusCode: 202 };
        if (task.version !== requestedVersion) throw boardError(409, 'conflict', 'Version mismatch', { expected: task.version, got: requestedVersion });
        await ensureRunnableProject(task);
        if (task.assignee_type !== 'agent') throw boardError(422, 'validation_error', 'task assignee_type must be agent to run');
        if (task.status === 'done') throw boardError(422, 'validation_error', 'done task cannot be run');
        await assertCanonicalTaskRouting(task);
        const prepared = await createExecutionAttempt(task, actorId, idempotencyKey, 'manual');
        if (prepared.sameAttempt) return { task, statusCode: 202 };

        await persistTaskMutation(located.scope, id, task, actorId, 'run_task_prepared', {
          attempt_id: prepared.attempt.attempt_id,
        });

        const created = await scheduler.createJob(buildDispatchPayload(task, prepared.attempt, actorId));
        if (created.errors) {
          const message = 'failed to create scheduler job';
          await reconcileDispatchFailure(task, message);
          await persistTaskMutation(located.scope, id, task, actorId, 'run_task_dispatch_failed', {
            attempt_id: prepared.attempt.attempt_id,
            stage: 'create_job',
            errors: created.errors,
          });
          throw boardError(422, 'scheduler_error', message, { errors: created.errors });
        }
        await updateAttemptRecord(task, {
          state: 'queued',
          scheduler_job_id: created.job.id,
        });
        await persistTaskMutation(located.scope, id, task, actorId, 'run_task_queued', {
          attempt_id: prepared.attempt.attempt_id,
          scheduler_job_id: created.job.id,
        });

        const runResult = await scheduler.runNow(created.job.id);
        if (runResult.errors) {
          const message = 'failed to dispatch scheduler run';
          await reconcileDispatchFailure(task, message);
          await persistTaskMutation(located.scope, id, task, actorId, 'run_task_dispatch_failed', {
            attempt_id: prepared.attempt.attempt_id,
            scheduler_job_id: created.job.id,
            stage: 'run_now',
            errors: runResult.errors,
          });
          throw boardError(422, 'scheduler_error', message, { errors: runResult.errors });
        }
        await updateAttemptRecord(task, {
          scheduler_job_id: created.job.id,
          scheduler_run_id: runResult.run.id,
          state: 'queued',
        });
        await persistTaskMutation(located.scope, id, task, actorId, 'run_task', {
          attempt_id: prepared.attempt.attempt_id,
          scheduler_run_id: runResult.run.id,
          scheduler_job_id: created.job.id,
        });
        return { task, statusCode: 202 };
      });
    },

    async cancelTask(taskId, body, actor) {
      const actorId = actorIdFrom(actor);
      if (!actor?.isHuman) throw boardError(403, 'forbidden', 'cancel requires authenticated human');
      const requestedVersion = Number(body?.version);
      if (!Number.isInteger(requestedVersion)) throw boardError(422, 'validation_error', 'version is required');
      const id = ensureId(taskId);
      return mutateTask(id, actor, async (task) => {
        if (task.version !== requestedVersion) throw boardError(409, 'conflict', 'Version mismatch', { expected: task.version, got: requestedVersion });
        if (!ACTIVE_EXECUTION_STATES.has(task.execution?.state)) throw boardError(409, 'execution_inactive', 'no active attempt to cancel');
        const runId = task.execution.scheduler_run_id;
        if (runId) {
          const result = await scheduler.cancelRun(runId);
          if (result?.errors) throw boardError(422, 'scheduler_error', 'cancel failed', { errors: result.errors });
        }
        await updateAttemptRecord(task, { state: 'cancel_requested' });
        return task;
      }, 'cancel_task_execution');
    },

    async retryTask(taskId, body, actor) {
      const actorId = actorIdFrom(actor);
      if (!actor?.isHuman) throw boardError(403, 'forbidden', 'retry requires authenticated human');
      const requestedVersion = Number(body?.version);
      const idempotencyKey = String(body?.idempotency_key || '').trim();
      if (!Number.isInteger(requestedVersion)) throw boardError(422, 'validation_error', 'version is required');
      if (!idempotencyKey) throw boardError(422, 'validation_error', 'idempotency_key is required');
      const id = ensureId(taskId);
      return storage.withLock(`task:${id}`, async () => {
        const located = await assertTaskReadable(id, actor);
        if (!canWriteProject(located.project, actor)) throw boardError(403, 'forbidden', 'task access denied');
        const task = located.task;
        const priorAttempt = (task.execution?.attempts || []).find((a) => a.idempotency_key === idempotencyKey);
        if (priorAttempt) return { task, statusCode: 202 };
        if (task.version !== requestedVersion) throw boardError(409, 'conflict', 'Version mismatch', { expected: task.version, got: requestedVersion });
        await ensureRunnableProject(task);
        if (!TERMINAL_EXECUTION_STATES.has(task.execution?.state) || task.execution?.state === 'succeeded') {
          throw boardError(409, 'retry_not_allowed', 'retry allowed only for failed/timed_out/cancelled attempts');
        }
        const attempts = task.execution?.attempts || [];
        const retries = attempts.filter((a) => a.state === 'failed' || a.state === 'timed_out' || a.state === 'cancelled').length;
        if (retries >= LIMITS.retriesMax) throw boardError(409, 'retry_limit', `retry limit reached (${LIMITS.retriesMax})`);
        await assertCanonicalTaskRouting(task);
        const prepared = await createExecutionAttempt(task, actorId, idempotencyKey, 'retry');
        if (prepared.sameAttempt) return { task, statusCode: 202 };

        await persistTaskMutation(located.scope, id, task, actorId, 'retry_task_prepared', {
          attempt_id: prepared.attempt.attempt_id,
        });

        const created = await scheduler.createJob(buildDispatchPayload(task, prepared.attempt, actorId));
        if (created.errors) {
          const message = 'failed to create scheduler job';
          await reconcileDispatchFailure(task, message);
          await persistTaskMutation(located.scope, id, task, actorId, 'retry_task_dispatch_failed', {
            attempt_id: prepared.attempt.attempt_id,
            stage: 'create_job',
            errors: created.errors,
          });
          throw boardError(422, 'scheduler_error', message, { errors: created.errors });
        }
        await updateAttemptRecord(task, {
          state: 'queued',
          scheduler_job_id: created.job.id,
        });
        await persistTaskMutation(located.scope, id, task, actorId, 'retry_task_queued', {
          attempt_id: prepared.attempt.attempt_id,
          scheduler_job_id: created.job.id,
        });

        const runResult = await scheduler.runNow(created.job.id);
        if (runResult.errors) {
          const message = 'failed to dispatch scheduler run';
          await reconcileDispatchFailure(task, message);
          await persistTaskMutation(located.scope, id, task, actorId, 'retry_task_dispatch_failed', {
            attempt_id: prepared.attempt.attempt_id,
            scheduler_job_id: created.job.id,
            stage: 'run_now',
            errors: runResult.errors,
          });
          throw boardError(422, 'scheduler_error', message, { errors: runResult.errors });
        }
        await updateAttemptRecord(task, {
          scheduler_job_id: created.job.id,
          scheduler_run_id: runResult.run.id,
          state: 'queued',
        });
        await persistTaskMutation(located.scope, id, task, actorId, 'retry_task_execution', {
          attempt_id: prepared.attempt.attempt_id,
          scheduler_run_id: runResult.run.id,
          scheduler_job_id: created.job.id,
        });
        return { task, statusCode: 202 };
      });
    },

    async executionCallback(body, actor) {
      const actorId = actorIdFrom(actor);
      if (!actor?.isInternal) throw boardError(403, 'forbidden', 'internal callback channel required');
      const taskId = ensureId(body?.task_id, 'task_id');
      const attemptId = String(body?.attempt_id || '').trim();
      if (!attemptId) throw boardError(422, 'validation_error', 'attempt_id is required');
      const state = String(body?.state || '').trim();
      if (!CALLBACK_STATES.has(state)) throw boardError(422, 'validation_error', 'invalid callback state');
      const callbackExecutionState = CALLBACK_TO_EXECUTION_STATE[state];
      const callbackJobId = body?.scheduler_job_id ? String(body.scheduler_job_id).trim() : null;
      const callbackRunId = body?.scheduler_run_id ? String(body.scheduler_run_id).trim() : null;
      const runtimeSecretValues = await getRuntimeSecretValues();
      const redactedResultSummary = redactSecretsInText(body?.result_summary || '', runtimeSecretValues);
      const redactedFailureSummary = redactSecretsInText(body?.failure_summary || '', runtimeSecretValues);

      return storage.withLock(`task:${taskId}`, async () => {
        const located = await findTaskScoped(taskId);
        if (!located) throw boardError(404, 'not_found', 'task not found');
        const task = located.task;
        if (task.execution?.attempt_id !== attemptId) {
          await appendIgnoredCallbackEvent({
            scope: located.scope,
            task,
            taskId,
            actorId,
            attemptId,
            reason: 'attempt_mismatch',
            details: { current_attempt_id: task.execution?.attempt_id },
          });
          return task;
        }
        if (task.execution?.scheduler_job_id && task.execution.scheduler_job_id !== callbackJobId) {
          await appendIgnoredCallbackEvent({
            scope: located.scope,
            task,
            taskId,
            actorId,
            attemptId,
            reason: 'scheduler_job_mismatch',
            details: { expected_scheduler_job_id: task.execution.scheduler_job_id, got_scheduler_job_id: callbackJobId || null },
          });
          return task;
        }
        if (task.execution?.scheduler_run_id && task.execution.scheduler_run_id !== callbackRunId) {
          await appendIgnoredCallbackEvent({
            scope: located.scope,
            task,
            taskId,
            actorId,
            attemptId,
            reason: 'scheduler_run_mismatch',
            details: { expected_scheduler_run_id: task.execution.scheduler_run_id, got_scheduler_run_id: callbackRunId || null },
          });
          return task;
        }
        const currentState = task.execution?.state || 'none';
        if (callbackExecutionState === currentState) {
          await appendIgnoredCallbackEvent({
            scope: located.scope,
            task,
            taskId,
            actorId,
            attemptId,
            reason: 'duplicate_callback',
            details: { state: callbackExecutionState },
          });
          return task;
        }
        const allowedTransitions = EXECUTION_CALLBACK_TRANSITIONS[currentState] || new Set();
        if (!allowedTransitions.has(callbackExecutionState)) {
          await appendIgnoredCallbackEvent({
            scope: located.scope,
            task,
            taskId,
            actorId,
            attemptId,
            reason: 'out_of_order_transition',
            details: { from_state: currentState, to_state: callbackExecutionState },
          });
          return task;
        }
        const before = task.version;
        if (state === 'queued') {
          await updateAttemptRecord(task, { state: 'queued' });
        } else if (state === 'started') {
          await updateAttemptRecord(task, {
            state: 'running',
            started_at: task.execution?.started_at || nowIso(),
          });
        } else if (state === 'succeeded') {
          const runId = body?.scheduler_run_id || task.execution?.scheduler_run_id;
          await writeServerGeneratedAttemptArtifacts(
            task,
            attemptId,
            'succeeded',
            redactedResultSummary || task.execution?.result_summary || '',
            runId,
            runtimeSecretValues,
          );
          const artifacts = await registerAttemptArtifacts(task.visibility || 'private', task.id, attemptId);
          task.linked_runs = appendNewestBounded(
            task.linked_runs || [],
            runId ? [{ source: 'scheduler', id: String(runId) }] : [],
            LIMITS.linkedRunsMax,
            (r) => `${r.source}:${r.id}`,
          );
          task.linked_paths = appendNewestBounded(
            task.linked_paths || [],
            artifacts,
            LIMITS.linkedPathsMax,
            (p) => p.path,
          );
          await updateAttemptRecord(task, {
            state: 'succeeded',
            completed_at: nowIso(),
            result_summary: ensureLength(redactedResultSummary || '', 'result_summary', 0, LIMITS.resultSummaryMax) || null,
            failure_summary: null,
            artifact_paths: artifacts.map((a) => a.path),
            scheduler_run_id: runId || null,
            scheduler_job_id: callbackJobId || task.execution?.scheduler_job_id || null,
          });
          task.status = 'needs_review';
          task.review.state = 'needs_review';
          clearBlockedState(task);
        } else {
          const failedState = state === 'failed' ? 'failed' : state === 'timed_out' ? 'timed_out' : 'cancelled';
          const runId = callbackRunId || task.execution?.scheduler_run_id || null;
          await writeServerGeneratedAttemptArtifacts(
            task,
            attemptId,
            failedState,
            redactedFailureSummary || failedState,
            runId,
            runtimeSecretValues,
          );
          const artifacts = await registerAttemptArtifacts(task.visibility || 'private', task.id, attemptId);
          task.linked_paths = appendNewestBounded(
            task.linked_paths || [],
            artifacts,
            LIMITS.linkedPathsMax,
            (p) => p.path,
          );
          task.linked_runs = appendNewestBounded(
            task.linked_runs || [],
            runId ? [{ source: 'scheduler', id: String(runId) }] : [],
            LIMITS.linkedRunsMax,
            (r) => `${r.source}:${r.id}`,
          );
          await updateAttemptRecord(task, {
            state: failedState,
            completed_at: nowIso(),
            failure_summary: ensureLength(redactedFailureSummary || '', 'failure_summary', 0, LIMITS.failureSummaryMax) || null,
            scheduler_run_id: runId,
            scheduler_job_id: callbackJobId || task.execution?.scheduler_job_id || null,
            artifact_paths: artifacts.map((a) => a.path),
          });
          task.status = 'blocked';
          task.blocked = {
            is_blocked: true,
            reason: ensureLength(redactedFailureSummary || failedState, 'blocked.reason', 0, LIMITS.descriptionMax),
            since: task.blocked?.since || nowIso(),
          };
        }

        task.schema_version = SCHEMA_VERSION;
        task.version = before + 1;
        task.updated_at = nowIso();
        task.updated_by = actorId;
        await storage.writeTask(located.scope, taskId, task, { expectedVersion: before });
        await appendEvents(located.scope, makeEvent({
          entityType: 'task',
          entityId: taskId,
          projectId: task.project_id,
          action: 'execution_callback',
          actorId,
          oldVersion: before,
          newVersion: task.version,
          details: { attempt_id: attemptId, state },
        }));
        return task;
      });
    },

    async decideTaskReview(taskId, body, actor) {
      const actorId = actorIdFrom(actor);
      if (!actor?.isHuman) throw boardError(403, 'forbidden', 'review decision requires authenticated human');
      const requestedVersion = Number(body?.version);
      if (!Number.isInteger(requestedVersion) || requestedVersion < 1) throw boardError(422, 'validation_error', 'version is required');
      const decision = String(body?.decision || '').trim();
      if (decision !== 'approve' && decision !== 'request_changes') {
        throw boardError(422, 'validation_error', 'decision must be approve or request_changes');
      }
      const reason = ensureLength(body?.reason || '', 'reason', 0, LIMITS.descriptionMax);
      const id = ensureId(taskId);
      return mutateTask(id, actor, async (task) => {
        if (task.version !== requestedVersion) throw boardError(409, 'conflict', 'Version mismatch', { expected: task.version, got: requestedVersion });
        if (!task.review?.required) throw boardError(409, 'review_not_required', 'review is not required for this task');
        const reviewers = task.review?.reviewers || [];
        if (!reviewers.includes(actorId)) throw boardError(403, 'forbidden', 'actor is not an authorized reviewer');
        assertReviewStateTransition(task.review.state, decision === 'approve' ? 'approved' : 'changes_requested');
        task.review.state = decision === 'approve' ? 'approved' : 'changes_requested';
        task.review.decision = decision === 'approve' ? 'approve' : 'request_changes';
        task.review.decided_at = nowIso();
        task.review.decided_by = actorId;
        if (decision === 'approve') {
          if (task.status === 'needs_review') task.status = 'done';
          clearBlockedState(task);
        } else {
          if (task.status === 'needs_review' || task.status === 'done') task.status = 'in_progress';
          if (reason) {
            task.description = `${task.description || ''}${task.description ? '\n\n' : ''}Review changes requested: ${reason}`.slice(0, LIMITS.descriptionMax);
          }
        }
        applyInvariants(task);
        return task;
      }, 'task_review_decision', { skipProjectWriteCheck: true });
    },

    async getProjectActivity(projectId, actor) {
      const located = await assertProjectReadable(projectId, actor);
      return storage.readActivity(located.scope, (row) => row.project_id === located.project.id || row.entity_id === located.project.id);
    },

    async getProjectAudit(projectId, actor) {
      const located = await assertProjectReadable(projectId, actor);
      return storage.readAudit(located.scope, (row) => row.project_id === located.project.id || row.entity_id === located.project.id);
    },

    async getMetadata() {
      const agents = [...(await listCanonicalAgentIds())].sort();
      const workflows = [...(await listCanonicalWorkflowIds())].sort();
      const statusTransitions = Object.fromEntries(
        Object.entries(TASK_STATUS_TRANSITIONS).map(([from, allowed]) => [from, [...allowed.values()]])
      );
      return {
        canonical: {
          agents,
          workflows,
        },
        defaults: {
          assignee_type: 'agent',
          assignee_id: 'danny',
          visibility: 'private',
        },
        visibility_options: ['private', 'team'],
        task_status_transitions: statusTransitions,
      };
    },

    async migrateProjectVisibility(projectId, body, actor) {
      const actorId = actorIdFrom(actor);
      if (!actor?.isHuman) throw boardError(403, 'forbidden', 'migration requires authenticated human');
      const requestedVersion = Number(body?.version);
      if (!Number.isInteger(requestedVersion) || requestedVersion < 1) throw boardError(422, 'validation_error', 'version is required');
      const toVisibility = ensureEnum(String(body?.to_visibility || ''), PROJECT_VISIBILITIES, 'to_visibility');
      const operationId = ensureId(body?.operation_id || `mig_${Date.now().toString(36)}`, 'operation_id');
      const action = String(body?.action || 'resume');
      if (!new Set(['start', 'resume', 'rollback']).has(action)) throw boardError(422, 'validation_error', 'action must be start|resume|rollback');

      const pid = ensureId(projectId);
      return storage.withLock(`project:${pid}`, async () => {
        const scopeReads = await Promise.all(['private', 'team'].map(async (scope) => {
          try {
            const project = await storage.readProject(scope, pid);
            return project ? { scope, project } : null;
          } catch (err) {
            if (scope === 'team' && (err?.code === 'team_root_unconfigured' || err?.code === 'team_root_unavailable')) return null;
            throw err;
          }
        }));
        const entries = scopeReads.filter(Boolean);
        if (!entries.length) throw boardError(404, 'not_found', 'project not found');

        const byOperation = entries.find((e) => e.project?.scope_migration?.operation_id === operationId);
        const inProgress = entries.find((e) => {
          const state = String(e.project?.scope_migration?.state || '').toLowerCase();
          return state && state !== 'completed' && state !== 'rolled_back';
        });
        const sourceCandidate = entries.find((e) => e.project.visibility !== toVisibility);
        const targetCandidate = entries.find((e) => e.project.visibility === toVisibility);
        const located = byOperation || inProgress || sourceCandidate || targetCandidate || entries[0];

        if (!canWriteProject(located.project, actor)) throw boardError(403, 'forbidden', 'project access denied');
        const versionMatches = entries.some((e) => e.project.version === requestedVersion);
        if (!versionMatches) {
          throw boardError(409, 'conflict', 'Version mismatch', { expected: located.project.version, got: requestedVersion });
        }

        const toScope = toVisibility === 'team' ? 'team' : 'private';
        storage.resolveScopeRoot(toScope);

        const existingMarker = located.project.scope_migration || null;
        const markerState = String(existingMarker?.state || '').toLowerCase();
        if (existingMarker?.operation_id && action !== 'start' && existingMarker.operation_id !== operationId && markerState && markerState !== 'completed' && markerState !== 'rolled_back') {
          throw boardError(409, 'migration_operation_mismatch', 'migration operation_id mismatch', {
            expected_operation_id: existingMarker.operation_id,
            got_operation_id: operationId,
          });
        }
        if (located.project.visibility === toVisibility && (!markerState || markerState === 'completed')) {
          return located.project;
        }

        const fromScopeDefault = toScope === 'team' ? 'private' : 'team';
        const fromScope = existingMarker?.from_scope
          || sourceCandidate?.scope
          || (located.scope === toScope ? fromScopeDefault : located.scope);
        const marker = {
          operation_id: existingMarker?.operation_id || operationId,
          from_visibility: existingMarker?.from_visibility || (fromScope === 'team' ? 'team' : 'private'),
          to_visibility: existingMarker?.to_visibility || toVisibility,
          from_scope: fromScope,
          to_scope: toScope,
          state: existingMarker?.state || 'staged',
          started_at: existingMarker?.started_at || nowIso(),
          updated_at: nowIso(),
        };

        const allTasksByScope = {};
        for (const scope of ['private', 'team']) {
          const hasProject = entries.some((e) => e.scope === scope);
          if (!hasProject) {
            allTasksByScope[scope] = [];
            continue;
          }
          try {
            allTasksByScope[scope] = await storage.listProjectTasks(scope, pid);
          } catch (err) {
            if (scope === 'team' && (err?.code === 'team_root_unconfigured' || err?.code === 'team_root_unavailable')) {
              allTasksByScope[scope] = [];
              continue;
            }
            throw err;
          }
        }
        if (action !== 'rollback' && Object.values(allTasksByScope).flat().some((t) => ACTIVE_EXECUTION_STATES.has(t.execution?.state))) {
          throw boardError(409, 'execution_active', 'cannot migrate project while task execution is active');
        }

        const desiredScope = action === 'rollback' ? marker.from_scope : marker.to_scope;
        const desiredVisibility = action === 'rollback' ? marker.from_visibility : marker.to_visibility;
        storage.resolveScopeRoot(desiredScope);

        const desiredEntry = entries.find((e) => e.scope === desiredScope) || null;
        const baseProject = desiredEntry?.project || located.project;
        const desiredProject = {
          ...baseProject,
          visibility: desiredVisibility,
          scope_migration: {
            ...marker,
            state: action === 'rollback' ? 'rolled_back' : 'completed',
            completed_at: action === 'rollback' ? existingMarker?.completed_at || null : nowIso(),
            updated_at: nowIso(),
          },
          updated_at: nowIso(),
          updated_by: actorId,
          version: (desiredEntry?.project?.version || baseProject.version || 0) + 1,
        };

        await storage.writeProject(desiredScope, pid, desiredProject, {
          expectedVersion: desiredEntry?.project?.version ?? null,
        });

        const desiredTasks = allTasksByScope[desiredScope] || [];
        const desiredTaskIds = new Set(desiredTasks.map((t) => t.id));
        const allTasks = Object.values(allTasksByScope).flat();
        for (const task of allTasks) {
          if (desiredTaskIds.has(task.id)) continue;
          await storage.writeTask(desiredScope, task.id, {
            ...task,
            visibility: desiredVisibility,
          }, { expectedVersion: null });
        }

        for (const scope of ['private', 'team']) {
          if (scope === desiredScope) continue;
          if (!entries.some((e) => e.scope === scope)) continue;
          const tasks = allTasksByScope[scope] || [];
          for (const task of tasks) {
            await storage.deleteTask(scope, task.id);
          }
          await storage.deleteProject(scope, pid);
        }

        return desiredProject;
      });
    },

    async readTaskArtifact({ taskId, attemptId, artifactPath, actor }) {
      const located = await assertTaskReadable(taskId, actor);
      const task = located.task;
      const allowedAttempts = (task.execution?.attempts || []).filter((a) => a.attempt_id === attemptId);
      if (!allowedAttempts.length) throw boardError(404, 'not_found', 'artifact attempt not found');
      const attempt = allowedAttempts[0];
      const normalized = path.posix.normalize('/' + String(artifactPath || '').replace(/\\/g, '/')).slice(1);
      if (!normalized || normalized.includes('..')) throw boardError(422, 'validation_error', 'invalid artifact path');
      const fallbackRoot = path.posix.join('artifacts/project-board', task.visibility || 'private', task.id, attemptId);
      const scopedAttemptRoot = String(attempt.output_root || '').trim();
      const strictAttemptRootRe = new RegExp(`^artifacts/project-board/(private|team)/${task.id}/${attemptId}$`);
      const rootCandidates = [fallbackRoot];
      if (strictAttemptRootRe.test(scopedAttemptRoot)) rootCandidates.push(scopedAttemptRoot);
      const uniqueRoots = [...new Set(rootCandidates)];
      const candidateRels = uniqueRoots.map((root) => path.posix.join(root, normalized));
      const linkedRef = (task.execution?.artifact_paths || []).some((p) => candidateRels.includes(p) || candidateRels.some((rel) => String(p || '').endsWith('/' + normalized)))
        || (task.linked_paths || []).some((p) => candidateRels.includes(p.path) || candidateRels.some((rel) => String(p.path || '').endsWith('/' + normalized)));
      if (!linkedRef) {
        throw boardError(404, 'not_found', 'artifact not linked to attempt');
      }
      for (const rel of candidateRels) {
        const abs = path.join(rootDir, rel);
        const lst = await fsp.lstat(abs).catch(() => null);
        if (!lst || !lst.isFile() || lst.isSymbolicLink()) continue;
        const real = await fsp.realpath(abs).catch(() => null);
        const confined = real && uniqueRoots.some((root) => isPathWithin(path.join(rootDir, root), real));
        if (!confined) throw boardError(403, 'forbidden', 'artifact escaped confinement');
        return { abs: real, rel };
      }
      throw boardError(404, 'not_found', 'artifact not found');
    },

    async applySchedulerEvent(event) {
      if (event?.meta?.source !== 'project-board') return;
      const mapped = {
        queued: 'queued',
        started: 'started',
        ok: 'succeeded',
        error: 'failed',
        timeout: 'timed_out',
        cancelled: 'cancelled',
      };
      const next = mapped[event.type];
      if (!next) return;
      await this.executionCallback({
        task_id: event.meta.task_id,
        attempt_id: event.meta.attempt_id,
        state: next,
        scheduler_job_id: event.jobId,
        scheduler_run_id: event.runId,
        result_summary: event.summary || null,
        failure_summary: event.summary || null,
      }, { id: 'scheduler', isInternal: true });
    },
  };
}
