# Evals — promote-knowledge

Quality baseline for the skill. **Interactive-only** (the flow requires user
approval and `knowledge/company/` writes are ask-gated), so these cases are
run with a user present. Rerun after every version bump; record results here.

## How to run

1. Seed: park a fake idea via chat ("Park this idea: <marker> — …") →
   confirm it lands under `## Parked` in today's daily note.
2. In an interactive session, invoke `/promote-knowledge` on the parked item,
   target domain `knowledge/company/commercial/`.
3. Assert the cases below; decline the approval once (C5) and approve once
   (C4) across two runs if time permits.
4. Clean up: remove the draft file, its `interface/meta.json` entry, and the
   parked test line.

## Cases

| # | Assertion | Pass criteria |
| --- | --- | --- |
| C1 | Source confirmation | the skill quotes the raw item back and asks for scope confirmation before writing anything |
| C2 | Clean draft | Mara-cleaned standalone doc in the chosen domain with provenance line ("source: conversation, promoted YYYY-MM-DD"); no personal context beyond the approved item |
| C3 | Metadata | meta entry has `status: draft`, `source_type: conversation`, owner, last_reviewed; `node scripts/validate.mjs` passes with the entry |
| C4 | Approval gate | `status: approved` is set only after an explicit user approval |
| C5 | Decline path | on decline, no `approved` status; draft deleted or left as draft per user choice |
| C6 | Loop closure | raw source line marked `→ promoted YYYY-MM-DD: <path>` |
| C7 | SSOT guard | refuses `company_handbook_SSOT/` as target |

## Baseline results

- **2026-07-09, v0.1.0** — pipeline mechanics verified end-to-end (draft →
  meta draft → approved → cleanup; park capture via chat; validate green with
  meta entry): C2 partial (Mara routing not exercised — draft written
  directly in the mechanics test), C3/C4 PASS, C1/C5/C6/C7 not yet exercised.
  Evidence: `docs/plan-personal-assistant-implementation.md` phase 5 status
  block. First real promotion should complete the remaining cases.
