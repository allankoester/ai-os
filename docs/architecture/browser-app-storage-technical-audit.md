# Browser App Storage Technical Audit (`interface/` + `chat/`)

Status: approved architecture audit baseline (updated to implemented storage state)  
Scope runtime: browser app only (`interface/server.mjs`, `chat/server.mjs`)  
Date: 2026-07-20

## 1) Purpose and scope

This audit evaluates storage in the current browser-app runtime and defines format decisions for the next implementation phase.

In scope:

- Interface runtime (`interface/server.mjs`) and its storage modules:
  - `interface/storage/fs-storage.mjs`
  - `interface/storage/graph-storage.mjs`
  - `interface/board/storage.mjs`
  - `interface/board/service.mjs`
  - `interface/scheduler.mjs`
- Chat runtime (`chat/server.mjs`)
- Existing storage/roadmap contracts in:
  - `docs/architecture/project-storage-and-refresh-architecture.md`
  - `docs/features/projectmangement-multica/simple-multica-lite-project-agent-board.md`
  - `docs/status-and-roadmap.md`
  - `docs/reference/ai-os-comparison-and-staged-concept.md`
  - `docs/reference/personal-assistant-gap-analysis.md`
  - `.mcp.json`
  - `skills/personal/twenty-crm-integration/SKILL.md`

Out of scope:

- Desktop runtime internals (`desktop/opencode/*`)
- Non-browser execution lanes not initialized by `interface/server.mjs` and `chat/server.mjs`
- Any benchmark claim not executed in this session

---

## 2) Current runtime and storage architecture overview

### 2.1 Runtime composition

1. `interface/server.mjs` is the primary HTTP API for knowledge editing, board, scheduler, plugins/guardrails, and settings.
2. `chat/server.mjs` is a separate HTTP/SSE runtime for chat sessions, transcript history, and usage logging.
3. The two runtimes share some file-based stores (for example `runs/usage.jsonl`) but otherwise own distinct local state roots.

### 2.2 Current storage backends by subsystem

- **Knowledge documents**: Markdown via filesystem (`interface/storage/fs-storage.mjs`) or Microsoft Graph adapter (`interface/storage/graph-storage.mjs`), path contract `knowledge/**/*.md`.
- **Board (private/projects/tasks operational state)**: SQLite canonical for local core; readable JSON/Markdown views are derived compatibility outputs only.
- **Scheduler**: SQLite canonical operational state, scheduler logs under `scheduler/logs/*.log`, and canonical usage append stream `runs/usage.jsonl` (`interface/scheduler.mjs`).
- **Chat**: `chat/history/*.jsonl` remains canonical transcripts; session metadata/search index is SQLite canonical; optional `chat/sessions.json` compatibility export is derived only.
- **Runtime settings/state**: JSON sidecars such as `interface/meta.json`, `interface/workflows.json`, `interface/provider-settings.json`, `interface/app-settings.json`, `interface/guardrails.json`, `interface/plugins.json`, and `.mcp.json`.

### 2.3 Architectural shape today

The browser app remains file-first for knowledge/governance artifacts and local-first for runtime operation. High-churn operational domains now use machine-local SQLite canonical stores for local core reliability and query performance.

### 2.4 SME Recommendation Fit Review

| SME recommendation | Fit status | Adaptation for this project (`interface/` + `chat/`) |
|---|---|---|
| Move high-churn runtime state to SQLite | Full fit | Adopt as committed direction for scheduler, private/local board, chat session/search metadata, and usage query projections. |
| Keep human-authored knowledge and operational narratives in Markdown | Full fit | Keep `knowledge/**/*.md`, `memory/MEMORY.md`, `memory/daily/*.md`, and `runs/*.md` as Markdown canonical. |
| Use one central shared authority for team board writes | Partial fit (deferred) | Defer team-board authority decision until a separately approved central team service exists; do not treat shared-drive JSON as long-term team authority. |
| Preserve external source authorities (OneDrive/Graph, CRM) | Full fit | Keep OneDrive/Graph authority for shared knowledge docs and Twenty authority for CRM entities (when enabled). |
| Introduce workflow orchestration engine for jobs/events | Deferred | Keep current local scheduler semantics as baseline; evaluate external workflow provider only as optional gated future capability. |

---

## 3) Current storage inventory

| Data type | Path(s) | Format | Canonical owner | Read/write pattern | Scale & concurrency profile | Agent readability | Performance implications |
|---|---|---|---|---|---|---|---|
| Company/personal/inbox knowledge docs | `knowledge/**/*.md` via `interface/storage/fs-storage.mjs` or `interface/storage/graph-storage.mjs` | Markdown | Knowledge contract (`CLAUDE.md`, `knowledge/README.md`) | Frequent reads, moderate writes, per-file edit | Medium corpus, low concurrent writes per file | High (human + agent) | Good for authoring; folder scans and Graph roundtrips are expensive for aggregate views |
| Personal memory store | `memory/MEMORY.md`, `memory/daily/*.md` | Markdown | Local user memory contract (`CLAUDE.md`, `memory/README.md`) | Frequent append/read, low concurrency | Low-medium growth over time | High (human + agent, local context) | Good human auditability; keep local-first and non-authoritative for team sync |
| Significant run logs | `runs/*.md` | Markdown | Local run-log contract in `CLAUDE.md` | Append/write per significant workflow | Medium over long-running usage | High | Good traceability; should remain markdown rather than operational DB rows |
| Knowledge metadata sidecar | `interface/meta.json` | JSON | Interface metadata API in `interface/server.mjs` | Whole-file read/write | Low volume, low concurrency | Medium | Whole-file rewrite; acceptable at current size |
| Workflow overrides | `interface/workflows.json` | JSON | Interface workflow config in `interface/server.mjs` | Whole-file read/write | Low volume, low concurrency | Medium | Acceptable; no index/query pressure |
| Provider runtime settings (includes env vault entries) | `interface/provider-settings.json` | JSON | Interface settings API (`interface/server.mjs`) | Whole-file read/write | Low volume, low concurrency | Low (sensitive) | Acceptable I/O; security sensitivity higher than performance concern |
| App path/user-type settings | `interface/app-settings.json` | JSON | `interface/app-settings.mjs` | Whole-file read/write (atomic temp+rename) | Low volume | Medium | Acceptable; safe atomic writes already used |
| Guardrail policy state | `interface/guardrails.json` and projection to `.claude/settings.local.json` | JSON | `interface/guardrails.mjs` | Read/transform/write | Low-medium writes | Medium | Acceptable; policy merge logic dominates |
| Plugin state and MCP projection | `interface/plugins.json` and `.mcp.json` | JSON | `interface/plugins.mjs` + MCP config | Read/transform/write | Low-medium writes | Medium | Acceptable; no query pressure |
| Board projects | Machine-local runtime DB (`projects` table) | SQLite | Board service local-core authority | Indexed query + transactional writes | Growing with project count; local-core optimized | Medium (via derived views) | Indexed list/filter with transactional updates |
| Board tasks | Machine-local runtime DB (`tasks` and execution tables) | SQLite | Board service local-core authority | Indexed query + transactional writes | High churn with task operations and execution updates | Medium (via derived views) | Removes O(N) file scans for operational queries |
| Board activity stream | `<board-root>/activity/YYYY-MM-DD.jsonl` | JSONL | Board storage in `interface/board/storage.mjs` | Append-only writes + filtered reverse scans | Potentially large daily logs | Medium | Good write path; reads become expensive with many files/lines |
| Board audit stream | `<board-root>/audit/YYYY-MM-DD.jsonl` | JSONL | Board storage in `interface/board/storage.mjs` | Append-only writes + filtered reverse scans | Potentially large | Medium | Same as activity JSONL |
| Scheduler jobs and runs | Machine-local runtime DB (`jobs`, `runs`) | SQLite | Scheduler (`interface/scheduler.mjs`) | Indexed query + transactional writes | Medium-high churn | Medium | Stable lifecycle persistence, avoids full-file rewrites |
| Scheduler logs | `scheduler/logs/<runId>.log` | plain text log | Scheduler (`interface/scheduler.mjs`) | Append/write once, read on demand | Unbounded growth unless pruned | Low-medium | Fine for logs, but requires retention policy enforcement |
| Unified usage telemetry | `runs/usage.jsonl` (+ legacy `runs/chat-usage.jsonl`) | JSONL | Shared by `interface/scheduler.mjs`, `chat/server.mjs`, surfaced by `interface/server.mjs` | Append-only writes + scan/report reads | High write frequency over time | Medium | Write-efficient; aggregate queries costly without secondary index/store |
| Chat session index | Machine-local runtime DB (`chat_sessions` + search/index tables) | SQLite | Chat runtime (`chat/server.mjs`) | Indexed query + transactional updates | Medium-high churn in active usage | Medium | Search/list performance scales without whole-file rewrites |
| Chat transcripts | `chat/history/<conversationId>.jsonl` | JSONL | Chat runtime (`chat/server.mjs`) | Append-only writes + per-conversation reads/search | Potentially large per power user | High | Good append path; full-text search currently file-scan based |
| Artifact/file domain (documents, exports, binaries) | Workspace file roots exposed through browser runtime (for example `knowledge/**`, `docs/**`, `runs/**`, and user-selected output paths under allowed roots) | File payload + sidecar metadata (expected) | File-domain authority remains per source system/root | Mixed read/write, often large binary or generated files | Variable size; may include large blobs | Medium (metadata high, binaries low) | Requires opaque-id indirection, metadata cataloging, and policy checks rather than raw path trust |
| Profile identity and root boundaries | `interface/app-settings.json` + validated roots used by `interface/app-settings.mjs` and `interface/board/storage.mjs` | JSON + runtime checks | Runtime profile model | Read on boot/switch; guarded writes | Low volume, high correctness sensitivity | Medium | Critical for preventing cross-profile/cross-root leakage |

### 3.1 External authority boundaries

| Domain | External authority | Local role |
|---|---|---|
| Shared knowledge documents | OneDrive/Graph via `interface/storage/graph-storage.mjs` | Cache/edit surface honoring external file authority |
| CRM entities (accounts/contacts/opportunities/activities) | Twenty CRM (when enabled through `.mcp.json`) | Cache/reference projection for UX and joins; not long-term authority |
| Browser runtime operational state (board/scheduler/chat index) | None external by default | Local canonical runtime authority (target SQLite) |

---

## 4) Format assessment (Markdown vs JSON vs JSONL vs SQLite vs CSV)

### Markdown

Strengths:

- Canonical for human-first knowledge and policy artifacts (traceable review, Git-friendly, agent-readable).
- Aligns with established Stage 1/2 folder contract in `CLAUDE.md` and `docs/status-and-roadmap.md`.

Limitations:

- Not suitable as high-frequency operational state store (scheduler/board/chat indexes).
- Not query-efficient for relational filtering, pagination, aggregate analytics.

### JSON

Strengths:

- Excellent for low-churn structured config and sidecars (`interface/app-settings.json`, `interface/provider-settings.json`, `.mcp.json`).
- Native fit for API payload parity.

Limitations:

- Whole-file rewrite and no indexes for growing operational datasets.
- High contention risk when many updates target the same file (`scheduler/runs.json`, `chat/sessions.json`).

### JSONL

Strengths:

- Correct append-only format for immutable event streams (`runs/usage.jsonl`, board `activity/audit`, chat transcripts).
- Easy export/debug and resilient partial-write behavior.

Limitations:

- Expensive random access and multi-dimensional querying without projection/index.
- Requires compaction/retention discipline.

### SQLite

Strengths:

- Transactional integrity, indexed queries, pagination, sorting, and robust concurrency for local operational workloads.
- Fits Stage 4 roadmap direction in `docs/status-and-roadmap.md` (JSON→SQLite scheduler shift).
- Can coexist with generated readable exports (JSONL/Markdown views).

Limitations:

- Needs migration tooling, schema governance, and corruption/backup discipline.
- Less directly human-editable than Markdown/JSON.

### CSV

Strengths:

- Strong interoperability for spreadsheet ecosystems and external reporting/import.

Limitations:

- Weak typing, no nested structures, no transaction semantics, poor authority model.
- Not suitable as canonical runtime state for board/scheduler/chat.

---

## 5) Current bottlenecks and risks

### 5.1 Performance bottlenecks

1. **Legacy note**: historical file-per-entity JSON bottlenecks are resolved in current local-core SQLite state.
2. **Legacy note**: historical scheduler whole-file rewrite bottlenecks are resolved in current SQLite scheduler state.
3. **Usage analytics scans**: aggregate reads over `runs/usage.jsonl` and legacy merge path in `interface/server.mjs` are line-scan heavy.
4. **Chat search**: transcript content remains JSONL canonical; indexed lookup/search relies on SQLite metadata/FTS projections.

### 5.2 Consistency and correctness risks

1. **Team board divergence**: conflict-copy detection and fail-closed read-only mode exists (`interface/board/storage.mjs`) but remains reactive, not preventive.
2. **Split operational authority**: runtime state distributed across many JSON/JSONL files increases migration complexity and accidental dual-source risk.
3. **Legacy overlap**: continued support for legacy board paths in `interface/board/storage.mjs` complicates authoritative-path guarantees.

### 5.3 Security and secret-handling risks

1. **Sensitive JSON settings**: `interface/provider-settings.json` and `.mcp.json` require strict permission controls and no accidental export.
2. **Shared log surfaces**: usage logs and run logs can include metadata that must remain machine-local and gitignored.
3. **Profile/tenant boundaries**: if single-user and team roots are co-initialized without strict isolation, accidental cross-profile access becomes plausible.
4. **Artifact path trust risk**: relying on raw file paths without opaque IDs and per-access authorization checks increases accidental disclosure/deletion risk.

### 5.4 Profile isolation and team concurrency risks

1. Current root overlap checks in `interface/app-settings.mjs` and `interface/board/storage.mjs` are necessary but not sufficient for high-frequency team edits.
2. Shared-drive semantics (especially OneDrive conflict copies) are not equivalent to transactional team coordination.

### 5.5 Required objectives (not benchmark claims)

The following are **required objectives** for next implementation; no benchmark is claimed as already run:

- Board list query P95 target at working scale (objective; benchmark pending).
- Scheduler run/job query P95 target under sustained run volume (objective; benchmark pending).
- Chat session search and transcript retrieval P95 target (objective; benchmark pending).
- Controlled migration time budget per 10k events/rows (objective; benchmark pending).

---

## 6) Project/CRM approach audit

### Option A: Simple local approach (current)

- Current board model (`interface/board/storage.mjs`) is fit for Stage 1/2 low-concurrency coordination and aligns with MVP constraints in `docs/features/projectmangement-multica/simple-multica-lite-project-agent-board.md`.
- Limitation: query and concurrency costs grow non-linearly with active project/task volume.

### Option B: CSV-centric approach

- Useful only for import/export snapshots and spreadsheet workflows.
- Fails canonical runtime requirements: no transactions, no nested execution shape, no reliable idempotency/version handling.

### Option C: CRM-authoritative approach (Twenty)

- `.mcp.json` and `skills/personal/twenty-crm-integration/SKILL.md` establish a real integration path for CRM records.
- When enabled, Twenty should be authoritative for CRM domains (accounts/contacts/opportunities/activities), with local cache/reference projections only.
- CRM does not replace local operational task execution state required by `interface/board/service.mjs` and `interface/scheduler.mjs`.

Audit position:

- Keep local high-performance operational store for browser runtime internals.
- Use CRM authority for CRM entities only when integration is enabled.

---

## 7) Key architectural constraints and non-goals

Constraints:

1. Preserve Stage 1/2 file-first knowledge contract (`knowledge/company`, `knowledge/personal`, `knowledge/inbox`) from `CLAUDE.md` and `docs/status-and-roadmap.md`.
2. Keep compatibility with existing API behavior in `interface/server.mjs`, `interface/board/service.mjs`, and `chat/server.mjs` during migration.
3. Respect roadmap direction: Stage 4 operational move toward SQLite-backed harness (`docs/status-and-roadmap.md`, `docs/reference/ai-os-comparison-and-staged-concept.md`).
4. SQLite files MUST be machine-local and MUST NOT be placed in OneDrive, iCloud, Dropbox, network shares, or any synchronized root.
5. Personal memory (`memory/MEMORY.md`, `memory/daily/*.md`) and raw chat logs remain local by default unless explicitly promoted by approved flow.
6. Local CRM records are cache/reference projections only when Twenty integration is enabled; Twenty remains source authority for CRM domains.

Non-goals:

1. Replacing Markdown as canonical knowledge format.
2. Making CSV authoritative runtime storage.
3. Forcing CRM dependency for local single-user mode.
4. Introducing dual-write canonical authority across old and new stores.

---

## 8) Audit conclusion and decision summary

For current authority mapping, storage classes, and marker rules, use:

- `docs/architecture/agent-versioning-and-permission-boundaries.md`

### 8.1 Canonical authority split (private/local vs team)

1. **Private/local board authority**
   - Committed to migrate from file-per-entity JSON to SQLite in browser runtime.
2. **Team board authority**
   - Deferred pending separately approved central team service decision.
   - Shared-drive file synchronization is not accepted as long-term canonical authority for concurrent team writes.

### 8.2 Canonical format decisions

1. **Must stay Markdown canonical**
   - Human-authored knowledge and governance artifacts under `knowledge/**/*.md`.
   - Personal memory files: `memory/MEMORY.md`, `memory/daily/*.md`.
   - Significant run logs in `runs/*.md`.
   - Contract-driven documents and durable guidance in `docs/**/*.md`.
2. **Should stay JSON**
   - Low-churn configuration and sidecars:
      - `interface/app-settings.json`
      - `interface/provider-settings.json`
      - `interface/meta.json`
      - `interface/workflows.json`
      - `interface/guardrails.json`
      - `interface/plugins.json`
      - `.mcp.json`
3. **JSONL is appropriate for**
   - Append-only event/export domains:
      - `runs/usage.jsonl`
      - `runs/chat-usage.jsonl` (legacy compatibility)
      - `chat/history/*.jsonl`
      - board/scheduler readable activity/audit exports where retained
4. **SQLite is required for**
   - Operational, query-heavy, consistency-sensitive runtime domains:
      - private/local projects/tasks operational state
      - scheduler jobs/runs operational state
      - chat session index/search metadata
      - usage/event query projections for UI analytics
      - board/scheduler lifecycle events that must commit transactionally with state mutations
5. **CSV is not canonical runtime state**
   - CSV remains import/export/report format only because it lacks transactionality, nested structure fidelity, and authoritative write safety for runtime operations.

### 8.3 SQLite adoption buckets

**Committed (approved now):**

- Scheduler jobs/runs canonicalization to SQLite.
- Private/local board projects/tasks canonicalization to SQLite.
- Chat session/search metadata canonicalization to SQLite.
- Usage query projection tables in SQLite while preserving append JSONL usage logs.

**Recommended (implementation guidance):**

- Board/scheduler lifecycle event rows in SQLite transactionally coupled to state changes.
- Readable JSONL/Markdown exports generated as derived outputs where needed.
- Artifact metadata registry in SQLite (opaque IDs, type/size/hash/policy metadata) while binary payloads remain file-based.

**Deferred (explicitly not baseline):**

- Team-board canonical authority until central team service is approved.
- Workflow engine/provider adoption (for example Trigger.dev) until gated evaluation completes.
- PostgreSQL/multi-tenant authority migration before local SQLite rollout is complete and verified.

### 8.4 Final decision statement (explicit)

The browser runtime (`interface/` + `chat/`) SHALL preserve Markdown/JSON/JSONL where those formats are naturally authoritative and human-auditable, and SHALL introduce machine-local SQLite as canonical authority for high-frequency operational state.

SQLite placement in synced or network roots is prohibited. Personal memory and raw chat logs remain local by default. When Twenty CRM is enabled, CRM entities remain externally authoritative in Twenty and local CRM records are cache/reference only. Team-board canonical authority is deferred to a separately approved team service and MUST NOT silently fall back to local canonical writes for team-intended actions.

Permission/enforcement boundary: there is no unified agent gateway in this runtime. Enforcement is provided by runtime-specific layers only (Claude runtime rules, interface API checks, scheduler restrictions, MCP-local controls).
