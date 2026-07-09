---
name: promote-knowledge
version: 0.1.0
description: Promotes a raw conversational item (parked idea, daily-note entry, chat excerpt, inbox note) into cleaned company knowledge with draft status and explicit user approval. Use when someone says 'promote this', 'promote knowledge', 'make this company knowledge', 'das ins Firmenwissen übernehmen', 'aus der Notiz Wissen machen', or asks to turn a brainstorm/parked idea into a knowledge document.
---

# Promote Knowledge

The only path from conversation into `knowledge/company/` (see `CLAUDE.md`
§ Memory and `knowledge/README.md` § Conversational knowledge lifecycle).
Runs only with the user present — never from scheduled/headless runs.

## Flow

1. **Identify the source item.** A `## Parked` entry or line in
   `memory/daily/*.md`, a chat statement the user points at, or a file in
   `knowledge/inbox/`. Quote it back to the user to confirm scope.
2. **Pick the target domain.** One of `knowledge/company/<domain>/`
   (strategy, commercial, projects, marketing, contracts, references —
   naming rules in `docs/policy-knowledge-sync.md`).
   `company_handbook_SSOT/` is **not** a valid target.
3. **Clean via Mara.** Route to `mara-setup-agent` (Task) with only the raw
   item + target domain: structure it as a standalone Markdown doc (clear
   title, date, provenance line "source: conversation, promoted YYYY-MM-DD"),
   no personal context beyond what the user approved for sharing.
4. **Write the draft** to `knowledge/company/<domain>/<kebab-name>.md` and
   register metadata via `PUT /api/meta` on the interface (or edit
   `interface/meta.json` directly if the interface is not running):
   `status: draft`, `source_type: conversation`, `scope`, `owner`,
   `last_reviewed: <today>`.
5. **Approval.** Show the user the draft. Only after an explicit approval set
   `status: approved`. If the user declines, either delete the draft or leave
   it as `draft` per their choice — never silently approve.
6. **Close the loop.** Mark the raw source as promoted (append
   `→ promoted YYYY-MM-DD: <path>` to the daily-note line, or move the inbox
   file out per the inbox rules).

## Hard rules

- User approval is mandatory before `status: approved` (CLAUDE.md approval
  logic). Danny/Mara never approve.
- Never promote content the user has not seen in its cleaned form.
- Personal context stays personal: strip anything not explicitly meant for
  the shared knowledge base.
- Provenance is preserved (`source_type: conversation`).

## Changelog

- 0.1.0 — initial version (personal-assistant plan, phase 5).
