# AI-OS Migration Status

## Purpose

This is the leading status document for the Steadymade AI-OS OneDrive migration.

It defines the current canonical structure, migration status, backup locations,
remaining exceptions, and next steps.

## Current decision

The canonical shared AI-OS root is:

```text
SteadyMade.ai - General/AI_OS/
```

Local absolute path on Allan's machine:

```text
/Users/allan/Library/CloudStorage/OneDrive-SharedLibraries-SMAPAS/SteadyMade.ai - General/AI_OS
```

The old `AI_OS_Knowledge/` scaffold is not the canonical root anymore. It was
archived under:

```text
AI_OS/archive/previous-ai-os-knowledge-scaffold-2026-07-07/
```

## Canonical folder model

```text
AI_OS/
├── knowledge/
│   ├── company/
│   ├── team/
│   └── inbox/
├── technical_config/
│   ├── company/
│   ├── team/
│   └── personal/
├── tools/
├── apps/
├── archive/
└── _artifacts/
```

## Folder meaning

| Folder | Meaning |
| --- | --- |
| `knowledge/company/` | Shared company knowledge and system-of-record content |
| `knowledge/team/` | Shared operating knowledge for team work |
| `knowledge/inbox/` | Temporary intake/triage only |
| `technical_config/company/` | Company-level AI-OS config: agents, skills, workflows, guardrails, profiles |
| `technical_config/team/` | Team-level AI-OS config: skills, workflows, profiles |
| `technical_config/personal/` | Personal scopes for skills, profiles, workflows; no secrets |
| `tools/` | Shared utility tooling and setup helpers |
| `apps/` | Shared small internal AI-OS apps/tools |
| `_artifacts/` | Cross-domain/generated/unclassified artifacts |
| `archive/` | Backups, legacy snapshots, migration evidence |

## Artifact rule

Use `_artifacts`, not `_attachments`.

Preferred placement is origin-local:

```text
knowledge/company/marketing/website/
├── website-homepage.md
└── _artifacts/
    └── homepage-wireframe.png
```

Use root `_artifacts/` only for generated, cross-domain, or not-yet-classified
binary files.

## Repo linking state

Repo-local folders now link to OneDrive:

```text
knowledge/company -> ../../../../_local/onedrive-company/AI_OS/knowledge/company
knowledge/inbox   -> ../../../../_local/onedrive-company/AI_OS/knowledge/inbox
```

`knowledge/personal/` stays local/private and is not linked to shared OneDrive.

For each user, `_local/onedrive-company` must point to that user's local
OneDrive installation of the shared `SteadyMade.ai - General` folder. Absolute
user-specific OneDrive paths must not be committed.

## Migration status

Implemented:

1. OneDrive root created: `AI_OS/`.
2. Final scaffold created with `knowledge/`, `technical_config/`, `tools/`,
   `apps/`, `archive/`, `_artifacts/`.
3. Repo-local `knowledge/company` and `knowledge/inbox` linked to OneDrive.
4. Existing repo-local shared knowledge archived and copied into canonical root.
5. Eligible OneDrive files copied into canonical target and backup mirror.
6. Validation passed with `node scripts/validate.mjs`.
7. Second migration pass executed from open review decisions (2026-07-08):
   - migrated approved sensitive/manual-review rows
   - converted selected email/RTF/HTML sources into Markdown records
   - moved approved artifacts into canonical `_artifacts` paths
   - cleaned up agreed alias files (rows 54 and 55)
8. Skip-archive pass executed (2026-07-08):
   - moved skipped files to `AI_OS/archive/skip/` with preserved legacy paths
   - deleted skipped `README.md` files per user instruction
   - generated skip-archive report with empty-folder detection
9. Company hierarchy cleanup pass executed (2026-07-08):
   - moved `knowledge/company/operating-profile.md` to `AI_OS/operating-profile.md`
   - renamed `knowledge/company/steadymade Docs/` to `knowledge/company/company_handbook_SSOT/`
   - restricted SSOT folder to SSOT 1-6 files only
   - cleaned `knowledge/company/strategy/` to strategy working docs only
   - moved misplaced design-system content out of `contracts/`
   - removed empty `knowledge/company/documents/`
10. Company taxonomy normalization pass executed (2026-07-08):
    - consolidated `sales`, `offers`, and `clients` into `knowledge/company/commercial/`
    - merged top-level `creative` into `knowledge/company/marketing/`
    - normalized legacy numbered folders and typo folder names
    - flattened `contracts/legal/` into direct contract categories under `contracts/`
    - consolidated `references/04_Partner/` into `references/partners/`
    - aligned interface knowledge folder mappings to the new taxonomy

Backup locations:

```text
AI_OS/archive/legacy-onedrive-backup-2026-07-07/
AI_OS/archive/repo-local-knowledge-backup-2026-07-07/
AI_OS/archive/previous-ai-os-knowledge-scaffold-2026-07-07/
```

Migration report:

```text
docs/archive/ai-os-migration-2026-07-07/onedrive-migration-report-2026-07-07.json
```

Execution pass report:

```text
docs/archive/ai-os-migration-2026-07-07/migration-execution-pass-2026-07-08.md
```

Skip-archive report:

```text
docs/archive/ai-os-migration-2026-07-07/skip-archive-pass-2026-07-08.json
```

Company hierarchy cleanup reports:

```text
docs/archive/ai-os-migration-2026-07-07/company-knowledge-hierarchy-cleanup-2026-07-08.md
docs/archive/ai-os-migration-2026-07-07/company-knowledge-hierarchy-cleanup-2026-07-08.json
```

Company taxonomy normalization reports:

```text
docs/archive/ai-os-migration-2026-07-07/company-taxonomy-normalization-2026-07-08.md
docs/archive/ai-os-migration-2026-07-07/company-taxonomy-normalization-2026-07-08.json
```

Inventory:

```text
docs/archive/ai-os-migration-2026-07-07/onedrive-migration-inventory-2026-07-06.json
```

## Still excluded / intentionally deferred

After the 2026-07-08 execution pass, these groups are still intentionally not
migrated (per review-table decisions/comments):

1. `triage_inbox` bundle (`98_XChange/**`, rows 56-69)
2. cockpit snapshot bundle (rows 20-46)
3. selected manual-review files marked `skip` (rows 5, 6, 7, 16, 18, 19, 50, 52, 53)
4. special formats marked `skip` (rows 70-72)
5. system/excluded files (`.obsidian/`, `.trash/`, `.DS_Store`, OneDrive/system files)
6. secrets, credentials, private notes, personal task lists

## Source-format rule for CMS/system of record

Markdown is the editable source format for AI-OS records.

PDFs are static final/export artifacts unless they are external/legal originals.
For example, an invoice should normally have a Markdown/source record first;
the PDF is the final artifact sent to the customer.

Office files, PDFs, media, and generated files should be indexed from Markdown
and stored as `_artifacts` where they are needed.

## Next steps

1. Decide final policy for remaining `skip` rows:
   - keep in legacy old-root location
   - archive into `AI_OS/archive/` bundle(s)
   - or delete after explicit confirmation
2. Add a focused triage decision for `98_XChange/**` (rows 56-69) if any reusable
   AI-OS patterns should be promoted into `knowledge/company/references/`.
3. Decide whether special formats (rows 70-72) should stay excluded or be converted
   in a separate pass.
4. Normalize canonical company docs further:
   - reduce duplicated strategy/legacy SSOT copies
   - keep source links where originals are retained as artifacts
5. Confirm every team member has a working `_local/onedrive-company` symlink.
6. Verify the interface against:

```bash
STEADYMADE_KNOWLEDGE_BACKEND=fs
STEADYMADE_KNOWLEDGE_FS_ROOT="../../../_local/onedrive-company/AI_OS/knowledge"
```

7. Decide whether to remove tracked repo-local company knowledge from git in the
   next commit or keep a small README-only fixture.
8. Run and store a lightweight migration QA check (path checks + sampling of
   migrated Markdown records and artifacts).
9. Review empty legacy folders listed in the skip-archive report and delete them
   only after explicit approval.
10. Validate ongoing folder intake against updated taxonomy policy and prevent
    reintroduction of deprecated legacy paths.

## Supporting documents

- `docs/archive/ai-os-migration-2026-07-07/audit-knowledge-onedrive-2026-07-06.md`
- `docs/archive/ai-os-migration-2026-07-07/ai-os-knowledge-structure-recommendation-2026-07-06.md`
- `docs/archive/ai-os-migration-2026-07-07/ai-os-development-plan-2026-07-06.md`
- `docs/archive/ai-os-migration-2026-07-07/ai-os-migration-plan-2026-07-06.md`
- `docs/archive/ai-os-migration-2026-07-07/onedrive-migration-inventory-2026-07-06.json`
- `docs/archive/ai-os-migration-2026-07-07/onedrive-migration-report-2026-07-07.json`
