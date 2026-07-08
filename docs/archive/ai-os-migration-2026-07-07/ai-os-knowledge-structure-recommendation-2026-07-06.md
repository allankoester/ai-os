# AI-OS Knowledge Structure Recommendation (2026-07-06)

## Decision

Use a dedicated AI-OS root directly under OneDrive `General`:

`/Users/allan/Library/CloudStorage/OneDrive-SharedLibraries-SMAPAS/SteadyMade.ai - General/AI_OS`

Use `_artifacts` (not `_attachments`) for binary artifacts.

## Target structure

```text
SteadyMade.ai - General/
└── AI_OS/
    ├── knowledge/
    │   ├── company/
    │   │   ├── company_handbook/
    │   │   ├── strategy/
    │   │   ├── sales/
    │   │   ├── marketing/
    │   │   ├── offers/
    │   │   ├── projects/
    │   │   ├── clients/
    │   │   ├── finance_legal/
    │   │   ├── creative/
    │   │   ├── references/
    │   │   └── data_sources/
    │   ├── team/
    │   │   ├── runbooks/
    │   │   ├── templates/
    │   │   └── decisions/
    │   └── inbox/
    ├── technical_config/
    │   ├── company/
    │   │   ├── agents/
    │   │   ├── skills/
    │   │   ├── workflows/
    │   │   ├── guardrails/
    │   │   └── profiles/
    │   ├── team/
    │   │   ├── skills/
    │   │   ├── workflows/
    │   │   └── profiles/
    │   └── personal/
    │       ├── skills/
    │       ├── profiles/
    │       └── workflows/
    ├── tools/
    ├── apps/
    ├── archive/
    └── _artifacts/
```

## Notes

1. `company_handbook/` is for fixed baseline documents used across all work items.
2. SSOT is a principle for canonical docs, not a dedicated folder name.
3. `knowledge/` contains business/system-of-record content.
4. `technical_config/` contains operational config (agents, skills, workflows, guardrails, profiles).
5. `technical_config/personal/` includes personal scopes for skills, profiles, and workflows.
6. Prefer origin-local `_artifacts/` near source docs; keep root `_artifacts/` for cross-domain/unclassified binaries.
