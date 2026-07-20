# Browser App Local-Core + Team-Layer Storage Specification (`interface/` + `chat/`)

Status: implemented baseline specification (normative)  
Scope runtime: browser app only (`interface/server.mjs`, `chat/server.mjs`)  
Date: 2026-07-20

---

## 1) Purpose, scope, and definitions

### 1.1 Purpose

This document defines the target storage architecture for the browser app runtime:

- **Local single-user core** (default, high-performance)
- **Optional team capability layer** (enabled by explicit profile/mode)

It translates the technical-audit decisions into implementation-ready requirements.

### 1.2 Scope

In scope:

- `interface/server.mjs`
- `interface/board/storage.mjs`
- `interface/board/service.mjs`
- `interface/scheduler.mjs`
- `chat/server.mjs`
- Existing storage adapters and docs contracts:
  - `interface/storage/fs-storage.mjs`
  - `interface/storage/graph-storage.mjs`
  - `docs/architecture/project-storage-and-refresh-architecture.md`
  - `docs/features/projectmangement-multica/simple-multica-lite-project-agent-board.md`
  - `docs/status-and-roadmap.md`
  - `docs/reference/ai-os-comparison-and-staged-concept.md`
  - `docs/reference/personal-assistant-gap-analysis.md`
  - `.mcp.json`
  - `skills/personal/twenty-crm-integration/SKILL.md`

Out of scope:

- Desktop-only runtime internals
- Stage 5 enterprise policy engine redesign
- Unapproved external benchmark claims

### 1.3 Definitions

- **Canonical store**: authoritative write target for a domain.
- **Derived store**: index/projection/export generated from canonical data.
- **Requested mode**: user/config requested profile mode before validation.
- **Effective mode**: mode applied after capability checks and safety gates.
- **Operational store**: high-frequency, indexed runtime state store (SQLite).
- **Readable export**: human/agent-facing projection (Markdown/JSON/JSONL).

---

## 2) Goals and non-goals

### 2.1 Goals

1. Maintain Markdown-first knowledge governance for Stage 1/2 contracts.
2. Introduce SQLite-backed operational state for board/scheduler/chat index/usage queries.
3. Keep local single-user runtime lean and fast by default.
4. Keep team capability optional and isolated.
5. Eliminate dual-write canonical authority during migration.

### 2.2 Non-goals

1. Replacing Markdown as canonical company/personal knowledge.
2. Making CSV authoritative runtime state.
3. Requiring CRM connectivity for local mode.
4. Changing orchestration semantics in `CLAUDE.md`.

---

## 3) Target architecture: local single-user core + optional team capability layer

### 3.1 Architecture model

The runtime MUST be split logically into two layers:

1. **Local Core Layer (mandatory)**
   - Always available.
   - Contains local operational SQLite store and local file projections.
   - Must function without shared team roots or CRM.

2. **Team Capability Layer (optional)**
   - Enabled only when requested mode and safety checks pass.
   - Adds team-scope board operations and shared knowledge integrations.
   - Must not degrade local-core availability when unavailable.

### 3.2 Service initialization requirements

- `interface/server.mjs` MUST initialize local-core services unconditionally.
- Team services MUST initialize lazily and only when effective mode includes team capability.
- Local mode MUST NOT initialize team-only watchers, scanners, or sync loops.
- `chat/server.mjs` MUST remain operational in local mode independent of team-layer status.

---

## 4) Runtime profile model and mode semantics

### 4.1 Mode model

The runtime MUST track both requested and effective mode.

Requested mode MUST be derived from user settings (`interface/app-settings.mjs`, including `userType` and configured roots):

- `single-user`
- `team-user`
- `collaborator`

Effective mode MUST be computed at startup and on profile switch by validating:

1. root path safety/non-overlap,
2. root existence and accessibility,
3. required credentials for enabled integrations,
4. guardrail policy readiness.

### 4.2 Effective mode downgrade rules

- If team capability checks fail, runtime MUST disable team capability in effective mode and report explicit diagnostics.
- Degradation MUST be fail-safe (no partial team writes and no implicit local substitution for team actions).
- Requested mode MUST remain persisted; effective mode and team capability status MUST be observable via API status.
- Team-scoped actions attempted while team capability is unavailable MUST fail closed with explicit error semantics (for example `TEAM_CAPABILITY_UNAVAILABLE`) and MUST NOT be converted into local/private authoritative writes.

### 4.3 Deployment Modes (normative)

The runtime MUST support exactly two deployment modes:

1. **`local-only`**
   - Local SQLite + local file contracts only.
   - Team services MUST NOT initialize.
2. **`team-server`**
   - Local core remains active.
   - Team capability is enabled only after all team checks pass.

Mode observability requirements:

- API status MUST expose `requestedMode`, `effectiveMode`, and `teamCapability` (`enabled`/`disabled` + reason).
- Operational logs/audit events SHOULD include mode at mutation time.

### 4.4 Identity & Authentication (normative)

- Runtime MUST establish a stable local actor identity for each mutating operation.
- When team capability is enabled, runtime MUST bind operations to authenticated team identity context before team-scope reads/writes.
- Unauthenticated or ambiguous identity context MUST fail closed for team-scope actions.
- Identity metadata recorded in audit/event rows MUST include actor ID, scope (`local`/`team`), and timestamp.

### 4.5 Authorization & Tenant Isolation (normative)

- Authorization MUST be evaluated per request and per target scope.
- Local/private board authorities and team-board authorities MUST be isolated and MUST NOT share write paths.
- Cross-tenant/team reads or writes MUST be denied unless explicitly authorized by active effective mode and policy.
- Root overlap/symlink protections from `interface/app-settings.mjs` and `interface/board/storage.mjs` MUST remain mandatory safeguards.

### 4.6 Data Classification and Residency (normative)

- **Local-only by default:** personal memory, raw chat transcripts, local scheduler/board state, and local secrets/config.
- **Shared knowledge authority:** files governed by OneDrive/Graph integration when that adapter is active.
- **External authority:** CRM entities in Twenty when enabled.
- Data classified as local-only MUST NOT be written to shared cloud/synced roots unless explicit approved promotion/export flow exists.

---

## 5) Profile switching lifecycle and safety requirements

Profile switch (`requested mode` change) MUST follow this lifecycle:

1. **Preflight validation**
   - Validate root safety (overlap, symlink, accessibility) using policies aligned with `interface/app-settings.mjs` and `interface/board/storage.mjs`.
2. **Operational quiesce**
   - Block new mutating board/scheduler/chat-index writes during switch window.
3. **Snapshot + migration hooks**
   - Create local backup snapshot for affected operational stores.
4. **Apply mode**
   - Activate effective mode only after successful checks.
5. **Post-switch verification**
   - Run store health checks and emit switch audit event.

Safety rules:

- Runtime MUST prevent mixed-scope writes during switch.
- Runtime MUST fail closed on partial migration failure.
- Runtime MUST provide reversible recovery to last valid snapshot.

---

## 6) Storage architecture policy (normative)

Authoritative runtime matrix is maintained in:

- `docs/architecture/agent-versioning-and-permission-boundaries.md` (§2)

The matrix below is a local runtime view aligned to that canonical mapping.

| Data domain | Canonical store | Derived / index / projection stores | Human-readable requirement | API access pattern | Backup / retention policy |
|---|---|---|---|---|---|
| Knowledge documents (`knowledge/company`, `knowledge/personal`, `knowledge/inbox`) | Markdown files via `interface/storage/fs-storage.mjs` or `interface/storage/graph-storage.mjs` | Optional search/index projections | MUST be human-readable canonical | File API read/write by path | Daily backup + versioned history per existing knowledge policy |
| Personal memory markdown (`memory/MEMORY.md`, `memory/daily/*.md`) | Markdown files (local-first) | Optional search/index projection | MUST remain human-readable canonical | Append/read APIs and file operations | Local backup; never mandatory team replication |
| Run logs markdown (`runs/*.md`) | Markdown files | Optional dashboard index entries | MUST remain human-readable canonical | Append/read by run-log workflow | Time-based retention policy with local archive option |
| Knowledge metadata/workflow sidecars (`interface/meta.json`, `interface/workflows.json`) | JSON files | Optional cache mirrors | SHOULD be human-readable | Whole-file read/write | Versioned backup before schema changes |
| Runtime/app/provider/plugin/guardrail settings (`interface/app-settings.json`, `interface/provider-settings.json`, `interface/plugins.json`, `interface/guardrails.json`, `.mcp.json`) | JSON files | Optional runtime in-memory cache | SHOULD be human-readable (except secret values) | Controlled read/update endpoints | Backup on write + permissions hardening |
| Private/local board projects/tasks | SQLite (local canonical DB) | Optional generated JSON/Markdown agent-readable views | MAY generate human-readable views; DB canonical | Indexed query + transactional writes | Point-in-time snapshots + WAL checkpoints |
| Team board projects/tasks | Deferred central team service (not local JSON/SQLite baseline authority) | Temporary read-only compatibility projections only when explicitly enabled | SHOULD expose readable views, but not local authority fallbacks | Team capability APIs gated by identity and policy | Defined by approved team service design (deferred) |
| Scheduler jobs/runs operational state | SQLite | JSON export snapshots for compatibility | Export SHOULD be readable; DB canonical | Indexed query + transactional writes | Rolling snapshots + retention policy for historical runs |
| Chat session index/search metadata | SQLite | `chat/sessions.json` compatibility export during transition | Export SHOULD be readable; DB canonical | Indexed reads/search + transactional updates | Regular snapshot + consistency check |
| Board/scheduler lifecycle events | SQLite event tables in same transaction as lifecycle state mutations | Optional JSONL/Markdown readable exports | Export MAY be human-readable; SQLite rows canonical | Transactional writes + indexed reads | Snapshot + WAL + replay validation |
| Chat transcripts (`chat/history/*.jsonl`) | JSONL append logs | SQLite metadata/FTS index | MUST remain readable append logs | Append-only write + indexed lookup via projection | Time-based retention + optional compaction |
| Usage telemetry (`runs/usage.jsonl`, legacy `runs/chat-usage.jsonl`) | JSONL append logs | SQLite aggregate/projection tables | MUST remain readable append logs | Append-only write + indexed aggregate reads | Time-based retention + compaction policy |
| Artifact binaries + metadata | Binary payload in authorized local artifact roots + metadata catalog (SQLite) | Optional preview/thumbnail/index projections | Metadata SHOULD be human-readable; binary opaque | Opaque artifact ID API only (no raw path trust) | Retention classes + secure deletion policy |
| CRM cache/reference projections | Local SQLite/JSON cache marked non-authoritative | Derived joins/views for UI | SHOULD be inspectable but clearly marked non-authoritative | Read-mostly cache APIs, validated writes via Twenty | TTL + invalidation + refresh policy |
| CSV external data exchanges | None (never canonical) | CSV import/export files | Human-readable by spreadsheet tools | Import/export endpoints only | Retention per import/export policy |

---

## 7) Specific decisions by format

### 7.1 Markdown canonical domains

The following domains MUST remain Markdown canonical:

1. `knowledge/**/*.md` (company/personal/inbox)
2. Architecture and governance docs in `docs/**/*.md`
3. Human-authored artifacts and run logs in `runs/*.md` where applicable

### 7.2 JSON configuration domains

The following SHOULD remain JSON canonical:

- `interface/meta.json`
- `interface/workflows.json`
- `interface/provider-settings.json`
- `interface/app-settings.json`
- `interface/guardrails.json`
- `interface/plugins.json`
- `.mcp.json`

### 7.3 JSONL event/export domains

The following MUST remain JSONL append streams:

- `runs/usage.jsonl` (plus managed legacy handling for `runs/chat-usage.jsonl`)
- `chat/history/*.jsonl`
- readable board/scheduler activity or audit export streams when retained

### 7.4 SQLite operational domains

SQLite MUST be canonical for:

1. Projects/tasks operational reads/writes currently in `interface/board/storage.mjs`
2. Scheduler jobs/runs currently in `interface/scheduler.mjs`
3. Chat session index/search state currently in `chat/sessions.json` logic in `chat/server.mjs`
4. Board/scheduler lifecycle event rows transactionally committed with state changes
5. Query projections over usage/activity streams for UI analytics

### 7.5 CSV import/export-only policy

CSV MAY be supported for:

- Importing external CRM/project/task datasets
- Exporting reports/snapshots

CSV MUST NOT be used as canonical state due to typing, nesting, transaction, and concurrency limitations.

### 7.6 Event authority model by domain

1. **Board/scheduler lifecycle events**
   - MUST be written transactionally in SQLite alongside the lifecycle mutation they describe.
   - MUST NOT depend on append-log success to commit canonical state.
   - JSONL/Markdown event exports MAY be generated as derived outputs.
2. **Chat transcripts**
   - MUST remain canonical JSONL append logs in `chat/history/*.jsonl`.
   - SQLite MAY maintain metadata/FTS indices only as derived acceleration.
3. **Usage telemetry**
   - MUST remain canonical JSONL append logs in `runs/usage.jsonl` (and managed legacy stream while needed).
   - SQLite aggregates are derived query projections and MUST be rebuildable from canonical append logs.

---

## 8) Projects/tasks specification for high-performance single-user mode

### 8.1 Canonical SQLite schema concept (high level)

The operational board schema MUST include, at minimum:

- `projects` table (id, visibility, status, owner, review, blocked, version, timestamps)
- `tasks` table (id, project_id, status, priority, assignee/workflow refs, review, blocked, version, timestamps)
- `task_execution_attempts` table (attempt_id, task_id, idempotency_key, state, runtime_mode, scheduler refs, summaries, timestamps)
- `task_execution_updates` table (attempt_id, sequence/time, source, summary, state)
- `activity_events` and `audit_events` tables (immutable event rows, entity/action metadata)
- `links_paths` and `links_runs` projection tables for relational querying

The schema MUST preserve contracts currently enforced in `interface/board/service.mjs` (version checks, status transitions, run/cancel/retry semantics, reviewer logic).

### 8.2 Optional generated agent-readable views

- Runtime SHOULD generate optional read-only JSON or Markdown projections for agent/tool consumption.
- Generated views MUST be explicitly marked derived and MUST NOT become authority.

### 8.3 UI/query requirements and indexing

Required indexes MUST include:

- project visibility + status + updated_at
- task project_id + status + priority + updated_at
- task execution state + attempt_id + scheduler_run_id
- event timestamp indexes for activity/audit pagination

Required objective targets (benchmarks pending):

- Board list/filter and project detail queries must meet defined P95 targets.
- Mutation operations with optimistic version checks must meet defined P95 targets.
- No benchmark result may be claimed until measured and documented.

---

## 9) CRM specification

### 9.1 Authoritative model when CRM is enabled

When Twenty CRM integration is configured (`.mcp.json`, `skills/personal/twenty-crm-integration/SKILL.md`):

- CRM entities (accounts/companies, contacts/people, opportunities, CRM activities) MUST treat Twenty as authoritative source.
- Local runtime MAY cache or project CRM data for UX performance.
- Local cache MUST carry source timestamp/version metadata.

### 9.2 Local lightweight mode when CRM is disabled

- Local mode MUST function fully without Twenty connectivity.
- Local project/task coordination remains canonical in local operational store.
- CRM-dependent UI paths SHOULD degrade gracefully with explicit status messaging.

### 9.3 Local reference/cache staleness handling

- Cache records MUST include `fetched_at` and source identifiers.
- UI MUST indicate stale cache beyond configured TTL.
- Mutating CRM actions MUST re-validate against source before write.

### 9.4 External-system contracts

1. **OneDrive/Graph contract**
   - For shared knowledge paths accessed via `interface/storage/graph-storage.mjs`, OneDrive/Graph is authoritative.
   - Local caches/projections MUST be treated as derived and refreshable.
2. **Twenty CRM contract**
   - When enabled, Twenty is authoritative for CRM entities.
   - Local CRM tables/JSON caches MUST be clearly marked non-authoritative and rebuildable.
3. **Workflow provider contract (future optional)**
   - External workflow engines (for example Trigger.dev) MAY be evaluated as optional integrations only.
   - They MUST NOT be baseline runtime dependencies for local-only mode.
   - Adoption requires separate approval, security review, and migration gate.

---

## 10) Scheduler/chat/usage migration outcome (JSON/JSONL → SQLite operational store)

### 10.1 Migration scope (completed for local core)

Operational authority was migrated from:

- `scheduler/jobs.json` and `scheduler/runs.json`
- `chat/sessions.json`
- file-scan-only usage analytics over `runs/usage.jsonl`

to SQLite operational tables while preserving JSON/JSONL readable exports where required.

### 10.2 Authority rule

- SQLite is the single canonical authority for migrated operational domains.
- Runtime does not keep long-term dual-write authority.
- Temporary compatibility exports are allowed but MUST be one-way derived outputs.

### 10.3 Readable export preservation

- `runs/usage.jsonl` MUST remain append-readable.
- `chat/history/*.jsonl` MUST remain append-readable.
- Legacy JSON compatibility files MAY be generated during transition for UI/API backward compatibility windows only.

---

## 11) API and service composition requirements

1. Local mode MUST NOT initialize team services.
2. Team-mode services MUST be explicitly gated by effective mode.
3. API responses MUST expose requested mode, effective mode, and team capability status/reason.
4. `interface/board/service.mjs` and `interface/scheduler.mjs` integrations MUST preserve behavior contracts for run lifecycle callbacks.
5. `chat/server.mjs` session/transcript APIs MUST preserve existing endpoint behavior while storage backend changes.
6. Team-intended API actions MUST fail closed when team capability is unavailable and MUST NOT silently write into local/private board authority.

---

## 12) Security requirements

1. Credentials and secrets (provider settings, MCP tokens) MUST NOT be written to logs or readable exports.
2. Sensitive config files (`interface/provider-settings.json`, `.mcp.json`) MUST use restrictive local permissions.
3. Operational SQLite files MUST be placed in machine-local runtime paths with least-privilege permissions.
4. Guardrails/policy enforcement from `interface/guardrails.mjs` MUST remain in force across migration.
5. Cross-profile root overlap/symlink checks MUST remain mandatory.

### 12.1 Local SQLite constraints (normative)

1. SQLite DB, WAL, and SHM files MUST reside in machine-local paths controlled by the current user.
2. SQLite files MUST NOT be created or used under OneDrive/iCloud/Dropbox/network mounts or other synchronized roots.
3. File permissions MUST default to owner-only read/write (least privilege) and MUST be re-validated on startup.
4. Backup/snapshot jobs MUST include DB + WAL-consistent handling (checkpoint or backup API strategy) and restore validation.
5. Runtime MUST treat unexpected DB path relocation to synced/network roots as policy violation and fail closed for mutating operations.

### 12.2 Attachment and artifact containment requirements (normative)

1. All attachment/artifact access MUST use opaque artifact IDs; runtime MUST NOT trust raw client-provided filesystem paths.
2. Read/write/delete operations MUST perform authorization checks against active identity, scope, and policy.
3. Runtime MUST enforce type/size policy before accepting artifact writes.
4. Retention and deletion policies MUST be explicit per artifact class, including secure delete behavior where required.
5. Artifact access attempts (success/failure) SHOULD be auditable with actor, artifact ID, operation, and timestamp.

### 12.3 Enforcement boundary note (normative)

- There is no unified agent gateway in the current runtime.
- Enforcement is runtime-specific (Claude runtime rules, interface file API checks, scheduler tool restrictions, MCP-local controls).
- Agent-specific guardrail entries and skill/plugin declarations are routing/dependency metadata; they are not standalone invocation-time authorization.

---

## 13) Backup/recovery and corruption handling requirements

1. Runtime MUST take pre-migration snapshots before schema transitions.
2. SQLite MUST run integrity checks at startup and after unclean shutdown recovery.
3. On corruption detection, runtime MUST fail closed for affected domain and surface actionable recovery steps.
4. JSON/JSONL compatibility exports MUST be reproducible from canonical store plus immutable logs.
5. Recovery procedures MUST be documented and testable without manual DB surgery.

---

## 14) Migration record (legacy planning retained for traceability)

Legacy phase wording below describes the original migration contract. Current local-core runtime has completed the operational authority shift to SQLite for scheduler, private board state, and chat session metadata/index domains. Team service authority remains deferred.

### Phase 0 — storage interfaces + driver spike

- Introduce storage interfaces for board/scheduler/chat-index/usage projection domains.
- Implement and validate SQLite driver spike behind non-authoritative feature flag.
- Define schema versioning, migration ledger, and rollback primitives.

### Phase 1 — scheduler

- Migrate `scheduler/jobs.json` and `scheduler/runs.json` authority to SQLite.
- Keep bounded, one-way JSON compatibility exports where required.

### Phase 2 — private/local board

- Migrate private/local board project/task authority from JSON files to SQLite.
- Keep lifecycle events transactionally in SQLite; keep readable exports as derived outputs only.

### Phase 3 — chat index/FTS metadata

- Move `chat/sessions.json` authority to SQLite metadata/index tables.
- Keep `chat/history/*.jsonl` as canonical transcript append logs.

### Phase 4 — usage projection

- Keep `runs/usage.jsonl` canonical append stream.
- Build/maintain SQLite projection and aggregation tables for fast dashboard queries.

### Phase 5 — separately approved team service

- Implement team-board authority only via separately approved central team service.
- No implicit local fallback writes for team-intended actions while team service is absent/unavailable.

All phases MUST be one-way and checkpointed. Rollback MUST restore the last full snapshot; runtime MUST NOT run dual canonical authorities.

---

## 15) Acceptance criteria and verification plan

### 15.1 Acceptance criteria

1. Markdown canonical domains remain unchanged and writable through existing knowledge APIs.
2. Operational board/scheduler/chat-index domains are canonical in SQLite.
3. JSON/JSONL derived exports remain readable where required.
4. Requested/effective mode semantics are visible and correct.
5. Local mode boot does not initialize team services.
6. Team-intended actions fail closed when team capability is unavailable (no silent local-write substitution).
7. Security checks pass for secret exposure, file permissions, and SQLite path policy.
8. Attachment/artifact operations enforce opaque-ID access control and policy checks.

### 15.2 Verification plan

- Functional parity tests for existing endpoints in `interface/server.mjs` and `chat/server.mjs`.
- Migration tests with representative fixture datasets.
- Concurrency tests for task run/cancel/retry paths from `interface/board/service.mjs`.
- Integrity/recovery tests for simulated crash/corruption scenarios.
- Performance validation against required objectives (benchmark execution required before claims).
- Identity/tenant isolation tests for local scope vs team scope authorization behavior.
- Secret-leak regression checks across logs, exports, and error paths.
- Migration rollback tests validating snapshot restoration and post-rollback consistency.
- Attachment security tests (path traversal prevention, unauthorized read/write rejection, type/size policy enforcement).

---

## 16) Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Incomplete migration leaves split authority | Data inconsistency | Enforce one-way canonical cutover with explicit authority flags |
| Team-layer initialization leakage in local mode | Unnecessary failures/latency | Hard gate team service init by effective mode |
| Legacy consumers depend on JSON files | Breakage risk | Provide bounded, explicit derived compatibility exports |
| SQLite corruption handling not hardened | Runtime outage | Startup integrity checks + snapshot restore path |
| Secret leakage via logs/exports | Security incident | Redaction, strict config permissions, export filtering |

---

## 17) Deferred technology decisions

1. **Drizzle/ORM choice**
   - Deferred until Phase 0 driver spike establishes query/migration requirements.
   - Gate: measurable developer ergonomics and migration safety versus raw SQL baseline.
2. **PostgreSQL timing and gates**
   - Deferred beyond local SQLite stabilization.
   - Gate: approved team service architecture, multi-tenant requirements, and operational SLOs that exceed local SQLite scope.
3. **Vector search introduction criteria**
   - Deferred; not baseline for initial chat index rollout.
   - Gate: documented retrieval use case, relevance metrics, and storage/latency budget acceptance.
4. **Workflow engine adoption**
   - Deferred; external engines (for example Trigger.dev) are optional candidates only.
   - Gate: separate approval, security/compliance review, failure-mode analysis, and rollback plan.
5. **Retention defaults and compatibility-export windows**
   - Deferred until production telemetry from Phases 1-4 is available.
   - Gate: storage growth profile, support burden, and user-facing audit/report requirements.

---

## 18) Traceability references

- `interface/server.mjs`
- `interface/storage/fs-storage.mjs`
- `interface/storage/graph-storage.mjs`
- `interface/board/storage.mjs`
- `interface/board/service.mjs`
- `interface/scheduler.mjs`
- `chat/server.mjs`
- `docs/architecture/project-storage-and-refresh-architecture.md`
- `docs/features/projectmangement-multica/simple-multica-lite-project-agent-board.md`
- `docs/status-and-roadmap.md`
- `docs/reference/ai-os-comparison-and-staged-concept.md`
- `docs/reference/personal-assistant-gap-analysis.md`
- `.mcp.json`
- `skills/personal/twenty-crm-integration/SKILL.md`
