# Status and Roadmap

## Purpose

This is the living source of truth for implementation status and roadmap in this
repository.

Mandatory rule: any implementation-relevant repo change must update this file in
the same change set.

## Last Verified Snapshot

- Date: 2026-07-08
- Validation: `node scripts/validate.mjs` (passed)
- Scope verified: docs, interface, scheduler, knowledge contract, scripts

## Verified Implementation Status

### Stage status

- Stage 1 (personal local AI-OS): implemented and operational
- Stage 2 (small team local AI-OS): implemented baseline contracts and runbooks
- Stage 3 (OpenClaw personal assistant integration): planned
- Stage 4 (VM execution runtime): planned, not implemented as runtime default
- Stage 5 (full company AI-OS): planned

### Runtime and operations

- Interface server is implemented: `interface/server.mjs`
- Scheduler is implemented and executable now: `interface/scheduler.mjs`
- Scheduler persistence is machine-local JSON in `scheduler/jobs.json` and
  `scheduler/runs.json`
- Scheduler run logs are machine-local files in `scheduler/logs/`
- Headless execution path is implemented via `claude -p`

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

### Skills and agent model

- Claude-first orchestrator and specialist agents are implemented in
  `CLAUDE.md` and `.claude/agents/`
- Skill hub and profile model are implemented with `skills/`, `.skill-profile`,
  and interface skill APIs

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
| 0 | Contracts and schemas | partial | Folder/state contracts exist in docs and code; canonical runtime schema still to formalize |
| 1 | Local scheduler + run history | implemented (JSON) | Working scheduler exists; persistence currently JSON |
| 2 | Skills operations and profile handling | implemented baseline | Skill hub, profile activation, and docs present |
| 3 | OpenClaw personal assistant integration | planned | Personal assistant layer with governed access to company knowledge |
| 4 | VM execution runtime and common harness | planned | Runtime migration not active yet; target SQLite-backed scheduler harness |
| 5 | Enterprise connectors/policy | planned | Not implemented |

### OneDrive knowledge migration status

- Phase 1 (docs and decision lock): implemented
- Phase 2 (OneDrive root scaffold and path alignment): implemented
- Phase 3 (dry-run migration inventory): implemented
- Phase 4 (copy-first migration execution): implemented
- Phase 5 (canonical switch and stabilization): implemented baseline

### Planned runtime shift for Stage 4

The scheduler persistence model should move from machine-local JSON to a common
SQLite-backed harness for reliability and shared operational behavior.

Target direction for Stage 4:

- one common scheduler/run harness
- SQLite state store for jobs/runs
- consistent lifecycle/state transitions across local and VM runtime modes
- migration path from `scheduler/*.json` to SQLite without losing history

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
  - `scheduler/jobs.json`
  - `scheduler/runs.json`
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
4. Freeze the Stage 4 scheduler schema for a SQLite-backed common harness.
5. Add the SQLite job/run store behind the current scheduler API.
6. Add a one-way migration from `scheduler/jobs.json` and
   `scheduler/runs.json`.
7. Run scheduler parity tests against the current JSON behavior.
8. Add basic health/usage diagnostics for scheduler runs.
9. Update the Stage 4 readiness checklist after the SQLite harness is stable.
10. Complete manual-review/review-sensitive migration tranche (`manual_review`, `review_sensitive`, `triage_inbox`).
11. Finalize Graph backend root alignment and cross-user onboarding runbook updates.
12. Normalize company handbook and reduce duplicated legacy strategy/SSOT copies.

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
