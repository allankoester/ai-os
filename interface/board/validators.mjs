import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  ACTIVITY_STATUSES,
  ACTIVITY_VISIBILITIES,
  ASSIGNEE_TYPES,
  LIMITS,
  PRIORITIES,
  PROJECT_STATUSES,
  PROJECT_VISIBILITIES,
  REVIEW_DECISIONS,
  REVIEW_STATES,
  TASK_STATUSES,
  WORK_TYPES,
} from './constants.mjs';
import { boardError } from './errors.mjs';

const ID_RE = /^[a-z0-9_]{3,80}$/;
const SUBTASK_ID_RE = /^[a-z0-9_-]{1,80}$/;

function normString(value) {
  return String(value ?? '').trim();
}

export function ensureId(id, field = 'id') {
  const value = normString(id);
  if (!ID_RE.test(value)) {
    throw boardError(422, 'validation_error', `${field} must match ^[a-z0-9_]{3,80}$`);
  }
  return value;
}

export function ensureEnum(value, allowed, field) {
  if (!allowed.has(value)) throw boardError(422, 'validation_error', `${field} is invalid`);
  return value;
}

export function ensureLength(value, field, min, max) {
  const v = String(value ?? '');
  if (v.length < min || v.length > max) {
    throw boardError(422, 'validation_error', `${field} length must be ${min}..${max}`);
  }
  return v;
}

function normalizeIsoDateOrNull(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw boardError(422, 'validation_error', `${field} must be a valid ISO date-time`);
  return d.toISOString();
}

function ensureIntegerInRange(value, field, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw boardError(422, 'validation_error', `${field} must be an integer in range ${min}..${max}`);
  }
  return n;
}

function normalizeNullableString(value, field, max) {
  if (value === null || value === undefined || value === '') return null;
  return ensureLength(String(value).trim(), field, 1, max);
}

function ensureHttpUrl(value, field) {
  const raw = String(value ?? '').trim();
  if (!raw) throw boardError(422, 'validation_error', `${field} is required`);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw boardError(422, 'validation_error', `${field} must be a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw boardError(422, 'validation_error', `${field} must use http/https`);
  }
  return parsed.toString();
}

function dedupeStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function sanitizeReview(input, existing = null) {
  if (input && typeof input === 'object') {
    if (input.state !== undefined) throw boardError(422, 'validation_error', 'review.state is server-managed');
    if (input.decision !== undefined) throw boardError(422, 'validation_error', 'review.decision is server-managed');
    if (input.decided_at !== undefined) throw boardError(422, 'validation_error', 'review.decided_at is server-managed');
    if (input.decided_by !== undefined) throw boardError(422, 'validation_error', 'review.decided_by is server-managed');
  }
  const current = existing || {
    state: 'none',
    required: false,
    reviewers: [],
    decision: null,
    decided_at: null,
    decided_by: null,
  };
  return {
    state: current.state,
    required: Boolean(input?.required ?? current.required),
    reviewers: sanitizeReviewers(input?.reviewers ?? current.reviewers),
    decision: ensureReviewDecision(current.decision),
    decided_at: current.decided_at ?? null,
    decided_by: current.decided_by ?? null,
  };
}

export function sanitizeReviewers(value) {
  const reviewers = Array.isArray(value) ? value : [];
  if (reviewers.length > LIMITS.reviewersMax) throw boardError(422, 'validation_error', `reviewers max ${LIMITS.reviewersMax}`);
  return reviewers.map((v) => ensureId(v, 'reviewer_id'));
}

export function ensureReviewDecision(value) {
  if (!REVIEW_DECISIONS.has(value ?? null)) {
    throw boardError(422, 'validation_error', 'review.decision is invalid');
  }
  return value ?? null;
}

export function sanitizeBlocked(input, existing = null) {
  const curr = existing || { is_blocked: false, reason: '', since: null };
  const isBlocked = Boolean(input?.is_blocked ?? curr.is_blocked);
  const reason = ensureLength(input?.reason ?? curr.reason ?? '', 'blocked.reason', 0, LIMITS.descriptionMax);
  return {
    is_blocked: isBlocked,
    reason,
    since: isBlocked ? (input?.since ?? curr.since ?? new Date().toISOString()) : null,
  };
}

function isPathWithin(parentAbs, targetAbs) {
  const rel = path.relative(parentAbs, targetAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function normalizeRelPath(rawPath) {
  const raw = String(rawPath || '').trim();
  if (!raw) throw boardError(422, 'validation_error', 'linked path is required');
  if (path.isAbsolute(raw) || raw.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(raw)) {
    throw boardError(422, 'validation_error', 'absolute linked path is not allowed');
  }
  const decoded = decodeURIComponent(raw);
  if (decoded.includes('..') || /%2e%2e/i.test(raw)) {
    throw boardError(422, 'validation_error', 'path traversal is not allowed');
  }
  const normalized = path.posix.normalize('/' + raw.replace(/\\/g, '/')).slice(1);
  if (!normalized || normalized.startsWith('../')) {
    throw boardError(422, 'validation_error', 'invalid linked path');
  }
  return normalized;
}

const ALLOWED_PREFIXES = ['knowledge/company/', 'runs/', 'artifacts/project-board/'];
const DENIED_PREFIXES = ['knowledge/personal/', 'knowledge/inbox/', 'memory/', 'chat/', '.claude/', 'interface/', 'scheduler/', 'project-board/'];

export async function validateLinkedPaths({ items, rootDir, guardrails }) {
  const list = Array.isArray(items) ? items : [];
  if (list.length > LIMITS.linkedPathsMax) {
    throw boardError(422, 'validation_error', `linked_paths max ${LIMITS.linkedPathsMax}`);
  }
  const out = [];
  for (const item of list) {
    const normalized = normalizeRelPath(item?.path);
    if (!ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      throw boardError(422, 'validation_error', `linked path not allowed: ${normalized}`);
    }
    if (DENIED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      throw boardError(422, 'validation_error', `linked path denied: ${normalized}`);
    }
    const gate = guardrails.check(normalized, 'read');
    if (!gate.allowed) {
      throw boardError(403, 'guardrail_denied', gate.reason, { path: normalized });
    }
    const abs = path.resolve(rootDir, normalized);
    if (!isPathWithin(rootDir, abs)) throw boardError(422, 'validation_error', 'linked path escapes project root');
    const lst = await fsp.lstat(abs).catch(() => null);
    if (!lst) throw boardError(422, 'validation_error', `linked path not found: ${normalized}`);
    const realAbs = await fsp.realpath(abs).catch(() => null);
    if (!realAbs || !isPathWithin(rootDir, realAbs)) {
      throw boardError(422, 'validation_error', `linked path resolves outside root: ${normalized}`);
    }
    const kind = item?.kind === 'directory' ? 'directory' : 'file';
    const realStat = await fsp.stat(realAbs).catch(() => null);
    if (!realStat) throw boardError(422, 'validation_error', `linked path not found: ${normalized}`);
    if (kind === 'directory' && !realStat.isDirectory()) {
      throw boardError(422, 'validation_error', `linked path kind mismatch (expected directory): ${normalized}`);
    }
    if (kind === 'file' && !realStat.isFile()) {
      throw boardError(422, 'validation_error', `linked path kind mismatch (expected file): ${normalized}`);
    }
    out.push({ path: normalized, kind });
  }
  return out;
}

export function validateLinkedRuns(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length > LIMITS.linkedRunsMax) {
    throw boardError(422, 'validation_error', `linked_runs max ${LIMITS.linkedRunsMax}`);
  }
  return list.map((item) => {
    const source = String(item?.source || '').trim();
    if (!source) throw boardError(422, 'validation_error', 'linked_runs.source is required');
    if (source === 'runs') {
      const p = normalizeRelPath(item?.path);
      if (!p.startsWith('runs/') || !p.endsWith('.md')) {
        throw boardError(422, 'validation_error', 'linked_runs runs source requires runs/*.md path');
      }
      return { source: 'runs', path: p };
    }
    if (source === 'scheduler' || source === 'chat') {
      const id = normString(item?.id);
      if (!id) throw boardError(422, 'validation_error', `linked_runs source ${source} requires id`);
      return { source, id };
    }
    throw boardError(422, 'validation_error', `unknown linked_runs source: ${source}`);
  });
}

export function validateProjectCreate(body) {
  const now = new Date().toISOString();
  const id = ensureId(body?.id || slugify(body?.name || ''), 'id');
  const name = ensureLength(body?.name || '', 'name', 1, LIMITS.projectNameMax);
  const status = ensureEnum(body?.status || 'active', PROJECT_STATUSES, 'status');
  const visibility = ensureEnum(body?.visibility || 'private', PROJECT_VISIBILITIES, 'visibility');
  const description = ensureLength(body?.description || '', 'description', 0, LIMITS.descriptionMax);
  const tagsInput = Array.isArray(body?.tags) ? body.tags : [];
  if (tagsInput.length > LIMITS.tagsMax) throw boardError(422, 'validation_error', `tags max ${LIMITS.tagsMax}`);
  const tags = tagsInput.map((t) => String(t).trim()).filter(Boolean);
  return {
    id,
    name,
    status,
    visibility,
    owner_id: ensureId(body?.owner_id || body?.created_by || 'unknown', 'owner_id'),
    description,
    tags,
    linked_paths: [],
    linked_runs: [],
    review: sanitizeReview(body?.review),
    blocked: sanitizeBlocked(body?.blocked),
    version: 1,
    created_at: now,
    updated_at: now,
  };
}

function normalizeOptionalId(value, field) {
  if (value === null || value === undefined || value === '') return null;
  return ensureId(value, field);
}

export function validateActivityCreate(body) {
  const now = new Date().toISOString();
  const id = ensureId(body?.id || slugify(body?.name || ''), 'id');
  const name = ensureLength(body?.name || '', 'name', 1, LIMITS.activityNameMax);
  const status = ensureEnum(body?.status || 'active', ACTIVITY_STATUSES, 'status');
  const visibility = ensureEnum(body?.visibility || 'private', ACTIVITY_VISIBILITIES, 'visibility');
  const description = ensureLength(body?.description || '', 'description', 0, LIMITS.descriptionMax);
  const tagsInput = Array.isArray(body?.tags) ? body.tags : [];
  if (tagsInput.length > LIMITS.tagsMax) throw boardError(422, 'validation_error', `tags max ${LIMITS.tagsMax}`);
  const tags = tagsInput.map((t) => String(t).trim()).filter(Boolean);
  const custom_fields = sanitizeCustomFields(body?.custom_fields);
  return {
    id,
    name,
    description,
    status,
    visibility,
    owner_id: ensureId(body?.owner_id || body?.created_by || 'unknown', 'owner_id'),
    tags,
    custom_fields,
    version: 1,
    created_at: now,
    updated_at: now,
  };
}

export function validateTaskCreate(body) {
  const now = new Date().toISOString();
  const id = ensureId(body?.id || slugify(body?.title || ''), 'id');
  const assigneeType = ensureEnum(body?.assignee_type || 'unassigned', ASSIGNEE_TYPES, 'assignee_type');
  const project_id = normalizeOptionalId(body?.project_id, 'project_id');
  const activity_id = normalizeOptionalId(body?.activity_id, 'activity_id');
  // Phase 1 decision: reject linking a task to both project and activity.
  // This keeps permission/read paths deterministic while legacy project flows remain unchanged.
  if (project_id && activity_id) {
    throw boardError(422, 'validation_error', 'task may link to either project_id or activity_id, not both');
  }
  return {
    id,
    project_id,
    activity_id,
    title: ensureLength(body?.title || '', 'title', 1, LIMITS.taskTitleMax),
    description: ensureLength(body?.description || '', 'description', 0, LIMITS.descriptionMax),
    status: ensureEnum(body?.status || 'backlog', TASK_STATUSES, 'status'),
    priority: ensureEnum(body?.priority || 'medium', PRIORITIES, 'priority'),
    work_type: sanitizeWorkType(body?.work_type),
    assignee_type: assigneeType,
    assignee_id: body?.assignee_id ? ensureId(body.assignee_id, 'assignee_id') : null,
    human_assignee_label: sanitizeHumanAssigneeLabel(body?.human_assignee_label),
    task_list_id: normalizeOptionalId(body?.task_list_id, 'task_list_id'),
    workflow_id: body?.workflow_id ? ensureId(body.workflow_id, 'workflow_id') : null,
    subtasks: sanitizeSubtasks(body?.subtasks),
    component_tags: sanitizeComponentTags(body?.component_tags),
    sprint: sanitizeSprint(body?.sprint),
    story_points: sanitizeStoryPoints(body?.story_points),
    completion_percent: sanitizeCompletionPercent(body?.completion_percent),
    dependencies: sanitizeDependencies(body?.dependencies),
    external_links: sanitizeExternalLinks(body?.external_links),
    custom_fields: sanitizeCustomFields(body?.custom_fields),
    due_at: normalizeIsoDateOrNull(body?.due_at, 'due_at'),
    linked_paths: [],
    linked_runs: [],
    review: sanitizeReview(body?.review),
    blocked: sanitizeBlocked(body?.blocked),
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
    created_at: now,
    updated_at: now,
  };
}

export function sanitizeWorkType(value) {
  return ensureEnum(value || 'feature', WORK_TYPES, 'work_type');
}

export function sanitizeComponentTags(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw boardError(422, 'validation_error', 'component_tags must be an array');
  if (value.length > LIMITS.componentTagsMax) {
    throw boardError(422, 'validation_error', `component_tags max ${LIMITS.componentTagsMax}`);
  }
  const normalized = value
    .map((item) => ensureLength(String(item ?? '').trim(), 'component_tags[]', 1, LIMITS.componentTagMaxLength));
  return dedupeStrings(normalized);
}

export function sanitizeSprint(value) {
  return normalizeNullableString(value, 'sprint', LIMITS.sprintMax);
}

export function sanitizeStoryPoints(value) {
  if (value === null || value === undefined || value === '') return null;
  return ensureIntegerInRange(value, 'story_points', LIMITS.storyPointsMin, LIMITS.storyPointsMax);
}

export function sanitizeCompletionPercent(value) {
  if (value === null || value === undefined || value === '') return 0;
  return ensureIntegerInRange(value, 'completion_percent', LIMITS.completionPercentMin, LIMITS.completionPercentMax);
}

export function sanitizeDependencies(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw boardError(422, 'validation_error', 'dependencies must be an array');
  if (value.length > LIMITS.dependenciesMax) {
    throw boardError(422, 'validation_error', `dependencies max ${LIMITS.dependenciesMax}`);
  }
  const ids = value.map((v) => ensureId(v, 'dependency_id'));
  return dedupeStrings(ids);
}

export function sanitizeExternalLinks(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw boardError(422, 'validation_error', 'external_links must be an array');
  if (value.length > LIMITS.externalLinksMax) {
    throw boardError(422, 'validation_error', `external_links max ${LIMITS.externalLinksMax}`);
  }
  return value.map((item) => ({
    label: ensureLength(String(item?.label ?? '').trim(), 'external_links[].label', 1, LIMITS.externalLinkLabelMax),
    url: ensureHttpUrl(item?.url, 'external_links[].url'),
  }));
}

export function sanitizeCustomFields(value) {
  if (value === null || value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw boardError(422, 'validation_error', 'custom_fields must be an object');
  }
  const entries = Object.entries(value);
  if (entries.length > LIMITS.customFieldsMax) {
    throw boardError(422, 'validation_error', `custom_fields max ${LIMITS.customFieldsMax}`);
  }
  const out = {};
  for (const [key, raw] of entries) {
    const normalizedKey = ensureLength(String(key ?? '').trim(), 'custom_fields key', 1, LIMITS.customFieldKeyMax);
    const t = typeof raw;
    const isValid = raw === null || t === 'string' || t === 'number' || t === 'boolean';
    if (!isValid || (t === 'number' && !Number.isFinite(raw))) {
      throw boardError(422, 'validation_error', `custom_fields.${normalizedKey} must be string|number|boolean|null`);
    }
    out[normalizedKey] = raw;
  }
  return out;
}

export function sanitizeHumanAssigneeLabel(value) {
  const raw = value === null || value === undefined ? '' : String(value);
  const normalized = raw.trim();
  if (!normalized) return null;
  return ensureLength(normalized, 'human_assignee_label', 1, LIMITS.humanAssigneeLabelMax);
}

export function sanitizeSubtasks(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw boardError(422, 'validation_error', 'subtasks must be an array');
  if (value.length > LIMITS.subtasksMax) throw boardError(422, 'validation_error', `subtasks max ${LIMITS.subtasksMax}`);
  return value.map((item, index) => {
    const id = String(item?.id || '').trim().toLowerCase();
    if (!SUBTASK_ID_RE.test(id)) {
      throw boardError(422, 'validation_error', 'subtasks.id must match ^[a-z0-9_-]{1,80}$');
    }
    const text = ensureLength(item?.text || '', 'subtasks.text', 1, LIMITS.subtaskTextMax);
    const rawOrder = item?.order;
    const fallbackOrder = index;
    const orderNum = rawOrder === null || rawOrder === undefined || rawOrder === '' ? fallbackOrder : Number(rawOrder);
    if (!Number.isInteger(orderNum) || orderNum < 0 || orderNum > 10_000) {
      throw boardError(422, 'validation_error', 'subtasks.order must be an integer in range 0..10000');
    }
    return {
      id,
      text,
      completed: Boolean(item?.completed),
      order: orderNum,
    };
  });
}

export function normalizeDueAt(value) {
  return normalizeIsoDateOrNull(value, 'due_at');
}

function slugify(input) {
  const s = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return s || `id_${Date.now().toString(36)}`;
}
