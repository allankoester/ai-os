# Guide — Using the Personal Assistant Layer

How to work with Danny day-to-day now that memory, chat history, the learning
loop and the promotion pipeline are live. Implementation record:
`docs/plan-personal-assistant-implementation.md`.

## The memory layers at a glance

| Layer | File(s) | Who writes it | Lifetime | Shared? |
| --- | --- | --- | --- | --- |
| 1. Chat history | `chat/history/*.jsonl` + `chat/sessions.json` | chat server, automatically | until you archive/delete | never — machine-local |
| 2. Working memory (daily notes) | `memory/daily/YYYY-MM-DD.md` | Danny (observations, parked ideas, `#durable`, `#feedback`) | rolling; consolidated weekly | never — machine-local |
| 3. Curated memory | `memory/MEMORY.md` | you, or the reviewed consolidation | durable (≤ ~200 lines) | never — machine-local |
| 4. Company shared memory | `knowledge/company/company_handbook_SSOT/agent-memory.md` | promotion only (Mara + your approval) | durable | team (OneDrive) |
| 5. Company knowledge | `knowledge/company/<domain>/` | `/promote-knowledge` or normal knowledge intake | durable, governed | team (OneDrive) |

Rule of thumb: **everything you say is layer 1-2 by default.** Nothing moves
right (toward shared/durable) without an explicit act — `#durable` tagging,
consolidation review, or promotion approval.

## Daily usage

- **Just chat.** Every new session automatically starts with your curated
  memory + the last two daily notes injected (session-start hook) — Danny
  knows your standing context without being asked.
- **"Remember this: …"** → Danny appends it to today's daily note tagged
  `#durable`. It becomes curated memory at the next consolidation, after you
  review the proposal. (Direct MEMORY.md edits from chat are blocked on
  purpose — that's the memory-poisoning defense.)
- **"Park this idea: …"** → lands under `## Parked` in today's daily note.
  Parked ideas are retrievable but count as unvalidated raw material.
- **Correcting Danny** ("that was wrong because…") → he records a
  `#feedback` entry (what was wrong / why / how to apply). These aggregate
  into weekly improvement proposals.
- **Sensitive brainstorming** → flip the **INCOGNITO** toggle (top right in
  chat). The conversation leaves no trace: no history, no session entry, no
  memory writes, no run log — and the Claude CLI's own transcript of the
  turn is purged. Usage keeps anonymous cost numbers only (no session id).
- **Past conversations** → left sidebar in Chat: click to restore and
  continue (full context resumes), rename, archive, or search full-text
  across all transcripts.

## Weekly rhythm

1. **Friday 16:00** the `memory-consolidation` job runs (only while the
   interface is running). It distills daily notes and writes:
   - `memory/MEMORY.proposed.md` — the proposed new curated memory
     (**it never touches MEMORY.md on its own**),
   - `runs/feedback-summary-YYYY-Www.md` — your corrections, grouped,
   - `runs/instruction-proposals-YYYY-MM-DD.md` — suggested CLAUDE.md/agent/
     skill changes (drafts; nothing is applied automatically).
2. **You review**: say "apply the memory proposal" in an interactive session
   (VS Code / desktop), or open the files via interface → Memory. Discard
   what you don't want.
3. Run it on demand anytime: "consolidate memory" in chat, or Scheduler →
   Run now.

## Turning a brainstorm into company knowledge

1. Park it (or point at any daily-note line / inbox file).
2. Say **"promote this"** (`/promote-knowledge`). Mara cleans it into a
   standalone doc in the right `knowledge/company/<domain>/`, registered as
   `status: draft`, `source_type: conversation`.
3. You approve → `status: approved`. Decline → it stays a draft or is
   deleted. There is no other path from chat into company knowledge, and
   `company_handbook_SSOT/` is never a target.

## Skills

- Company skills are versioned (semver in SKILL.md, enforced by
  `scripts/validate.mjs`) with changelogs; changes go through git review.
- Marketplace installs are pinned to the exact commit; check
  `GET /api/marketplace/updates` (or the Skill Hub) for upstream updates and
  locally-modified skills.
- Personal skills have their own local git history — roll back with plain
  git inside `skills/personal/`.
- Each new company skill ships eval cases in `skills/company/<name>/evals/`;
  rerun them after changing a skill.

## Privacy model (what never leaves this machine)

`memory/`, `chat/history/`, `runs/`, `knowledge/personal/`, `skills/personal/`
are gitignored, never synced to OneDrive, and excluded from company
artifacts and task briefs. Guardrails enforce write boundaries technically
(Settings → Guardrails); `scripts/backup.sh` covers knowledge + runs — add
`memory/` to your backup targets if you want memory in the archive
(currently pending, see plan phase 6 notes).

## If something looks off

- Danny "forgot" something → check `memory/MEMORY.md` and today's daily note
  via interface → Memory; the fact may still be un-consolidated or was said
  in incognito.
- Consolidation didn't run → the interface must be running Friday 16:00;
  trigger manually via Scheduler → Run now.
- A chat can't write memory → intended for MEMORY.md; daily notes should
  always work (guardrail `memory: write`).
