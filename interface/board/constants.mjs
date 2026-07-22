export const SCHEMA_VERSION = '1.0';

export const PROJECT_STATUSES = new Set(['active', 'paused', 'archived']);
export const PROJECT_VISIBILITIES = new Set(['private', 'team']);
export const ACTIVITY_STATUSES = new Set(['active', 'paused', 'archived']);
export const ACTIVITY_VISIBILITIES = new Set(['private', 'team']);
export const TASK_STATUSES = new Set(['backlog', 'todo', 'in_progress', 'needs_review', 'blocked', 'done']);
export const TASK_DESK_SCOPES = new Set(['my_desk']);
export const PRIORITIES = new Set(['low', 'medium', 'high']);
export const WORK_TYPES = new Set(['feature', 'bug', 'tech_debt', 'spike']);
export const ASSIGNEE_TYPES = new Set(['human', 'agent', 'unassigned']);
export const REVIEW_STATES = new Set(['none', 'needs_review', 'approved', 'changes_requested']);
export const REVIEW_DECISIONS = new Set([null, 'approve', 'request_changes']);
export const EXECUTION_STATES = new Set(['none', 'prepared', 'queued', 'running', 'cancel_requested', 'succeeded', 'failed', 'timed_out', 'cancelled']);
export const ACTIVE_EXECUTION_STATES = new Set(['prepared', 'queued', 'running', 'cancel_requested']);
export const TERMINAL_EXECUTION_STATES = new Set(['succeeded', 'failed', 'timed_out', 'cancelled']);

export const PATCH_OPS = new Set([
  'set_status',
  'set_name',
  'set_title',
  'set_description',
  'set_priority',
  'set_project_id',
  'set_activity_id',
  'set_assignee',
  'assign_to_me',
  'set_task_list_id',
  'set_workflow_id',
  'set_subtasks',
  'set_due_at',
  'set_review_required',
  'set_reviewers',
  'set_blocked',
  'set_linked_paths',
  'set_linked_runs',
  'set_work_type',
  'set_component_tags',
  'set_sprint',
  'set_story_points',
  'set_completion_percent',
  'set_dependencies',
  'set_external_links',
  'set_custom_fields',
]);

export const TASK_STATUS_TRANSITIONS = {
  backlog: new Set(['todo']),
  todo: new Set(['in_progress', 'blocked', 'backlog']),
  in_progress: new Set(['needs_review', 'blocked', 'todo', 'backlog']),
  needs_review: new Set(['in_progress', 'done', 'blocked', 'backlog']),
  blocked: new Set(['todo', 'in_progress', 'backlog']),
  done: new Set(['in_progress', 'backlog']),
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
  activityNameMax: 120,
  taskTitleMax: 160,
  humanAssigneeLabelMax: 120,
  descriptionMax: 4000,
  subtasksMax: 100,
  subtaskTextMax: 280,
  resultSummaryMax: 4000,
  failureSummaryMax: 1000,
  executionUpdatesMax: 200,
  tagsMax: 20,
  linkedPathsMax: 30,
  linkedRunsMax: 30,
  reviewersMax: 10,
  retriesMax: 3,
  componentTagsMax: 10,
  componentTagMaxLength: 40,
  sprintMax: 80,
  storyPointsMin: 0,
  storyPointsMax: 100,
  completionPercentMin: 0,
  completionPercentMax: 100,
  dependenciesMax: 20,
  externalLinksMax: 20,
  externalLinkLabelMax: 80,
  customFieldsMax: 30,
  customFieldKeyMax: 60,
};
