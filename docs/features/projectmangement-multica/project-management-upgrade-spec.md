# Project Management Upgrade Specification

Status: draft implementation spec  
Target area: `interface/board/*`, `interface/server.mjs`, `interface/public/app.js`, `interface/public/styles.css`  
Supersedes: baseline behavior documented in `docs/features/projectmangement-multica/simple-multica-lite-project-agent-board.md`

---

## 1) Purpose and scope

### Purpose

Define the next upgrade of the internal Projects/Tasks feature from a lightweight execution board into a development-board-capable project management system with:

- richer workflow semantics (review + QA readiness + blocked semantics)
- planning primitives (priority model, work type, component tags, sprint/stories)
- stronger dependency tracking
- explicit agent-enabled execution controls (assignment != autonomous execution)
- board/list/backlog/sprint/dashboard multi-view UX
- queryable metrics for delivery tracking

### In scope

1. Data model additions for projects, tasks, sprints, dashboard aggregates.
2. API additions/changes for new fields, filtering, sprint operations, and dashboard reads.
3. UI/UX redesign specification (information architecture, cards, task drawer).
4. Migration and backward compatibility from current schema.
5. Acceptance criteria and verification matrix.

### Out of scope

- Replacement of scheduler runtime architecture.
- Autonomous execution from assignment.
- External portfolio/reporting system integration.
- Multi-tenant RBAC redesign.

---

## 2) Current-state summary (fact-based)

Based on current implementation in `interface/board/service.mjs`, `interface/board/constants.mjs`, `interface/board/storage.mjs`, `interface/server.mjs`, and `interface/public/app.js`:

1. **Project/task domain exists and is operational**
   - CRUD for projects and tasks.
   - Optimistic version conflict handling (`version`, `409 conflict`).
   - Explicit patch-op model (no unrestricted object merge).

2. **Status and execution model is basic but strict**
   - Task statuses: `backlog | todo | in_progress | needs_review | blocked | done`.
   - Review model: `none | needs_review | approved | changes_requested`.
   - Execution is explicit (`run/cancel/retry`) and requires authenticated human actor.
   - Assignment metadata and execution are separated in current behavior.

3. **Current classification/planning fields are limited**
   - Priority exists with enum `low | medium | high`.
   - Assignee supports `human | agent | unassigned` plus canonical agent resolution.
   - Subtasks exist.
   - No first-class sprint model, story points, work types, component tags, dependency graph, completion percentage field, or typed custom fields.

4. **Storage/persistence is hybrid by scope**
   - Private scope authoritative in SQLite (`board_projects`, `board_tasks`, attempts, events, artifacts).
   - Team scope still served from file-based structure with safety checks and divergence protection.
   - Activity/audit projections already exist.

5. **API surface exists with project-scoped dashboard endpoint**
   - Existing endpoints: `/api/projects`, `/api/tasks`, `/api/board/metadata`, `/api/projects/:id/dashboard`, execution endpoints, review decision endpoint, activity/audit streams.

6. **UI supports project list + project detail + board/list layouts**
   - Two task layouts only: board and list.
   - Task drawer covers editable basics + subtasks + execution controls + review actions.
   - No backlog-specific view, sprint view, or dashboard metrics view.

---

## 3) Target capability model (aligned with dev boards)

### 3.1 Workflow statuses and semantics

Task `workflow_status` (new canonical board column field):

1. `backlog` — scoped idea/queued work, not committed.
2. `todo` — selected for delivery, not started.
3. `in_progress` — active implementation.
4. `in_review` — implementation complete; reviewer action required.
5. `qa_ready` — accepted by reviewer; ready for QA intake.
6. `qa_in_progress` — QA active.
7. `qa_failed` — QA found issues; task must return to implementation.
8. `blocked` — explicit external/internal blocker active.
9. `done` — delivery complete and accepted.

Semantics:

- `blocked` is stateful and MUST be synchronized with `blocked.is_blocked=true` and `blocked.reason`.
- `in_review` requires populated `review.required=true` and reviewer list.
- `qa_ready` requires `review.state=approved`.
- `done` requires:
  - `review.required=false` OR `review.state=approved`
  - `qa_required=false` OR `qa_state=passed`

Allowed high-level transitions:

- `backlog -> todo`
- `todo -> in_progress | blocked | backlog`
- `in_progress -> in_review | blocked | todo`
- `in_review -> in_progress | qa_ready | blocked`
- `qa_ready -> qa_in_progress | blocked | done`
- `qa_in_progress -> qa_failed | done | blocked`
- `qa_failed -> in_progress | blocked`
- `blocked -> todo | in_progress | in_review`
- `done -> in_progress` (reopen)

### 3.2 Priority, work types, component tags

- `priority`: `p0 | p1 | p2 | p3 | p4` (maps from legacy low/medium/high during migration).
- `work_type`: `feature | bug | chore | spike | research | docs | ops`.
- `component_tags`: string array (e.g., `ui`, `api`, `scheduler`, `security`).

### 3.3 Sprint tracking and story points

- Sprint entity with lifecycle: `planned | active | closed`.
- Tasks may reference `sprint_id` (nullable; backlog tasks typically null).
- `story_points`: integer `0..100` (0 allowed for non-estimated work).

### 3.4 Assignee model including AI agents

- Keep current assignee type model: `human | agent | unassigned`.
- Keep canonical resolution for `assignee_id` where type is `agent`.
- Add optional `pairing` model:
  - `delivery_owner_id` (human, optional)
  - `executor_agent_id` (agent, optional)
- Assignment still metadata only (see section 4).

### 3.5 Blockers and dependencies

- `blocked` object remains canonical for immediate blocker state.
- Add `dependencies` array of structured references:
  - task dependency (`task:<id>`)
  - external dependency (`external:<slug>`)
- Dependency readiness computed from referenced item state.

### 3.6 Completion percent

- Add `completion_percent` persisted field (`0..100`) with server-side normalization.
- Auto-computation modes:
  1. Subtasks-based (default when subtasks exist): `completed_subtasks / total_subtasks * 100`.
  2. Story-points heuristic (when no subtasks): status weight map.
- Manual override allowed only with explicit `manual_completion=true` and audit event.

### 3.7 Links/artifacts

- Keep `linked_paths`, `linked_runs`, and execution artifact model.
- Add `linked_urls` (allowlist validation, max count).
- Add `artifact_refs` metadata list for non-runtime artifacts (design docs, PRs, recordings).

### 3.8 Custom fields

Project-level custom field definitions + task values:

- Supported types: `text`, `number`, `select`, `multi_select`, `boolean`, `date`, `user`, `agent`.
- Task values validated against project schema.

### 3.9 Multi-view UX model

Views required in project workspace:

1. **Board** (status columns)
2. **List** (filter/sort dense)
3. **Backlog** (un-sprinted prioritization and triage)
4. **Sprint** (active/planned sprint lane + sprint burndown summary)
5. **Dashboard** (metrics, trend cards, workload, blockers, throughput)

---

## 4) Agent-enabled PM model

### 4.1 Assignment vs explicit execution separation

Rules:

1. `set_assignee` MUST remain metadata-only.
2. No implicit run trigger from status change, sprint assignment, or assignee change.
3. Execution starts only via explicit human action (`run_task` / retry).
4. Execution attempts are tied to immutable attempt IDs and full audit trace.

### 4.2 Review and approval boundaries

1. Agents cannot self-approve review decisions.
2. Review decisions (`approve`, `request_changes`) require authenticated human reviewer.
3. QA pass/fail decisions require authenticated human QA actor.
4. Transition to `done` is blocked until review/QA conditions are met.

### 4.3 Safety constraints

1. Existing path confinement and guardrail checks remain mandatory.
2. Artifact write confinement remains under per-attempt output root.
3. Callback updates accepted only for active attempt IDs.
4. Secrets must not be persisted in task/project payloads, events, or dashboard aggregates.

---

## 5) Data model additions (fields + validation)

Schema target: `schema_version = "1.1"`.

### 5.1 Task additions

- `workflow_status` (enum, required) — values in §3.1.
- `qa` (object):
  - `required` (boolean, default `false`)
  - `state` (`none | ready | in_progress | passed | failed`, default `none`)
  - `owner_id` (id|null)
  - `updated_at` (ISO timestamp|null)
- `priority` enum migrated to `p0..p4`.
- `work_type` (enum, required, default `feature`).
- `component_tags` (string[], max 30, each 1..40 chars, pattern `^[a-z0-9_\-/]+$`).
- `sprint_id` (id|null, must reference sprint in same project).
- `story_points` (integer, range `0..100`, default `0`).
- `dependencies` (array, max 50):
  - `{ "kind": "task", "task_id": "...", "required_state": "done" }`
  - `{ "kind": "external", "key": "vendor_access", "state": "open|resolved" }`
- `completion_percent` (integer `0..100`, server managed unless manual mode).
- `manual_completion` (boolean, default `false`).
- `linked_urls` (array, max 20, `https://` only, max 500 chars each).
- `artifact_refs` (array, max 30):
  - `{ "type": "pr|doc|design|recording|ticket|other", "label": "...", "url": "https://..." }`
- `custom_fields` (object, keys must match project field defs).

### 5.2 Project additions

- `default_work_type` (enum, default `feature`).
- `component_catalog` (string[], max 200).
- `custom_field_definitions` (array, max 50), item:
  - `key` (`^[a-z][a-z0-9_]{1,49}$`)
  - `label` (1..80)
  - `type` (`text|number|select|multi_select|boolean|date|user|agent`)
  - `required` (boolean)
  - `options` (required for select/multi_select, 1..100 options)
  - `validation` (type-specific min/max/pattern)

### 5.3 Sprint entity (new)

`board_sprints`:

- `id` (task-style id)
- `project_id` (fk)
- `name` (1..120)
- `goal` (0..1000)
- `status` (`planned|active|closed`)
- `start_date`, `end_date` (ISO date)
- `capacity_points` (integer `0..1000`)
- `committed_points` (derived)
- `completed_points` (derived)
- `version`, timestamps, actor fields

Validation:

- `start_date <= end_date`
- max one `active` sprint per project
- closed sprint immutable except metadata corrections

### 5.4 Dashboard projection tables (new)

- `board_dashboard_daily`
- `board_dashboard_project_rollup`
- `board_dashboard_sprint_rollup`

These are derived/projection tables; task/project canonical records remain source of truth.

---

## 6) API additions and changes

All responses remain `{ ok: true|false, data|error }` envelope.

### 6.1 New endpoints

1. `GET /api/projects/:id/dashboard`
   - Query:
     - `sprint_id` (optional)
     - `range` (`7d|14d|30d|90d`, default `30d`)
   - Returns aggregate KPIs + timeseries + workload snapshots.

2. Sprint endpoints:
   - `GET /api/projects/:id/sprints`
   - `POST /api/projects/:id/sprints`
   - `PATCH /api/sprints/:id`
   - `POST /api/sprints/:id/activate`
   - `POST /api/sprints/:id/close`

3. Backlog operations:
   - `POST /api/projects/:id/backlog/reorder` (ordered task IDs)

### 6.2 Existing endpoint enhancements

`GET /api/tasks`

- New filters: `workflow_status`, `work_type`, `component_tag`, `sprint_id`, `qa_state`, `blocked`, `dependency_state`, `priority` (`p0..p4`).

`POST /api/tasks` and `PATCH /api/tasks/:id`

- Accept/validate new fields listed in section 5.
- Add patch ops:
  - `set_workflow_status`
  - `set_work_type`
  - `set_component_tags`
  - `set_sprint`
  - `set_story_points`
  - `set_dependencies`
  - `set_completion`
  - `set_linked_urls`
  - `set_artifact_refs`
  - `set_custom_fields`
  - `set_qa_state`

`GET /api/board/metadata`

- Extend with:
  - workflow status transition map
  - work type options
  - component catalog
  - custom field definitions
  - sprint status options

### 6.3 Dashboard response contract (minimum)

```json
{
  "kpis": {
    "tasks_total": 0,
    "tasks_done": 0,
    "completion_rate": 0,
    "blocked_open": 0,
    "review_pending": 0,
    "qa_pending": 0,
    "throughput_14d": 0,
    "cycle_time_p50_hours": 0,
    "cycle_time_p90_hours": 0
  },
  "status_breakdown": [{ "status": "in_progress", "count": 0 }],
  "priority_breakdown": [{ "priority": "p1", "count": 0 }],
  "work_type_breakdown": [{ "work_type": "feature", "count": 0 }],
  "sprint": {
    "id": "spr_x",
    "name": "Sprint 12",
    "capacity_points": 40,
    "committed_points": 34,
    "completed_points": 13,
    "burndown": [{ "date": "2026-07-20", "remaining_points": 21 }]
  },
  "trends": {
    "throughput_daily": [{ "date": "2026-07-20", "done_count": 3 }],
    "blocked_daily": [{ "date": "2026-07-20", "blocked_count": 2 }]
  },
  "generated_at": "2026-07-20T12:00:00Z"
}
```

---

## 7) UI/UX redesign specification

### 7.1 Information architecture

Project workspace tabs:

1. **Board** — status columns with DnD.
2. **List** — table-like, multi-filter, sortable columns.
3. **Backlog** — unsprinted task queue ordered by rank.
4. **Sprint** — sprint selector + sprint board + scope summary.
5. **Dashboard** — KPI cards + trend charts + blocker/review/QA queues.

### 7.2 Task card spec (board/backlog/sprint)

Required card fields:

- title
- workflow status badge
- priority badge (`p0..p4`)
- work type badge
- story points
- assignee avatar/label
- dependency indicator (blocked by X)
- review/QA indicator
- completion percent bar

Interactions:

- single click opens task drawer
- drag/drop validates transition preflight
- quick actions: move status, add/remove sprint, mark blocked

### 7.3 Task drawer spec

Sections:

1. **Core**: title, description, status, priority, work type, assignee.
2. **Planning**: sprint, story points, component tags, due date.
3. **Dependencies/Blockers**: editable dependency list + blocker controls.
4. **Review/QA**: review state + reviewer roster + QA state + QA owner.
5. **Completion**: auto/manual mode + percent + subtask progress.
6. **Links/Artifacts**: linked paths, runs, URLs, artifact refs.
7. **Custom fields**: rendered by project field definitions.
8. **Execution controls**: run/cancel/retry + execution feed (unchanged boundary semantics).

### 7.4 View-specific behavior

- **Backlog view**
  - shows tasks with `sprint_id=null`
  - supports rank reorder (persisted ordering key)
  - bulk assign to sprint

- **Sprint view**
  - active sprint summary (capacity, committed, completed points)
  - sprint-scoped board and list toggles
  - explicit “close sprint” with carry-over action

- **Dashboard view**
  - read-only analytics, no direct mutation controls
  - filterable by project/sprint/date range

### 7.5 Visual QA review (2026-07-20)

Scope:

- Project workspace visual and interaction QA for board/list/dashboard/task drawer on desktop and mobile breakpoints.
- Validation pass focused on accessibility, hierarchy, responsive behavior, and execution-control clarity.

Concise findings and implemented UX decisions:

1. **Keyboard-accessible task cards and controls**
   - Task cards and key card controls are reachable via keyboard tab order.
   - Card activation and drawer open behavior are aligned with keyboard interaction expectations.

2. **Improved card hierarchy and blocked emphasis**
   - Card information order prioritizes title, status, ownership, and next action signals.
   - Blocked-state visual emphasis is intentionally stronger than neutral/in-progress cards.

3. **Dashboard metric card styling**
   - KPI cards use clearer label/value contrast and spacing for scan readability.
   - Status/metric groupings are visually consistent with board semantics.

4. **Responsive project switcher behavior**
   - Project switcher remains visible and operable at mobile widths.
   - Layout adapts to avoid burying primary navigation or current project context.

5. **Assignment vs run controls remain explicitly separate**
   - Assignment controls stay in metadata/planning surfaces.
   - Run/cancel/retry controls remain in execution-specific UI only.
   - No visual affordance implies assignment auto-starts execution.

### 7.6 Board-first redesign implemented

Implemented UI behavior now prioritizes a board-first workspace with three primary tabs:

1. **Board / List / Overview tabs**
   - Board is the default delivery surface.
   - List and Overview are peer tabs for dense scanning and project health.

2. **Decluttered controls with filter panel**
   - Primary actions remain visible in the header/task surfaces.
   - Secondary controls are moved into a dedicated filter panel to reduce top-bar noise.

3. **Overview visual metrics**
   - Segmented status bar for at-a-glance workflow distribution.
   - Completion bar for overall progress signal.
   - Blocked and overdue highlights to surface delivery risk early.
   - Breakdown lists for status/priority/work-type quick analysis.

4. **Mobile behavior improvements**
    - Tabs, project context, and key controls remain reachable at small breakpoints.
    - Drawer and filter interactions are tuned to avoid burying primary actions.

5. **Interactive Overview quick-jumps to Board filters**
   - Overview interactions are wired as actionable shortcuts, not static summaries.
   - Click behavior:
     - status segments/legend -> applies `status` filter
     - priority rows -> applies `priority` filter
     - work-type rows -> applies `work_type` filter
     - blocked/overdue tiles -> applies boolean filters (`is_blocked`, `is_overdue`)
   - Navigation behavior:
     - switches active tab to **Board**
     - opens filter controls with the selected filter pre-applied

### 7.7 Structured filter model and visible chips (implemented)

Board/List filtering uses a structured UI filter state with explicit, removable chips.

Canonical filter keys in current UI model:

- `status`
- `priority`
- `work_type`
- `sprint`
- `assignee_id`
- `is_blocked`
- `is_overdue`

Behavior:

- Every active filter is surfaced as a visible chip.
- Each chip supports single-filter removal.
- A global **Clear all** action resets the entire filter set.
- UI filter keys are mapped to existing task-query semantics/endpoints (no new endpoint family introduced).

### 7.8 Board column visibility controls (implemented)

- Users can show/hide existing status columns in Board view.
- Controls affect visibility only; they do not create, rename, or mutate workflow statuses.
- Guardrail: at least one status column must remain visible.
- Column-visibility preference is persisted and restored on reload.

### 7.9 Preference persistence semantics (implemented)

Persisted board preferences are local UI presentation state only, including:

- active tab/filter-panel state
- structured filter selections
- board column visibility

Constraints:

- Preference persistence MUST NOT mutate task/project workflow data.
- Preference writes are non-authoritative UI state (not task lifecycle events, not execution/review state changes).

### 7.10 Premium interaction polish (implemented)

Recent premium-polish refinements include:

- stronger click affordances for metric rows, segments, tiles, and actionable controls
- drag/drop motion refinements for smoother board interactions and clearer drop intent
- animated progress visuals (including overview progress signals) for more legible state change feedback

---

## 8) Screenshot catalogue and reproducible capture

### 8.1 Screenshot catalogue

1. `docs/features/projectmangement-multica/screenshots/project-board-desktop.png`
   - Desktop Board tab baseline with status columns and upgraded task cards.

2. `docs/features/projectmangement-multica/screenshots/project-board-overview.png`
   - Overview tab with segmented status/completion bars and breakdown lists.

3. `docs/features/projectmangement-multica/screenshots/project-board-list-view.png`
   - List tab presentation with compact scanning of task fields.

4. `docs/features/projectmangement-multica/screenshots/project-board-task-drawer.png`
   - Task drawer open state with planning/review/execution sections visible.

5. `docs/features/projectmangement-multica/screenshots/project-board-mobile.png`
   - Mobile responsive state, including tabs/project context and non-buried primary controls.

Note:

- `project-board-dense-board.png` is a legacy stress-density capture and is not part of the current primary screenshot set.

### 8.2 Reproducible capture procedure (deep-link based)

1. Open the project workspace with fixed query params and explicit tab:
   - Board baseline: `?view=projects&project_id=visual_review_board&tab=board`
   - Overview capture: `?view=projects&project_id=visual_review_board&tab=overview`
   - List capture: `?view=projects&project_id=visual_review_board&tab=list`
2. Capture desktop Board tab baseline.
3. Switch to Overview and capture visual metrics state.
4. Switch to List and capture list view.
5. Open a task drawer via deep link and capture drawer state:
   - `?view=projects&project_id=visual_review_board&tab=board&task_id=<task_id>`
6. Resize to mobile breakpoint and capture responsive Board tab behavior:
   - `?view=projects&project_id=visual_review_board&tab=board`

Notes:

- Keep endpoint usage aligned with implementation: dashboard reads remain `GET /api/projects/:id/dashboard`.

---

## 9) Tracking/dashboard metric definitions and formulas

1. **Completion rate**
   - `tasks_done / tasks_total * 100`

2. **Throughput (N days)**
   - count of tasks transitioned into `done` in last N days.

3. **Cycle time (hours)**
   - per task: `done_at - first_in_progress_at`
   - dashboard: p50 and p90 across sample window.

4. **Lead time (hours)**
   - `done_at - created_at`.

5. **Sprint commitment ratio**
   - `committed_points / capacity_points * 100`.

6. **Sprint completion ratio**
   - `completed_points / committed_points * 100`.

7. **Blocked rate**
   - `blocked_open / active_non_done_tasks * 100`.

8. **Review queue age**
   - average hours tasks stay in `in_review`.

9. **QA queue age**
   - average hours tasks stay in `qa_ready` + `qa_in_progress`.

10. **Reopen rate**
    - `tasks_reopened_from_done / tasks_done_in_period * 100`.

All formulas must be computed server-side from event/task data and returned pre-aggregated for dashboard rendering.

---

## 10) Migration and backward compatibility plan

### 10.1 Versioning

- Introduce schema `1.1` while continuing to read `1.0` records.
- On read:
  - if `1.0`, apply compatibility defaults.
- On write:
  - persist as `1.1`.

### 10.2 Field mapping

Legacy -> new mappings:

- `status needs_review` -> `workflow_status in_review`
- `priority low|medium|high` -> `p3|p2|p1`
- missing new fields -> defaults (`story_points=0`, `work_type=feature`, `completion_percent` computed)

### 10.3 API compatibility

- Existing clients using old status and priority values remain accepted during transition window.
- Server translates old values and returns canonical `1.1` values with optional `compat` block for legacy UI.

### 10.4 Rollout safeguards

1. Feature flags:
   - `BOARD_PM_UPGRADE_READ`
   - `BOARD_PM_UPGRADE_WRITE`
   - `BOARD_PM_DASHBOARD`
2. Dual-read validation logs for migrated records.
3. Migration ledger entries for every upgraded batch.
4. Rollback path: disable write flag, continue read in compatibility mode.

---

## 11) Phased implementation plan + acceptance criteria

### Phase 1 — Data model and validation

Deliver:

- schema migration scripts for task/project/sprint/dashboard tables
- validators for new enums/ranges
- compatibility adapters for 1.0 reads

Acceptance:

- creates/patches validate all new fields correctly
- legacy entities load without failure
- optimistic version checks unchanged

### Phase 2 — API upgrade

Deliver:

- sprint endpoints
- enhanced task filters/patch ops
- dashboard endpoint baseline aggregates

Acceptance:

- endpoint contracts return valid envelopes
- unsupported transitions return `422`
- dashboard endpoint supports project and range filtering

### Phase 3 — UI multi-view redesign

Deliver:

- board/list/backlog/sprint/dashboard views
- upgraded task cards and drawer sections
- sprint management controls

Acceptance:

- all views load from same canonical dataset
- DnD and quick actions respect transition rules
- task drawer edits persist across refresh
- visual readability supports fast scan of card title/status/owner/priority at standard desktop width
- keyboard navigation reaches cards and primary card/drawer actions in logical order
- responsive behavior keeps project switcher and primary project context visible (no burying)
- blocked tasks are visually more prominent than non-blocked tasks in board/list scanning

### Phase 4 — Metrics hardening and performance

Deliver:

- projection refresh strategy
- caching for dashboard queries
- instrumentation for query latency

Acceptance:

- dashboard p95 response <= 300 ms for 10k tasks/project dataset (local target)
- metric formulas match reference fixtures

### Phase 5 — Rollout and compatibility closure

Deliver:

- deprecation path for legacy status/priority values
- migration completion report and guardrail checks

Acceptance:

- no data loss on migration sample + production dry run
- rollback procedure validated

---

## 12) Test and verification matrix

| Area | Scenario | Type | Expected |
|---|---|---|---|
| Status transitions | `qa_ready -> done` without QA pass | unit/service | `422 invalid_transition` |
| Review boundary | agent/internal actor attempts approve | integration | `403 forbidden` |
| Assignment semantics | assignee change triggers no run | integration | no execution attempt created |
| Sprint rules | create 2 active sprints in one project | service | second request rejected |
| Dependency validation | task depends on unknown task | service | `422 validation_error` |
| Completion calc | subtasks 3/5 complete | unit | `completion_percent=60` |
| Priority mapping | legacy `high` on read | unit | mapped to `p1` |
| Dashboard formulas | throughput fixture over 14d | integration | exact expected counts |
| Backlog reorder | duplicate IDs in reorder payload | integration | `422` |
| API compatibility | old client patch with `set_status:needs_review` | integration | accepted + normalized |
| Visual readability | scan card hierarchy in desktop board | UI integration/manual | title/status/owner/priority readable without ambiguity |
| Keyboard navigation | navigate cards and open drawer without pointer | UI integration/manual | cards/controls reachable and actionable via keyboard |
| Responsive no-burying | mobile width with active project switcher | UI integration/manual | switcher + primary context remain visible/operable |
| Blocked prominence | mixed blocked/non-blocked board | UI integration/manual | blocked cards visibly distinct and prioritized in scan |
| Performance | dashboard on 10k tasks | perf | p95 <= target |
| Security | artifact/link path traversal attempt | security | blocked with 4xx |
| Concurrency | concurrent patch same task version | integration | one success, one `409` |
| Migration | 1.0 import + 1.1 writeback | migration test | all rows readable/writeable |

Verification stages:

1. Unit: validators, transition engine, formula helpers.
2. Service/API integration: endpoint behavior and auth boundaries.
3. UI integration (playwright or equivalent): view navigation and drawer actions.
4. Migration rehearsal: snapshot -> migrate -> compare record counts/hashes.
5. Production readiness check: feature flags + rollback drill.

---

## 13) Implementation notes

- Preserve existing explicit execution boundary and guardrail enforcement as non-negotiable constraints.
- Treat dashboard as projection/read model only; do not create a second mutable task authority.
- Keep existing activity/audit streams; extend event payloads for new fields instead of replacing event contracts.
