# Stage 4 Runtime Integration Reference

## Purpose

This reference plan consolidates prior Cockpit-style runtime planning and
OpenClaw integration guidance into one Stage 4 runtime direction.

This is a reference architecture document. Canonical implementation status stays
in `docs/status-and-roadmap.md`.

## Current Baseline (Implemented)

- Stage 1/2 run in the local Steadymade runtime.
- Scheduler is active today via `interface/scheduler.mjs`.
- Scheduler state currently persists in JSON files under `scheduler/`.
- Execution path uses `claude -p` in the project root.

## Stage 4 Design Objective

Introduce a VM-capable runtime with stronger reliability and shared operational
behavior while keeping Steadymade governance, approvals, and knowledge contracts
unchanged.

## Runtime Strategy

### Core direction

Move from JSON scheduler persistence to one common SQLite-backed harness.

### Why

- deterministic job/run lifecycle state
- restart-safe persistence
- consistent local and VM behavior
- better diagnostics and operational support
- clearer migration path toward enterprise controls

### Minimum harness scope

1. `jobs` and `runs` schema with explicit status transitions
2. idempotent scheduler tick behavior
3. overlap prevention, timeout, and kill controls
4. durable run logs and history retention
5. migration utility from `scheduler/*.json`

## OpenClaw Best-Practice Inputs

OpenClaw contributes patterns, not authoritative runtime truth for this repo.

Reference signals:

- gateway-oriented runtime operations
- workspace conventions for personal assistant operation
- cron operational semantics
- multi-agent routing/isolation concepts
- memory indexing/search lifecycle
- explicit security and sandbox posture

Important guardrails when applying OpenClaw patterns:

- do not treat workspace paths as security boundaries by themselves
- do not assume sandboxing defaults are active
- do not collapse Steadymade company/personal knowledge boundaries

## Cockpit Best-Practice Inputs

Cockpit contributes proven control-plane ideas:

- scheduler + run history UX
- usage/health operational surfaces
- robust local-first operation before VM rollout
- clear phase gates and exit criteria

## What Must Stay Steadymade-Native

1. `CLAUDE.md` orchestration model and specialist routing
2. strategy gate and approval logic
3. knowledge governance and canonical-source policy
4. folder contracts for company/personal/inbox knowledge

## Stage alignment note

Stage 3 is now the OpenClaw personal assistant integration stage.
This document defines the subsequent Stage 4 runtime execution layer.

## Phased Delivery

### Phase 0: schema and migration contracts

- define SQLite schema (`jobs`, `runs`, optional `run_events`)
- define JSON -> SQLite migration mapping
- define compatibility behavior for existing scheduler endpoints

Exit: schema approved and migration dry-run successful.

### Phase 1: local SQLite harness

- replace JSON persistence in scheduler with SQLite
- keep existing behavior and controls parity
- ensure restart-safe lifecycle transitions

Exit: local reliability parity or better than current JSON model.

### Phase 2: operations hardening

- add usage/health diagnostics surfaces
- improve failure triage and incident runbook coverage

Exit: operator can diagnose common failures from UI + logs quickly.

### Phase 3: VM runtime introduction

- per-user runtime isolation model
- secrets and identity baseline
- incident simulation and recovery validation

Exit: Stage 4 gate criteria in `docs/status-and-roadmap.md` are met.

## Acceptance Criteria

1. Scheduler persistence is SQLite-backed with migration support.
2. Existing scheduler workflows keep functional parity.
3. Stage 1/2 docs and onboarding remain valid after runtime change.
4. No violations of knowledge separation:
   - `knowledge/company/`
   - `knowledge/personal/`
   - `knowledge/inbox/`
5. Canonical status updates are captured in `docs/status-and-roadmap.md`.

## Source Trail

- Supersedes and harmonizes:
  - `docs/archive/cockpit-integration-project-plan.md`
  - `docs/archive/openclaw-runtime-integration-spec.md`
- Context reference:
  - `docs/reference/ai-os-comparison-and-staged-concept.md`
