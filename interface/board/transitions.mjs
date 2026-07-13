import { TASK_STATUS_TRANSITIONS, REVIEW_TRANSITIONS } from './constants.mjs';
import { boardError } from './errors.mjs';

export function assertTaskStatusTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return;
  const allowed = TASK_STATUS_TRANSITIONS[fromStatus];
  if (!allowed || !allowed.has(toStatus)) {
    throw boardError(422, 'invalid_transition', `task status transition ${fromStatus} -> ${toStatus} is not allowed`);
  }
}

export function assertReviewStateTransition(fromState, toState) {
  if (fromState === toState) return;
  const allowed = REVIEW_TRANSITIONS[fromState] || new Set();
  if (!allowed.has(toState)) {
    throw boardError(422, 'invalid_transition', `review transition ${fromState} -> ${toState} is not allowed`);
  }
}
