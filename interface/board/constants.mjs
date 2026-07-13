export const SCHEMA_VERSION = '1.0';

export const PROJECT_STATUSES = new Set(['active', 'paused', 'archived']);
export const PROJECT_VISIBILITIES = new Set(['private', 'team']);
export const TASK_STATUSES = new Set(['backlog', 'todo', 'in_progress', 'needs_review', 'blocked', 'done']);
export const PRIORITIES = new Set(['low', 'medium', 'high']);
export const ASSIGNEE_TYPES = new Set(['human', 'agent', 'unassigned']);
export const REVIEW_STATES = new Set(['none', 'needs_review', 'approved', 'changes_requested']);
export const REVIEW_DECISIONS = new Set([null, 'approve', 'request_changes']);
export const EXECUTION_STATES = new Set(['none', 'prepared', 'queued', 'running', 'cancel_requested', 'succeeded', 'failed', 'timed_out', 'cancelled']);
export const ACTIVE_EXECUTION_STATES = new Set(['prepared', 'queued', 'running', 'cancel_requested']);
export const TERMINAL_EXECUTION_STATES = new Set(['succeeded', 'failed', 'timed_out', 'cancelled']);

export const PATCH_OPS = new Set([
  'set_status',
  'set_priority',
  'set_assignee',
  'set_due_at',
  'set_review_required',
  'set_reviewers',
  'set_blocked',
  'set_linked_paths',
  'set_linked_runs',
]);

export const TASK_STATUS_TRANSITIONS = {
  backlog: new Set(['todo']),
  todo: new Set(['in_progress', 'blocked']),
  in_progress: new Set(['needs_review', 'blocked', 'todo']),
  needs_review: new Set(['in_progress', 'done', 'blocked']),
  blocked: new Set(['todo', 'in_progress']),
  done: new Set(['in_progress']),
};

export const REVIEW_TRANSITIONS = {
  none: new Set(['needs_review']),
  changes_requested: new Set(['needs_review']),
  needs_review: new Set(['approved', 'changes_requested']),
  approved: new Set([]),
};

export const CALLBACK_STATES = new Set(['queued', 'started', 'succeeded', 'failed', 'timed_out', 'cancelled']);

export const LIMITS = {
  projectNameMax: 120,
  taskTitleMax: 160,
  descriptionMax: 4000,
  resultSummaryMax: 4000,
  failureSummaryMax: 1000,
  tagsMax: 20,
  linkedPathsMax: 30,
  linkedRunsMax: 30,
  reviewersMax: 10,
  retriesMax: 3,
};
