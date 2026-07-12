// Steadymade AI OS — job scheduler
// Zero-dependency cron scheduler that executes agent tasks headlessly via the
// Claude Code CLI (`claude -p`). Jobs and run history live in scheduler/ as
// machine-local state (gitignored); full run output goes to scheduler/logs/.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const TICK_MS = 20_000;
const MAX_RUNS_KEPT = 200;
const SCHEDULER_PERMISSION_MODE = process.env.SCHEDULER_PERMISSION_MODE || 'default';
const SCHEDULER_ALLOWED_TOOLS = process.env.SCHEDULER_ALLOWED_TOOLS || 'Task,Read,Glob,Grep,Skill,WebFetch';

// Locate the Claude Code CLI. The binary is not always on PATH (e.g. when the
// CLI ships inside the VS Code extension), so try in order:
// 1. CLAUDE_BIN env var  2. PATH  3. local install  4. newest VS Code extension
export function resolveClaudeBin() {
  if (process.env.CLAUDE_BIN && fs.existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  try {
    const found = execSync('command -v claude', { encoding: 'utf8', shell: '/bin/sh' }).trim();
    if (found) return found;
  } catch { /* not on PATH */ }
  const home = os.homedir();
  const local = path.join(home, '.claude', 'local', 'claude');
  if (fs.existsSync(local)) return local;
  const extDir = path.join(home, '.vscode', 'extensions');
  try {
    const candidates = fs.readdirSync(extDir)
      .filter((d) => d.startsWith('anthropic.claude-code-'))
      .sort()
      .reverse()
      .map((d) => path.join(extDir, d, 'resources', 'native-binary', 'claude'))
      .filter((p) => fs.existsSync(p));
    if (candidates.length) return candidates[0];
  } catch { /* no vscode extensions dir */ }
  return null;
}

// ---------- cron (standard 5 fields: min hour dom mon dow) ----------

function parseField(spec, min, max) {
  const values = new Set();
  for (const part of spec.split(',')) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) return null;
    const step = m[2] ? parseInt(m[2], 10) : 1;
    if (!step || step < 1) return null;
    let lo = min, hi = max;
    if (m[1] !== '*') {
      const [a, b] = m[1].split('-').map((n) => parseInt(n, 10));
      lo = a;
      hi = b === undefined ? a : b;
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

export function parseCron(expr) {
  const fields = String(expr || '').trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dom, month, dow] = [
    parseField(fields[0], 0, 59),
    parseField(fields[1], 0, 23),
    parseField(fields[2], 1, 31),
    parseField(fields[3], 1, 12),
    parseField(fields[4].replace(/\b7\b/g, '0'), 0, 6),
  ];
  if (!minute || !hour || !dom || !month || !dow) return null;
  return { minute, hour, dom, month, dow };
}

export function cronMatches(cron, date) {
  return cron.minute.has(date.getMinutes())
    && cron.hour.has(date.getHours())
    && cron.dom.has(date.getDate())
    && cron.month.has(date.getMonth() + 1)
    && cron.dow.has(date.getDay());
}

export function cronNext(expr, from = new Date()) {
  const cron = parseCron(expr);
  if (!cron) return null;
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  // scan minute by minute, capped at 366 days
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (cronMatches(cron, d)) return d.getTime();
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

// ---------- scheduler ----------

export function createScheduler({ rootDir }) {
  const stateDir = path.join(rootDir, 'scheduler');
  const logsDir = path.join(stateDir, 'logs');
  const jobsFile = path.join(stateDir, 'jobs.json');
  const runsFile = path.join(stateDir, 'runs.json');
  const usageLogFile = path.join(rootDir, 'runs', 'usage.jsonl');

  fs.mkdirSync(logsDir, { recursive: true });

  const readJson = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  };
  const writeJson = (file, data) => fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');

  let jobs = readJson(jobsFile, []);
  let runs = readJson(runsFile, []);
  const running = new Map();   // jobId -> child process
  const lastFired = new Map(); // jobId -> minute key

  function validateJob(input) {
    const errors = [];
    if (!input.name || !String(input.name).trim()) errors.push('name is required');
    if (!input.prompt || !String(input.prompt).trim()) errors.push('prompt is required');
    const type = input.scheduleType || 'cron';
    if (type === 'once') {
      const runAt = Number(input.runAt);
      if (!Number.isFinite(runAt) || runAt <= 0) errors.push('runAt must be a valid date/time');
    } else if (type === 'cron') {
      if (!parseCron(input.schedule)) errors.push('schedule must be a valid 5-field cron expression (min hour dom mon dow)');
    } else {
      errors.push('scheduleType must be cron or once');
    }
    const timeout = Number(input.timeoutMinutes ?? 15);
    if (!(timeout >= 1 && timeout <= 120)) errors.push('timeoutMinutes must be between 1 and 120');
    return errors;
  }

  function oncePending(job) {
    // pending unless it already ran at/after the scheduled time (re-arming with a new runAt re-enables it)
    return !job.lastRun || job.lastRun.at < job.runAt;
  }

  function jobNextRun(job) {
    if (!job.enabled) return null;
    if (job.scheduleType === 'once') return oncePending(job) ? job.runAt : null;
    return cronNext(job.schedule);
  }

  function publicJob(job) {
    return {
      ...job,
      nextRun: jobNextRun(job),
      running: running.has(job.id),
    };
  }

  async function persistJobs() { await writeJson(jobsFile, jobs); }
  async function persistRuns() {
    runs = runs.slice(0, MAX_RUNS_KEPT);
    await writeJson(runsFile, runs);
  }

  function appendUsageEntry(entry) {
    try {
      fs.mkdirSync(path.dirname(usageLogFile), { recursive: true });
      fs.appendFileSync(usageLogFile, JSON.stringify(entry) + '\n', 'utf8');
    } catch {
      // scheduler telemetry must never break run execution
    }
  }

  function logSchedulerUsage(run, job) {
    appendUsageEntry({
      source: 'scheduler',
      timestamp: new Date().toISOString(),
      start: run.startedAt ? new Date(run.startedAt).toISOString() : null,
      end: run.endedAt ? new Date(run.endedAt).toISOString() : null,
      started_at: run.startedAt ? new Date(run.startedAt).toISOString() : null,
      ended_at: run.endedAt ? new Date(run.endedAt).toISOString() : null,
      duration: run.startedAt && run.endedAt ? Math.max(0, run.endedAt - run.startedAt) : null,
      duration_ms: run.startedAt && run.endedAt ? Math.max(0, run.endedAt - run.startedAt) : null,
      status: run.status,
      is_error: run.status === 'error' || run.status === 'timeout',
      trigger: run.trigger,
      run_id: run.id,
      jobId: run.jobId,
      jobName: run.jobName,
      job_id: run.jobId,
      job_name: run.jobName,
      model: job.model || null,
      session_id: null,
      selected_agent: job.agent || null,
      mode: 'scheduler',
      num_turns: null,
      cost_usd: null,
      input_tokens: null,
      output_tokens: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      total_tokens: null,
    });
  }

  function buildPrompt(job) {
    const parts = [];
    const workflowId = String(job.workflow || '').replace(/_workflow$/, '');
    if (job.workflow) {
      parts.push(`Execute this task as a ${workflowId} workflow (see the workflow definitions in CLAUDE.md) and follow that workflow's agent chain and gates.`);
    }
    if (job.agent) {
      parts.push(`Use the ${job.agent} subagent to execute this task, then report its result concisely.`);
    }
    parts.push(job.workflow || job.agent ? `Task:\n${job.prompt}` : job.prompt);
    return parts.join('\n\n');
  }

  async function executeJob(job, trigger) {
    if (running.has(job.id)) {
      return { error: 'job is already running' };
    }
    const claudeBin = resolveClaudeBin();
    if (!claudeBin) {
      return { error: 'Claude Code CLI not found — install it or set CLAUDE_BIN to the binary path' };
    }
    const run = {
      id: randomUUID().slice(0, 8),
      jobId: job.id,
      jobName: job.name,
      trigger, // 'cron' | 'manual'
      startedAt: Date.now(),
      endedAt: null,
      status: 'running',
      exitCode: null,
      summary: '',
    };
    runs.unshift(run);
    await persistRuns();

    const logFile = path.join(logsDir, `${run.id}.log`);
    const args = ['-p', buildPrompt(job), '--output-format', 'text',
      '--permission-mode', SCHEDULER_PERMISSION_MODE,
      '--allowedTools', SCHEDULER_ALLOWED_TOOLS,
      // curated long-term memory is draft-only for unattended runs — same
      // block as the chat runtime (Simon audit, phase 6)
      '--disallowedTools', 'Write(./memory/MEMORY.md),Edit(./memory/MEMORY.md)'];
    if (job.model) args.push('--model', job.model);

    let output = '';
    let spawnFailed = false;
    const child = spawn(claudeBin, args, {
      cwd: rootDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    running.set(job.id, child);

    const timeoutMs = (Number(job.timeoutMinutes) || 15) * 60_000;
    const timer = setTimeout(() => {
      run.status = 'timeout';
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (c) => { output += c; });
    child.stderr.on('data', (c) => { output += c; });

    child.on('error', async (err) => {
      clearTimeout(timer);
      running.delete(job.id);
      spawnFailed = true;
      run.status = 'error';
      run.endedAt = Date.now();
      run.summary = `failed to start claude CLI (${claudeBin}): ${err.message}`;
      await fsp.writeFile(logFile, run.summary + '\n', 'utf8').catch(() => {});
      await persistRuns();
      logSchedulerUsage(run, job);
    });

    child.on('close', async (code) => {
      if (spawnFailed) return;
      clearTimeout(timer);
      running.delete(job.id);
      run.endedAt = Date.now();
      run.exitCode = code;
      if (run.status === 'running') run.status = code === 0 ? 'ok' : 'error';
      run.summary = output.trim().slice(0, 400);
      await fsp.writeFile(logFile, output, 'utf8').catch(() => {});
      const stored = jobs.find((j) => j.id === job.id);
      if (stored) {
        stored.lastRun = { runId: run.id, status: run.status, at: run.startedAt };
        await persistJobs();
      }
      await persistRuns();
      logSchedulerUsage(run, job);
    });

    return { run };
  }

  function tick() {
    const now = new Date();
    const minuteKey = Math.floor(now.getTime() / 60_000);
    for (const job of jobs) {
      if (!job.enabled || running.has(job.id)) continue;
      if (lastFired.get(job.id) === minuteKey) continue;

      if (job.scheduleType === 'once') {
        if (oncePending(job) && now.getTime() >= job.runAt) {
          lastFired.set(job.id, minuteKey);
          executeJob(job, 'once')
            .then(async (result) => {
              if (result?.run) {
                job.enabled = false; // disable only after a run was created/recorded
                await persistJobs();
              }
            })
            .catch((e) => console.error('[scheduler] run failed:', e.message));
        }
        continue;
      }

      const cron = parseCron(job.schedule);
      if (cron && cronMatches(cron, now)) {
        lastFired.set(job.id, minuteKey);
        executeJob(job, 'cron').catch((e) => console.error('[scheduler] run failed:', e.message));
      }
    }
  }

  const interval = setInterval(tick, TICK_MS);
  interval.unref?.();

  return {
    listJobs: () => jobs.map(publicJob),
    listRuns: (limit = 50) => runs.slice(0, limit),
    getRunLog: async (runId) => {
      if (!/^[0-9a-f-]+$/i.test(runId)) return null;
      const file = path.join(logsDir, `${runId}.log`);
      try { return await fsp.readFile(file, 'utf8'); } catch { return null; }
    },
    async createJob(input) {
      const errors = validateJob(input);
      if (errors.length) return { errors };
      const job = {
        id: randomUUID().slice(0, 8),
        name: String(input.name).trim(),
        agent: input.agent || null,
        workflow: input.workflow || null,
        prompt: String(input.prompt),
        scheduleType: input.scheduleType === 'once' ? 'once' : 'cron',
        schedule: String(input.schedule || '').trim(),
        runAt: input.scheduleType === 'once' ? Number(input.runAt) : null,
        enabled: input.enabled !== false,
        timeoutMinutes: Number(input.timeoutMinutes ?? 15),
        model: input.model || null,
        createdAt: Date.now(),
        lastRun: null,
      };
      jobs.push(job);
      await persistJobs();
      return { job: publicJob(job) };
    },
    async updateJob(id, input) {
      const job = jobs.find((j) => j.id === id);
      if (!job) return { errors: ['job not found'] };
      const merged = { ...job, ...input, id: job.id, createdAt: job.createdAt, lastRun: job.lastRun };
      const errors = validateJob(merged);
      if (errors.length) return { errors };
      merged.name = String(merged.name).trim();
      merged.scheduleType = merged.scheduleType === 'once' ? 'once' : 'cron';
      merged.schedule = String(merged.schedule || '').trim();
      merged.runAt = merged.scheduleType === 'once' ? Number(merged.runAt) : null;
      merged.workflow = merged.workflow || null;
      merged.timeoutMinutes = Number(merged.timeoutMinutes);
      merged.enabled = Boolean(merged.enabled);
      jobs = jobs.map((j) => (j.id === id ? merged : j));
      await persistJobs();
      return { job: publicJob(merged) };
    },
    async deleteJob(id) {
      const exists = jobs.some((j) => j.id === id);
      if (!exists) return { errors: ['job not found'] };
      jobs = jobs.filter((j) => j.id !== id);
      await persistJobs();
      return { ok: true };
    },
    async deleteRun(runId) {
      if (!/^[0-9a-f-]+$/i.test(runId)) return { errors: ['run not found'] };
      const run = runs.find((r) => r.id === runId);
      if (!run) return { errors: ['run not found'] };
      if (run.status === 'running' || running.has(run.jobId)) {
        return { errors: ['run is still running'], code: 'RUN_ACTIVE' };
      }

      runs = runs.filter((r) => r.id !== runId);
      await persistRuns();

      const logFile = path.join(logsDir, `${runId}.log`);
      await fsp.unlink(logFile).catch(() => {});

      let jobsChanged = false;
      for (const job of jobs) {
        if (job.lastRun?.runId === runId) {
          job.lastRun = null;
          jobsChanged = true;
        }
      }
      if (jobsChanged) await persistJobs();
      return { ok: true };
    },
    async runNow(id) {
      const job = jobs.find((j) => j.id === id);
      if (!job) return { errors: ['job not found'] };
      const result = await executeJob(job, 'manual');
      if (result.error) return { errors: [result.error] };
      return { run: result.run };
    },
  };
}
