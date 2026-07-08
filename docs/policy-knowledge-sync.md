# Knowledge Sync Policy

Applies to shared company knowledge under `knowledge/company/`.
Personal knowledge (`knowledge/personal/`) is never shared and is out of scope.

## Distribution channels

| What | Channel | Why |
| --- | --- | --- |
| Software, agents, instructions, templates, profiles | git (this repo) | reviewable, versioned, reproducible |
| Company knowledge (`knowledge/company/`) | OneDrive canonical root `AI_OS/knowledge` (repo links via symlink) | single canonical source |
| Company operating profile (`operating-profile.md`) | OneDrive canonical root `AI_OS/` | central custom instruction for whole hub |
| Personal knowledge, run logs, backups | never shared | privacy rule |

## Canonical source rules

1. Every topic has exactly one canonical document. Duplicates are defects.
2. OneDrive `AI_OS/knowledge` is canonical for shared company knowledge.
3. `operating-profile.md` lives at AI_OS root (`AI_OS/operating-profile.md`).
4. `company_handbook_SSOT/` is the canonical SSOT corpus folder.

## Canonical taxonomy

```text
knowledge/company/
├── company_handbook_SSOT/
├── strategy/
├── commercial/
├── projects/
├── marketing/
├── contracts/
└── references/
```

### Folder ownership and purpose

- `company_handbook_SSOT/`: SSOT 1-6 canonical baseline docs only.
- `strategy/`: working strategy material and decision docs.
- `commercial/`: opportunities, clients, offers, proposals, pricing, sales material.
- `projects/`: delivery execution docs (`internal`, `active`, `inactive`).
- `marketing/`: campaigns, content, channels, social media, presentations,
  creative and brand assets.
- `contracts/`: contract documents (`client-contracts`, `vendor-contracts`,
  `company-registration`, `templates`, `signed`).
- `references/`: external research, partner references, tool snapshots.

## Required second-level taxonomy

```text
commercial/
├── opportunities/
├── clients/
├── offers/
├── proposals/
├── pricing/
└── sales-materials/

projects/
├── internal/
├── active/
└── inactive/

marketing/
├── campaigns/
├── content/
├── channels/
├── presentations/
├── social-media/
├── flyers-infographics/
├── creative/
└── brand-assets/

contracts/
├── client-contracts/
├── vendor-contracts/
├── company-registration/
├── templates/
└── signed/

references/
├── partners/
├── reports-whitepapers/
└── agent-skills/
```

## Artifact placement

- Use `_artifacts/` (never `_attachments`).
- Prefer origin-local `_artifacts/` next to source Markdown records.
- Use root `AI_OS/_artifacts/` only for cross-domain, generated, or
  not-yet-classified binaries.
- Do not create nested `Archive/` folders inside active knowledge domains.

## Naming conventions

- Folders: lowercase kebab-case for new folders.
- Files: descriptive names in content language.
- SSOT files: `steadymade – SSOT n. <topic>.md` naming remains canonical.
- Dated records: prefix `YYYY-MM-DD-`.
- Status and market scope belong in `interface/meta.json`, not filenames.
- No spaces in new folder names.

## Legacy path deprecation

Deprecated legacy structures must not be recreated:

- `steadymade Docs` -> `company_handbook_SSOT`
- `sales`, `offers`, `clients` (top-level) -> `commercial/*`
- `creative` (top-level) -> `marketing/creative` or `marketing/brand-assets`
- `projects/00_Internal` -> `projects/internal`
- `projects/01_Active` -> `projects/active`
- `marketing/01_Presentations` -> `marketing/presentations`
- `marketing/03_Social_Media` -> `marketing/social-media`
- `marketing/04_Flyer_&_Infographics` -> `marketing/flyers-infographics`
- `references/02_Reports_Whitepapgers` -> `references/reports-whitepapers`
- `references/04_Partner` -> `references/partners`
- `references/Agent Skills` -> `references/agent-skills`

## Move safety protocol

1. Build a manifest before moving: `source -> target`.
2. Never overwrite non-identical destination files.
3. If destination exists and differs: stop and log conflict.
4. Remove old folders only after content and checksum verification.

## Conflict handling

- git-synced knowledge: conflicts are resolved in PR review.
- OneDrive sync: ownership by folder/domain to reduce edit collisions.
- On conflict: canonical source wins; loser path becomes intake for Mara review.

## Change flow

1. New/changed material lands in `knowledge/inbox/` or a feature branch.
2. Mara classifies, deduplicates, and proposes canonical targets.
3. Review under `docs/runbook-team-operations.md`.
4. Merge/sync and run `node scripts/validate.mjs`.

## Intake folder meaning

`knowledge/inbox/` is temporary staging only.

- Not a source of truth
- Not a task queue
- Not a CRM inbox

Items in `knowledge/inbox/` must be classified or discarded after review.
