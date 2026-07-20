import path from 'node:path';
import { createHash } from 'node:crypto';
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
  WORK_TYPES,
} from './constants.mjs';
import { boardError } from './errors.mjs';
import {
  ensureEnum,
  ensureLength,
  ensureId,
  normalizeDueAt,
  sanitizeComponentTags,
  sanitizeCompletionPercent,
  sanitizeCustomFields,
  sanitizeDependencies,
  sanitizeExternalLinks,
  sanitizeHumanAssigneeLabel,
  sanitizeReviewers,
  sanitizeSprint,
  sanitizeStoryPoints,
  sanitizeSubtasks,
  sanitizeWorkType,
  validateLinkedPaths,
  validateLinkedRuns,
  validateProjectCreate,
  validateTaskCreate,
} from './validators.mjs';
import { assertReviewStateTransition, assertTaskStatusTransition } from './transitions.mjs';

function nowIso() { return new Date().toISOString(); }

const DEFAULT_ARTIFACT_ALLOWED_CONTENT_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/xml',
  'application/json',
  'application/pdf',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
const DEFAULT_ARTIFACT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_ARTIFACT_HASH_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_ARTIFACT_RETENTION_CLASS = 'task_attempt';
const EXT_TO_CONTENT_TYPE = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

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

function slashPath(value) {
  return String(value || '').split(path.sep).join('/');
}

function parsePositiveIntOr(defaultValue, raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.floor(n);
}

function artifactPolicy() {
  const allowedRaw = String(process.env.BOARD_ARTIFACT_ALLOWED_CONTENT_TYPES || '').trim();
  const allowed = new Set(
    (allowedRaw
      ? allowedRaw.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
      : [...DEFAULT_ARTIFACT_ALLOWED_CONTENT_TYPES])
  );
  return {
    allowedContentTypes: allowed,
    maxBytes: parsePositiveIntOr(DEFAULT_ARTIFACT_MAX_BYTES, process.env.BOARD_ARTIFACT_MAX_BYTES),
    hashMaxBytes: parsePositiveIntOr(DEFAULT_ARTIFACT_HASH_MAX_BYTES, process.env.BOARD_ARTIFACT_HASH_MAX_BYTES),
    retentionClass: String(process.env.BOARD_ARTIFACT_RETENTION_CLASS || DEFAULT_ARTIFACT_RETENTION_CLASS).trim() || DEFAULT_ARTIFACT_RETENTION_CLASS,
  };
}

function contentTypeForArtifactFile(relPath) {
  const ext = path.extname(String(relPath || '')).toLowerCase();
  return EXT_TO_CONTENT_TYPE[ext] || 'application/octet-stream';
}

function safeArtifactReferenceForAudit({ artifactId = null, taskId = null, attemptId = null, relPath = null }) {
  const sanitizedRel = String(relPath || '').replace(/\\/g, '/').split('/').filter(Boolean).slice(-3).join('/');
  if (artifactId) return `id:${artifactId}`;
  if (taskId && attemptId && sanitizedRel) return `legacy:${taskId}/${attemptId}/${sanitizedRel}`;
  if (taskId && attemptId) return `legacy:${taskId}/${attemptId}`;
  return 'unknown';
}

async function sha256File(absFile) {
  const hash = createHash('sha256');
  const fh = await fsp.open(absFile, 'r');
  try {
    const stream = fh.createReadStream();
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest('hex');
  } finally {
    await fh.close();
  }
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

function normalizeTaskShape(task) {
  task.subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  task.human_assignee_label = sanitizeHumanAssigneeLabel(task.human_assignee_label);
  try { task.work_type = sanitizeWorkType(task.work_type); } catch { task.work_type = 'feature'; }
  try { task.component_tags = sanitizeComponentTags(task.component_tags); } catch { task.component_tags = []; }
  try { task.sprint = sanitizeSprint(task.sprint); } catch { task.sprint = null; }
  try { task.story_points = sanitizeStoryPoints(task.story_points); } catch { task.story_points = null; }
  try { task.completion_percent = sanitizeCompletionPercent(task.completion_percent); } catch { task.completion_percent = 0; }
  try { task.dependencies = sanitizeDependencies(task.dependencies); } catch { task.dependencies = []; }
  try { task.external_links = sanitizeExternalLinks(task.external_links); } catch { task.external_links = []; }
  try { task.custom_fields = sanitizeCustomFields(task.custom_fields); } catch { task.custom_fields = {}; }
  task.execution = task.execution && typeof task.execution === 'object' ? task.execution : {};
  task.execution.attempts = Array.isArray(task.execution.attempts) ? task.execution.attempts : [];
  task.execution.execution_updates = Array.isArray(task.execution.execution_updates) ? task.execution.execution_updates : [];
  task.execution.artifact_paths = Array.isArray(task.execution.artifact_paths) ? task.execution.artifact_paths : [];
}

function appendExecutionUpdate(task, update) {
  normalizeTaskShape(task);
  const entry = {
    timestamp: nowIso(),
    attempt_id: task.execution?.attempt_id || null,
    state: String(update?.state || task.execution?.state || 'none'),
    summary: ensureLength(String(update?.summary || '').trim(), 'execution_updates.summary', 0, LIMITS.failureSummaryMax),
    source: String(update?.source || 'scheduler'),
  };
  task.execution.execution_updates = appendNewestBounded(
    task.execution.execution_updates || [],
    [entry],
    LIMITS.executionUpdatesMax,
    (item) => `${item.timestamp}:${item.attempt_id || 'none'}:${item.state}:${item.source}:${item.summary}`,
  );
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

export function createBoardService({ rootDir, guardrails, scheduler, storage, getRuntimeSettingsRaw, listCanonicalAgentIds, listCanonicalWorkflowIds, resolveDeploymentState }) {
  async function getDeploymentState() {
    if (typeof resolveDeploymentState === 'function') {
      const state = await resolveDeploymentState();
      if (state && typeof state === 'object') return state;
    }
    return {
      requestedDeployment: 'team-server',
      effectiveDeployment: 'team-server',
      teamCapability: { status: 'enabled', reason: null },
    };
  }

  async function assertTeamCapabilityAvailable() {
    const state = await getDeploymentState();
    const capabilityStatus = String(state?.teamCapability?.status || '').toLowerCase();
    const capabilityEnabled = capabilityStatus === 'enabled';
    if (state?.effectiveDeployment === 'team-server' && capabilityEnabled) return;
    throw boardError(503, 'TEAM_CAPABILITY_UNAVAILABLE', 'team board capability is unavailable', {
      requestedDeployment: state?.requestedDeployment || null,
      effectiveDeployment: state?.effectiveDeployment || null,
      reason: state?.teamCapability?.reason || null,
    });
  }

  async function assertTeamMutationAllowed(scope) {
    if (scope !== 'team') return;
    await assertTeamCapabilityAvailable();
  }

  async function appendEvents(scope, record) {
    await storage.appendActivity(scope, record);
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

  async function auditArtifactAccess({
    actor,
    operation,
    result,
    reasonCode = null,
    scope = null,
    projectId = null,
    taskId = null,
    attemptId = null,
    artifactId = null,
    relPath = null,
  }) {
    await storage.appendArtifactAccessAudit({
      actorId: actorIdFrom(actor),
      operation,
      scope,
      projectId,
      taskId,
      attemptId,
      artifactId,
      artifactReference: safeArtifactReferenceForAudit({ artifactId, taskId, attemptId, relPath }),
      result,
      reasonCode,
    });
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
      await assertTeamMutationAllowed(located.scope);
      if (!canWriteProject(located.project, actor)) throw boardError(403, 'forbidden', 'project access denied');
      const existing = located.project;
      const before = existing.version;
      const next = await mutator(existing);
      next.schema_version = SCHEMA_VERSION;
      next.updated_at = nowIso();
      next.updated_by = actorId;
      next.version = before + 1;
      await storage.writeProject(located.scope, id, next, {
        expectedVersion: before,
        event: makeEvent({
          entityType: 'project',
          entityId: id,
          projectId: id,
          action,
          actorId,
          oldVersion: before,
          newVersion: next.version,
        }),
      });
      return next;
    });
  }

  async function mutateTask(id, actor, mutator, action, options = {}) {
    return storage.withLock(`task:${id}`, async () => {
      const actorId = actorIdFrom(actor);
      const located = await assertTaskReadable(id, actor);
      await assertTeamMutationAllowed(located.scope);
      if (!options.skipProjectWriteCheck && !canWriteProject(located.project, actor)) {
        throw boardError(403, 'forbidden', 'task access denied');
      }
      const existing = located.task;
      normalizeTaskShape(existing);
      const before = existing.version;
      const next = await mutator(existing);
      next.schema_version = SCHEMA_VERSION;
      next.updated_at = nowIso();
      next.updated_by = actorId;
      next.version = before + 1;
      await storage.writeTask(located.scope, id, next, {
        expectedVersion: before,
        event: makeEvent({
          entityType: 'task',
          entityId: id,
          projectId: next.project_id,
          action,
          actorId,
          oldVersion: before,
          newVersion: next.version,
        }),
      });
      return next;
    });
  }

  async function assertCanonicalTaskRouting(task) {
    normalizeTaskShape(task);
    if (task.assignee_type === 'agent') {
      if (!task.assignee_id) throw boardError(422, 'validation_error', 'assignee_id required for assignee_type=agent');
      const agents = await listCanonicalAgentIds();
      if (!agents.has(task.assignee_id)) throw boardError(422, 'unknown_assignee', `unknown agent assignee_id: ${task.assignee_id}`);
      task.human_assignee_label = null;
    }
    if (task.assignee_type !== 'agent' && task.assignee_id) {
      ensureId(task.assignee_id, 'assignee_id');
    }
    if (task.assignee_type !== 'human') task.human_assignee_label = null;
    if (task.workflow_id) {
      const workflows = await listCanonicalWorkflowIds();
      if (!workflows.has(task.workflow_id)) throw boardError(422, 'unknown_workflow', `unknown workflow_id: ${task.workflow_id}`);
    }
  }

  function applyInvariants(task) {
    normalizeTaskShape(task);
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

  function resolveAttemptRoot(scope, visibility, taskId, attemptId) {
    const rootRef = path.posix.join('artifacts/project-board', visibility, taskId, attemptId);
    const scopeRootAbs = scope === 'team' ? storage.resolveScopeRoot('team') : storage.resolveScopeRoot('private');
    const absRoot = path.join(scopeRootAbs, rootRef);
    return { scope, visibility, rootRef, absRoot, scopeRootAbs };
  }

  async function assertNoSymlinkSegments(scopeRootAbs, absRoot) {
    const relSegments = path.relative(scopeRootAbs, absRoot).split(path.sep).filter(Boolean);
    let probe = scopeRootAbs;
    for (const segment of relSegments) {
      probe = path.join(probe, segment);
      const lst = await fsp.lstat(probe).catch(() => null);
      if (!lst) break;
      if (lst.isSymbolicLink()) {
        throw boardError(422, 'output_root_invalid', 'attempt output root contains a symlinked segment');
      }
    }
  }

  async function canonicalizeRootBoundary(scopeRootAbs, absRoot, visibility) {
    await assertNoSymlinkSegments(scopeRootAbs, absRoot);
    const realScopeRoot = await fsp.realpath(scopeRootAbs).catch(() => path.resolve(scopeRootAbs));
    const attemptBaseAbs = path.join(scopeRootAbs, 'artifacts', 'project-board', visibility);
    const attemptBaseRel = path.relative(scopeRootAbs, attemptBaseAbs);
    const realScopeAttemptBase = await fsp.realpath(attemptBaseAbs).catch(() => path.resolve(realScopeRoot, attemptBaseRel));
    if (!isPathWithin(realScopeRoot, realScopeAttemptBase)) {
      throw boardError(422, 'output_root_invalid', 'artifact base escaped scope root');
    }
    const attemptRel = path.relative(scopeRootAbs, absRoot);
    const realAttemptRoot = await fsp.realpath(absRoot).catch(() => path.resolve(realScopeRoot, attemptRel));
    if (!isPathWithin(realScopeAttemptBase, realAttemptRoot)) {
      throw boardError(422, 'output_root_invalid', 'attempt output root escaped confinement');
    }
    return { realScopeRoot, realScopeAttemptBase, realAttemptRoot };
  }

  async function registerAttemptArtifacts({ scope, visibility, taskId, attemptId }) {
    const attemptRoot = resolveAttemptRoot(scope, visibility, taskId, attemptId);
    const { rootRef, absRoot, scopeRootAbs } = attemptRoot;
    const { realAttemptRoot } = await canonicalizeRootBoundary(scopeRootAbs, absRoot, visibility);
    const policy = artifactPolicy();
    const out = [];
    const stack = [realAttemptRoot];
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
        if (!real || !isPathWithin(realAttemptRoot, real)) continue;
        const relFromAttempt = slashPath(path.relative(realAttemptRoot, real));
        if (!relFromAttempt || relFromAttempt.startsWith('..')) continue;
        const contentType = contentTypeForArtifactFile(relFromAttempt);
        if (!policy.allowedContentTypes.has(contentType.toLowerCase())) {
          throw boardError(422, 'artifact_type_rejected', 'artifact content type is not allowed by policy', {
            rel_path: relFromAttempt,
            content_type: contentType,
          });
        }
        const sizeBytes = Number(lst.size || 0);
        if (sizeBytes > policy.maxBytes) {
          throw boardError(422, 'artifact_size_rejected', 'artifact exceeds max size policy', {
            rel_path: relFromAttempt,
            size_bytes: sizeBytes,
            max_bytes: policy.maxBytes,
          });
        }
        let hashSha256 = null;
        if (sizeBytes > 0 && sizeBytes <= policy.hashMaxBytes) {
          hashSha256 = await sha256File(real).catch(() => null);
        }
        const pathRef = `${rootRef}/${relFromAttempt}`;
        out.push({
          path: pathRef,
          storage_ref: pathRef,
          kind: 'file',
          content_type: contentType,
          size_bytes: sizeBytes,
          hash_sha256: hashSha256,
          retention_class: policy.retentionClass,
        });
      }
    }
    return out;
  }

  async function createExecutionAttempt(task, actorId, idempotencyKey, trigger = 'manual', scope = 'private') {
    normalizeTaskShape(task);
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
    const guardrailPath = path.posix.join('artifacts/project-board', visibility, task.id, attemptId);
    const attemptRoot = resolveAttemptRoot(scope, visibility, task.id, attemptId);
    const { rootRef: outputRoot, absRoot: outputRootAbs, scopeRootAbs } = attemptRoot;
    const writeGate = guardrails.check(guardrailPath, 'write');
    if (!writeGate.allowed || writeGate.confirmRequired) {
      throw boardError(403, 'guardrail_denied', writeGate.reason || 'guardrail denied', { path: guardrailPath });
    }
    await assertNoSymlinkSegments(scopeRootAbs, outputRootAbs);
    await fsp.mkdir(outputRootAbs, { recursive: true });
    await canonicalizeRootBoundary(scopeRootAbs, outputRootAbs, visibility);

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
      output_root: outputRoot,
      instruction_snapshot: ensureLength(task.description || '', 'instruction_snapshot', 0, LIMITS.descriptionMax),
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
        attempt.instruction_snapshot || '',
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

  async function persistTaskMutation(scope, taskId, task, actorId, action, details = null) {
    await assertTeamMutationAllowed(scope);
    const before = task.version;
    task.version = before + 1;
    task.updated_at = nowIso();
    task.updated_by = actorId;
    await storage.writeTask(scope, taskId, task, {
      expectedVersion: before,
      event: makeEvent({
        entityType: 'task',
        entityId: taskId,
        projectId: task.project_id,
        action,
        actorId,
        oldVersion: before,
        newVersion: task.version,
        ...(details ? { details } : {}),
      }),
    });
  }

  async function reconcileDispatchFailure(task, summary) {
    await updateAttemptRecord(task, {
      state: 'failed',
      completed_at: nowIso(),
      failure_summary: ensureLength(summary || 'dispatch failed', 'failure_summary', 0, LIMITS.failureSummaryMax),
    });
    appendExecutionUpdate(task, {
      state: 'failed',
      summary: ensureLength(summary || 'dispatch failed', 'execution_updates.summary', 0, LIMITS.failureSummaryMax),
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

  function parseDeletePayload(body) {
    const requestedVersion = Number(body?.version);
    if (!Number.isInteger(requestedVersion) || requestedVersion < 1) throw boardError(422, 'validation_error', 'version is required');
    if (body?.confirm !== true) throw boardError(422, 'validation_error', 'confirm=true is required');
    return requestedVersion;
  }

  function parseArtifactStorageRef(ref, expectedTaskId = null, expectedAttemptId = null) {
    const normalized = slashPath(String(ref || '')).replace(/^\/+/, '');
    const match = normalized.match(/^artifacts\/project-board\/(private|team)\/([^/]+)\/([^/]+)\/(.+)$/);
    if (!match) return null;
    const [, visibility, taskId, attemptId, relPath] = match;
    if (expectedTaskId && taskId !== expectedTaskId) return null;
    if (expectedAttemptId && attemptId !== expectedAttemptId) return null;
    return {
      visibility,
      scope: visibility === 'team' ? 'team' : 'private',
      taskId,
      attemptId,
      relPath,
    };
  }

  async function resolveCatalogArtifactLocation(task, artifactRow) {
    const refs = [artifactRow?.storage_ref, artifactRow?.path].filter(Boolean);
    for (const ref of refs) {
      const parsed = parseArtifactStorageRef(ref, task.id, artifactRow?.attempt_id || null);
      if (!parsed) continue;
      const root = resolveAttemptRoot(parsed.scope, parsed.visibility, task.id, parsed.attemptId);
      const { realAttemptRoot } = await canonicalizeRootBoundary(root.scopeRootAbs, root.absRoot, parsed.visibility);
      const abs = path.join(root.absRoot, ...String(parsed.relPath || '').split('/'));
      const lst = await fsp.lstat(abs).catch(() => null);
      if (!lst || !lst.isFile() || lst.isSymbolicLink()) continue;
      const real = await fsp.realpath(abs).catch(() => null);
      if (!real || !isPathWithin(realAttemptRoot, real)) {
        throw boardError(403, 'forbidden', 'artifact escaped confinement');
      }
      return {
        abs: real,
        rel: slashPath(ref),
        relFilePath: parsed.relPath,
      };
    }
    return null;
  }

  async function quarantineArtifactPath({ scope, absPath, artifactId = null }) {
    if (!absPath) return null;
    const scopeRootAbs = storage.resolveScopeRoot(scope === 'team' ? 'team' : 'private');
    const quarantineDir = path.join(scopeRootAbs, 'artifacts', 'project-board', 'quarantine');
    await fsp.mkdir(quarantineDir, { recursive: true, mode: 0o700 });
    const base = path.basename(String(absPath || '')) || 'artifact.bin';
    const safeBase = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const quarantineName = `${artifactId || 'artifact'}_${Date.now()}_${safeBase}`;
    const quarantineAbs = path.join(quarantineDir, quarantineName);
    await fsp.rename(absPath, quarantineAbs).catch(() => null);
    return quarantineAbs;
  }

  async function validateCatalogArtifactReadIntegrity({ row, resolved }) {
    const policy = artifactPolicy();
    const lst = await fsp.lstat(resolved.abs).catch(() => null);
    if (!lst || !lst.isFile() || lst.isSymbolicLink()) {
      return { ok: false, reasonCode: 'artifact_missing_or_unsafe' };
    }
    const real = await fsp.realpath(resolved.abs).catch(() => null);
    if (!real || real !== resolved.abs) {
      return { ok: false, reasonCode: 'artifact_realpath_mismatch' };
    }
    const contentType = contentTypeForArtifactFile(resolved.relFilePath);
    if (!policy.allowedContentTypes.has(String(contentType || '').toLowerCase())) {
      return { ok: false, reasonCode: 'artifact_policy_type_mismatch' };
    }
    const sizeBytes = Number(lst.size || 0);
    if (sizeBytes > policy.maxBytes) {
      return { ok: false, reasonCode: 'artifact_policy_size_mismatch' };
    }
    if (row.size_bytes !== null && row.size_bytes !== undefined && Number(row.size_bytes) !== sizeBytes) {
      return { ok: false, reasonCode: 'artifact_catalog_size_mismatch' };
    }
    if (row.hash_sha256) {
      const hash = await sha256File(real).catch(() => null);
      if (!hash || hash !== String(row.hash_sha256)) {
        return { ok: false, reasonCode: 'artifact_catalog_hash_mismatch' };
      }
    }
    return {
      ok: true,
      contentType,
      sizeBytes,
    };
  }

  async function secureDeleteBestEffort(absPath) {
    const st = await fsp.stat(absPath).catch(() => null);
    if (!st || !st.isFile()) return { removed: false, overwritten: false };
    let overwritten = false;
    try {
      if (st.size > 0) {
        const fh = await fsp.open(absPath, 'r+');
        try {
          const chunk = Buffer.alloc(Math.min(st.size, 1024 * 1024), 0);
          let written = 0;
          while (written < st.size) {
            const next = Math.min(chunk.length, st.size - written);
            await fh.write(chunk.subarray(0, next), 0, next, written);
            written += next;
          }
          await fh.sync();
          overwritten = true;
        } finally {
          await fh.close();
        }
      }
    } catch {
      overwritten = false;
    }
    await fsp.unlink(absPath).catch(() => {});
    const exists = await fsp.stat(absPath).then(() => true).catch(() => false);
    return { removed: !exists, overwritten };
  }

  async function deleteCatalogArtifactInternal({ artifactRow, actorId, reasonCode }) {
    const dummyTask = { id: artifactRow.task_id };
    const resolved = await resolveCatalogArtifactLocation(dummyTask, artifactRow);
    const erase = resolved ? await secureDeleteBestEffort(resolved.abs) : { removed: false, overwritten: false };
    const eventId = randomUUID();
    await storage.markCatalogArtifactDeleted({
      artifactId: artifactRow.artifact_id,
      actorId,
      reason: reasonCode,
      eventId,
    });
    return { erase, eventId };
  }

  async function deleteTaskArtifactsByScopeTask({ scope, taskId, actor, reasonCode }) {
    const rows = await storage.listCatalogArtifacts({ scope, taskId, includeDeleted: false });
    const actorId = actorIdFrom(actor);
    for (const row of rows) {
      const deleted = await deleteCatalogArtifactInternal({ artifactRow: row, actorId, reasonCode });
      await auditArtifactAccess({
        actor,
        operation: 'delete',
        result: 'ok',
        scope: row.scope,
        projectId: row.project_id,
        taskId: row.task_id,
        attemptId: row.attempt_id,
        artifactId: row.artifact_id,
        reasonCode: deleted.erase.overwritten ? 'best_effort_overwrite_and_unlink' : 'unlink_only',
      });
    }
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
      await assertTeamMutationAllowed(scope);
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
        await storage.writeProject(scope, project.id, project, {
          expectedVersion: null,
          event: makeEvent({
            entityType: 'project',
            entityId: project.id,
            projectId: project.id,
            action: 'create_project',
            actorId,
            oldVersion: 0,
            newVersion: project.version,
          }),
        });
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
            case 'set_name':
              project.name = ensureLength(op.value || '', 'name', 1, LIMITS.projectNameMax);
              break;
            case 'set_description':
              project.description = ensureLength(op.value || '', 'description', 0, LIMITS.descriptionMax);
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

    async deleteProject(id, body, actor) {
      const requestedVersion = parseDeletePayload(body);
      const projectId = ensureId(id);
      return storage.withLock(`project:${projectId}`, async () => {
        const actorId = actorIdFrom(actor);
        const located = await findProjectScoped(projectId);
        if (!located) throw boardError(404, 'not_found', 'project not found');
        await assertTeamMutationAllowed(located.scope);
        if (!canWriteProject(located.project, actor)) throw boardError(403, 'forbidden', 'project access denied');
        if (located.project.version !== requestedVersion) {
          throw boardError(409, 'conflict', 'Version mismatch', { expected: located.project.version, got: requestedVersion });
        }
        const tasks = await storage.listProjectTasks(located.scope, projectId);
        const activeTask = tasks.find((task) => ACTIVE_EXECUTION_STATES.has(task.execution?.state || 'none'));
        if (activeTask) {
          throw boardError(409, 'execution_active', `cannot delete project while task ${activeTask.id} has active execution`);
        }
        const events = [
          ...tasks.map((task) => makeEvent({
            entityType: 'task',
            entityId: task.id,
            projectId,
            action: 'delete_task_cascade',
            actorId,
            oldVersion: task.version,
            newVersion: task.version + 1,
          })),
          makeEvent({
            entityType: 'project',
            entityId: projectId,
            projectId,
            action: 'delete_project',
            actorId,
            oldVersion: located.project.version,
            newVersion: located.project.version + 1,
            details: { deleted_task_ids: tasks.map((task) => task.id) },
          }),
        ];
        for (const task of tasks) {
          await deleteTaskArtifactsByScopeTask({
            scope: located.scope,
            taskId: task.id,
            actor,
            reasonCode: 'project_delete_cascade',
          });
        }
        await storage.deleteProject(located.scope, projectId, { events });
        return { id: projectId, deleted: true, cascade_deleted_tasks: tasks.length };
      });
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
      for (const task of all) normalizeTaskShape(task);
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
      await assertTeamMutationAllowed(locatedProject.scope);
      if (!canWriteProject(project, actor)) throw boardError(403, 'forbidden', 'project access denied');
      if (task.assignee_type === 'agent' && !task.assignee_id) task.assignee_id = 'danny';
      task.schema_version = SCHEMA_VERSION;
      task.created_by = actorId;
      task.updated_by = actorId;
      task.visibility = project.visibility || 'private';
      task.linked_paths = await validateLinkedPaths({ items: body?.linked_paths || [], rootDir, guardrails });
      task.linked_runs = validateLinkedRuns(body?.linked_runs || []);
      normalizeTaskShape(task);
      await assertCanonicalTaskRouting(task);
      applyInvariants(task);

      await storage.withLock(`task:${task.id}`, async () => {
        const existing = await findTaskScoped(task.id);
        if (existing) throw boardError(409, 'conflict', 'task id already exists');
        await storage.writeTask(locatedProject.scope, task.id, task, {
          expectedVersion: null,
          event: makeEvent({
            entityType: 'task',
            entityId: task.id,
            projectId: task.project_id,
            action: 'create_task',
            actorId,
            oldVersion: 0,
            newVersion: task.version,
          }),
        });
      });
      return task;
    },

    async getTask(id, actor) {
      const located = await assertTaskReadable(id, actor);
      normalizeTaskShape(located.task);
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
        normalizeTaskShape(task);
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
              if (nextStatus === 'backlog' && ACTIVE_EXECUTION_STATES.has(task.execution?.state || 'none')) {
                throw boardError(422, 'invalid_transition', 'cannot move task to backlog while execution is active');
              }
              if (nextStatus !== 'backlog') {
                assertTaskStatusTransition(task.status, nextStatus);
              }
              if (task.status === 'blocked' && nextStatus !== 'blocked') {
                clearBlockedState(task);
              }
              if (nextStatus === 'backlog') {
                clearBlockedState(task);
                task.review.state = 'none';
                task.review.decision = null;
                task.review.decided_at = null;
                task.review.decided_by = null;
              }
              task.status = nextStatus;
              if (nextStatus === 'needs_review') task.review.state = 'needs_review';
              break;
            }
            case 'set_title':
              task.title = ensureLength(op.value || '', 'title', 1, LIMITS.taskTitleMax);
              break;
            case 'set_description':
              task.description = ensureLength(op.value || '', 'description', 0, LIMITS.descriptionMax);
              break;
            case 'set_priority':
              task.priority = ensureEnum(op.value, PRIORITIES, 'priority');
              break;
            case 'set_work_type':
              task.work_type = sanitizeWorkType(op.value);
              break;
            case 'set_component_tags':
              task.component_tags = sanitizeComponentTags(op.value);
              break;
            case 'set_sprint':
              task.sprint = sanitizeSprint(op.value);
              break;
            case 'set_story_points':
              task.story_points = sanitizeStoryPoints(op.value);
              break;
            case 'set_completion_percent':
              task.completion_percent = sanitizeCompletionPercent(op.value);
              break;
            case 'set_dependencies':
              task.dependencies = sanitizeDependencies(op.value);
              break;
            case 'set_external_links':
              task.external_links = sanitizeExternalLinks(op.value);
              break;
            case 'set_custom_fields':
              task.custom_fields = sanitizeCustomFields(op.value);
              break;
            case 'set_assignee': {
              const type = ensureEnum(op?.value?.assignee_type, ASSIGNEE_TYPES, 'assignee_type');
              task.assignee_type = type;
              task.assignee_id = op?.value?.assignee_id ? ensureId(op.value.assignee_id, 'assignee_id') : null;
              task.workflow_id = op?.value?.workflow_id ? ensureId(op.value.workflow_id, 'workflow_id') : task.workflow_id;
              task.human_assignee_label = sanitizeHumanAssigneeLabel(op?.value?.human_assignee_label);
              await assertCanonicalTaskRouting(task);
              break;
            }
            case 'set_workflow_id':
              task.workflow_id = op?.value ? ensureId(op.value, 'workflow_id') : null;
              break;
            case 'set_subtasks':
              task.subtasks = sanitizeSubtasks(op.value);
              break;
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

    async deleteTask(id, body, actor) {
      const requestedVersion = parseDeletePayload(body);
      const taskId = ensureId(id);
      return storage.withLock(`task:${taskId}`, async () => {
        const actorId = actorIdFrom(actor);
        const located = await assertTaskReadable(taskId, actor);
        await assertTeamMutationAllowed(located.scope);
        if (!canWriteProject(located.project, actor)) throw boardError(403, 'forbidden', 'task access denied');
        if (located.task.version !== requestedVersion) {
          throw boardError(409, 'conflict', 'Version mismatch', { expected: located.task.version, got: requestedVersion });
        }
        if (ACTIVE_EXECUTION_STATES.has(located.task.execution?.state || 'none')) {
          throw boardError(409, 'execution_active', 'cannot delete task while execution is active');
        }
        await deleteTaskArtifactsByScopeTask({
          scope: located.scope,
          taskId,
          actor,
          reasonCode: 'task_delete_cascade',
        });
        await storage.deleteTask(located.scope, taskId, { event: makeEvent({
          entityType: 'task',
          entityId: taskId,
          projectId: located.task.project_id,
          action: 'delete_task',
          actorId,
          oldVersion: located.task.version,
          newVersion: located.task.version + 1,
        }) });
        return { id: taskId, deleted: true };
      });
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
        await assertTeamMutationAllowed(located.scope);
        if (!canWriteProject(located.project, actor)) throw boardError(403, 'forbidden', 'task access denied');
        const task = located.task;
        normalizeTaskShape(task);
        const priorAttempt = (task.execution?.attempts || []).find((a) => a.idempotency_key === idempotencyKey);
        if (priorAttempt) return { task, statusCode: 202 };
        if (task.version !== requestedVersion) throw boardError(409, 'conflict', 'Version mismatch', { expected: task.version, got: requestedVersion });
        await ensureRunnableProject(task);
        if (task.assignee_type !== 'agent') throw boardError(422, 'validation_error', 'task assignee_type must be agent to run');
        if (task.status === 'done') throw boardError(422, 'validation_error', 'done task cannot be run');
        await assertCanonicalTaskRouting(task);
        const prepared = await createExecutionAttempt(task, actorId, idempotencyKey, 'manual', located.scope);
        if (prepared.sameAttempt) return { task, statusCode: 202 };

        appendExecutionUpdate(task, {
          state: 'prepared',
          summary: 'execution prepared',
        });
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
        appendExecutionUpdate(task, {
          state: 'queued',
          summary: `queued in scheduler job ${created.job.id}`,
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
        normalizeTaskShape(task);
        if (task.version !== requestedVersion) throw boardError(409, 'conflict', 'Version mismatch', { expected: task.version, got: requestedVersion });
        if (!ACTIVE_EXECUTION_STATES.has(task.execution?.state)) throw boardError(409, 'execution_inactive', 'no active attempt to cancel');
        const runId = task.execution.scheduler_run_id;
        if (runId) {
          const result = await scheduler.cancelRun(runId);
          if (result?.errors) throw boardError(422, 'scheduler_error', 'cancel failed', { errors: result.errors });
        }
        await updateAttemptRecord(task, { state: 'cancel_requested' });
        appendExecutionUpdate(task, {
          state: 'cancel_requested',
          summary: 'cancel requested',
        });
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
        await assertTeamMutationAllowed(located.scope);
        if (!canWriteProject(located.project, actor)) throw boardError(403, 'forbidden', 'task access denied');
        const task = located.task;
        normalizeTaskShape(task);
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
        const prepared = await createExecutionAttempt(task, actorId, idempotencyKey, 'retry', located.scope);
        if (prepared.sameAttempt) return { task, statusCode: 202 };

        appendExecutionUpdate(task, {
          state: 'prepared',
          summary: 'retry execution prepared',
        });
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
        appendExecutionUpdate(task, {
          state: 'queued',
          summary: `retry queued in scheduler job ${created.job.id}`,
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
        await assertTeamMutationAllowed(located.scope);
        const task = located.task;
        normalizeTaskShape(task);
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
          appendExecutionUpdate(task, { state: 'queued', summary: 'scheduler queued callback received' });
        } else if (state === 'started') {
          await updateAttemptRecord(task, {
            state: 'running',
            started_at: task.execution?.started_at || nowIso(),
          });
          appendExecutionUpdate(task, { state: 'running', summary: 'scheduler started callback received' });
        } else if (state === 'succeeded') {
          const runId = body?.scheduler_run_id || task.execution?.scheduler_run_id;
          const artifacts = await registerAttemptArtifacts({
            scope: located.scope,
            visibility: task.visibility || 'private',
            taskId: task.id,
            attemptId,
          });
          const catalogArtifacts = await storage.upsertCatalogArtifacts({
            scope: located.scope,
            projectId: task.project_id,
            taskId: task.id,
            attemptId,
            actorId,
            retentionClass: artifactPolicy().retentionClass,
            artifacts,
          });
          task.linked_runs = appendNewestBounded(
            task.linked_runs || [],
            runId ? [{ source: 'scheduler', id: String(runId) }] : [],
            LIMITS.linkedRunsMax,
            (r) => `${r.source}:${r.id}`,
          );
          task.linked_paths = appendNewestBounded(
            task.linked_paths || [],
            catalogArtifacts.map((a) => ({ ...a, kind: 'file' })),
            LIMITS.linkedPathsMax,
            (p) => p.path,
          );
          await updateAttemptRecord(task, {
            state: 'succeeded',
            completed_at: nowIso(),
            result_summary: ensureLength(redactedResultSummary || '', 'result_summary', 0, LIMITS.resultSummaryMax) || null,
            failure_summary: null,
            artifact_paths: catalogArtifacts.map((a) => a.path),
            scheduler_run_id: runId || null,
            scheduler_job_id: callbackJobId || task.execution?.scheduler_job_id || null,
          });
          appendExecutionUpdate(task, {
            state: 'succeeded',
            summary: ensureLength(redactedResultSummary || 'execution succeeded', 'execution_updates.summary', 0, LIMITS.failureSummaryMax),
          });
          task.status = 'needs_review';
          task.review.state = 'needs_review';
          clearBlockedState(task);
        } else {
          const failedState = state === 'failed' ? 'failed' : state === 'timed_out' ? 'timed_out' : 'cancelled';
          const runId = callbackRunId || task.execution?.scheduler_run_id || null;
          const artifacts = await registerAttemptArtifacts({
            scope: located.scope,
            visibility: task.visibility || 'private',
            taskId: task.id,
            attemptId,
          });
          const catalogArtifacts = await storage.upsertCatalogArtifacts({
            scope: located.scope,
            projectId: task.project_id,
            taskId: task.id,
            attemptId,
            actorId,
            retentionClass: artifactPolicy().retentionClass,
            artifacts,
          });
          task.linked_paths = appendNewestBounded(
            task.linked_paths || [],
            catalogArtifacts.map((a) => ({ ...a, kind: 'file' })),
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
            artifact_paths: catalogArtifacts.map((a) => a.path),
          });
          appendExecutionUpdate(task, {
            state: failedState,
            summary: ensureLength(redactedFailureSummary || failedState, 'execution_updates.summary', 0, LIMITS.failureSummaryMax),
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
        await storage.writeTask(located.scope, taskId, task, {
          expectedVersion: before,
          event: makeEvent({
            entityType: 'task',
            entityId: taskId,
            projectId: task.project_id,
            action: 'execution_callback',
            actorId,
            oldVersion: before,
            newVersion: task.version,
            details: { attempt_id: attemptId, state },
          }),
        });
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

    async getProjectDashboard(projectId, actor) {
      const located = await assertProjectReadable(projectId, actor);
      const tasks = await storage.listProjectTasks(located.scope, located.project.id);
      const byStatus = Object.fromEntries([...TASK_STATUSES].map((status) => [status, 0]));
      const byPriority = Object.fromEntries([...PRIORITIES].map((priority) => [priority, 0]));
      const byWorkType = Object.fromEntries([...WORK_TYPES].map((workType) => [workType, 0]));
      const sprintBreakdown = {};
      const nowMs = Date.now();
      let blockedCount = 0;
      let overdueCount = 0;
      let inProgressCount = 0;
      let doneCount = 0;
      let completionTotal = 0;

      for (const task of tasks) {
        normalizeTaskShape(task);
        byStatus[task.status] = (byStatus[task.status] || 0) + 1;
        byPriority[task.priority] = (byPriority[task.priority] || 0) + 1;
        byWorkType[task.work_type] = (byWorkType[task.work_type] || 0) + 1;
        if (task.blocked?.is_blocked || task.status === 'blocked') blockedCount += 1;
        if (task.status === 'in_progress') inProgressCount += 1;
        if (task.status === 'done') doneCount += 1;

        const dueAtMs = task.due_at ? Date.parse(task.due_at) : NaN;
        if (Number.isFinite(dueAtMs) && dueAtMs < nowMs && task.status !== 'done') overdueCount += 1;
        completionTotal += Number.isInteger(task.completion_percent) ? task.completion_percent : 0;

        if (task.sprint) sprintBreakdown[task.sprint] = (sprintBreakdown[task.sprint] || 0) + 1;
      }

      const totalTasks = tasks.length;
      return {
        project_id: located.project.id,
        total_tasks: totalTasks,
        by_status: byStatus,
        by_priority: byPriority,
        by_work_type: byWorkType,
        blocked_count: blockedCount,
        overdue_count: overdueCount,
        in_progress_count: inProgressCount,
        done_count: doneCount,
        avg_completion_percent: totalTasks ? Math.round(completionTotal / totalTasks) : 0,
        sprint_breakdown: sprintBreakdown,
      };
    },

    async getProjectAudit(projectId, actor) {
      const located = await assertProjectReadable(projectId, actor);
      return storage.readAudit(located.scope, (row) => row.project_id === located.project.id || row.entity_id === located.project.id);
    },

    async getMetadata() {
      const agents = [...(await listCanonicalAgentIds())].sort();
      const workflows = [...(await listCanonicalWorkflowIds())].sort();
      let teamConfigured = true;
      let teamAvailable = true;
      try {
        storage.resolveScopeRoot('team');
      } catch (err) {
        if (err?.code === 'team_root_unconfigured') {
          teamConfigured = false;
          teamAvailable = false;
        } else if (err?.code === 'team_root_unavailable') {
          teamConfigured = true;
          teamAvailable = false;
        } else {
          throw err;
        }
      }
      const deploymentState = await getDeploymentState();
      const teamCapabilityEnabled = String(deploymentState?.teamCapability?.status || '').toLowerCase() === 'enabled'
        && deploymentState?.effectiveDeployment === 'team-server';
      const visibilityOptionsEffective = (teamAvailable && teamCapabilityEnabled) ? ['private', 'team'] : ['private'];
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
        visibility: {
          team_root_configured: teamConfigured,
          team_root_available: teamAvailable,
        },
        visibility_options: visibilityOptionsEffective,
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
        await assertTeamMutationAllowed(toScope);
        if (entries.some((e) => e.scope === 'team')) await assertTeamMutationAllowed('team');
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

    async readArtifactById({ artifactId, actor }) {
      const id = String(artifactId || '').trim();
      if (!id) throw boardError(422, 'validation_error', 'artifact_id is required');
      const row = await storage.readCatalogArtifactById(id);
      if (!row) {
        await auditArtifactAccess({ actor, operation: 'read', result: 'denied', reasonCode: 'artifact_not_found', artifactId: id });
        throw boardError(404, 'not_found', 'artifact not found');
      }
      let located;
      try {
        located = await assertTaskReadable(row.task_id, actor);
      } catch (err) {
        await auditArtifactAccess({
          actor,
          operation: 'read',
          result: 'denied',
          reasonCode: err?.code || 'access_denied',
          scope: row.scope,
          projectId: row.project_id,
          taskId: row.task_id,
          attemptId: row.attempt_id,
          artifactId: row.artifact_id,
        });
        throw err;
      }
      const rowProjectId = row.project_id || located.task.project_id;
      if (located.scope !== row.scope || located.task.project_id !== rowProjectId) {
        await auditArtifactAccess({
          actor,
          operation: 'read',
          result: 'denied',
          reasonCode: 'scope_mismatch',
          scope: row.scope,
          projectId: row.project_id,
          taskId: row.task_id,
          attemptId: row.attempt_id,
          artifactId: row.artifact_id,
        });
        throw boardError(409, 'conflict', 'artifact scope relationship mismatch');
      }
      if (row.deleted_at) {
        await auditArtifactAccess({
          actor,
          operation: 'read',
          result: 'denied',
          reasonCode: 'artifact_deleted',
          scope: row.scope,
          projectId: row.project_id,
          taskId: row.task_id,
          attemptId: row.attempt_id,
          artifactId: row.artifact_id,
        });
        throw boardError(404, 'not_found', 'artifact not found');
      }
      const resolved = await resolveCatalogArtifactLocation(located.task, row);
      if (!resolved) {
        await auditArtifactAccess({
          actor,
          operation: 'read',
          result: 'denied',
          reasonCode: 'artifact_missing',
          scope: row.scope,
          projectId: row.project_id,
          taskId: row.task_id,
          attemptId: row.attempt_id,
          artifactId: row.artifact_id,
        });
        throw boardError(404, 'not_found', 'artifact not found');
      }
      const integrity = await validateCatalogArtifactReadIntegrity({ row, resolved });
      if (!integrity.ok) {
        await quarantineArtifactPath({ scope: row.scope, absPath: resolved.abs, artifactId: row.artifact_id });
        await storage.markCatalogArtifactDeleted({
          artifactId: row.artifact_id,
          actorId: actorIdFrom(actor),
          reason: integrity.reasonCode,
          eventId: randomUUID(),
        }).catch(() => {});
        await auditArtifactAccess({
          actor,
          operation: 'read',
          result: 'denied',
          reasonCode: integrity.reasonCode,
          scope: row.scope,
          projectId: rowProjectId,
          taskId: row.task_id,
          attemptId: row.attempt_id,
          artifactId: row.artifact_id,
          relPath: resolved.relFilePath,
        });
        throw boardError(409, 'artifact_integrity_mismatch', 'artifact integrity validation failed');
      }
      await auditArtifactAccess({
        actor,
        operation: 'read',
        result: 'ok',
        scope: row.scope,
        projectId: rowProjectId,
        taskId: row.task_id,
        attemptId: row.attempt_id,
        artifactId: row.artifact_id,
        relPath: resolved.relFilePath,
      });
      return {
        artifact_id: row.artifact_id,
        abs: resolved.abs,
        rel: resolved.rel,
        content_type: row.content_type || integrity.contentType || contentTypeForArtifactFile(resolved.relFilePath),
      };
    },

    async readTaskArtifact({ taskId, attemptId, artifactPath, actor }) {
      const rawPath = String(artifactPath || '').replace(/\\/g, '/');
      const segments = rawPath.split('/').filter((seg) => seg.length > 0);
      const hasTraversal = segments.some((seg) => seg === '..' || seg === '.');
      const normalized = path.posix.normalize('/' + rawPath).slice(1);
      if (!normalized || hasTraversal || normalized.includes('..')) {
        await auditArtifactAccess({ actor, operation: 'read_legacy', result: 'denied', reasonCode: 'invalid_path', taskId, attemptId, relPath: normalized });
        throw boardError(422, 'validation_error', 'invalid artifact path');
      }
      let located;
      try {
        located = await assertTaskReadable(taskId, actor);
      } catch (err) {
        await auditArtifactAccess({ actor, operation: 'read_legacy', result: 'denied', reasonCode: err?.code || 'access_denied', taskId, attemptId, relPath: normalized });
        throw err;
      }
      const task = located.task;
      const allowedAttempts = (task.execution?.attempts || []).filter((a) => a.attempt_id === attemptId);
      if (!allowedAttempts.length) {
        await auditArtifactAccess({ actor, operation: 'read_legacy', result: 'denied', reasonCode: 'attempt_not_found', scope: located.scope, projectId: task.project_id, taskId: task.id, attemptId, relPath: normalized });
        throw boardError(404, 'not_found', 'artifact attempt not found');
      }
      const attempt = allowedAttempts[0];
      const roots = [resolveAttemptRoot(located.scope, task.visibility || 'private', task.id, attemptId)];
      const strictAttemptRootRe = new RegExp(`^artifacts/project-board/(private|team)/${task.id}/${attemptId}$`);
      const attemptOutputRoot = String(attempt.output_root || '').trim();
      const match = strictAttemptRootRe.exec(attemptOutputRoot);
      if (match) {
        const oldVisibility = match[1];
        const oldScope = oldVisibility === 'team' ? 'team' : 'private';
        const oldRoot = resolveAttemptRoot(oldScope, oldVisibility, task.id, attemptId);
        if (!roots.some((r) => r.scope === oldRoot.scope && r.rootRef === oldRoot.rootRef)) roots.push(oldRoot);
      }
      const candidatePaths = roots.map((root) => `${slashPath(root.rootRef)}/${normalized}`);
      let rows = await storage.listCatalogArtifactsByAttemptPathVariants({
        scope: located.scope,
        taskId: task.id,
        attemptId,
        candidatePaths,
      });

      if (!rows.length) {
        const linkedRef = (attempt.artifact_paths || []).some((p) => candidatePaths.includes(slashPath(p)))
          || (task.linked_paths || []).some((p) => candidatePaths.includes(slashPath(p?.path)));
        if (!linkedRef) {
          await auditArtifactAccess({ actor, operation: 'read_legacy', result: 'denied', reasonCode: 'not_linked', scope: located.scope, projectId: task.project_id, taskId: task.id, attemptId, relPath: normalized });
          throw boardError(404, 'not_found', 'artifact not linked to attempt');
        }
        for (const root of roots) {
          const parsed = parseArtifactStorageRef(`${slashPath(root.rootRef)}/${normalized}`, task.id, attemptId);
          if (!parsed) continue;
          const { realAttemptRoot } = await canonicalizeRootBoundary(root.scopeRootAbs, root.absRoot, root.visibility);
          const abs = path.join(root.absRoot, ...normalized.split('/'));
          const st = await fsp.stat(abs).catch(() => null);
          if (!st || !st.isFile()) continue;
          const real = await fsp.realpath(abs).catch(() => null);
          if (!real || !isPathWithin(realAttemptRoot, real)) continue;
          const type = contentTypeForArtifactFile(parsed.relPath);
          const policy = artifactPolicy();
          if (!policy.allowedContentTypes.has(type)) continue;
          if (Number(st.size || 0) > policy.maxBytes) continue;
          const hashSha256 = Number(st.size || 0) <= policy.hashMaxBytes ? await sha256File(real).catch(() => null) : null;
          const inserted = await storage.upsertCatalogArtifacts({
            scope: located.scope,
            projectId: task.project_id,
            taskId: task.id,
            attemptId,
            actorId: actorIdFrom(actor),
            retentionClass: policy.retentionClass,
            artifacts: [{
              path: `${slashPath(root.rootRef)}/${normalized}`,
              storage_ref: `${slashPath(root.rootRef)}/${normalized}`,
              content_type: type,
              size_bytes: Number(st.size || 0),
              hash_sha256: hashSha256,
            }],
          });
          rows = inserted.filter((r) => candidatePaths.includes(slashPath(r.path || '')));
          if (rows.length) break;
        }
      }

      const row = rows.find((r) => r.artifact_id) || rows[0];
      if (!row?.artifact_id) {
        await auditArtifactAccess({ actor, operation: 'read_legacy', result: 'denied', reasonCode: 'catalog_mapping_failed', scope: located.scope, projectId: task.project_id, taskId: task.id, attemptId, relPath: normalized });
        throw boardError(404, 'not_found', 'artifact not found');
      }
      await auditArtifactAccess({
        actor,
        operation: 'read_legacy',
        result: 'ok',
        scope: row.scope,
        projectId: row.project_id,
        taskId: row.task_id,
        attemptId: row.attempt_id,
        artifactId: row.artifact_id,
        relPath: normalized,
      });
      return this.readArtifactById({ artifactId: row.artifact_id, actor });
    },

    async deleteArtifactById({ artifactId, actor, reason = '' }) {
      const id = String(artifactId || '').trim();
      if (!id) throw boardError(422, 'validation_error', 'artifact_id is required');
      const row = await storage.readCatalogArtifactById(id);
      if (!row || row.deleted_at) {
        await auditArtifactAccess({ actor, operation: 'delete', result: 'denied', reasonCode: 'artifact_not_found', artifactId: id });
        throw boardError(404, 'not_found', 'artifact not found');
      }
      let located;
      try {
        located = await assertTaskReadable(row.task_id, actor);
      } catch (err) {
        await auditArtifactAccess({
          actor,
          operation: 'delete',
          result: 'denied',
          reasonCode: err?.code || 'access_denied',
          scope: row.scope,
          projectId: row.project_id,
          taskId: row.task_id,
          attemptId: row.attempt_id,
          artifactId: row.artifact_id,
        });
        throw err;
      }
      const rowProjectId = row.project_id || located.task.project_id;
      await assertTeamMutationAllowed(located.scope);
      if (!canWriteProject(located.project, actor)) {
        await auditArtifactAccess({
          actor,
          operation: 'delete',
          result: 'denied',
          reasonCode: 'forbidden',
          scope: row.scope,
          projectId: rowProjectId,
          taskId: row.task_id,
          attemptId: row.attempt_id,
          artifactId: row.artifact_id,
        });
        throw boardError(403, 'forbidden', 'artifact delete access denied');
      }
      const deleted = await deleteCatalogArtifactInternal({
        artifactRow: row,
        actorId: actorIdFrom(actor),
        reasonCode: String(reason || '').trim() || 'manual_delete',
      });
      await auditArtifactAccess({
        actor,
        operation: 'delete',
        result: 'ok',
        scope: row.scope,
        projectId: rowProjectId,
        taskId: row.task_id,
        attemptId: row.attempt_id,
        artifactId: row.artifact_id,
        reasonCode: deleted.erase.overwritten ? 'best_effort_overwrite_and_unlink' : 'unlink_only',
      });
      return {
        artifact_id: row.artifact_id,
        deleted: true,
        retention_class: row.retention_class || artifactPolicy().retentionClass,
        deletion: {
          removed: Boolean(deleted.erase.removed),
          overwrite_attempted: true,
          overwrite_succeeded: Boolean(deleted.erase.overwritten),
          guarantee: 'best_effort',
        },
      };
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
