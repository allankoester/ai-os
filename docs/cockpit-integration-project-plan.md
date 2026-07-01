# Cockpit Best Practices Integration Plan (Claude-first, staged)

## Objective

Integrate the strongest Cockpit AI-OS runtime practices into Steadymade AI-OS while preserving the staged rollout model:

- local-first execution now
- VM execution later
- Claude-first provider priority
- provider-neutral adapter foundation for future multi-provider support

## Target architecture

Combine two layers:

1. Operating model layer (already strong in Steadymade AI-OS)
   - workflows
   - role routing
   - strategy and approval gates
   - knowledge governance

2. Runtime control-plane layer (to be integrated from Cockpit patterns)
   - scheduler
   - job execution and run history
   - skill activation/profile management
   - usage and health monitoring
   - local mode first, VM mode later

## Delivery principles

1. Claude-first delivery speed
2. Keep all user-facing behavior deterministic and auditable
3. Keep company/private boundaries explicit
4. Add provider abstraction only where it does not block immediate value
5. Do not require VM to unlock Stage 1 and Stage 2 value

## Roadmap

## Phase 0 - Foundation and contracts (1-2 weeks)

### Deliverables

- Define runtime folder contracts:
  - `runtime/jobs/`
  - `runtime/runs/`
  - `runtime/logs/`
  - `runtime/state/`
- Define canonical job schema and run schema
- Define skill manifest schema (provider-neutral)
- Define permission classes (safe, review_required, restricted)

### Exit criteria

- Schemas documented and validated by example files
- Naming conventions and lifecycle states documented
- Approval rules mapped to workflow types

## Phase 1 - Local scheduler and run history (Stage 1 baseline)

### Deliverables

- Add local scheduler service with persisted jobs/runs (SQLite or equivalent)
- Add local execution worker for Claude headless tasks
- Add timeout, overlap prevention, and kill controls
- Add run result persistence and basic log viewer

### UX requirement

- Jobs run even when browser tab is closed, as long as local service is running

### Exit criteria

- Repeatable scheduled run success in local mode
- Run status transitions are accurate (queued/running/success/failed/timeout)
- No data loss after service restart

## Phase 2 - Skills operations and slash command experience (Stage 1 -> 2)

### Deliverables

- Skill registry view (all/core/active/disabled)
- Skill profile activation/deactivation model
- Skill metadata parser from `SKILL.md` and/or `skill.manifest.yaml`
- Slash command guidance for Claude Code and OpenCode

### Claude Code usage model

- Keep `.claude/agents` for specialist roles
- Keep `.claude/skills` for executable/reusable skills
- Use slash commands mapped to skill entry points where supported
- For unsupported direct slash mapping, use canonical command docs and quick-paste templates

### OpenCode usage model

- Maintain OpenCode adapter docs in `.opencode/`
- Map canonical skill intents to OpenCode tool flows
- Use a command catalog file to normalize invocation patterns

### Exit criteria

- Team can enable/disable shared and private skills without manual filesystem edits
- Slash-command invocation guide works end-to-end for Claude and OpenCode
- Skill profile drift detection is in place

## Phase 3 - Usage, health, and operations hardening (Stage 2)

### Deliverables

- Token/cost usage panel
- Session and project usage aggregation
- Health endpoint and diagnostics checks
- Local auto-start guidance (launchd/systemd depending on platform)

### Exit criteria

- Operator can diagnose common failures from UI and logs
- Usage visibility supports weekly cost review
- Service recovers safely from restart/crash

## Phase 4 - VM mode introduction (Stage 3)

### Deliverables

- Per-user VM service model
- Per-user workspace and data isolation
- Per-user runtime port strategy and secure tunnel instructions
- Relogin/noVNC operational flow
- Secrets and identity handling baseline

### Exit criteria

- VM run reliability target reached
- Isolation controls tested (no cross-user workspace access)
- Incident runbook validated in simulation

## Phase 5 - Enterprise integration layer (Stage 4)

### Deliverables

- Connector framework for CRM/ERP/Dev/M365
- Integration policy and approval gates
- Audit trail and evidence retention
- Data classification enforcement

### Exit criteria

- High-risk actions are policy-gated and auditable
- Connector failures are observable and recoverable
- Compliance and governance controls are operational

## Skill command concept (Claude and OpenCode)

## Canonical skill model

Every skill should have a provider-neutral descriptor:

```yaml
id: newsletter-draft
name: Newsletter Draft
intent: Create newsletter draft from source bundle
inputs:
  - source_paths
  - audience
  - tone
outputs:
  - markdown_draft
  - review_checklist
permissions:
  class: review_required
providers:
  claude:
    slash: /newsletter-draft
    adapter: .claude/skills/newsletter-draft/SKILL.md
  opencode:
    slash: /newsletter-draft
    adapter: .opencode/skills/newsletter-draft.md
```

## Adapter strategy

1. Canonical skill manifest is source of truth.
2. Provider adapters are generated or maintained from canonical metadata.
3. Provider-specific execution details stay in adapter files.
4. Capability tags map to provider tool permissions.

This allows Claude-first implementation now while preserving multi-provider portability.

## Do we have to stick with one provider?

Short answer: no, but prioritize one provider first.

- Near term: stay Claude-first for speed and reliability.
- Mid term: add provider-neutral manifests and adapter generation.
- Long term: run multi-provider where business value justifies complexity.

## Risks and mitigations

1. Risk: provider lock-in
   - Mitigation: canonical manifests introduced by Phase 2

2. Risk: runtime complexity too early
   - Mitigation: local scheduler first, VM deferred to Phase 4

3. Risk: knowledge leakage between personal/company scopes
   - Mitigation: strict path boundaries and profile-based access

4. Risk: operational fragility
   - Mitigation: health checks, restart behavior, incident runbooks

## Suggested implementation backlog

1. Define schemas and lifecycle states
2. Build local scheduler + runs persistence
3. Add logs viewer and run controls
4. Add skill registry and profile manager
5. Add slash-command catalog and adapter docs (Claude/OpenCode)
6. Add usage/health telemetry
7. Introduce VM mode and per-user services
8. Add enterprise connectors and policy gates

## Acceptance criteria summary

- Stage 1 accepted when local scheduler, run history, and skill usage are reliable for one user
- Stage 2 accepted when 2-3 users operate consistently with shared software and controlled shared knowledge
- Stage 3 accepted when VM execution is stable, isolated, and supportable
- Stage 4 accepted when enterprise integrations are policy-controlled, auditable, and operationally predictable
