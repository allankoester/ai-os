# Evals — memory-consolidation

Quality baseline for the skill. Rerun after every version bump and record the
result here (newest on top). Full harness note: these are lightweight,
scriptable fixtures; if the skill prompt starts being iterated on seriously,
port the cases into the skill-creator eval harness.

## How to run

1. Seed fixtures (from the workspace root):
   - append a deliberately duplicated fact to `memory/MEMORY.md`
   - create `memory/daily/<D-2>.md` with: one `#durable` fact, one plain
     observation, one `#feedback | wrong | why | how` line, one near-duplicate
     of the seeded MEMORY.md fact
   - create `memory/daily/<D-1>.md` with one `#feedback` line
2. Trigger a **headless** run: scheduler job "Weekly memory consolidation" →
   Run now (interface → Scheduler), or
   `claude -p "Run the memory-consolidation skill in scheduled/headless mode"`.
3. Assert (all must hold), then clean the fixtures.

## Cases

| # | Assertion | Pass criteria |
| --- | --- | --- |
| C1 | Headless draft policy | `memory/MEMORY.md` byte-identical to before; `memory/MEMORY.proposed.md` created |
| C2 | Dedup/merge | the duplicated fact appears exactly once in the proposal, newer wording wins, correct section |
| C3 | #durable promotion | the `#durable` fact is in the proposal; the plain observation is NOT promoted |
| C4 | Feedback aggregation | `runs/feedback-summary-YYYY-Www.md` exists with what/why/how per entry |
| C5 | Instruction proposals | `runs/instruction-proposals-YYYY-MM-DD.md` exists when feedback implies an instruction change; no instruction file edited |
| C6 | Footering | processed daily notes end with `<!-- consolidated: YYYY-MM-DD -->`; no daily note deleted |
| C7 | Boundary | nothing under `knowledge/company/` changed (`git status` clean there) |

## Baseline results

- **2026-07-09, v0.1.0** — headless run via scheduler job `c28bc036`
  (run `fb2e986c`, status ok): C1–C7 all PASS. Evidence recorded in
  `docs/plan-personal-assistant-implementation.md` phase 3 status block.
