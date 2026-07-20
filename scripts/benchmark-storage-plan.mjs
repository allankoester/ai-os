import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { createBoardStorage } from '../interface/board/storage.mjs';
import { createBoardService } from '../interface/board/service.mjs';
import { createSchedulerStorage } from '../interface/storage/runtime/scheduler-storage.mjs';
import { createChatSessionStore } from '../chat/storage/chat-session-store.mjs';
import { getUsageProjectionHealth, rebuildUsageProjectionShadow } from '../interface/storage/runtime/usage-projection.mjs';
import {
  PROPOSED_THRESHOLDS_MS,
  resolveBenchmarkConfig,
  summarizeDurationsMs,
} from './benchmark-storage-plan-utils.mjs';

const HUMAN_ACTOR = { id: 'perf_user', isHuman: true, isInternal: false };

function createGuardrailsAllowAll() {
  return {
    check() {
      return { allowed: true, confirmRequired: false };
    },
  };
}

function createSchedulerNoop() {
  return {
    async createJob() {
      return { job: { id: `bench_${Date.now()}` } };
    },
    async runNow() {
      return { run: { id: `run_${Date.now()}` } };
    },
    async cancelRun() {
      return { ok: true };
    },
    async getRunLog() {
      return null;
    },
  };
}

async function mkScopedTempRoot() {
  return fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'storage-plan-bench-')));
}

async function safeCleanupTempRoot(tempRoot) {
  const tmpRoot = await fsp.realpath(os.tmpdir());
  const resolved = await fsp.realpath(tempRoot).catch(() => null);
  if (!resolved) return;
  const rel = path.relative(tmpRoot, resolved);
  const inTmp = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  const hasExpectedPrefix = path.basename(resolved).startsWith('storage-plan-bench-');
  if (inTmp && hasExpectedPrefix) {
    await fsp.rm(resolved, { recursive: true, force: true });
  }
}

function machineMetadata() {
  const cpus = os.cpus() || [];
  return {
    timestamp: new Date().toISOString(),
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus[0]?.model || 'unknown',
    cpuCount: cpus.length,
    totalMemoryGb: Number((os.totalmem() / (1024 ** 3)).toFixed(2)),
    runtimeIsolation: 'temporary-local-only',
  };
}

async function seedBoardDataset({ workspaceRoot, runtimeRoot, boardProjects, boardTasks }) {
  await fsp.mkdir(workspaceRoot, { recursive: true });
  await fsp.mkdir(runtimeRoot, { recursive: true });

  const storage = createBoardStorage({
    rootDir: workspaceRoot,
    runtimeRootOverride: runtimeRoot,
  });
  const service = createBoardService({
    rootDir: workspaceRoot,
    guardrails: createGuardrailsAllowAll(),
    scheduler: createSchedulerNoop(),
    storage,
    getRuntimeSettingsRaw: async () => ({ runtimeMode: 'claude-subscription', envVault: {} }),
    listCanonicalAgentIds: async () => new Set(['danny', 'agent_alpha']),
    listCanonicalWorkflowIds: async () => new Set(['workflow_alpha']),
  });

  const projectIds = [];
  for (let i = 0; i < boardProjects; i += 1) {
    const id = `proj_${String(i).padStart(5, '0')}`;
    const name = i % 3 === 0 ? `Alpha Project ${i}` : `Project ${i}`;
    const project = await service.createProject({
      id,
      name,
      status: i % 11 === 0 ? 'paused' : 'active',
      visibility: 'private',
      description: `Benchmark project ${i}`,
    }, HUMAN_ACTOR);
    projectIds.push(project.id);
  }

  let mutationTask = null;
  for (let i = 0; i < boardTasks; i += 1) {
    const task = await service.createTask({
      id: `task_${String(i).padStart(6, '0')}`,
      project_id: projectIds[i % projectIds.length],
      title: `Task ${i}`,
      description: i % 5 === 0 ? 'Includes quarterly roadmap keyword' : 'Routine benchmark task',
      status: i % 7 === 0 ? 'in_progress' : 'todo',
      assignee_type: 'agent',
      assignee_id: 'agent_alpha',
      workflow_id: 'workflow_alpha',
      completion_percent: i % 100,
    }, HUMAN_ACTOR);
    if (!mutationTask && i % 41 === 0) mutationTask = task;
  }

  return {
    service,
    focusProjectId: projectIds[0],
    mutationTask,
  };
}

async function seedSchedulerDataset({ workspaceRoot, runtimeRoot, schedulerJobs, schedulerRuns }) {
  await fsp.mkdir(workspaceRoot, { recursive: true });
  await fsp.mkdir(runtimeRoot, { recursive: true });
  const storage = createSchedulerStorage({
    workspaceRoot,
    legacyJobsFile: path.join(workspaceRoot, 'scheduler', 'jobs.json'),
    legacyRunsFile: path.join(workspaceRoot, 'scheduler', 'runs.json'),
    testRootOverride: runtimeRoot,
    maxRunsKept: Math.max(200, schedulerRuns + 10),
  });

  const now = Date.now();
  const jobIds = [];
  const insertJob = storage.db.prepare(`
    INSERT INTO scheduler_jobs (
      id, name, agent, workflow, prompt, schedule_type, schedule, run_at,
      enabled, timeout_minutes, model, allowed_tools, meta_json, created_at,
      last_run_id, last_run_status, last_run_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRun = storage.db.prepare(`
    INSERT INTO scheduler_runs (
      id, job_id, job_name, trigger, started_at, ended_at, status, exit_code,
      summary, created_at, lease_owner, lease_expires_at, terminal_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  storage.db.exec('BEGIN IMMEDIATE;');
  try {
    for (let i = 0; i < schedulerJobs; i += 1) {
      const id = `job_${String(i).padStart(6, '0')}`;
      jobIds.push(id);
      insertJob.run(
        id,
        `Job ${i}`,
        'danny',
        null,
        'benchmark prompt',
        'cron',
        '*/20 * * * *',
        null,
        1,
        10,
        null,
        null,
        null,
        now - (schedulerJobs - i) * 1000,
        null,
        null,
        null,
      );
    }
    for (let i = 0; i < schedulerRuns; i += 1) {
      const jobId = jobIds[i % jobIds.length];
      const startedAt = now - i * 5000;
      insertRun.run(
        `run_${String(i).padStart(7, '0')}`,
        jobId,
        `Job ${i % jobIds.length}`,
        i % 2 === 0 ? 'manual' : 'cron',
        startedAt,
        startedAt + 400,
        i % 25 === 0 ? 'error' : 'ok',
        i % 25 === 0 ? 1 : 0,
        i % 25 === 0 ? 'failed' : 'ok',
        startedAt,
        null,
        null,
        startedAt + 400,
      );
    }
    storage.db.exec('COMMIT;');
  } catch (err) {
    try { storage.db.exec('ROLLBACK;'); } catch {}
    throw err;
  }

  return storage;
}

async function seedChatDataset({ workspaceRoot, runtimeRoot, chatSessions, chatTurnsPerSession }) {
  const chatDir = path.join(workspaceRoot, 'chat');
  const historyDir = path.join(chatDir, 'history');
  await fsp.mkdir(historyDir, { recursive: true });
  await fsp.mkdir(runtimeRoot, { recursive: true });

  const store = createChatSessionStore({
    workspaceRoot,
    chatDir,
    historyDir,
    testRuntimeRoot: runtimeRoot,
  });

  for (let i = 0; i < chatSessions; i += 1) {
    const conversationId = `conv_${String(i).padStart(6, '0')}`;
    const lines = [];
    for (let t = 0; t < chatTurnsPerSession; t += 1) {
      const isUser = t % 2 === 0;
      lines.push(JSON.stringify({
        t: isUser ? 'user' : 'assistant',
        ts: new Date(Date.now() - (chatSessions - i) * 1000 - t * 500).toISOString(),
        text: i % 9 === 0
          ? `Quarterly roadmap planning item ${i}-${t}`
          : `Routine conversation text ${i}-${t}`,
        agent: 'danny',
      }));
    }
    await fsp.writeFile(path.join(store.canonicalHistoryDir, `${conversationId}.jsonl`), `${lines.join('\n')}\n`, 'utf8');
  }
  store.reconcileFromTranscripts();
  return store;
}

async function seedUsageDataset({ workspaceRoot, usageEvents }) {
  const usageDir = path.join(workspaceRoot, 'runs');
  await fsp.mkdir(usageDir, { recursive: true });
  const usagePath = path.join(usageDir, 'usage.jsonl');

  const lines = [];
  for (let i = 0; i < usageEvents; i += 1) {
    lines.push(JSON.stringify({
      source: i % 3 === 0 ? 'scheduler' : 'chat',
      timestamp: new Date(Date.now() - i * 2000).toISOString(),
      session_id: i % 3 === 0 ? null : `sess_${String(i % 400).padStart(4, '0')}`,
      selected_agent: i % 2 === 0 ? 'danny' : 'agent_alpha',
      mode: i % 3 === 0 ? 'scheduler' : 'danny',
      model: 'test-model',
      duration_ms: (i % 20) * 25,
      cost_usd: ((i % 7) * 0.0003),
      num_turns: i % 3,
      input_tokens: 100 + (i % 50),
      output_tokens: 40 + (i % 20),
      total_tokens: 140 + (i % 70),
      is_error: i % 37 === 0,
      status: i % 37 === 0 ? 'error' : 'ok',
      run_id: i % 3 === 0 ? `run_${i}` : null,
      job_id: i % 3 === 0 ? `job_${i % 500}` : null,
      job_name: i % 3 === 0 ? `Job ${i % 500}` : null,
    }));
  }
  await fsp.writeFile(usagePath, `${lines.join('\n')}\n`, 'utf8');
  return usagePath;
}

async function runBenchmarkOperation({ name, objective, warmup, iterations, thresholdMs, action }) {
  for (let i = 0; i < warmup; i += 1) {
    await action(i, true);
  }

  const durations = [];
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    await action(i, false);
    durations.push(performance.now() - started);
  }

  const stats = summarizeDurationsMs(durations);
  return {
    name,
    objective,
    threshold: {
      kind: 'proposed',
      source: 'local proposal (docs list objectives but no approved numeric thresholds)',
      p95Ms: thresholdMs,
    },
    measured: {
      p50Ms: Number(stats.p50Ms.toFixed(3)),
      p95Ms: Number(stats.p95Ms.toFixed(3)),
      maxMs: Number(stats.maxMs.toFixed(3)),
      samples: stats.count,
      warmup,
    },
    pass: stats.p95Ms <= thresholdMs,
  };
}

async function main() {
  const config = resolveBenchmarkConfig();
  const isolationId = randomUUID().slice(0, 12);
  const tempRoot = await mkScopedTempRoot();

  let boardSeed = null;
  let schedulerStorage = null;
  let chatStore = null;

  try {
    const boardWorkspace = path.join(tempRoot, 'board-workspace');
    const boardRuntime = path.join(tempRoot, 'runtime', 'board');
    boardSeed = await seedBoardDataset({
      workspaceRoot: boardWorkspace,
      runtimeRoot: boardRuntime,
      boardProjects: config.boardProjects,
      boardTasks: config.boardTasks,
    });

    const schedulerWorkspace = path.join(tempRoot, 'scheduler-workspace');
    const schedulerRuntime = path.join(tempRoot, 'runtime', 'scheduler');
    schedulerStorage = await seedSchedulerDataset({
      workspaceRoot: schedulerWorkspace,
      runtimeRoot: schedulerRuntime,
      schedulerJobs: config.schedulerJobs,
      schedulerRuns: config.schedulerRuns,
    });

    const chatWorkspace = path.join(tempRoot, 'chat-workspace');
    const chatRuntime = path.join(tempRoot, 'runtime', 'chat');
    chatStore = await seedChatDataset({
      workspaceRoot: chatWorkspace,
      runtimeRoot: chatRuntime,
      chatSessions: config.chatSessions,
      chatTurnsPerSession: config.chatTurnsPerSession,
    });

    const usageWorkspace = path.join(tempRoot, 'usage-workspace');
    const usageRuntime = path.join(tempRoot, 'runtime', 'usage');
    const usagePath = await seedUsageDataset({
      workspaceRoot: usageWorkspace,
      usageEvents: config.usageEvents,
    });

    let mutationVersion = boardSeed.mutationTask.version;
    let mutationPercent = boardSeed.mutationTask.completion_percent;

    const benchmarks = [];
    benchmarks.push(await runBenchmarkOperation({
      name: 'board_filtered_list_detail',
      objective: 'Filtered board list + detail access at working local scale',
      warmup: config.warmup,
      iterations: config.iterations,
      thresholdMs: PROPOSED_THRESHOLDS_MS.boardFilteredListDetail,
      action: async () => {
        const listed = await boardSeed.service.listProjects({
          status: 'active',
          visibility: 'private',
          q: 'alpha',
          limit: 30,
          offset: 0,
        }, HUMAN_ACTOR);
        await boardSeed.service.getProject(boardSeed.focusProjectId, HUMAN_ACTOR);
        await boardSeed.service.listTasks({
          project_id: boardSeed.focusProjectId,
          status: 'todo',
          limit: 30,
          offset: 0,
        }, HUMAN_ACTOR);
        if (!listed?.items?.length) throw new Error('board list returned no rows');
      },
    }));

    benchmarks.push(await runBenchmarkOperation({
      name: 'board_mutation_event_transaction',
      objective: 'Transactional board mutation + lifecycle event persistence',
      warmup: config.warmup,
      iterations: config.iterations,
      thresholdMs: PROPOSED_THRESHOLDS_MS.boardMutationEvent,
      action: async () => {
        mutationPercent = (mutationPercent + 1) % 100;
        const updated = await boardSeed.service.patchTask(boardSeed.mutationTask.id, {
          version: mutationVersion,
          ops: [{ op: 'set_completion_percent', value: mutationPercent }],
        }, HUMAN_ACTOR);
        mutationVersion = updated.version;
      },
    }));

    benchmarks.push(await runBenchmarkOperation({
      name: 'scheduler_query_jobs_runs',
      objective: 'Scheduler query over jobs/runs under sustained local volume',
      warmup: config.warmup,
      iterations: config.iterations,
      thresholdMs: PROPOSED_THRESHOLDS_MS.schedulerQuery,
      action: async () => {
        const jobs = schedulerStorage.listJobs();
        const runs = schedulerStorage.listRuns(50);
        if (!jobs.length || !runs.length) throw new Error('scheduler query returned empty result');
      },
    }));

    benchmarks.push(await runBenchmarkOperation({
      name: 'chat_search_top_results',
      objective: 'Chat session search/top results over indexed metadata + transcript snippets',
      warmup: config.warmup,
      iterations: config.iterations,
      thresholdMs: PROPOSED_THRESHOLDS_MS.chatSearchTopResults,
      action: async () => {
        const results = chatStore.searchSessions('quarterly roadmap planning', { limit: 10 });
        if (!results.length) throw new Error('chat search returned no rows');
      },
    }));

    benchmarks.push(await runBenchmarkOperation({
      name: 'usage_aggregate_projection',
      objective: 'Usage aggregate/projection rebuild + health read',
      warmup: config.warmup,
      iterations: config.iterations,
      thresholdMs: PROPOSED_THRESHOLDS_MS.usageAggregateProjection,
      action: async () => {
        const rebuilt = rebuildUsageProjectionShadow({
          workspaceRoot: usageWorkspace,
          canonicalUsageLogPath: usagePath,
          testRootOverride: usageRuntime,
        });
        if (!rebuilt.ready) throw new Error(`usage projection rebuild failed (${rebuilt.reason || 'unknown'})`);
        const health = getUsageProjectionHealth({ workspaceRoot: usageWorkspace, testRootOverride: usageRuntime });
        if (!health.ready) throw new Error('usage projection health not ready');
      },
    }));

    const output = {
      benchmark: 'storage-plan-local-verification',
      isolationId,
      metadata: machineMetadata(),
      config: {
        profile: config.profile,
        warmup: config.warmup,
        iterations: config.iterations,
      },
      dataset: {
        boardProjects: config.boardProjects,
        boardTasks: config.boardTasks,
        schedulerJobs: config.schedulerJobs,
        schedulerRuns: config.schedulerRuns,
        chatSessions: config.chatSessions,
        chatTurnsPerSession: config.chatTurnsPerSession,
        usageEvents: config.usageEvents,
        maxScaleReference: {
          boardProjects: 5000,
          schedulerRuns: 50000,
          usageEvents: 500000,
        },
      },
      results: benchmarks,
      thresholdInterpretation: 'Measured values are from this machine/session. Thresholds are proposed local targets, not approved release gates.',
    };

    if (config.json) {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    } else {
      process.stdout.write(`Storage plan local benchmark [${output.isolationId}]\n`);
      process.stdout.write(`Node ${output.metadata.node} | ${output.metadata.platform}/${output.metadata.arch} | CPU x${output.metadata.cpuCount}\n`);
      process.stdout.write(`Profile: ${output.config.profile} | warmup=${output.config.warmup} | iterations=${output.config.iterations}\n`);
      process.stdout.write(`Dataset: board ${output.dataset.boardProjects}/${output.dataset.boardTasks}, scheduler ${output.dataset.schedulerJobs}/${output.dataset.schedulerRuns}, chat ${output.dataset.chatSessions}, usage ${output.dataset.usageEvents}\n`);
      process.stdout.write('---\n');
      for (const row of output.results) {
        process.stdout.write(`${row.name}: p50=${row.measured.p50Ms}ms p95=${row.measured.p95Ms}ms max=${row.measured.maxMs}ms threshold(proposed)=${row.threshold.p95Ms}ms => ${row.pass ? 'PASS' : 'FAIL'}\n`);
      }
      process.stdout.write('---\n');
      process.stdout.write(`${output.thresholdInterpretation}\n`);
      process.stdout.write('Use --json=true for machine-readable output.\n');
    }
  } finally {
    try { chatStore?.close?.(); } catch {}
    try { schedulerStorage?.db?.close?.(); } catch {}
    try { boardSeed?.storage?.db?.close?.(); } catch {}
    await safeCleanupTempRoot(tempRoot);
  }
}

main().catch((err) => {
  process.stderr.write(`benchmark failed: ${err?.message || 'unknown error'}\n`);
  process.exitCode = 1;
});
