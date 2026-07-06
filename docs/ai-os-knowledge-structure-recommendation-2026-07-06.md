# AI-OS Knowledge Structure Recommendation (2026-07-06)

## Decision

Use a dedicated AI-OS root directly under the shared OneDrive `General` root:

`/Users/allan/Library/CloudStorage/OneDrive-SharedLibraries-SMAPAS/SteadyMade.ai - General/AI_OS_Knowledge`

Do not place the canonical AI-OS root inside `99_Resources/`.

## Target structure

```text
SteadyMade.ai - General/
└── AI_OS_Knowledge/
    ├── company/
    ├── team/
    ├── inbox/
    ├── archive/
    └── _attachments/
```

Detailed structure:

```text
AI_OS_Knowledge/company/
├── operating-profile.md
├── ssot/
├── strategy/
├── marketing/
├── offers/
├── projects/
├── clients/
├── finance-legal/
├── creative/
└── references/

AI_OS_Knowledge/team/
├── runbooks/
├── templates/
├── workflows/
├── skills/
└── decisions/

AI_OS_Knowledge/inbox/
└── _triage/

AI_OS_Knowledge/archive/
└── legacy-onedrive-structure/

AI_OS_Knowledge/_attachments/
├── images/
├── pdf/
├── office/
├── media/
└── exports/
```

## Mapping from current OneDrive scaffolding

### Company

- `01_Strategy_&_Company/` -> `company/ssot/`, `company/strategy/`, `company/creative/`
- `02_Sales_&_Pipeline/` -> `company/clients/`, `company/offers/`
- `03_Projects/` -> `company/projects/`
- `05_Marketing_&_Content/` -> `company/marketing/`, `company/creative/`
- `99_Resources/` -> `company/references/` (selected, curated)

### Team

- shared operating docs and reusable process assets -> `team/runbooks/`, `team/templates/`, `team/workflows/`, `team/skills/`

### Transit

- `98_XChange/` -> `inbox/_triage/`

### Personal/sensitive review

- person-specific, legal, and client-sensitive items remain review-first

## Folder policy (operational)

1. `company/` is shared system-of-record content.
2. `team/` is shared operating knowledge for internal execution.
3. `inbox/` is temporary intake only.
4. `archive/` stores legacy structures and frozen snapshots.
5. `_attachments/` stores binary artifacts referenced by Markdown records.

## Naming and content rules

1. Markdown-first for editable source records.
2. Keep one canonical source per topic.
3. Keep sensitive records scoped and labeled.
4. Keep external binary artifacts in `_attachments/` and link from Markdown index cards.
