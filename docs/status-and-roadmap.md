# Status and Roadmap

## Purpose

This is the living source of truth for implementation status and roadmap in this
repository.

Mandatory rule: any implementation-relevant repo change must update this file in
the same change set.

## Last Verified Snapshot

- Date: 2026-07-20
- Validation: `node scripts/validate.mjs` (passed, 243 checks)
- Scope verified: docs, interface, scheduler, knowledge contract, scripts,
  personal-assistant layer (memory, chat history, learning loop, skill
  versioning, promotion pipeline)

## Verified Implementation Status

### Stage status

- Stage 1 (personal local AI-OS): implemented and operational
- Stage 2 (small team local AI-OS): implemented baseline contracts and runbooks
- Stage 3 (personal assistant layer): **foundations implemented Claude-native
  (2026-07-09)** — memory, chat history, learning loop, skill versioning,
  raw→clean promotion; the OpenClaw adoption decision stays open (see
  `docs/reference/openclaw-module-integration.md`)
- Stage 4 (VM execution runtime): planned, not implemented as runtime default
- Stage 5 (full company AI-OS): planned

### Runtime and operations

- Interface server is implemented: `interface/server.mjs`
- Scheduler is implemented and executable now: `interface/scheduler.mjs`
- Scheduler operational persistence is machine-local SQLite (canonical)
- Private board operational persistence is machine-local SQLite (canonical)
- Chat session metadata/search index persistence is machine-local SQLite (canonical)
- Chat transcripts remain canonical JSONL in `chat/history/*.jsonl`
- Usage telemetry stream remains canonical JSONL in `runs/usage.jsonl` (with legacy compatibility read path for `runs/chat-usage.jsonl`)
- Scheduler run logs are machine-local files in `scheduler/logs/`
- Headless execution path is implemented via `claude -p`
- Local Microsoft 365 MCP read-only integration baseline is implemented:
  - local MCP server: `mcp/m365/server.mjs`
  - plugin materialization: built-in `m365-readonly` in `interface/plugins.mjs`
  - setup guide + Azure CLI app-registration helper:
    `docs/guide-m365-mcp-readonly-setup.md`, `scripts/m365-app-registration.sh`
  - explicit boundary: separate from app-only Graph backend in
    `interface/storage/graph-storage.mjs`

### Knowledge and governance

- Knowledge folder contract is implemented:
  - `knowledge/company/`
  - `knowledge/personal/`
  - `knowledge/inbox/`
- Canonical-source policy is documented in `docs/policy-knowledge-sync.md`
- Onboarding and team operations runbooks are implemented in docs
- Validation checks enforce key Stage 1/2 contracts via `scripts/validate.mjs`
- OneDrive knowledge audit and migration planning (Phases 1-3) are implemented:
  - lead status doc: `docs/ai-os-migration-status.md`
  - support archive: `docs/archive/ai-os-migration-2026-07-07/`
- OneDrive migration execution completed (copy-first, with backups):
  - report: `docs/archive/ai-os-migration-2026-07-07/onedrive-migration-report-2026-07-07.json`
  - canonical root: `SteadyMade.ai - General/AI_OS/`
  - top-level: `knowledge/`, `technical_config/`, `tools/`, `apps/`, `archive/`, `_artifacts/`
  - backup mirrors: `AI_OS/archive/legacy-onedrive-backup-2026-07-07/`, `AI_OS/archive/repo-local-knowledge-backup-2026-07-07/`
  - repo-local links: `knowledge/company` and `knowledge/inbox` now symlink to OneDrive `AI_OS/knowledge/...`

### Personal assistant layer (implemented 2026-07-09)

Execution record: `docs/plan-personal-assistant-implementation.md` (phases,
verification evidence, commits); analysis:
`docs/reference/personal-assistant-gap-analysis.md`.

- **Memory**: two-layer machine-local memory (`memory/MEMORY.md` curated +
  `memory/daily/` working notes, gitignored except README); guardrail-scoped
  write access; session-start injection via `.claude/hooks/`
  `session-start-memory.mjs` (also re-injects after compaction); chat runtime
  blocks direct MEMORY.md edits (memory-poisoning defense) — durable facts
  flow through `#durable` daily-note entries.
- **Chat history**: product-owned transcripts (`chat/history/*.jsonl` +
  `chat/sessions.json`, gitignored) with sidebar (restore/resume/rename/
  archive/full-text search) and incognito mode (no-trace turns).
- **Learning loop**: run logs live; `#feedback` capture in daily notes;
  weekly `memory-consolidation` scheduler job (drafts only headless:
  `memory/MEMORY.proposed.md`, feedback summaries + instruction proposals in
  `runs/`).
- **Skill versioning**: semver frontmatter mandatory for company skills
  (validate-enforced), marketplace installs pinned to commit sha
  (`.install.json`), `GET /api/marketplace/updates`, local-only git
  snapshots for personal skill scopes.
- **Raw→clean pipeline**: conversational content raw+personal by default;
  `## Parked` capture; `promote-knowledge` skill is the only path into
  `knowledge/company/` (Mara clean → `status: draft`,
  `source_type: conversation` → user approval → `approved`).

### Skills and agent model

- Claude-first orchestrator and specialist agents are implemented in
  `CLAUDE.md` and `.claude/agents/`
- Skill hub and profile model are implemented with `skills/`, `.skill-profile`,
  and interface skill APIs
- Versioning and permission-boundary reference: `docs/architecture/agent-versioning-and-permission-boundaries.md`

### Prototype vs live boundaries

- Live now:
  - file-backed markdown editing
  - scheduler execution and run history
  - skill registry/toggle and marketplace install support
  - plugins and guardrails file writes
- Still prototype/pending for runtime integration:
  - direct interactive "ask agent" execution from UI controls that currently use
    copy/brief behavior for some flows

## Canonical Roadmap

Roadmap baseline references:

- `docs/reference/ai-os-comparison-and-staged-concept.md`
- `docs/reference/stage4-runtime-integration-plan.md`

### Phase status

| Phase | Intent | Status | Notes |
| --- | --- | --- | --- |
| 0 | Contracts and schemas | implemented baseline | Folder/state contracts exist in docs/code; Phase 0 contract lane includes ADR + migration contract + migration fixtures/tests (`docs/architecture/adr-2026-07-20-phase0-runtime-storage-decisions.md`, `docs/architecture/migration-contract-phase0-json-to-sqlite.md`, `tests/board/fixtures/phase0-migration/`, `tests/board/migration-fixtures-contract.test.mjs`) |
| 1 | Local scheduler + run history | implemented (SQLite core) | Working scheduler exists; operational persistence is SQLite, logs remain file-based |
| 2 | Skills operations and profile handling | implemented baseline | Skill hub, profile activation, and docs present |
| 3 | Personal assistant layer (OpenClaw-compatible) | foundations implemented | Memory/chat-history/learning/promotion implemented Claude-native 2026-07-09; memory files use OpenClaw semantics, adoption decision open |
| 4 | VM execution runtime and common harness | planned | Local SQLite core is implemented; VM runtime rollout remains planned |
| 5 | Enterprise connectors/policy | planned | Not implemented |

Connector checkpoint note (2026-07-20): a local, delegated, read-only Microsoft
365 MCP baseline is now implemented for interactive sessions; scheduler/headless
connector execution and full native PKCE token lifecycle remain follow-up scope.

### Desktop packaging track (new spec drafted 2026-07-13)

- A macOS-first desktop packaging specification is now documented:
  `docs/spec-desktop-app-electron-macos-first.md`.
- Scope in this checkpoint is specification only (architecture, dependencies,
  external storage/API/terminal proposals, risk register, release gates).
- No runtime/package implementation is active yet; status remains **planned**.

### OneDrive knowledge migration status

- Phase 1 (docs and decision lock): implemented
- Phase 2 (OneDrive root scaffold and path alignment): implemented
- Phase 3 (dry-run migration inventory): implemented
- Phase 4 (copy-first migration execution): implemented
- Phase 5 (canonical switch and stabilization): implemented baseline

### Stage 4 runtime scope after local-core SQLite rollout

The scheduler/board/chat local operational model already uses machine-local SQLite canonical authority.

Target direction for Stage 4:

- one common scheduler/run harness across local and VM runtime modes
- SQLite state store continuity for jobs/runs
- consistent lifecycle/state transitions across local and VM runtime modes
- compatibility and rollback path for legacy JSON inputs where still present

### Stage 3 assistant layer scope

Stage 3 introduces OpenClaw personal assistant integration before VM execution.

Scope:

- personal assistant workspaces and memory boundaries
- governed retrieval/search access to company knowledge (no blind copying into
  private memory)
- assistant-first task support for day-to-day execution

### Company knowledge as lightweight business objects

With the current company knowledge base, we can support simple CRM and project
management behavior without a full CRM platform by treating markdown records as
lightweight business objects.

Examples:

- opportunities (`lead`, `qualified`, `proposal`, `won`, `lost`)
- tasks (`todo`, `in_progress`, `blocked`, `done`)
- client notes and project notes with ownership and next actions
- simple pipeline and workload views from structured metadata

## Canonical Folder Contract

### Repository-local operating structure

- Root: `apps/internal/steadymade-ai-os/`
- Instructions: `CLAUDE.md`, `CLAUDE.local.md`, `.claude/agents/`
- Skills: `skills/company/`, `skills/personal/`, `.claude/skills/`
- Knowledge:
  - `knowledge/company/` (shared)
  - `knowledge/personal/` (private, never committed)
  - `knowledge/inbox/` (transit only)
- Runtime state today:
  - machine-local SQLite runtime DB files (board/scheduler/chat-index/event domains)
  - `chat/history/*.jsonl`
  - `runs/usage.jsonl`
  - `scheduler/logs/`
  - `runs/`
  - `interface/meta.json`
  - `interface/workflows.json`

### Knowledge canonical-source note

`knowledge/company/` resolves to the OneDrive canonical root
`AI_OS/knowledge/company/`. SSOT is a governance principle for canonical
documents, not a folder name. Fixed baseline docs should be normalized into
`knowledge/company/company_handbook_SSOT/`; duplicated legacy strategy/SSOT copies
still need a manual cleanup pass.

## Recommended Next Implementation Steps

1. Freeze the Stage 3 OpenClaw personal assistant integration scope and
   boundaries.
2. Define governed company-knowledge retrieval patterns for assistant use.
3. Define markdown metadata templates for tasks, opportunities, and project
   records (lightweight CRM/PM behavior).
4. Lock Stage 4 VM runtime interfaces on top of the implemented local SQLite core.
5. Keep compatibility exports bounded and removable.
6. Run scheduler parity/regression tests against current SQLite behavior.
7. Add basic health/usage diagnostics for scheduler runs.
9. Update the Stage 4 readiness checklist after the SQLite harness is stable.
10. Complete manual-review/review-sensitive migration tranche (`manual_review`, `review_sensitive`, `triage_inbox`).
11. Finalize Graph backend root alignment and cross-user onboarding runbook updates.
12. Normalize company handbook and reduce duplicated legacy strategy/SSOT copies.
13. Add native Authorization Code + PKCE (S256) browser/loopback token lifecycle
    for local M365 MCP (in-memory/secure local storage, refresh handling, and
    explicit tenant policy checks).

## Update Rules

Update this file when any of the following changes:

- runtime architecture or scheduler persistence model
- stage or phase implementation status
- knowledge folder contract or SSOT location rules
- approval/governance mechanics impacting implementation
- major interface capabilities moving between prototype and live

Minimum update payload for each change:

1. what changed
2. status impact (implemented/partial/planned)
3. affected files/folders
4. next checkpoint
