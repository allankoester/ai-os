# Implementation Specification: OpenClaw as Personal Assistant Runtime inside SMAPAS AI-OS

Archived and superseded by `docs/reference/stage4-runtime-integration-plan.md`.

## 1. Document Status

This is a harmonized project specification for the Steadymade AI OS repository.

- It replaces a raw imported draft with a repo-aligned version.
- It separates verified current implementation from proposed future integration.
- It uses OpenClaw official repository/docs as external reference evidence.

Canonical project naming in this repo is Steadymade AI OS.

## 2. Objective

Evaluate and specify how OpenClaw can be integrated as a personal assistant
runtime pattern in later-stage Steadymade AI OS, while preserving current
Claude-first operation and existing Stage 1/2 delivery.

Current baseline in this repo:

- Claude-first orchestrator model (`CLAUDE.md` + `.claude/agents/`)
- local interface and scheduler runtime (`interface/`, `scheduler/`)
- staged governance and knowledge contracts (`knowledge/`, `docs/`)

## 3. Current vs Target

### 3.1 Current implemented runtime (verified)

- Local scheduler executes headless `claude -p` jobs.
- Scheduler state currently persists in JSON (`scheduler/jobs.json`,
  `scheduler/runs.json`) with log files in `scheduler/logs/`.
- Stage 1 and Stage 2 contracts are implemented and validated.

### 3.2 Target direction (Stage 3+)

Adopt selected OpenClaw best practices where they improve runtime reliability,
assistant ergonomics, and operations.

Important note from current project direction: for Stage 3, scheduler
persistence should move to one common SQLite-backed harness rather than remain
JSON-based local state.

## 4. OpenClaw Evidence Summary

Primary sources:

- https://github.com/openclaw/openclaw
- https://docs.openclaw.ai/

### 4.1 What OpenClaw is

- Personal AI assistant runtime with a Gateway control plane.
- Local-first operation with multi-channel capabilities.
- Recommended setup uses onboarding and daemonized gateway operation.

### 4.2 Runtime requirements

- Node 24 recommended.
- Node 22.19+ / 23.11+ also supported in current install docs.

### 4.3 Workspace model (verified)

- Default workspace: `~/.openclaw/workspace` (configurable).
- Documented workspace artifacts include:
  - `AGENTS.md`
  - `SOUL.md`
  - `USER.md`
  - `TOOLS.md`
  - `MEMORY.md`
  - `HEARTBEAT.md` (optional)
  - `BOOT.md` (optional)
  - `IDENTITY.md`
  - `BOOTSTRAP.md`
  - `skills/`
  - `memory/YYYY-MM-DD.md`

### 4.4 Memory and search model

- `MEMORY.md` is curated long-term memory loaded at session start.
- daily memory files are indexed/searchable and used in startup/reset workflows.
- memory operations are CLI-supported (`openclaw memory ...`).

### 4.5 Scheduler/cron model

- Built-in gateway cron with persisted state/history and CLI controls
  (`openclaw cron ...`).
- Supports scheduled and manual operations.

### 4.6 Multi-agent and routing model

- Supports multiple agents with isolated workspaces/session stores.
- Channel/binding based routing is supported.

### 4.7 Security model relevance

- OpenClaw is not positioned as a hostile multi-tenant security boundary.
- Sandboxing exists but is off by default and must be explicitly configured.

## 5. Claim Review and Harmonized Decisions

| Imported claim pattern | Validity | Harmonized decision |
| --- | --- | --- |
| OpenClaw workspace file model exists | mostly valid | Keep, but include full documented file set and optionality |
| Workspace implies hard sandbox by itself | invalid | Treat workspace as cwd convention; require explicit sandbox policy |
| `MEMORY.md` and daily files are always prompt-injected per turn | overstated | Treat as startup/curation/index model per docs |
| OpenClaw cron can cover scheduling needs | valid | Keep as reference pattern for Stage 3 scheduler redesign |
| One gateway is enough for hostile multi-tenant isolation | invalid | Keep trusted-operator boundary; isolate untrusted users by stronger boundaries |
| `/ai-os/second-brain/` as canonical repo structure | invalid for this repo | Keep repo-native `knowledge/` contract as canonical |

## 6. Canonical Folder Structure for This Project

Repository root:

- `apps/internal/steadymade-ai-os/`

Instructions and roles:

- `CLAUDE.md`
- `CLAUDE.local.md`
- `.claude/agents/`

Skills:

- `skills/company/`
- `skills/personal/`
- `.claude/skills/`

Knowledge bases:

- `knowledge/company/` (shared)
- `knowledge/personal/` (private, never committed)
- `knowledge/inbox/` (temporary intake only)

SSOT rule for overlapping Steadymade docs:

- `knowledge/company/steadymade Docs/` is SSOT master area.
- domain folders should reference, not duplicate SSOT docs.

Runtime state today:

- `scheduler/jobs.json`
- `scheduler/runs.json`
- `scheduler/logs/`
- `runs/`
- `interface/meta.json`
- `interface/workflows.json`

Future runtime contract (if adopted):

- `runtime/jobs/`
- `runtime/runs/`
- `runtime/logs/`
- `runtime/state/`

## 7. Integration Design for Stage 3+

### 7.1 Principle

Do not replace current operating model and governance with OpenClaw defaults.
Adopt runtime best practices where they improve reliability and maintain
Steadymade governance and knowledge boundaries.

### 7.2 Scheduler architecture change (required direction)

Move from JSON scheduler persistence to a common SQLite-backed harness.

Minimum target capabilities:

1. shared schema for jobs/runs/status transitions
2. deterministic restart recovery
3. run history and log pointer consistency
4. migration path from existing JSON state
5. uniform behavior across local and VM modes

### 7.3 OpenClaw-aligned runtime capabilities to evaluate

1. workspace conventions for personal assistant instances
2. cron semantics and operational controls
3. multi-agent isolation/routing patterns
4. memory indexing/search lifecycle practices
5. gateway security/sandboxing controls

### 7.4 What stays Steadymade-native

1. knowledge governance and folder contract
2. approval logic and strategy gates
3. orchestrator routing model and specialist department logic
4. company profile and onboarding contracts

## 8. Phased Delivery (Harmonized)

### Phase A - Validation and design freeze

- Validate OpenClaw claims against official docs before implementation work.
- Define SQLite harness schema and migration plan from `scheduler/*.json`.
- Define guardrail/security requirements for Stage 3 runtime.

Exit:

- approved architecture note
- approved migration design

### Phase B - Common scheduler harness implementation

- Introduce SQLite-backed job/run store.
- Preserve current scheduler API behavior where possible.
- Add migration utility for existing JSON state.

Exit:

- scheduler parity tests pass
- no state loss in migration tests

### Phase C - OpenClaw runtime pattern pilot

- Pilot one personal assistant runtime lane using documented workspace model.
- Keep integration clearly bounded from canonical `knowledge/` structure.
- Validate security and isolation assumptions.

Exit:

- pilot runbook complete
- risk review complete

### Phase D - Stage 3 VM rollout decisions

- Choose runtime operating mode(s) based on reliability and governance fit.
- Finalize incident, backup, and support runbooks.

Exit:

- Stage 3 gate checklist passes

## 9. Non-Goals

- Replacing Steadymade governance with vendor/runtime defaults.
- Treating OpenClaw workspace as a security boundary by itself.
- Treating one gateway as hostile multi-tenant isolation.
- Replacing canonical `knowledge/` folders with external ad-hoc structures.

## 10. Open Questions

1. Should OpenClaw be embedded as a secondary runtime lane or become the primary
   assistant runtime in Stage 3?
2. Which parts of OpenClaw cron semantics should be mirrored exactly in the
   SQLite harness?
3. What is the required compatibility layer between current scheduler API and a
   future shared runtime service?
4. Which security baseline (sandbox mode, execution boundaries, secrets model)
   is mandatory before VM rollout?

## 11. Acceptance Criteria for This Specification

This specification is accepted when:

1. all folder and knowledge-base locations are consistent with this repo
2. OpenClaw claims are evidence-grounded and not overstated
3. Stage 3 scheduler direction explicitly includes SQLite common harness
4. migration path from current JSON scheduler state is specified
5. status tracking is maintained in `docs/status-and-roadmap.md`
