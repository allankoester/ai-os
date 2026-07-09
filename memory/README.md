# Agent Memory (machine-local)

Two-layer personal-assistant memory for the **local user**, following the
convergent pattern documented in
`docs/reference/personal-assistant-gap-analysis.md` (OpenClaw / Hermes /
Claude memory all use the same shape):

```
memory/
├── MEMORY.md            curated long-term layer: durable facts, preferences,
│                        standing decisions — small, budgeted (≤ ~200 lines)
└── daily/YYYY-MM-DD.md  working layer: observations, session summaries,
                         parked ideas, #feedback entries — append-only
```

## Contract

- Everything here **except this README is gitignored**: machine-local,
  per-user, never committed, never synced to OneDrive.
- Same privacy class as `knowledge/personal/`: content never enters company
  artifacts, shared briefs, task briefs to other users, or client-facing
  outputs.
- This folder sits at the workspace root (not under `knowledge/personal/`)
  **on purpose**: guardrails keep `knowledge/personal/` write-blocked with
  deny rules, and Claude Code deny rules override any child allow rule.
  A sibling folder lets agents write memory while the personal knowledge
  folder stays fully protected. Privacy rules are identical.
- Company shared memory stays in
  `knowledge/company/company_handbook_SSOT/agent-memory.md` and is
  **promotion-only**: entries land there via Mara + explicit user approval,
  never automatically.
- Consolidation: the `memory-consolidation` skill distills daily notes into
  `MEMORY.md` and prunes stale entries (weekly scheduler job).

Operating rules for agents are in `CLAUDE.md` § Memory.
