# AI-OS Comparison and Staged Concept

## Scope

This document compares two AI-OS implementations:

- Steadymade AI-OS in `apps/internal/steadymade-ai-os`
- Cockpit AI-OS in `apps/research/.temp/Cockpit AI-OS/cockpit`

It then defines a staged implementation model (Stage 1 to Stage 5), quality gates between stages, and provider strategy options.

## Executive verdict

Both systems are mature, but in different dimensions:

- Steadymade AI-OS is stronger as a governance and knowledge operating model.
- Cockpit AI-OS is stronger as a runtime execution cockpit.

The best direction is a hybrid target:

- Steadymade AI-OS as the operating model (roles, workflows, quality gates, knowledge governance)
- Cockpit-style runtime as the execution control plane (scheduler, runs, usage, health, VM operations)

## Comparison matrix

| Dimension | Steadymade AI-OS | Cockpit AI-OS |
| --- | --- | --- |
| Primary goal | Claude-based operating layer for strategy, marketing, offers, documents, knowledge | Operational cockpit for running and monitoring Claude jobs |
| Orchestration model | Intent classification and specialist routing via Danny | Scheduled and manual job execution via server + scheduler |
| Agent roles | Strong role model (`.claude/agents`) and workflow taxonomy | Less role-centric, more operational control-centric |
| Knowledge model | Markdown knowledge taxonomy + second-brain sync policy | Workspace file access and run outputs, less explicit second-brain governance |
| Storage backend strategy | FS + Microsoft Graph backend abstraction | SQLite for jobs/runs + workspace filesystem |
| Runtime execution | Partial/prototype in interface docs for live execution | Live headless execution (`claude -p`) with timeout/process handling |
| Skill management | Role and instruction centric; skill references exist | Explicit skills discovery/toggling and profile handling |
| Observability | Process and workflow design oriented | Usage, sessions, status health, run history in UI/API |
| VM operations | Planned via Graph/prod mode and operating docs | Concrete VM mode with per-user service patterns and relogin/noVNC |
| Governance gates | Strategy gate and approval states are explicit | Operational safety controls exist, fewer strategic editorial gates |
| Provider orientation | Claude-first but architecture is adapter-aware at workspace level | Claude-centric implementation |

## Common patterns

Both systems already share practical AI-OS patterns:

1. Markdown and filesystem-first knowledge and instruction model
2. Agent decomposition (orchestrator + specialist capabilities)
3. Local-first usability before enterprise-scale operations
4. Explicit runbooks and setup conventions
5. Human review checkpoints before external outputs
6. Separation of personal and company context as an operating concern

## Key differences

1. Governance-first vs runtime-first
   - Steadymade focuses on strategic correctness and quality gates.
   - Cockpit focuses on operational continuity and execution reliability.

2. Workflow routing vs job scheduling
   - Steadymade routes by workflow type and department logic.
   - Cockpit triggers by cron/manual jobs and tracks run outcomes.

3. Knowledge architecture depth
   - Steadymade defines second-brain policy and cleaner source-of-truth rules.
   - Cockpit offers practical workspace browsing and execution logs, but less enterprise knowledge governance.

4. Production readiness shape
   - Steadymade is architecturally rich but runtime integration is partly pending.
   - Cockpit has stronger concrete runtime mechanics today.

## Staged AI-OS target model

## Stage 1 - Personal local AI-OS

### Scope

- One user on one local machine
- Execution only while local machine is running
- Personal knowledge and company knowledge stored separately
- Markdown as second-brain baseline

### Required capabilities

- Claude-first orchestrator and role agents
- Local folder contracts:
  - `knowledge/company/`
  - `knowledge/personal/`
  - `knowledge/inbox/`
- Basic task templates and approval checklist
- Local run logs for repeatability and learning

### Benefits

- Fastest setup and learning cycle
- No infrastructure overhead
- High privacy and local control

### Limitations

- No always-on automation
- Laptop availability and uptime dependency
- Single-user quality and consistency bottlenecks

### Quality gate to Stage 2

- Reproducible onboarding documented
- Backup and restore tested
- Knowledge separation rule enforced
- Basic quality rubric for external outputs in place

## Stage 2 - Small team local AI-OS (2-3 users)

### Scope

- Each user runs locally
- Software/instructions distributed through GitHub
- Personal knowledge stays local
- Shared company knowledge and shared skills via OneDrive/shared folder

### Required capabilities

- Shared repo for prompts, agents, workflows, runbooks
- Shared knowledge sync policy and naming conventions
- Skills profile contract per user (core + optional + excluded)
- Simple change management and review process

### Benefits

- Strong velocity with low infrastructure costs
- Team collaboration without central runtime dependency
- Traceable instruction/software changes via GitHub

### Limitations

- Environment drift across user machines
- Non-deterministic scheduling reliability
- Sync conflicts in shared knowledge

### Quality gate to Stage 3

- Environment parity checklist passes for all members
- CI checks for instruction/schema validity
- Shared skill profile model working and documented
- Operational runbook for incidents and support created

## Stage 3 - OpenClaw personal assistant integration

### Scope

- Introduce an assistant layer for day-to-day personal execution
- Keep Stage 1/2 local-first runtime model
- Governed retrieval into assistant context
- Preserve boundaries between company and personal knowledge

### Required capabilities

- Assistant workspace and memory boundary rules
- Governed retrieval/search access to company knowledge
- Explicit no-copy rules from personal/inbox into shared artifacts
- Approval and quality gates still enforced before external outputs

### Benefits

- Better daily execution support for individuals
- Safer retrieval pattern before VM runtime migration
- Clearer policy boundaries for personal assistant usage

### Limitations

- Adds one more governance layer to maintain
- Requires clear memory and retrieval policies
- Still depends on local execution reliability

### Quality gate to Stage 4

- Assistant memory/retrieval boundaries documented and validated
- Source precedence and citation rules consistently applied
- Personal/company boundary leaks tested and blocked
- Stage 4 VM scope frozen and approved

## Stage 4 - VM execution AI-OS with user workspaces

### Scope

- Local machine used mainly for development and supervision
- Agent execution moved to VM
- Dedicated workspace per user on VM
- Distinct company and private skills

### Required capabilities

- Runtime service (scheduler + executor + run history)
- Per-user isolation and per-user data stores
- Health status and relogin/noVNC support
- Clear boundary between private user skills/knowledge and company-managed skills/knowledge

### Benefits

- Always-on scheduled execution
- Better reliability and operability
- Lower local machine dependency
- Cleaner support model for team operations

### Limitations

- Higher ops complexity and costs
- Identity, secrets, and permissions management overhead
- More formal incident handling required

### Quality gate to Stage 5

- RBAC and access boundaries verified
- Audit trail for runs and key actions available
- Security and backup policies tested
- Service-level expectations and on-call/runbook responsibilities defined

## Stage 5 - Full company AI-OS

### Scope

- Build on Stage 4 runtime foundation
- Integrate business systems (CRM, ERP, Dev, M365, internal data systems)
- Governed company-wide operating layer

### Required capabilities

- Connector architecture with clear trust boundaries
- Policy and approval engine for high-risk actions
- Data classification and retention policies
- Monitoring for quality, cost, and compliance

### Benefits

- End-to-end business process augmentation
- Reusable enterprise capabilities
- Strong auditability and operational consistency

### Limitations

- Integration maintenance overhead
- Change management and governance complexity
- Higher organizational adoption requirements

### Ongoing quality controls

- Mandatory human approval for external/high-impact actions
- Policy-as-code for tool permissions
- SLA/quality/cost dashboards and periodic reviews

## Stage transition quality gates summary

| Transition | Technical gate | Knowledge gate | Security gate | Ops gate |
| --- | --- | --- | --- | --- |
| Stage 1 -> 2 | Reproducible setup on 2+ machines | Company/personal taxonomy stable | Local data boundaries defined | Backup/restore and rollback tested |
| Stage 2 -> 3 | Assistant layer boundary model documented | Shared knowledge sync conflict policy active | Personal/company memory separation documented | Onboarding and retrieval runbook validated |
| Stage 3 -> 4 | Runtime services stable in test VM | Source precedence/citation rules enforced | Per-user identity and secret model documented | Scheduler reliability and incident runbook validated |
| Stage 4 -> 5 | Connector framework and APIs validated | Data classification mapped to integrations | RBAC, audit, and approval controls enforced | SLOs, cost controls, and governance cadences active |

## Provider strategy investigation

## Option A - Claude-only

### Fit

- Best immediate fit with both current assets
- Lowest implementation complexity
- Fastest path to Stage 1 and Stage 2 outcomes

### Risks

- Provider lock-in over time
- Skill semantics tied to Claude conventions

## Option B - Multi-provider

### Fit

- Best long-term flexibility and resilience
- Enables provider switching and hybrid execution

### Core requirement

Create provider-neutral canonical artifacts and generate adapters:

- `agent.manifest.yaml` (role, responsibilities, constraints)
- `skill.manifest.yaml` (inputs, outputs, side effects, permission class)
- `policy.manifest.yaml` (allowed tools, approval requirements, data class)

Adapters then render into provider-specific formats (Claude/OpenCode/Copilot/etc.).

### Risks

- More design and maintenance overhead
- Semantic mismatches across providers (tools, memory, slash command behavior)

## Option C - M365 Copilot-only

### Fit

- Strong for M365-native data and enterprise identity controls
- Good for information-worker workflows in SharePoint/Teams/Outlook contexts

### Limits

- Weaker for custom runtime control-plane patterns (scheduler, executor, custom CLI flows)
- Less suitable as sole platform for engineering-heavy agent OS operations

## Recommendation

Use a staged provider strategy:

1. Stage 1 and Stage 2: Claude-first
2. Stage 2 onward: define provider-neutral manifests in parallel
3. Stage 3: integrate assistant layer with governed retrieval and memory boundaries
4. Stage 4: adopt Cockpit-like runtime operations while keeping Claude as default provider
5. Stage 5: integrate M365 and enterprise systems through controlled adapters, not as the only runtime model

This keeps delivery speed high now while preventing lock-in debt later.
