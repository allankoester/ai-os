export const MAX_FIXTURE_SCALE = Object.freeze({
  boardProjects: 5000,
  boardTasks: 50000,
  schedulerJobs: 5000,
  schedulerRuns: 50000,
  chatSessions: 5000,
  chatTurnsPerSession: 12,
  usageEvents: 500000,
});

export const DEFAULT_CONFIG = Object.freeze({
  warmup: 10,
  iterations: 100,
  boardProjects: 20,
  boardTasks: 120,
  schedulerJobs: 80,
  schedulerRuns: 500,
  chatSessions: 60,
  chatTurnsPerSession: 6,
  usageEvents: 500,
});

export const PROPOSED_THRESHOLDS_MS = Object.freeze({
  boardFilteredListDetail: 120,
  boardMutationEvent: 140,
  schedulerQuery: 80,
  chatSearchTopResults: 120,
  usageAggregateProjection: 500,
});

function toPositiveInt(input, fallback) {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function parseCli(argv) {
  const out = {};
  for (const raw of argv || []) {
    if (!String(raw).startsWith('--')) continue;
    const trimmed = String(raw).slice(2);
    const [key, value] = trimmed.split('=');
    out[key] = value === undefined ? true : value;
  }
  return out;
}

export function resolveBenchmarkConfig(argv = process.argv.slice(2), env = process.env) {
  const cli = parseCli(argv);
  const useMaxProfile = cli.profile === 'max' || String(env.BENCH_PROFILE || '').toLowerCase() === 'max';
  const base = useMaxProfile ? MAX_FIXTURE_SCALE : DEFAULT_CONFIG;

  const cfg = {
    warmup: toPositiveInt(cli.warmup ?? env.BENCH_WARMUP, base.warmup),
    iterations: toPositiveInt(cli.iterations ?? env.BENCH_ITERATIONS, base.iterations),
    boardProjects: toPositiveInt(cli.boardProjects ?? env.BENCH_BOARD_PROJECTS, base.boardProjects),
    boardTasks: toPositiveInt(cli.boardTasks ?? env.BENCH_BOARD_TASKS, base.boardTasks),
    schedulerJobs: toPositiveInt(cli.schedulerJobs ?? env.BENCH_SCHEDULER_JOBS, base.schedulerJobs),
    schedulerRuns: toPositiveInt(cli.schedulerRuns ?? env.BENCH_SCHEDULER_RUNS, base.schedulerRuns),
    chatSessions: toPositiveInt(cli.chatSessions ?? env.BENCH_CHAT_SESSIONS, base.chatSessions),
    chatTurnsPerSession: toPositiveInt(cli.chatTurnsPerSession ?? env.BENCH_CHAT_TURNS_PER_SESSION, base.chatTurnsPerSession),
    usageEvents: toPositiveInt(cli.usageEvents ?? env.BENCH_USAGE_EVENTS, base.usageEvents),
  };

  if (cfg.iterations < 100) {
    throw new Error('iterations must be >= 100 for warm P95 measurements');
  }

  return {
    ...cfg,
    profile: useMaxProfile ? 'max' : 'pragmatic-default',
    json: String(cli.json || env.BENCH_JSON || '').toLowerCase() === 'true',
  };
}

export function percentileNearestRank(sortedValues, p) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return 0;
  const bounded = Math.min(1, Math.max(0, Number(p) || 0));
  const rank = Math.max(1, Math.ceil(bounded * sortedValues.length));
  return sortedValues[rank - 1];
}

export function summarizeDurationsMs(durations) {
  const values = (durations || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0);
  if (!values.length) {
    return {
      count: 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50Ms: percentileNearestRank(sorted, 0.50),
    p95Ms: percentileNearestRank(sorted, 0.95),
    maxMs: sorted[sorted.length - 1],
  };
}
