# Knowledge Sync Policy and Naming Conventions (Stage 2)

Applies to `knowledge/company/` shared across 2–3 users. Personal knowledge
(`knowledge/personal/`) is never synced and is out of scope here.

## Distribution channels

| What | Channel | Why |
| --- | --- | --- |
| Software, agents, instructions, templates, profiles | git (this repo) | reviewable, versioned, reproducible |
| Company knowledge (`knowledge/company/`) | git today; optionally OneDrive-synced folder via `STEADYMADE_KNOWLEDGE_FS_ROOT` | single canonical source |
| Personal knowledge, run logs, backups | never shared | privacy rule |

OneDrive remains the canonical second brain; this repo carries only cleaned
development/operating knowledge (see repo-level instructions).

## Canonical source rule

1. Every topic has exactly **one** canonical document. Duplicates are a defect —
   Mara flags them during intake, the team resolves them in review.
2. If OneDrive sync is active (`STEADYMADE_KNOWLEDGE_FS_ROOT` points to a
   OneDrive folder), that folder is canonical for knowledge and the repo copy
   of `knowledge/company/` is not used. Otherwise the repo copy is canonical.
   One of the two — never both.
3. Known duplication to resolve: `company/strategy/` and
   `company/steadymade Docs/` currently contain overlapping SSOT files.
   `company/steadymade Docs/` is the SSOT master area; domain folders should
   reference, not copy.

## Naming conventions

- Folders: `company/<domain>/` — lowercase, one word where possible.
- Files: `<topic>.md`, descriptive, German or English matching the content
  language. SSOT files keep their `steadymade – SSOT n. <topic>.md` scheme.
- Dated material: prefix `YYYY-MM-DD-` (e.g. `2026-07-04-client-call-acme.md`).
- Status and market scope live in the interface sidecar (`interface/meta.json`),
  not in filenames.
- No spaces in **new** folder names (existing `steadymade Docs` is grandfathered).

## Conflict handling

- git-synced knowledge: conflicts surface as merge conflicts → resolved in the
  PR by the document owner.
- OneDrive-synced knowledge: last-writer-wins is the platform behavior, so
  agree ownership per folder; the Graph backend protects concurrent edits via
  ETag (HTTP 409 on remote change) when using the interface.
- On any conflict: the canonical source wins, the loser becomes an inbox item
  for Mara to reconcile.

## Change flow for company knowledge

1. New/changed material lands in `knowledge/inbox/` or directly in a branch.
2. Mara classifies, checks duplicates/contradictions, proposes target path.
3. Review per `docs/team-operations-runbook.md` (PR or explicit team OK).
4. Merged/synced → other users pull; `node scripts/validate.mjs` must pass.
