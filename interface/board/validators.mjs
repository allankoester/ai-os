import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  ASSIGNEE_TYPES,
  LIMITS,
  PRIORITIES,
  PROJECT_STATUSES,
  PROJECT_VISIBILITIES,
  REVIEW_DECISIONS,
  REVIEW_STATES,
  TASK_STATUSES,
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

export function validateTaskCreate(body) {
  const now = new Date().toISOString();
  const id = ensureId(body?.id || slugify(body?.title || ''), 'id');
  const assigneeType = ensureEnum(body?.assignee_type || 'unassigned', ASSIGNEE_TYPES, 'assignee_type');
  return {
    id,
    project_id: ensureId(body?.project_id, 'project_id'),
    title: ensureLength(body?.title || '', 'title', 1, LIMITS.taskTitleMax),
    description: ensureLength(body?.description || '', 'description', 0, LIMITS.descriptionMax),
    status: ensureEnum(body?.status || 'backlog', TASK_STATUSES, 'status'),
    priority: ensureEnum(body?.priority || 'medium', PRIORITIES, 'priority'),
    assignee_type: assigneeType,
    assignee_id: body?.assignee_id ? ensureId(body.assignee_id, 'assignee_id') : null,
    human_assignee_label: sanitizeHumanAssigneeLabel(body?.human_assignee_label),
    workflow_id: body?.workflow_id ? ensureId(body.workflow_id, 'workflow_id') : null,
    subtasks: sanitizeSubtasks(body?.subtasks),
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
