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

## What `inbox/` means

`knowledge/inbox/` means temporary intake/staging for unsorted material.

- It is not an email/message inbox.
- It is not a task queue.
- It is not a CRM system.

If the name remains ambiguous for the team, a future dedicated migration can
rename it to `knowledge/intake/`. For now, `knowledge/inbox/` stays canonical.

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
