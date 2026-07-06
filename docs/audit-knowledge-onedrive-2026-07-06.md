# OneDrive and Knowledge Base Audit (2026-07-06)

## Scope

Audit of:

- repo-local AI-OS knowledge contract
- current OneDrive shared folder state
- current runtime linkage to canonical knowledge storage

## Executive Result

1. Repo-local knowledge contract exists and is valid:
   - `knowledge/company/`
   - `knowledge/personal/`
   - `knowledge/inbox/`
2. Runtime is currently using repo-local knowledge storage.
3. OneDrive shared root exists and is reachable:
   - `/Users/allan/Library/CloudStorage/OneDrive-SharedLibraries-SMAPAS/SteadyMade.ai - General`
4. New canonical AI-OS root has been created in OneDrive:
   - `/Users/allan/Library/CloudStorage/OneDrive-SharedLibraries-SMAPAS/SteadyMade.ai - General/AI_OS_Knowledge`
5. Linking to `99_Resources/AI_OS_Knowledge` is not used and not recommended.

## Evidence

### Repo-local contract and validation

- Contract documented in `knowledge/README.md`.
- Sync policy documented in `docs/policy-knowledge-sync.md`.
- Validation command passed: `node scripts/validate.mjs`.

### Runtime linkage state

- `STEADYMADE_KNOWLEDGE_FS_ROOT` is not set in the current shell session.
- Default fallback in `interface/storage/config.mjs` resolves to repo-local `knowledge`.

### OneDrive shared root state

Detected top-level folders under shared OneDrive root:

- `01_Strategy_&_Company/`
- `02_Sales_&_Pipeline/`
- `03_Projects/`
- `04_Finance_&_Legal/`
- `05_Marketing_&_Content/`
- `98_XChange/`
- `99_Resources/`
- `Meetings/`
- `Microsoft Planner/`
- `Whiteboards/`
- plus system/collab artifacts (`.obsidian/`, `.trash/`, `.DS_Store`, `.loop`, `.base`)

## Classification of important folders

### Company domain folders

Primary candidates for `AI_OS_Knowledge/company/` migration:

- `01_Strategy_&_Company/`
- `02_Sales_&_Pipeline/`
- `03_Projects/`
- `05_Marketing_&_Content/`
- `99_Resources/` (selected reference material)

### Team folders

Primary candidates for `AI_OS_Knowledge/team/` migration:

- README/index and governance docs with shared operating value
- reusable process and partner execution material under `99_Resources/04_Partner/`
- reusable skill/process notes under `99_Resources/Agent Skills/`

### Personal/sensitive or review-first folders

Do not auto-migrate without review:

- `04_Finance_&_Legal/`
- `02_Sales_&_Pipeline/02_Opportunities/`
- `Microsoft Planner/`
- person-specific files in `98_XChange/`

### Transit-only folders

- `98_XChange/` maps to intake/triage behavior and should not be treated as canonical source.

## New OneDrive AI-OS root scaffold (implemented)

Created:

- `AI_OS_Knowledge/company/`
- `AI_OS_Knowledge/team/`
- `AI_OS_Knowledge/inbox/`
- `AI_OS_Knowledge/archive/`
- `AI_OS_Knowledge/_attachments/`

README files were added to each scaffold folder.

## Inventory artifact (Phase 3)

Machine-readable dry-run inventory has been generated:

- `docs/onedrive-migration-inventory-2026-07-06.json`

This includes per-file classification and extension distribution for migration planning.

## Risks and controls

1. Mixed binary/static artifacts in OneDrive can pollute AI-OS knowledge if not triaged.
2. Sensitive commercial/legal data must be migrated review-first.
3. `98_XChange/` and collaboration artifacts must not become source-of-truth records.

Controls:

- Markdown-first source record policy
- exception list for first migration pass
- copy-first migration (no destructive move in first pass)
