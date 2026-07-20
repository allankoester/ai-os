# Storage plan local benchmark (Node 22)

This benchmark is a **local-only** verification harness for storage-plan objectives.

- Uses isolated temp workspaces/runtime roots under the OS temp directory.
- Never touches normal repo runtime authority files.
- Cleans temporary data at the end of each run.

## Command

```bash
npm run bench:storage-plan
```

Machine-readable output:

```bash
npm run bench:storage-plan -- --json=true
```

## What gets measured

Warm P95 (minimum 100 measured iterations after warmup) for:

1. filtered board list + detail
2. transactional board mutation + event write
3. scheduler jobs/runs query
4. chat search/top results
5. usage aggregate/projection rebuild + health read

Output includes:

- machine/runtime metadata
- dataset sizes
- warmup + measured iteration counts
- P50 / P95 / max per objective
- threshold pass/fail

## Scale controls

Default profile is intentionally pragmatic (not max fixture scale).

Set larger scale via CLI:

```bash
npm run bench:storage-plan -- --profile=max
```

or explicit overrides:

```bash
npm run bench:storage-plan -- --iterations=140 --warmup=30 --boardProjects=1000 --boardTasks=10000 --schedulerRuns=20000 --usageEvents=100000
```

Equivalent environment variables are supported:

- `BENCH_PROFILE=max`
- `BENCH_ITERATIONS`, `BENCH_WARMUP`
- `BENCH_BOARD_PROJECTS`, `BENCH_BOARD_TASKS`
- `BENCH_SCHEDULER_JOBS`, `BENCH_SCHEDULER_RUNS`
- `BENCH_CHAT_SESSIONS`, `BENCH_CHAT_TURNS_PER_SESSION`
- `BENCH_USAGE_EVENTS`

## Threshold semantics

Current thresholds are labeled as **proposed local targets** in output.
Measured results are machine/session-specific and must not be treated as universal performance gates.
