---
name: project-board-operations
version: 0.1.0
description: Operational guardrails for reading, updating and reviewing internal Projects UI / project-board data. Use for safe board maintenance by Danny and Paula (read-before-write, versioned updates, review authority checks).
---

# Project Board Operations

Safe operating discipline for internal Projects UI / project-board work.

Primary users: Paula (delivery coordination) and Danny (orchestration).

## Scope and source of truth

- The Projects UI and project-board API are the only write interface.
- **Private scope authority:** local SQLite board authority.
- **Team scope authority:** configured team-root JSON/JSONL board authority.
- Compatibility exports or storage files are implementation details.
- Never edit board storage files directly (`project-board/`, team-root `projects/` / `tasks/` JSON, `activity/` or `audit/` JSONL).

## Read-before-write workflow (mandatory)

For every project/task mutation:

1. Identify target exactly (`project_id`, `task_id`; do not rely on title only).
2. Read current entity state from board API.
3. Capture current `version`.
4. Apply the smallest possible patch (`ops`) for the intended field change.
5. Re-read after write and verify expected effect.

If project or task identity is ambiguous, stop and clarify first.

## Versioned updates and 409 handling

- All updates must send the latest `version`.
- On `409 conflict` / version mismatch:
  1. Re-read current entity.
  2. Re-evaluate whether the intended change is still valid.
  3. Retry one narrow update with new `version`.
- Do not replay stale full payloads.
- Do not perform broad multi-field retries after a conflict.

## Task maintenance fields for delivery operations

Use only operational fields relevant to delivery tracking:

- `status` (`backlog`, `todo`, `in_progress`, `needs_review`, `blocked`, `done`)
- `priority` (`low`, `medium`, `high`)
- `assignee` / `workflow_id`
- `due_at`
- `sprint`, `story_points`, `completion_percent`
- `dependencies`, `external_links`
- `blocked` state/reason
- `review.required`, `review.reviewers`

When changing state, keep transitions explicit and truthful (`planned`/`in_progress`/`needs_review`/`done` are not interchangeable).

## Task review decisions (approve / request_changes)

Only submit review decisions when both are true:

1. You are an assigned reviewer for that task (`review.reviewers` includes actor).
2. Review authority is clear (internal board review responsibility is explicit).

Rules:

- Allowed decisions: `approve` or `request_changes` only.
- If reviewer assignment or authority is unclear: do not decide; escalate to Danny.
- Internal task review is an execution-quality gate.
- Internal review decision is **not** client acceptance/sign-off.

## Boundaries and escalation

Do not use board maintenance actions to change:

- pricing or commercial terms
- offer scope/service modules
- architecture/specification decisions
- contractual commitments

Escalate to owner lane:

- Otto for commercial/scope changes
- Iris for architecture/specification changes
- Danny for cross-lane conflicts or unclear authority

## Output format (concise operation log)

```markdown
### Board Operation Log
- target: <project_id[/task_id]>
- action: <read | patch | review_decision>
- requested_change: <one-line>
- version_before: <n>
- result: <success | conflict | blocked>
- version_after: <n|->
- follow_up: <none | clarify owner | re-read+retry>
```

## Changelog

- 0.1.0 (2026-07-20): Initial version — safe Projects UI/project-board operations for Danny and Paula.
