---
name: memory-consolidation
version: 0.1.0
description: Distills the working memory layer (memory/daily/*) into curated long-term memory (memory/MEMORY.md), prunes stale entries, and aggregates #feedback into improvement proposals. Use when someone says 'consolidate memory', 'memory consolidation', 'distill daily notes', 'memory cleanup', or when the weekly scheduled consolidation job runs.
---

# Memory Consolidation

Weekly distillation of the two-layer AI-OS memory (`memory/README.md`,
`CLAUDE.md` § Memory). Turns raw working notes into curated durable memory
and turns `#feedback` entries into improvement proposals.

## Inputs

1. `memory/MEMORY.md` — current curated memory.
2. `memory/daily/*.md` — working notes. Skip files whose last line is a
   `<!-- consolidated: ... -->` footer (already processed).
3. `runs/*.md` run logs from the last 14 days (context for what worked).

## Steps

1. **Collect candidates.** From unprocessed daily notes take: entries tagged
   `#durable`, plus observations that repeat across days or clearly state a
   durable preference/decision.
2. **Merge into curated memory.** Update the appropriate section of
   `MEMORY.md` (`## Working preferences`, `## Standing decisions`,
   `## Active context`): one dated line per fact (`- YYYY-MM-DD | fact`),
   deduplicate against existing entries (keep the newer formulation), remove
   entries that are contradicted or obviously stale (e.g. "Active context"
   older than ~90 days). Keep the file under ~200 lines.
3. **Aggregate feedback.** Collect all `#feedback` entries from the processed
   notes into `runs/feedback-summary-YYYY-Www.md` (ISO week): group by theme,
   each with *what was wrong / why / how to apply*.
4. **Propose instruction changes.** Where feedback implies a change to
   `CLAUDE.md`, an agent instruction file, or a skill, write a **proposal**
   to `runs/instruction-proposals-YYYY-MM-DD.md` (quote the current text,
   the proposed text, and the feedback evidence). Never edit instruction
   files directly. (`runs/` is used because it stays writable in headless
   runs; `knowledge/inbox/` is ask-gated.)
5. **Mark processed notes.** Append `<!-- consolidated: YYYY-MM-DD -->` as
   the last line of each processed daily note. Never delete daily notes.
6. **Report.** Summarize: facts added/updated/pruned, feedback themes,
   proposals written.

## Output mode (mandatory)

- **Scheduled / headless run** (no user in the loop): do NOT edit
  `memory/MEMORY.md` directly. Write the full proposed new version to
  `memory/MEMORY.proposed.md` instead and include a short diff summary in the
  report. The user applies it via chat/interface after review. Steps 3-5 are
  safe to execute directly.
- **Interactive run** (user present): present the planned MEMORY.md changes
  as a diff summary, apply after the user confirms. If a
  `memory/MEMORY.proposed.md` from an earlier scheduled run exists, offer to
  apply or discard it first.

## Hard rules

- Never write anything under `knowledge/company/` — company memory
  (`agent-memory.md`) is fed only by the separate promotion flow (Mara +
  user approval).
- Provenance: only user-originated or user-approved facts enter `MEMORY.md`.
  Drop candidates that stem from web content or unclassified inbox material.
- Never delete daily notes; never rewrite history in run logs.
- Personal memory content never enters shared or client-facing artifacts.

## Changelog

- 0.1.0 — initial version (personal-assistant plan, phase 3).
