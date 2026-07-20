# Migration contract (Phase 0): JSON/JSONL authority to SQLite operational stores

Status: normative migration contract (executed for local core; retained for rollback/extension)  
Date: 2026-07-20  
Scope: scheduler, private board, chat session index/transcripts, usage

## 1) Source-of-truth contract

Legacy note: local-core cutover to SQLite canonical authority is complete for scheduler, private board operational state, and chat session metadata/index. This contract remains authoritative for evidence, rollback, and any extension migrations.

Domains covered by this migration contract:

- scheduler legacy state inputs (`scheduler/jobs.json`, `scheduler/runs.json`)
- private board entities (`project-board/private/**` JSON + JSONL activity/audit)
- chat session legacy index (`chat/sessions.json`) and transcript files (`chat/history/*.jsonl`)
- usage records (`runs/usage.jsonl`, legacy `runs/chat-usage.jsonl`)

Rules:

1. Each domain has exactly one canonical source at a time.
2. Canonical authority shifts only at explicit cutover.
3. Long-term dual-canonical writes are prohibited.

## 2) Authority marker and migration ledger

### 2.1 Authority marker (required)

Every domain cutover MUST write an authority marker with:

- `domain` (scheduler | private-board | chat-index | usage-projection)
- `authority` (`legacy-json` | `sqlite`)
- `schema_version`
- `cutover_at` (ISO timestamp)
- `migration_id` (immutable run identifier)
- `operator` (runtime/user identity)

The runtime MUST refuse ambiguous authority states.

### 2.2 Migration ledger (required)

Every migration run MUST append a ledger entry:

- `migration_id`
- `domain`
- `started_at`, `finished_at`
- input file set and row/file counts
- output row counts
- validation result summary
- rollback snapshot id/path
- final status (`completed` | `aborted` | `rolled_back`)

Ledger entries are append-only and auditable.

## 3) Semantic reconciliation rules

When legacy input has semantic variance (field aliases, nullability differences, optional fields), migration logic MUST:

1. Apply deterministic normalization rules.
2. Preserve unknown fields either in explicit extension columns/JSON payload or a documented drop list.
3. Record every lossy transformation in migration evidence.
4. Keep replay determinism (same input => same normalized output).

## 4) Malformed-input handling

Malformed legacy input is a hard stop.

Rules:

1. If malformed JSON/JSONL or schema-invalid critical records are detected, migration MUST abort for that domain.
2. Authority marker MUST stay on prior authority (`legacy-json`) for aborted runs.
3. Partial writes must be rolled back to pre-migration snapshot.
4. Ledger entry MUST record exact failing file/line and abort reason.

## 5) Compatibility export rules (derived-only)

Compatibility exports are allowed only as one-way derived projections from the canonical authority.

Rules:

1. Exports MUST be explicitly labeled derived/non-authoritative.
2. Derived exports MUST NOT accept direct mutation as canonical writes.
3. If export generation fails, canonical writes remain committed; export failure is a separate recoverable condition.
4. Backward compatibility windows must be bounded and removable.

## 6) Cutover evidence requirements (must-pass)

Cutover is valid only with domain-specific evidence:

### 6.1 Scheduler

- row parity for jobs/runs (within documented normalization deltas)
- lifecycle status distribution parity
- representative run-log linkage integrity

### 6.2 Private board

- project/task entity count parity
- optimistic-version and execution-attempt key field preservation
- activity/audit replay count parity

### 6.3 Chat

- sessions index parity (`id`, title/agent metadata, timestamps, turns)
- transcript line-count parity per sampled conversations
- malformed transcript handling evidence (abort or skip policy as specified)

### 6.4 Usage

- parsed entry count parity for canonical usage stream
- legacy `runs/chat-usage.jsonl` merge semantics evidence where still present
- aggregate metric parity for a fixed validation window

## 7) Rollback contract

If any must-pass evidence check fails:

1. Roll back domain to pre-cutover snapshot.
2. Reset authority marker to prior authority.
3. Emit ledger status `rolled_back` with failure evidence reference.

No mixed-authority operation is permitted after rollback.

## 8) Out of scope in this lane

- net-new runtime implementation design (this lane now documents executed contract and replay/rollback criteria)
- centralized team service rollout
- live dual-runtime orchestrated migration

This document defines the contract and test fixtures only.
