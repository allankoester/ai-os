# Multica-like Projects and Tasks Board (In-App Integration Spec)

Status: implemented backend scope update (visibility + scoped roots + runtime adapters)
Scope: in-app feature for existing interface only
Target app: `interface/public/` + `interface/server.mjs`

## 1) Purpose and hard constraints

Implement a Multica-inspired Projects and Tasks coordination surface inside the
existing Steadymade AI OS interface.

This feature must not introduce:
- a separate app/runtime stack
- a parallel scheduler engine or queue
- a board-local agent/workflow registry
- a database dependency for MVP

The board is a coordination layer with explicit execution integration. It is
not a standalone autonomous runtime.

## 2) MVP execution boundary

MVP includes:
- Projects list and project detail view in the existing SPA
- Canonical board/list task surface over one shared dataset
- Project/task CRUD through dedicated API endpoints
- Versioned PATCH with optimistic conflict handling (`409`)
- Path-safe, guardrail-checked linked references
- Assignment as metadata only
- Explicit human **Run task** action for assigned agents
- Execution through existing scheduler/runtime primitives
- Result + artifact write-back to the originating task

MVP excludes:
- Cron recurrence derived from board task fields
- Automatic execution on plain assignment
- Automatic retry loops
- Multi-tenant RBAC redesign
- Evidence-grade immutable audit ledger
- Mechanically enforced workflow graph runtime

## 3) Canonical system reuse (mandatory)

The board must reuse existing canonical systems.

1. Agents
   - Sources: `interface/public/data.js`, `.claude/agents`, chat runtime agent
     listing surfaces.
   - Rule: `assignee_id` for `assignee_type=agent` must resolve canonically.

2. Humans
   - MVP source: server-derived active interface principal.
   - Rule: human approval and run/cancel/retry actions require authenticated
     human actor derived server-side.

3. Workflows
   - Source: effective workflows (base + `interface/workflows.json`).
   - Rule: `workflow_id` must resolve canonically.
   - Note: in MVP this is canonical workflow guidance/gating context, not an
     executable workflow graph.

4. Scheduler and runtime
   - Source: `interface/scheduler.mjs` + current runtime/provider settings.
   - Rule: board execution dispatches through scheduler adapter and must use
     active configured runtime mode.

5. Skills/plugins/guardrails
   - Sources: canonical existing modules only.
   - Rule: no board-local duplicate registries or path-access bypasses.

## 4) Storage ownership and location

Board data roots (scoped):
- private scope root: configurable (`app-settings.privateBoardRoot`), default user-local runtime path outside repo
- team scope root: configurable (`app-settings.teamBoardRoot`), required for team scope
- legacy repo-local `project-board/` is treated as private baseline for backward-compatible reads/import

Structure (per scope root):

```text
<scope-root>/
  projects/<project-id>.json
  tasks/<task-id>.json
  activity/YYYY-MM-DD.jsonl
  audit/YYYY-MM-DD.jsonl
```

Ownership model:
- machine-local runtime coordination state in Stage 1/2
- gitignored like other mutable runtime state
- not canonical company knowledge
- not synced SSOT
- visibility model: project `visibility = private | team` (default `private`)
- owner is server-derived from authenticated principal (client `owner_id` ignored)

Low-concurrency shared-drive caveat (team scope):
- pre-write version re-read
- post-write verification
- conflict/duplicate variant file detection
- divergence fail-closed behavior: team scope becomes read-only error mode until repaired

Storage backend note:
- board persistence is direct local FS JSON/JSONL
- it does not use `interface/storage/*` knowledge backends (`fs|graph`)

## 5) Data model contracts

General rules:
- encoding: UTF-8 JSON
- timestamps: ISO-8601 UTC
- `schema_version`: `"1.0"`
- `version`: integer, server-managed
- IDs: lowercase `a-z0-9_`, length 3..80

### 5.1 Enumerations

- Project status: `active | paused | archived`
- Task status: `backlog | todo | in_progress | needs_review | blocked | done`
- Priority: `low | medium | high`
- Assignee type: `human | agent | unassigned`
- Review state: `none | needs_review | approved | changes_requested`
- Review decision: `approve | request_changes | null`
- Execution state:
  `none | queued | running | cancel_requested | succeeded | failed | timed_out | cancelled`

### 5.2 Project entity (core)

```json
{
  "schema_version": "1.0",
  "id": "proj_client_a_onboarding",
  "name": "Client A Onboarding",
  "status": "active",
  "owner_id": "allan",
  "description": "Operational rollout project.",
  "tags": ["client", "dach"],
  "linked_paths": [
    { "path": "knowledge/company/clients/client-a", "kind": "directory" }
  ],
  "linked_runs": [
    { "source": "runs", "path": "runs/2026-07-13-client-a-rollout.md" }
  ],
  "review": {
    "state": "none",
    "required": false,
    "reviewers": [],
    "decision": null,
    "decided_at": null,
    "decided_by": null
  },
  "blocked": {
    "is_blocked": false,
    "reason": "",
    "since": null
  },
  "version": 1,
  "updated_at": "2026-07-13T09:30:00Z",
  "updated_by": "allan",
  "created_at": "2026-07-13T08:00:00Z",
  "created_by": "allan"
}
```

### 5.3 Task entity (core + execution)

```json
{
  "schema_version": "1.0",
  "id": "task_prepare_offer_v1",
  "project_id": "proj_client_a_onboarding",
  "title": "Prepare offer draft v1",
  "description": "Create first draft based on discovery notes.",
  "status": "todo",
  "priority": "high",
  "assignee_type": "agent",
  "assignee_id": "clara",
  "workflow_id": "proposal",
  "due_at": "2026-07-15T12:00:00Z",
  "linked_paths": [
    { "path": "knowledge/company/sales", "kind": "directory" }
  ],
  "linked_runs": [],
  "review": {
    "state": "none",
    "required": true,
    "reviewers": ["allan"],
    "decision": null,
    "decided_at": null,
    "decided_by": null
  },
  "blocked": {
    "is_blocked": false,
    "reason": "",
    "since": null
  },
  "execution": {
    "attempt_id": null,
    "state": "none",
    "trigger": null,
    "idempotency_key": null,
    "requested_at": null,
    "requested_by": null,
    "runtime_mode": null,
    "agent_id": null,
    "workflow_id": null,
    "scheduler_job_id": null,
    "scheduler_run_id": null,
    "output_root": null,
    "started_at": null,
    "completed_at": null,
    "result_summary": null,
    "failure_summary": null,
    "artifact_paths": []
  },
  "version": 1,
  "updated_at": "2026-07-13T09:10:00Z",
  "updated_by": "allan",
  "created_at": "2026-07-13T09:10:00Z",
  "created_by": "allan"
}
```

### 5.4 Server-managed fields

Server-managed only:
- `schema_version`, `id`, `version`
- `created_at`, `created_by`, `updated_at`, `updated_by`
- `review.decided_at`, `review.decided_by`
- full `execution` object

Client cannot write these fields directly through generic PATCH.

### 5.5 Linked run reference contract

`linked_runs` is source-scoped; there is no universal run ID.

Allowed shapes:
- `{ "source": "runs", "path": "runs/YYYY-MM-DD-<slug>.md" }`
- `{ "source": "scheduler", "id": "<scheduler-run-id>" }`
- `{ "source": "chat", "id": "<conversation-id>" }`

Rules:
- `source` required
- `path` allowed only for `source=runs`
- `id` required for `source=scheduler|chat`
- unknown source -> `422`

## 6) Lifecycle and transition rules

Task `status` remains authoritative for board columns.

Invariants:
- `status=blocked` <=> `blocked.is_blocked=true`
- `status=needs_review` => `review.state=needs_review`
- if `review.required=true`, task cannot become `done` unless
  `review.state=approved`

Allowed status transitions:
- `backlog -> todo`
- `todo -> in_progress | blocked`
- `in_progress -> needs_review | blocked | todo`
- `needs_review -> in_progress | done | blocked`
- `blocked -> todo | in_progress`
- `done -> in_progress`

Review transitions:
- `none|changes_requested -> needs_review`
- `needs_review -> approved|changes_requested`

Reviewer/approval restrictions:
- review decisions require authenticated human reviewer
- agents/system callbacks cannot approve

## 7) Assignment and explicit Run semantics

### 7.1 Assignment semantics

`set_assignee` is metadata only.

Assignment must never automatically execute.

### 7.2 Run semantics

Execution begins only through explicit authenticated human action:
- `run_task` operation (or dedicated endpoint)

Preconditions for `run_task`:
- task `assignee_type=agent`
- canonical agent/workflow resolve
- task not archived/done
- no active execution attempt
- version match
- output policy + guardrail checks pass
- runtime mode available

Dispatch behavior:
- create new server-generated `attempt_id`
- set `execution.state=queued`
- set task `status=in_progress`
- create one-time board-linked scheduler job
- return `202 Accepted` + updated task

Idempotency:
- client provides `idempotency_key`
- repeated same key returns same attempt
- concurrent conflicting run request -> `409 execution_active`

## 8) Execution integration contract

Board execution reuses scheduler with board metadata.

Required scheduler linkage fields:
- `task_id`
- `project_id`
- `attempt_id`
- `task_version` snapshot

Required lifecycle callbacks from scheduler adapter to board:
- queued
- started
- succeeded
- failed
- timed_out
- cancelled

Callback update rules:
- callback accepted only for current active `attempt_id`
- stale callback is logged but cannot mutate task status/result
- successful callback sets `scheduler_run_id` and appends `linked_runs` entry
  with `source=scheduler`

## 9) Runtime/provider mode requirement

Board-triggered execution must use active configured runtime mode captured at
dispatch time.

Execution attempt stores `runtime_mode` snapshot.

Runtime unavailable at dispatch -> `503 runtime_unavailable`.

Scheduler runtime adapters:
- Claude CLI driver for `claude-subscription` and `anthropic-api`
- OpenCode CLI driver for `opencode` (aligned with chat runtime invocation style)
- runtime mode snapshot is persisted on task attempt and scheduler job meta for execution selection
- provider secrets are never persisted in board jobs/events payloads

## 10) Path safety, privacy, and output confinement

### 10.1 Allowed linked path roots

Allowed read references:
- `knowledge/company/**`
- `runs/**`
- `artifacts/project-board/**` (board-generated artifacts only)

Denied:
- `knowledge/personal/**`
- `knowledge/inbox/**`
- `memory/**`
- `chat/**`
- `.claude/**`
- `interface/**`
- `scheduler/**`
- `project-board/**` (entity/audit roots)

### 10.2 Validation rules

For every linked path add/read/use action:
- reject absolute paths
- reject traversal (`..`, encoded traversal)
- normalize separators
- resolve realpath
- reject symlink escapes outside allowed roots
- apply guardrail check for required action

### 10.3 Execution output root

Every run attempt gets a server-generated output root:

```text
artifacts/project-board/<visibility>/<task-id>/<attempt-id>/
```

Write policy during execution:
- writes allowed only in attempt output root
- linked references are read-only context
- runtime must not write outside output root

Post-run artifact registration:
- server scans output root
- validates realpath/no symlink/size limits
- registers valid outputs to `execution.artifact_paths`
- appends same references to task `linked_paths`

## 11) API contract

Base endpoints:
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PATCH /api/projects/:id`
- `GET /api/tasks`
- `POST /api/tasks`
- `GET /api/tasks/:id`
- `PATCH /api/tasks/:id`
- `POST /api/tasks/:id/execution/run`
- `POST /api/tasks/:id/execution/cancel`
- `POST /api/tasks/:id/execution/retry`
- `POST /api/internal/tasks/execution-callback`
- `GET /api/projects/:id/activity`
- `GET /api/projects/:id/audit`
- `POST /api/projects/:id/visibility-migration`
- `GET /api/board/metadata`
- `GET /api/board/artifacts/:taskId/:attemptId/*`

### 11.1 Envelope

Success:

```json
{ "ok": true, "data": {} }
```

Error:

```json
{ "ok": false, "error": { "code": "conflict", "message": "Version mismatch", "details": {} } }
```

### 11.2 PATCH operations

PATCH uses explicit allowlisted ops (no object merge):
- `set_status`
- `set_priority`
- `set_assignee`
- `set_due_at`
- `set_review_required`
- `set_reviewers`
- `set_blocked`
- `set_linked_paths`
- `set_linked_runs`

Execution actions are not generic PATCH field writes.

### 11.3 Execution endpoints behavior

`POST /execution/run`:
- requires `version`, `idempotency_key`
- performs preflight checks
- creates attempt + scheduler job
- returns `202`

`POST /execution/cancel`:
- requires active attempt + `version`
- sets `execution.state=cancel_requested`
- triggers scheduler termination

`POST /execution/retry`:
- terminal failed/timed_out/cancelled only
- explicit human action only
- creates new `attempt_id`

`POST /api/internal/tasks/execution-callback`:
- internal authenticated channel only
- updates task by attempt-state transition

## 12) Validation limits

Request/body:
- max JSON body 256 KB (`413`)

String lengths:
- project name: 1..120
- task title: 1..160
- description/reason: 0..4000
- `result_summary`: 0..4000
- `failure_summary`: 0..1000

Array limits:
- tags: max 20
- linked_paths: max 30
- linked_runs: max 30
- reviewers: max 10

Execution limits:
- one active attempt per task
- retries max 3 by default

## 13) Persistence and event streams

Entity writes:
- per-entity in-process lock
- version check inside lock
- temp file + fsync + rename

Activity/audit:
- append one event record per successful mutation/transition
- include `event_id`, `timestamp`, `entity_type`, `entity_id`, `action`,
  `actor_id`, `old_version`, `new_version`, `result`
- append failure blocks success response

Intentional behavior difference:
- board activity/audit append is part of mutation success criteria (stricter
  than best-effort telemetry logs)

## 14) Result write-back rules

On execution success:
- set `execution.state=succeeded`
- set `execution.completed_at`
- set bounded `result_summary`
- register validated `artifact_paths`
- append `linked_runs` scheduler reference
- task status -> `needs_review` (never auto-approved)

On failure/timeout/cancel:
- set terminal execution state
- set bounded `failure_summary`
- set task status -> `blocked`

Runtime/agent is never allowed to set:
- `review.state=approved`
- `review.decision`
- final external approval/publication flags

## 15) UX requirements

Projects list/detail/board/list requirements stay as defined.

Task drawer must include:
- assignee controls
- explicit **Run task** action
- cancel/retry actions with state-aware availability
- execution panel (state, attempt ID, runtime, linked run, summary, artifacts)
- manual **Open in Chat** action for interactive follow-up

State handling:
- loading, empty, denied, and stale conflict
- explicit execution progress indicators

Drag/drop status move handling is in active backend scope:
- status transitions are validated atomically with blocked/review invariants
- stale version protection remains `409 conflict`

## 16) Phased implementation plan

Phase 0: foundation and safety
- storage bootstrap
- schema validation and limits
- path and guardrail enforcement
- lock + atomic write utilities

Phase 1: projects/tasks APIs
- CRUD + list/filter/sort/pagination
- transition engine + `409`

Phase 2: execution integration
- run/cancel/retry endpoints
- scheduler board metadata + callback contract
- runtime mode adapter support
- output-root artifact registration

Phase 3: SPA integration
- Projects views
- task drawer execution panel and actions
- linked run/artifact rendering

Phase 4: deferred enhancements
- cron-derived board automation
- drag-and-drop
- bulk edits and saved filters

## 17) Acceptance criteria

Functional:
- projects visible under `Projects`
- shared board/list dataset
- assignment updates metadata only
- explicit run action dispatches one attempt
- execution updates task result, run reference, artifact references

Integration:
- canonical systems reused
- no board-local duplicate registries
- manual Open in Chat still available

Storage/API:
- one-file-per-entity under `project-board/`
- JSONL activity/audit append on mutations
- no board CRUD via `/api/file`
- board state remains machine-local Stage 1/2 runtime data

Safety:
- traversal/absolute/symlink escapes blocked
- linked path allow/deny policy enforced
- execution writes confined to attempt output root
- payload/field limits enforced
- stale version -> `409`
- non-human review/approval denied
- stale execution callbacks cannot mutate task

## 18) Required test matrix

Assignment/dispatch:
- assigning agent does not execute
- explicit run creates exactly one attempt/job
- repeated idempotency key does not duplicate runs

Execution lifecycle:
- queued -> running -> succeeded updates task
- success -> `needs_review`
- failed/timed_out/cancelled -> `blocked`

Callback authenticity:
- invalid/internal-unauthenticated callback rejected
- stale attempt callback ignored for task mutation

Artifact confinement:
- writes outside output root denied
- output root scan rejects symlinks/escape paths

Concurrency:
- one active attempt per task
- concurrent run requests conflict safely

Validation/security:
- invalid enum/format/length/count -> `422`
- oversized body -> `413`
- missing auth -> `401`
- unauthorized run/review actions -> `403`

## 19) Non-goals and forbidden scope

Do not implement in this feature:
- hidden automatic execution from plain assignment
- board-owned parallel runtime engine
- unsandboxed arbitrary write behavior
- workflow graph engine redesign
- storing secrets in project/task/activity/audit payloads
- broad `/api/file` based board writes
