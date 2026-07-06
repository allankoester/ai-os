# Knowledge Folder Contract (Stage 1)

This folder follows the staged AI-OS folder contract from
`docs/reference/ai-os-comparison-and-staged-concept.md`.

```
knowledge/
├── company/     Shared Steadymade knowledge — versioned in git, synced in Stage 2
├── personal/    Private per-user knowledge — NEVER committed, stays on this machine
└── inbox/       Unsorted intake — new material lands here before Mara classifies it
```

## Separation rule (enforced)

1. **Company knowledge** lives only under `knowledge/company/`. It is committed to
   git and may be shared with the team (Stage 2: OneDrive/shared folder sync).
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
| `company/strategy/` | SSOT strategy, positioning, ICP |
| `company/steadymade Docs/` | Brand / SSOT master documents |
| `company/marketing/` | Voice guides, campaign knowledge |
| `company/offers/` | Offer modules, pricing knowledge |
| `company/documents/` | Document standards and templates |
| `company/creative/` | Image prompt library, Kie.ai reference |
| `company/clients/` | Client notes (check data sensitivity before adding) |

Naming conventions are defined in `docs/policy-knowledge-sync.md`.
