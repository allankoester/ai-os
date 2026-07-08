# Company Knowledge Hierarchy Cleanup - 2026-07-08

Scope:

- `AI_OS/knowledge/company/` (non-archive only)
- executed after user-approved cleanup plan

## Completed changes

1. Removed `.DS_Store` files outside `AI_OS/archive/**`.
2. Moved operating profile from:
   - `knowledge/company/operating-profile.md`
   to:
   - `AI_OS/operating-profile.md`
3. Renamed SSOT folder:
   - `knowledge/company/steadymade Docs/`
   to:
   - `knowledge/company/company_handbook_SSOT/`
4. Kept only SSOT files in `company_handbook_SSOT/`:
   - `steadymade - SSOT 1...6`
5. Moved non-SSOT files out of SSOT folder:
   - LinkedIn campaign -> `knowledge/company/marketing/campaigns/linkedin/`
   - Marketing handbook -> `knowledge/company/marketing/`
   - ICP + positioning -> `knowledge/company/strategy/`
6. Cleaned `knowledge/company/strategy/`:
   - removed duplicate SSOT copies
   - flattened BAFA docs into `knowledge/company/strategy/bafa-kmu-beratung/`
   - removed migrated registration and brand/design subtrees
7. Moved registration artifact to contracts:
   - `knowledge/company/contracts/legal/company-registration/_artifacts/`
8. Fixed misplaced design-system under contracts:
   - moved `knowledge/company/contracts/design-system/` content to
     `knowledge/company/creative/design-system/legacy/`
9. Removed empty `knowledge/company/documents/` (contained only `.gitkeep`).

## Verification result

- operations executed: 40
- conflicts: 0
- missing paths: 0
- no `.DS_Store` files remain outside archive
- `knowledge/company/company_handbook_SSOT/` now contains only SSOT 1-6
- `knowledge/company/strategy/` now contains strategy working docs only
- `knowledge/company/contracts/design-system/` no longer exists

Machine-readable execution report:

- `docs/archive/ai-os-migration-2026-07-07/company-knowledge-hierarchy-cleanup-2026-07-08.json`

## Remaining normalization candidates (not changed in this pass)

- `knowledge/company/references/04_Partner/...` and
  `knowledge/company/references/partners/...` are both present.
- Typo/legacy naming remains in `references` subfolders
  (for example `Whitepapgers`, `Strartegy`, `Assessentcenter`).
- Policy update intentionally deferred until full subfolder clarification.
