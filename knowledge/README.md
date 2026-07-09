# Knowledge Folder Contract (Stage 1)

This folder follows the staged AI-OS folder contract from
`docs/reference/ai-os-comparison-and-staged-concept.md`.

```
knowledge/
├── company/     Shared Steadymade knowledge — canonical in OneDrive (`AI_OS/knowledge/company`) via local symlink
├── personal/    Private per-user knowledge — NEVER committed, stays on this machine
└── inbox/       Unsorted intake — new material lands here before Mara classifies it
```

## Separation rule (enforced)

1. **Company knowledge** lives only under `knowledge/company/`. In this setup it is
   linked to OneDrive canonical storage (`AI_OS/knowledge/company`) and shared with
   the team.
2. **Personal knowledge** lives only under `knowledge/personal/`. It is excluded
   via `.gitignore` and must never appear in commits, shared folders, task briefs
   sent to other users, or client-facing artifacts.
3. **Inbox** is a transit area. Nothing is referenced from `inbox/` in final
   outputs. Mara (`mara-setup-agent`) classifies inbox material into
   `company/<domain>/` or advises moving it to `personal/`, then the inbox copy
   is removed.

## Personal knowledge: hub-local settings vs. the private vault

`knowledge/personal/` holds two distinct things — `/personal-onboarding` keeps
them separate and never conflates them:

- **`user-profile.md`** — role description and working-style settings (see
  `skills/company/personal-onboarding/`). This is the small, hub-local file
  that Danny reads every session. It stays exactly where it is: inside this
  repo's `knowledge/personal/`, gitignored, machine-local. It is *not* meant
  to hold a broader private knowledge corpus.
- **`vault/`** (optional) — a symlink to a private folder the user picks
  themselves for their own notes, drafts, and working material beyond the
  profile. It must resolve outside this git repo and outside the shared
  OneDrive company root (`_local/onedrive-company`) — e.g. the user's own
  private OneDrive (`_local/onedrive-private`, if set up) or any other local
  folder. `knowledge/personal/*` in `.gitignore` already covers it, so no
  separate ignore rule is needed. `/personal-onboarding` offers to create this
  symlink; nothing requires it, and agents never assume it exists.

## What `inbox/` means

`knowledge/inbox/` means temporary intake/staging for unsorted material.

- It is not an email/message inbox.
- It is not a task queue.
- It is not a CRM system.

If the name remains ambiguous for the team, a future dedicated migration can
rename it to `knowledge/intake/`. For now, `knowledge/inbox/` stays canonical.

## Conversational knowledge lifecycle

Conversation content (chat, brainstorming) is **raw + personal by default**
and follows this maturity ladder — it never skips steps silently:

1. **Raw** — captured in `memory/daily/YYYY-MM-DD.md` (observations, parked
   ideas under `## Parked`). Machine-local, citable only as unvalidated.
2. **Promoted draft** — `/promote-knowledge`: Mara cleans and structures the
   item into `knowledge/company/<domain>/`, registered in the interface
   metadata with `status: draft`, `source_type: conversation`.
3. **Approved** — after explicit user approval the status becomes
   `approved`; only then is it regular company knowledge.

Incognito chat turns are never captured at all (no daily note, no history).
`company_handbook_SSOT/` is not a promotion target — SSOT changes go through
the onboarding/SSOT process.

## Company domains

| Folder | Content |
| --- | --- |
| `company/company_handbook_SSOT/` | Canonical SSOT 1-6 baseline docs |
| `company/strategy/` | Working strategy material and decision docs |
| `company/commercial/` | Opportunities, clients, offers, proposals, pricing, sales material |
| `company/projects/` | Delivery records: internal, active, inactive |
| `company/marketing/` | Campaigns, content, channels, creative and brand assets |
| `company/contracts/` | Contracts, registration, templates, signed documents |
| `company/references/` | External research, partner references, tool snapshots |

Naming conventions are defined in `docs/policy-knowledge-sync.md`.

## External AI_OS relation

The external OneDrive root `AI_OS/knowledge/team/` exists as shared operating
material, but it is not part of the Stage 1/2 in-repo knowledge contract unless
explicitly linked and documented in this repo.

## Agent memory locations

- **Company shared memory:**
  `knowledge/company/company_handbook_SSOT/agent-memory.md`
  (in this setup `knowledge/company/` is a symlink to shared OneDrive storage).
  Promotion-only: entries land here via Mara + explicit user approval, never
  automatically.
- **Personal memory (private, machine-local):** `memory/` at the workspace
  root — `memory/MEMORY.md` (curated long-term) + `memory/daily/YYYY-MM-DD.md`
  (working notes). Gitignored except its README. It deliberately lives
  *outside* `knowledge/personal/` so guardrails can allow agent writes there
  while `knowledge/personal/` stays write-blocked; the privacy contract is
  identical. See `memory/README.md` and `CLAUDE.md` § Memory.
- **Team shared memory:**
  use the shared OneDrive `AI_OS/knowledge/team/` location unless this repo
  explicitly adds and documents a linked `knowledge/team/` path.
