# Scheduler (machine-local state)

Managed via the operating interface (http://localhost:4011 → Scheduler).
Everything here except this README is gitignored.

```
scheduler/
├── jobs.json    job definitions (name, cron schedule, agent, prompt, …)
├── runs.json    run history (last 200)
└── logs/        full output per run (<runId>.log)
```

## How it works

- The interface server (`interface/server.mjs`) ticks every 20 seconds and
  fires enabled jobs. Two schedule types: **recurring** (5-field cron
  expression) and **one-time** (pick date & time in the UI; the job disables
  itself after firing).
- A job can target a specific subagent and/or a workflow from CLAUDE.md —
  the workflow instruction is prefixed to the prompt so Danny follows the
  defined agent chain and gates.
- A job runs `claude -p "<prompt>"` headless in the project root, so
  CLAUDE.md, subagents and active skills all apply. Optional per job: a
  specific subagent and a timeout (1–120 min).
- Jobs only run **while the interface server is running** (Stage 1/2 is
  local-first — always-on execution is Stage 4, VM runtime).
- If the app is offline during a recurring cron window, that missed window is
  skipped (no backfill run).
- One-time jobs with a past due timestamp fire on the next scheduler tick
  after restart, then disable themselves.
- Run logs are per-user learning data, same privacy rule as `runs/`.

## Approval rule

Scheduled runs never publish or send anything external. A job's output is a
draft/preparation; external artifacts still require the approval checklist
(`templates/approval-checklist.md`) and explicit user approval.
