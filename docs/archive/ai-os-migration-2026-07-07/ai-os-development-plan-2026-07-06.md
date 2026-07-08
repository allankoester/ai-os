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

1. Initial scaffold created at `SteadyMade.ai - General/AI_OS_Knowledge/`.
2. Final canonical root switched to `SteadyMade.ai - General/AI_OS/`.
3. Final structure now separates:
   - `knowledge/`
   - `technical_config/`
   - `tools/`
   - `apps/`
   - `archive/`
   - `_artifacts/`
4. README scaffold created in critical folders, including personal/team/company scopes in `technical_config/` (`skills/`, `profiles/`, `workflows/`).
5. Interface documentation paths updated to OneDrive `AI_OS/knowledge`.

### Phase 3 - Dry-run migration inventory (implemented)

Completed:

1. Generated machine-readable migration inventory:
   - `docs/onedrive-migration-inventory-2026-07-06.json`
2. Inventory includes extension counts, path-level entries, and migration classification flags.

## Remaining phases

### Phase 4 - Controlled migration execution (implemented)

1. Copy-first migration from eligible legacy OneDrive files into `AI_OS/knowledge/` completed.
2. Backup mirror created at `AI_OS/archive/legacy-onedrive-backup-2026-07-07/`.
3. Repo-local knowledge backup created at `AI_OS/archive/repo-local-knowledge-backup-2026-07-07/`.
4. Previous scaffold archived at `AI_OS/archive/previous-ai-os-knowledge-scaffold-2026-07-07/`.
5. Migration report generated: `docs/onedrive-migration-report-2026-07-07.json`.

### Phase 5 - Canonical switch and stabilization (implemented baseline)

1. Run interface with:

```bash
STEADYMADE_KNOWLEDGE_BACKEND=fs
STEADYMADE_KNOWLEDGE_FS_ROOT="../../../_local/onedrive-company/AI_OS/knowledge"
```

2. Repo `knowledge/company` and `knowledge/inbox` now symlink to OneDrive `AI_OS/knowledge/...`.
3. `knowledge/personal` remains local/private.
4. Legacy OneDrive scaffold retained only as archived backup snapshot.

## Guardrails for implementation

1. Do not auto-migrate review-sensitive folders.
2. Do not delete legacy content during first migration pass.
3. Keep `inbox/` as transit only.
4. Keep personal/private material out of shared company root.
