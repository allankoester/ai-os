# Team Operations Runbook

For a 2–3 person team running the AI-OS locally, sharing software via git and
company knowledge per `docs/policy-knowledge-sync.md`.

## Change management

Everything under version control follows one simple flow:

1. Branch from `main` (or work in a fork of the folder for small doc edits).
2. Make the change: agents (`.claude/agents/`), instructions (`CLAUDE.md`),
   templates, profiles, interface code, scripts, docs.
3. Run `node scripts/validate.mjs` — must pass.
4. If the change affects implementation status, runtime behavior, stage/phase
   progress, or folder contracts, update
   `docs/status-and-roadmap.md` in the same change.
5. Open a PR. Reviewer requirements:
    - agent/instruction changes → one other team member
    - strategy-relevant knowledge (offers, pricing, positioning, SSOT docs) →
      Allan or the strategy owner (this is the human Strategy Gate)
    - pure typo/format fixes → self-merge allowed, mention in team channel
6. Merge → everyone pulls at the start of their next working session.

Versioning rule: never edit another user's profile or a canonical SSOT doc
without review.

## Shared knowledge edits (OneDrive canonical)

`knowledge/company/` is canonical in OneDrive (`AI_OS/knowledge/company`) and
linked into the repo by symlink. Treat it as shared content, not as software
source code.

1. Propose structural or strategic changes in a short doc note/PR if they impact
   policy, taxonomy, or workflows.
2. Apply content edits in the canonical path.
3. Run `node scripts/validate.mjs` locally after changes.
4. If a knowledge change affects implementation rules, update docs in this repo
   (`docs/status-and-roadmap.md`, `docs/policy-knowledge-sync.md`, `CLAUDE.md`) in
   the same change set.

## Incident and support playbook

| Symptom | First response |
| --- | --- |
| Interface won't start / port busy | `node scripts/stop.mjs`, then `node scripts/start.mjs`; check Node 22+ |
| Knowledge folder empty in UI | check `STEADYMADE_KNOWLEDGE_BACKEND` / `STEADYMADE_KNOWLEDGE_FS_ROOT`; server log prints the active backend and root |
| Graph backend errors (prod) | verify tenant/client/secret env vars; 409 = remote edit conflict, re-open the doc and merge manually |
| Agent behaves off-policy | check the agent file in `.claude/agents/` for uncommitted local edits (`git status`, `git diff`) |
| Wrong/duplicated knowledge | route to Mara (knowledge intake), resolve per sync policy canonical-source rule |
| Lost local data | `scripts/backup.sh list` → `scripts/backup.sh restore <archive>` |
| Repo broken after pull | `node scripts/validate.mjs` to locate the failing check; revert the offending commit, notify the author |

Escalation: whoever hits the incident writes a short note (what happened,
impact, fix) in `knowledge/inbox/` so Mara can turn recurring issues into
runbook updates.

## Support roles

- **Repo owner** (currently Allan): merges, releases, monorepo conventions.
- **Knowledge owner**: canonical-source decisions, Mara escalations.
- Both roles may be the same person at 2–3 users; note it in `profiles/`.

## Routine cadence

- Start of session: `git pull`, restart interface if it was running.
- Weekly (or per sprint): review open inbox items, prune stale drafts,
  create a backup (`scripts/backup.sh backup`).
- Before onboarding a new user: run through `docs/runbook-stage1-onboarding.md`
  yourself once — it must still be reproducible (Stage 1 → 2 gate).
