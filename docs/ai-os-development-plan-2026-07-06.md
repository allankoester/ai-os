# AI-OS OneDrive Integration Development Plan (2026-07-06)

## Objective

Align AI-OS knowledge storage with a clean OneDrive canonical root and prepare safe migration without disrupting the current system.

## Phase status

### Phase 1 - Documentation and decision lock (implemented)

Completed:

1. Audit document created:
   - `docs/audit-knowledge-onedrive-2026-07-06.md`
2. Structure recommendation created:
   - `docs/ai-os-knowledge-structure-recommendation-2026-07-06.md`
3. Migration plan created:
   - `docs/ai-os-migration-plan-2026-07-06.md`

### Phase 2 - Root scaffold and config path alignment (implemented)

Completed:

1. OneDrive canonical root scaffold created:
   - `SteadyMade.ai - General/AI_OS_Knowledge/`
2. Subfolders created:
   - `company/`, `team/`, `inbox/`, `archive/`, `_attachments/`
3. README scaffold created in each folder.
4. Interface documentation paths updated to the new OneDrive root.

### Phase 3 - Dry-run migration inventory (implemented)

Completed:

1. Generated machine-readable migration inventory:
   - `docs/onedrive-migration-inventory-2026-07-06.json`
2. Inventory includes extension counts, path-level entries, and migration classification flags.

## Remaining phases

### Phase 4 - Controlled migration execution (pending approval)

1. Copy-first migration from legacy OneDrive folders into `AI_OS_Knowledge/`.
2. Convert source records to Markdown where needed.
3. Keep binary originals as attachments and link from Markdown index docs.
4. Run spot QA and classification checks.

### Phase 5 - Canonical switch and stabilization (pending approval)

1. Run interface with:

```bash
STEADYMADE_KNOWLEDGE_BACKEND=fs
STEADYMADE_KNOWLEDGE_FS_ROOT="/Users/allan/Applications/VS Code/steadymade-master/_local/onedrive-company/AI_OS_Knowledge"
```

2. Confirm read/write behavior in UI.
3. Freeze legacy branches and clean old scaffold after verification.

## Guardrails for implementation

1. Do not auto-migrate review-sensitive folders.
2. Do not delete legacy content during first migration pass.
3. Keep `inbox/` as transit only.
4. Keep personal/private material out of shared company root.
