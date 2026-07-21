# Local-First Personal Workspace — Staged Implementation Specification

Status: proposed implementation authority  
Scope runtime: `interface/*` browser app + board service  
Date: 2026-07-21

---

## 1) Scope

This specification defines the staged implementation model for a **local-first personal workspace** while staying aligned with the current direction in code.

In scope:

- Phase 1 local-only baseline (mandatory first release).
- A single task system with root task navigation in **My Desk** + **Projects**.
- Activities as first-class local domain records, accessed in Phase 1 inside Projects context.
- Workspace baseline in `/api/workspace` for single-user local mode (not a primary root destination).
- Deferred phases for SharePoint/shared workspaces, sync/conflict, identity/RBAC.

Out of scope (Phase 1):

- SharePoint requirement for boot/read/write.
- Team/shared authorization enforcement.
- Cross-device/cross-user conflict resolution.

---

## 2) Goals / Non-goals

### Goals

1. Keep a phased rollout with **Phase 1 local-only** and SharePoint deferred.
2. Keep existing board SQLite as the canonical authority in Phase 1.
3. Treat activities as domain records (not only lifecycle feed projections).
4. Make **My Desk** and **Projects** the root task destinations in Phase 1.
5. Support one task model that can represent:
   - inbox task (no project/activity link),
   - project-linked task,
   - activity-linked task.
6. Define My Desk as an aggregate task attention view over the same task IDs used by Projects.
7. Provide a minimal personal workspace baseline through `/api/workspace` with no SharePoint config dependency and no root-navigation dependency.

### Non-goals

1. No SharePoint dependency in Phase 1 startup path.
2. No duplicate task authorities between My Desk and Projects.
3. No separate “Desk task” namespace with new IDs.

---

## 3) Staged delivery model

## Phase 1 — Local-only personal workspace baseline (mandatory)

### Phase 1 scope

- Existing board SQLite remains the only write authority.
- Task records stay canonical and are reused by all UI surfaces.
- Activities are persisted as first-class domain records in local DB and surfaced in Projects context.
- My Desk is introduced/confirmed as an aggregate attention lens over the same task system.
- Root task navigation is My Desk + Projects (no root Activities/Workspaces destination in Phase 1).
- `/api/workspace` returns a minimal personal workspace baseline.
- SharePoint capability remains optional and non-blocking.

### Phase 1 hard constraints

- App boots and core task flows work offline/local-only.
- Missing SharePoint config/auth does not block My Desk or Projects.
- No authority split: one task ID = same entity in all views.
- Workspace endpoint is required for baseline context but workspace is not a primary Phase 1 task destination.

## Phase 2 — SharePoint + shared workspace capability (gated)

- Add shared workspace capability behind explicit configuration and capability checks.
- Keep local personal workspace valid even if shared capability is unavailable.
- Add source/context signaling in UI where shared data is introduced.

## Phase 3 — Sync/conflict model

- Add explicit sync strategy between local and shared workspaces.
- Add stale-write/conflict handling semantics.
- Add observable reconciliation outcomes and failure states.

## Phase 4 — Identity/RBAC + governance hardening

- Enforce identity and RBAC for shared mutations.
- Add policy hooks for auditability, retention, and boundary controls.
- Keep personal-local mode available for users without shared membership.

---

## 4) Phase 1 domain model (normative)

## 4.1 Authority

- Existing board SQLite remains canonical for task/project/activity domain state.
- My Desk and Projects are UI/query lenses over that same state.

## 4.2 Tasks

Tasks remain first-class records with optional links:

1. **Inbox task**: no `project_id`, no `activity_id`.
2. **Project-linked task**: `project_id` set, `activity_id` unset.
3. **Activity-linked task**: `activity_id` set, `project_id` unset.

Phase 1 rule: link fields are optional, enabling task capture before classification, but are **mutually exclusive** when set (`project_id` and `activity_id` cannot both be set on the same task).

## 4.3 Activities

Activities are first-class domain records and can be referenced directly by tasks.

They are not only a derived lifecycle feed. Feed/timeline views may still project from activity records, but activity records themselves are part of authoritative domain data.

---

## 5) UI overlap resolution: My Desk vs Projects

## 5.0 Root navigation contract (Phase 1)

- Root task destinations are **My Desk** and **Projects**.
- **Activities** remain first-class records but are accessed within Projects context.
- **Workspace** remains single personal baseline context and is not a primary root destination.

## 5.1 Shared identity, different lens

- My Desk and Projects show the **same task IDs**.
- A change from either lens mutates the same underlying task record.
- There is no cloning, shadow copy, or desk-specific task table in Phase 1.

## 5.2 Lens contract

- **My Desk**: aggregate attention lens (e.g., inbox, today/attention, upcoming, unassigned follow-up).
- **Projects**: delivery lens (project/activity context, board workflow, structured planning).

Both lenses are valid on the same task; they differ by filter, grouping, and context—not by authority.

## 5.4 My Desk minimum requirements (Phase 1)

My Desk must provide:

1. Dashboard metrics for personal task attention state.
2. Quick capture for unlinked/inbox tasks.
3. Filter controls for attention slices.
4. Keyboard + checkbox completion UX for fast task completion.
5. Same-task-ID overlap behavior with Projects (no cloned or desk-only task IDs).

## 5.3 What changed in project space (Phase 1)

Project space no longer implies exclusive ownership of a separate task set. Instead:

1. Project views render tasks from the unified task authority filtered by `project_id` / `activity_id` context.
2. Tasks can start in inbox and later be linked to either project or activity without ID change.
3. Task detail views should expose context linkage clearly (project/activity linked vs unlinked).
4. Cross-navigation between My Desk and Projects should preserve task identity and selection where possible.

---

## 6) Workspace in Phase 1: baseline context only

## 6.1 Is Workspace needed in Phase 1?

Yes — but only as a **minimal personal workspace baseline**, not as shared infra and not as a primary root task destination.

Phase 1 requires `/api/workspace` to return enough context for local operation (single personal workspace mode).

## 6.2 Phase 1 configuration contract

Required:

- Local app/runtime storage paths are available.
- Workspace endpoint resolves a personal-local workspace baseline.

Not required:

- SharePoint `sharedKnowledgeRoot` configuration.
- Graph/SharePoint authentication session.
- Team/shared workspace membership config.

Expected endpoint behavior:

- Personal workspace is present/enabled.
- Shared capability is explicitly reported as `disabled`, `not_configured`, or equivalent non-ready state.
- Non-ready shared capability does not degrade local task/project flows.

---

## 7) Data/API direction (Phase 1)

## 7.1 Data model direction

- Reuse existing board SQLite authority.
- Keep single authoritative task records with optional project/activity links that are mutually exclusive in Phase 1.
- Persist activities as first-class domain records.
- Avoid introducing a second authoritative “desk items” entity for Phase 1.

## 7.2 API direction

- Preserve current board/task/project API compatibility.
- Ensure workspace endpoint exposes minimal personal workspace baseline and shared capability state.
- My Desk data retrieval should be implemented as task queries/projections over unified task records.
- Activity endpoints/queries should return domain activities usable by both My Desk and Projects views.
- Root navigation/API composition in Phase 1 should prioritize My Desk + Projects, with workspace as context bootstrap only.

---

## 8) Migration and sequencing

## 8.1 Phase 1 sequencing (implementation order)

1. Confirm/lock single-authority task model in storage + service layer.
2. Ensure activity records are persisted as first-class domain entities.
3. Wire My Desk aggregate lens to unified task queries.
4. Ensure Projects lens consumes same task IDs and link semantics.
5. Finalize `/api/workspace` minimal personal baseline behavior.
6. Run regression validation and update docs/status.

Do not begin SharePoint/shared write-path implementation until Phase 1 acceptance is complete.

## 8.2 Migration policy

- Additive, non-destructive schema evolution only.
- No destructive rewrite of existing board data.
- Rollback via DB snapshot restore procedure.

---

## 9) Acceptance criteria

## Phase 1 acceptance (must pass)

1. **Local-only boot:** app boots and core flows work with no SharePoint config/auth.
2. **Single authority:** My Desk and Projects operate on same task IDs and no duplicate authoritative task store exists.
3. **Task typing by linkage:** system supports inbox, project-linked, and activity-linked tasks via optional links, with `project_id` and `activity_id` mutually exclusive in Phase 1.
4. **Navigation contract:** root task navigation is My Desk + Projects; Activities are accessed inside Projects; Workspace is not a primary root destination.
5. **Activities as domain records:** activities exist as first-class persisted records and power timeline/feed queries.
6. **My Desk UX minimum:** dashboard metrics, quick capture, filters, keyboard+checkbox completion, and same-task-ID overlap with Projects are present.
7. **Workspace baseline:** `/api/workspace` returns personal-local baseline and explicit shared capability state.
8. **Project lens compatibility:** existing project workflows remain functional with unified task authority.

## Phase 2 acceptance

1. SharePoint/shared workspace capability is explicit and gated.
2. Shared unavailability does not break local personal workspace operation.

## Phase 3 acceptance

1. Sync behavior and conflict semantics are explicit, deterministic, and test-covered.
2. User-visible conflict states/recovery paths are implemented for shared sync scenarios.

## Phase 4 acceptance

1. Shared mutations enforce identity and RBAC rules.
2. Governance/audit controls are present for shared operations.

---

## 10) Verification checkpoints

## Automated checkpoints

- Storage/service tests verify one authoritative task model with optional `project_id` / `activity_id` links and Phase 1 mutual exclusivity.
- Activity persistence tests verify activities as domain records (not feed-only derivations).
- API tests verify My Desk and Projects operate on same task identifiers.
- API tests verify `/api/workspace` local baseline in absence of SharePoint config.
- Regression tests for existing project/task endpoints.

## Manual checkpoints

1. Start in clean local environment without SharePoint config.
2. Verify root task navigation exposes My Desk + Projects (no root Activities/Workspaces destination).
3. Create inbox task via My Desk quick capture; verify it appears in My Desk and remains unlinked.
4. Link task to either project or activity; verify same task ID appears in Projects context.
5. Complete task using My Desk keyboard+checkbox UX; verify completion state in Projects for same task ID.
6. Update task from Projects; verify changes reflected in My Desk immediately (same record).
7. Attempt to set both `project_id` and `activity_id` on one task; verify Phase 1 behavior rejects or prevents dual linkage.
8. Verify activity timeline/feed reflects persisted activity domain records.
9. Check `/api/workspace` response confirms personal-local baseline and non-blocking shared capability state.

## Exit gate

Phase 1 is complete only when all Phase 1 acceptance criteria and verification checkpoints pass.

---

## 11) Delivery authority

This document is implementation authority for staged local-first workspace sequencing.

If implementation diverges from this spec, either:

1. update implementation to match this spec, or
2. issue an explicit spec amendment in `docs/architecture/` before release.
