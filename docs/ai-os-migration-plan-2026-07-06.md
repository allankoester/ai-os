# AI-OS Knowledge Migration Plan (2026-07-06)

## Goal

Migrate relevant OneDrive content into `AI_OS_Knowledge` so AI-OS can operate as CMS and system of record, with Markdown-first source strategy.

## Canonical target

`/Users/allan/Library/CloudStorage/OneDrive-SharedLibraries-SMAPAS/SteadyMade.ai - General/AI_OS_Knowledge`

## Core migration strategy

1. Copy-first migration (no destructive move in first pass).
2. Markdown-first for source-of-truth records.
3. Binary artifacts are attachments or exports, not canonical editable records.
4. Sensitive folders are review-first.

## File compatibility and handling rules

### Markdown (`.md`)

- Primary source format for AI-OS records.
- Migrate directly into target company/team/inbox structure.

### PDF (`.pdf`)

- If external report/legal original: keep as original attachment and add Markdown index/summary.
- If generated business document (invoice, proposal, handout): Markdown source record first, PDF only final static export.

### Office files (`.docx`, `.pptx`, `.xlsx`)

- `.docx`: convert to Markdown source where possible, keep original as attachment.
- `.pptx`: extract structure/messages into Markdown source, keep deck as export attachment.
- `.xlsx`: keep as attachment unless intentionally converted to Markdown/CSV data record.

### Media/assets (`.png`, `.jpg`, `.mp4`, `.mov`)

- Store under `_attachments/`.
- Reference from Markdown records.

### Collaboration/system artifacts (`.loop`, `.base`, `.whiteboard`, planner exports)

- Not canonical source records.
- Keep as attachment or exclude.
- Create Markdown summaries for important decisions if needed.

## Path-level migration plan

| Current path | Target path | Treatment |
| --- | --- | --- |
| `01_Strategy_&_Company/` | `company/ssot/`, `company/strategy/`, `company/creative/` | Markdown-first migration + attachment indexing |
| `02_Sales_&_Pipeline/` | `company/clients/`, `company/offers/` | review-first for client-sensitive branches |
| `03_Projects/` | `company/projects/` + `team/runbooks/` for internal playbooks | structured migration |
| `04_Finance_&_Legal/` | `company/finance-legal/` | review-first, preserve originals |
| `05_Marketing_&_Content/` | `company/marketing/`, `company/creative/` | Markdown source + attachment strategy |
| `98_XChange/` | `inbox/_triage/` | classify first, then migrate/discard |
| `99_Resources/` | `company/references/` and selected `team/` | curated migration only |
| `Microsoft Planner/` | exception/review | no automatic migration |
| `Whiteboards/` | `_attachments/exports/whiteboards/` + Markdown summaries | attachment-first |

## Explicit exceptions for first migration pass

Do not auto-migrate:

1. `.obsidian/`
2. `.trash/`
3. `.DS_Store`
4. `.849C9593-D756-4E56-8D6E-42412F2A707B`
5. `Loop-Absatz.loop`
6. `Untitled.base`
7. `Microsoft Planner/**`
8. `98_XChange/**` (until classified)
9. `04_Finance_&_Legal/**` (until sensitivity review)
10. `02_Sales_&_Pipeline/02_Opportunities/**` (until client review)
11. `03_Projects/01_Active/NDR Newsletter.zip` (until unpack/review)
12. flyer/image archive dumps without current business value

## Migration execution checklist

1. Review inventory: `docs/onedrive-migration-inventory-2026-07-06.json`.
2. Approve inclusion/exclusion list.
3. Execute copy-first migration batch.
4. Convert or summarize non-Markdown source documents.
5. Link attachments from Markdown records.
6. Verify in AI-OS interface with OneDrive fs root.
7. Freeze and archive legacy branches after sign-off.
