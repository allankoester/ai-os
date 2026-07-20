import fs from 'node:fs';
import path from 'node:path';

import {
  ensureRuntimeFilePath,
  initializeStorageKernel,
} from './storage-kernel.mjs';

const AUTHORITY_MARKER = 'scheduler.sqlite.authority.v1';

export const SCHEDULER_STORAGE_MIGRATIONS = [
  {
    version: 3001,
    name: 'scheduler_authority_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS scheduler_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        authority_mode TEXT NOT NULL DEFAULT 'legacy_pending',
        authority_marker TEXT,
        authority_activated_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scheduler_import_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_name TEXT NOT NULL,
        status TEXT NOT NULL,
        imported_count INTEGER NOT NULL DEFAULT 0,
        diagnostic TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scheduler_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        agent TEXT,
        workflow TEXT,
        prompt TEXT NOT NULL,
        schedule_type TEXT NOT NULL,
        schedule TEXT,
        run_at INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        timeout_minutes INTEGER NOT NULL,
        model TEXT,
        allowed_tools TEXT,
        meta_json TEXT,
        created_at INTEGER NOT NULL,
        last_run_id TEXT,
        last_run_status TEXT,
        last_run_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_enabled ON scheduler_jobs(enabled, schedule_type, run_at);

      CREATE TABLE IF NOT EXISTS scheduler_runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        job_name TEXT NOT NULL,
        trigger TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        status TEXT NOT NULL,
        exit_code INTEGER,
        summary TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        lease_owner TEXT,
        lease_expires_at INTEGER,
        terminal_at INTEGER,
        FOREIGN KEY(job_id) REFERENCES scheduler_jobs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_scheduler_runs_job_started ON scheduler_runs(job_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scheduler_runs_status_lease ON scheduler_runs(status, lease_expires_at);

      CREATE TABLE IF NOT EXISTS scheduler_events (
        event_id TEXT PRIMARY KEY,
        run_id TEXT,
        job_id TEXT NOT NULL,
        type TEXT NOT NULL,
        trigger TEXT,
        meta_json TEXT,
        summary TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scheduler_events_created ON scheduler_events(created_at DESC);

      CREATE TABLE IF NOT EXISTS scheduler_callback_outbox (
        event_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        delivery_state TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER,
        FOREIGN KEY(event_id) REFERENCES scheduler_events(event_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_scheduler_callback_outbox_due
        ON scheduler_callback_outbox(delivery_state, next_attempt_at, created_at);
    `,
  },
];

function parseJsonSafe(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readLegacyJsonStrict(filePath, validator) {
  const sourceName = path.join('scheduler', path.basename(String(filePath || '')));
  if (!fs.existsSync(filePath)) {
    return { present: false, rows: [] };
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    const error = new Error(`legacy scheduler import failed: cannot read ${filePath}: ${err?.message || err}`);
    error.code = 'scheduler_legacy_malformed';
    error.diagnostic = { source: sourceName, reason: 'read_failed' };
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const error = new Error(`legacy scheduler import failed: malformed JSON in ${filePath}: ${err?.message || err}`);
    error.code = 'scheduler_legacy_malformed';
    error.diagnostic = { source: sourceName, reason: 'malformed_json' };
    throw error;
  }
  if (!Array.isArray(parsed)) {
    const error = new Error(`legacy scheduler import failed: expected array in ${filePath}`);
    error.code = 'scheduler_legacy_malformed';
    error.diagnostic = { source: sourceName, reason: 'invalid_shape' };
    throw error;
  }
  for (let i = 0; i < parsed.length; i += 1) {
    const row = parsed[i];
    if (!validator(row)) {
      const error = new Error(`legacy scheduler import failed: invalid row at ${filePath}#${i + 1}`);
      error.code = 'scheduler_legacy_malformed';
      error.diagnostic = { source: sourceName, reason: 'invalid_row', rowIndex: i + 1 };
      throw error;
    }
  }
  return { present: true, rows: parsed };
}

function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  if (process.platform !== 'win32') {
    try { fs.chmodSync(filePath, 0o600); } catch {}
  }
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    throw err;
  }
}

function rowToJob(row) {
  if (!row) return null;
  const meta = row.meta_json ? parseJsonSafe(row.meta_json, null) : null;
  return {
    id: row.id,
    name: row.name,
    agent: row.agent || null,
    workflow: row.workflow || null,
    prompt: row.prompt,
    scheduleType: row.schedule_type,
    schedule: row.schedule || '',
    runAt: row.run_at === null || row.run_at === undefined ? null : Number(row.run_at),
    enabled: Number(row.enabled) === 1,
    timeoutMinutes: Number(row.timeout_minutes),
    model: row.model || null,
    allowedTools: row.allowed_tools || null,
    meta,
    createdAt: Number(row.created_at),
    lastRun: row.last_run_id
      ? {
        runId: row.last_run_id,
        status: row.last_run_status || null,
        at: row.last_run_at === null || row.last_run_at === undefined ? null : Number(row.last_run_at),
      }
      : null,
  };
}

function rowToRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    jobName: row.job_name,
    trigger: row.trigger,
    startedAt: Number(row.started_at),
    endedAt: row.ended_at === null || row.ended_at === undefined ? null : Number(row.ended_at),
    status: row.status,
    exitCode: row.exit_code === null || row.exit_code === undefined ? null : Number(row.exit_code),
    summary: row.summary || '',
  };
}

function toEventPayload(event) {
  return {
    type: event.type,
    runId: event.runId || null,
    jobId: event.jobId,
    trigger: event.trigger || null,
    meta: event.meta ?? null,
    summary: String(event.summary || ''),
  };
}

function normalizeLegacyJob(row) {
  return {
    id: String(row.id),
    name: String(row.name),
    agent: row.agent || null,
    workflow: row.workflow || null,
    prompt: String(row.prompt),
    schedule_type: row.scheduleType === 'once' ? 'once' : 'cron',
    schedule: String(row.schedule || ''),
    run_at: row.scheduleType === 'once' ? Number(row.runAt) : null,
    enabled: row.enabled === false ? 0 : 1,
    timeout_minutes: Number(row.timeoutMinutes ?? 15),
    model: row.model || null,
    allowed_tools: row.allowedTools || null,
    meta_json: row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta) ? JSON.stringify(row.meta) : null,
    created_at: Number(row.createdAt) || Date.now(),
    last_run_id: row.lastRun?.runId || null,
    last_run_status: row.lastRun?.status || null,
    last_run_at: Number(row.lastRun?.at) || null,
  };
}

function normalizeLegacyRun(row) {
  return {
    id: String(row.id),
    job_id: String(row.jobId),
    job_name: String(row.jobName || ''),
    trigger: String(row.trigger || 'manual'),
    started_at: Number(row.startedAt),
    ended_at: row.endedAt === null || row.endedAt === undefined ? null : Number(row.endedAt),
    status: String(row.status || 'error'),
    exit_code: row.exitCode === null || row.exitCode === undefined ? null : Number(row.exitCode),
    summary: String(row.summary || ''),
    created_at: Number(row.startedAt) || Date.now(),
    lease_owner: null,
    lease_expires_at: null,
    terminal_at: row.endedAt === null || row.endedAt === undefined ? null : Number(row.endedAt),
  };
}

function isValidLegacyJob(row) {
  return Boolean(
    row
    && typeof row.id === 'string'
    && typeof row.name === 'string'
    && typeof row.prompt === 'string'
    && ['once', 'cron'].includes(row.scheduleType)
    && typeof row.enabled === 'boolean'
    && Number.isFinite(Number(row.timeoutMinutes)),
  );
}

function isValidLegacyRun(row) {
  return Boolean(
    row
    && typeof row.id === 'string'
    && typeof row.jobId === 'string'
    && typeof row.status === 'string'
    && Number.isFinite(Number(row.startedAt))
    && typeof row.summary === 'string',
  );
}

export function createSchedulerStorage({
  workspaceRoot,
  legacyJobsFile,
  legacyRunsFile,
  compatibilityJobsFile,
  compatibilityRunsFile,
  maxRunsKept = 200,
  testRootOverride = null,
} = {}) {
  const kernel = initializeStorageKernel({
    workspaceRoot,
    component: 'interface',
    testRootOverride,
    migrations: SCHEDULER_STORAGE_MIGRATIONS,
  });
  const { db } = kernel;
  const canonicalCompatibilityJobsFile = compatibilityJobsFile
    || path.join(kernel.runtimeRoot, 'compat', 'scheduler', 'jobs.json');
  const canonicalCompatibilityRunsFile = compatibilityRunsFile
    || path.join(kernel.runtimeRoot, 'compat', 'scheduler', 'runs.json');

  db.prepare(`
    INSERT INTO scheduler_state (id, authority_mode, authority_marker, authority_activated_at, created_at, updated_at)
    VALUES (1, 'legacy_pending', NULL, NULL, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(Date.now(), Date.now());

  function appendImportLedger(sourceName, status, importedCount, diagnostic = null) {
    db.prepare(`
      INSERT INTO scheduler_import_ledger (source_name, status, imported_count, diagnostic, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(sourceName, status, Number(importedCount) || 0, diagnostic ? JSON.stringify(diagnostic) : null, Date.now());
  }

  function enforceAuthorityCutover() {
    const state = db.prepare('SELECT authority_mode FROM scheduler_state WHERE id = 1').get();
    if (state?.authority_mode === 'sqlite_active') return;

    let legacyJobs;
    let legacyRuns;
    try {
      legacyJobs = readLegacyJsonStrict(legacyJobsFile, isValidLegacyJob);
      legacyRuns = readLegacyJsonStrict(legacyRunsFile, isValidLegacyRun);
    } catch (err) {
      appendImportLedger('scheduler/jobs.json', 'failed', 0, err?.diagnostic || { reason: 'unknown' });
      appendImportLedger('scheduler/runs.json', 'failed', 0, err?.diagnostic || { reason: 'unknown' });
      throw err;
    }

    transaction(db, () => {
      const insertJob = db.prepare(`
        INSERT OR REPLACE INTO scheduler_jobs (
          id, name, agent, workflow, prompt, schedule_type, schedule, run_at,
          enabled, timeout_minutes, model, allowed_tools, meta_json, created_at,
          last_run_id, last_run_status, last_run_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertRun = db.prepare(`
        INSERT OR REPLACE INTO scheduler_runs (
          id, job_id, job_name, trigger, started_at, ended_at, status, exit_code,
          summary, created_at, lease_owner, lease_expires_at, terminal_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const raw of legacyJobs.rows) {
        const row = normalizeLegacyJob(raw);
        insertJob.run(
          row.id,
          row.name,
          row.agent,
          row.workflow,
          row.prompt,
          row.schedule_type,
          row.schedule,
          row.run_at,
          row.enabled,
          row.timeout_minutes,
          row.model,
          row.allowed_tools,
          row.meta_json,
          row.created_at,
          row.last_run_id,
          row.last_run_status,
          row.last_run_at,
        );
      }

      for (const raw of legacyRuns.rows.slice(0, maxRunsKept)) {
        const row = normalizeLegacyRun(raw);
        const jobExists = db.prepare('SELECT id FROM scheduler_jobs WHERE id = ?').get(row.job_id);
        if (!jobExists?.id) continue;
        insertRun.run(
          row.id,
          row.job_id,
          row.job_name,
          row.trigger,
          row.started_at,
          row.ended_at,
          row.status,
          row.exit_code,
          row.summary,
          row.created_at,
          row.lease_owner,
          row.lease_expires_at,
          row.terminal_at,
        );
      }

      db.prepare(`
        INSERT INTO scheduler_import_ledger (source_name, status, imported_count, diagnostic, created_at)
        VALUES (?, ?, ?, NULL, ?)
      `).run('scheduler/jobs.json', legacyJobs.present ? 'imported' : 'missing', legacyJobs.rows.length, Date.now());

      db.prepare(`
        INSERT INTO scheduler_import_ledger (source_name, status, imported_count, diagnostic, created_at)
        VALUES (?, ?, ?, NULL, ?)
      `).run('scheduler/runs.json', legacyRuns.present ? 'imported' : 'missing', legacyRuns.rows.length, Date.now());

      db.prepare(`
        UPDATE scheduler_state
        SET authority_mode = 'sqlite_active',
            authority_marker = ?,
            authority_activated_at = ?,
            updated_at = ?
        WHERE id = 1
      `).run(AUTHORITY_MARKER, Date.now(), Date.now());
    });
  }

  enforceAuthorityCutover();

  function assertAuthorityActive() {
    const row = db.prepare('SELECT authority_mode, authority_marker FROM scheduler_state WHERE id = 1').get();
    if (row?.authority_mode !== 'sqlite_active' || row?.authority_marker !== AUTHORITY_MARKER) {
      const err = new Error('scheduler authority is not active');
      err.code = 'scheduler_authority_inactive';
      throw err;
    }
  }

  function listJobs() {
    assertAuthorityActive();
    return db.prepare('SELECT * FROM scheduler_jobs ORDER BY created_at ASC').all().map(rowToJob);
  }

  function listRuns(limit = 50) {
    assertAuthorityActive();
    const bounded = Math.max(1, Math.min(2000, Number(limit) || 50));
    return db.prepare('SELECT * FROM scheduler_runs ORDER BY started_at DESC, created_at DESC LIMIT ?').all(bounded).map(rowToRun);
  }

  function getJob(id) {
    assertAuthorityActive();
    return rowToJob(db.prepare('SELECT * FROM scheduler_jobs WHERE id = ?').get(id));
  }

  function getRun(runId) {
    assertAuthorityActive();
    return rowToRun(db.prepare('SELECT * FROM scheduler_runs WHERE id = ?').get(runId));
  }

  function createJob(job) {
    assertAuthorityActive();
    db.prepare(`
      INSERT INTO scheduler_jobs (
        id, name, agent, workflow, prompt, schedule_type, schedule, run_at,
        enabled, timeout_minutes, model, allowed_tools, meta_json, created_at,
        last_run_id, last_run_status, last_run_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.id,
      job.name,
      job.agent || null,
      job.workflow || null,
      job.prompt,
      job.scheduleType,
      job.schedule,
      job.runAt,
      job.enabled ? 1 : 0,
      Number(job.timeoutMinutes),
      job.model || null,
      job.allowedTools || null,
      job.meta ? JSON.stringify(job.meta) : null,
      Number(job.createdAt),
      null,
      null,
      null,
    );
    return getJob(job.id);
  }

  function updateJob(id, job) {
    assertAuthorityActive();
    db.prepare(`
      UPDATE scheduler_jobs
      SET name = ?,
          agent = ?,
          workflow = ?,
          prompt = ?,
          schedule_type = ?,
          schedule = ?,
          run_at = ?,
          enabled = ?,
          timeout_minutes = ?,
          model = ?,
          allowed_tools = ?,
          meta_json = ?
      WHERE id = ?
    `).run(
      job.name,
      job.agent || null,
      job.workflow || null,
      job.prompt,
      job.scheduleType,
      job.schedule,
      job.runAt,
      job.enabled ? 1 : 0,
      Number(job.timeoutMinutes),
      job.model || null,
      job.allowedTools || null,
      job.meta ? JSON.stringify(job.meta) : null,
      id,
    );
    return getJob(id);
  }

  function deleteJob(id) {
    assertAuthorityActive();
    const result = db.prepare('DELETE FROM scheduler_jobs WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }

  function trimRunsAndLogs({ logsDir }) {
    const stale = db.prepare(`
      SELECT id FROM scheduler_runs
      ORDER BY started_at DESC, created_at DESC
      LIMIT -1 OFFSET ?
    `).all(maxRunsKept);
    if (!stale.length) return;
    const deleteRunStmt = db.prepare('DELETE FROM scheduler_runs WHERE id = ?');
    for (const row of stale) {
      deleteRunStmt.run(row.id);
      if (logsDir) {
        try { fs.rmSync(path.join(logsDir, `${row.id}.log`), { force: true }); } catch {}
      }
    }
  }

  function insertEventTx(event, now = Date.now()) {
    const payload = toEventPayload(event);
    db.prepare(`
      INSERT INTO scheduler_events (event_id, run_id, job_id, type, trigger, meta_json, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      payload.runId,
      payload.jobId,
      payload.type,
      payload.trigger,
      payload.meta ? JSON.stringify(payload.meta) : null,
      payload.summary,
      now,
    );

    db.prepare(`
      INSERT INTO scheduler_callback_outbox (
        event_id, payload_json, delivery_state, attempts, next_attempt_at, last_error, created_at, delivered_at
      ) VALUES (?, ?, 'pending', 0, ?, NULL, ?, NULL)
    `).run(event.eventId, JSON.stringify(payload), now, now);
  }

  function enqueueEvent(event) {
    assertAuthorityActive();
    transaction(db, () => {
      insertEventTx(event, Date.now());
    });
  }

  function createRunWithQueuedEvent({ run, leaseOwner, leaseExpiresAt, eventId, meta }) {
    assertAuthorityActive();
    return transaction(db, () => {
      const active = db.prepare(`
        SELECT id FROM scheduler_runs
        WHERE job_id = ? AND status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at > ?
        LIMIT 1
      `).get(run.jobId, Date.now());
      if (active?.id) return null;

      db.prepare(`
        INSERT INTO scheduler_runs (
          id, job_id, job_name, trigger, started_at, ended_at, status, exit_code,
          summary, created_at, lease_owner, lease_expires_at, terminal_at
        ) VALUES (?, ?, ?, ?, ?, NULL, 'running', NULL, '', ?, ?, ?, NULL)
      `).run(
        run.id,
        run.jobId,
        run.jobName,
        run.trigger,
        run.startedAt,
        run.startedAt,
        leaseOwner,
        leaseExpiresAt,
      );

      db.prepare(`
        UPDATE scheduler_jobs
        SET last_run_id = ?, last_run_status = 'running', last_run_at = ?
        WHERE id = ?
      `).run(run.id, run.startedAt, run.jobId);

      insertEventTx({
        eventId,
        type: 'queued',
        runId: run.id,
        jobId: run.jobId,
        trigger: run.trigger,
        meta,
        summary: '',
      }, run.startedAt);

      return getRun(run.id);
    });
  }

  function heartbeatRunLease({ runId, leaseOwner, leaseExpiresAt }) {
    assertAuthorityActive();
    const result = db.prepare(`
      UPDATE scheduler_runs
      SET lease_expires_at = ?
      WHERE id = ? AND status = 'running' AND lease_owner = ?
    `).run(leaseExpiresAt, runId, leaseOwner);
    return Number(result.changes) > 0;
  }

  function markRunTerminalWithEvent({ runId, status, endedAt, exitCode, summary, eventId, meta }) {
    assertAuthorityActive();
    return transaction(db, () => {
      const row = db.prepare('SELECT id, job_id, trigger, terminal_at FROM scheduler_runs WHERE id = ?').get(runId);
      if (!row) return { notFound: true };
      if (row.terminal_at !== null && row.terminal_at !== undefined) {
        return { alreadyTerminal: true, run: getRun(runId) };
      }

      db.prepare(`
        UPDATE scheduler_runs
        SET status = ?, ended_at = ?, exit_code = ?, summary = ?,
            lease_owner = NULL, lease_expires_at = NULL, terminal_at = ?
        WHERE id = ?
      `).run(status, endedAt, exitCode, summary, endedAt, runId);

      db.prepare(`
        UPDATE scheduler_jobs
        SET last_run_id = ?, last_run_status = ?, last_run_at = ?
        WHERE id = ?
      `).run(runId, status, endedAt, row.job_id);

      insertEventTx({
        eventId,
        type: status,
        runId,
        jobId: row.job_id,
        trigger: row.trigger,
        meta,
        summary,
      }, endedAt);

      return { run: getRun(runId) };
    });
  }

  function markRunCancelled({ runId, eventId, meta, summary = '' }) {
    assertAuthorityActive();
    return markRunTerminalWithEvent({
      runId,
      status: 'cancelled',
      endedAt: Date.now(),
      exitCode: null,
      summary,
      eventId,
      meta,
    });
  }

  function markRunStartedEvent({ runId, eventId, meta }) {
    assertAuthorityActive();
    const row = db.prepare('SELECT id, job_id, trigger FROM scheduler_runs WHERE id = ?').get(runId);
    if (!row) return false;
    transaction(db, () => {
      insertEventTx({
        eventId,
        type: 'started',
        runId,
        jobId: row.job_id,
        trigger: row.trigger,
        meta,
        summary: '',
      }, Date.now());
    });
    return true;
  }

  function setJobEnabled(id, enabled) {
    assertAuthorityActive();
    db.prepare('UPDATE scheduler_jobs SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
    return getJob(id);
  }

  function listPendingCallbacks({ now = Date.now(), limit = 10 } = {}) {
    assertAuthorityActive();
    const bounded = Math.max(1, Math.min(200, Number(limit) || 10));
    return db.prepare(`
      SELECT event_id, payload_json, attempts
      FROM scheduler_callback_outbox
      WHERE delivery_state = 'pending' AND next_attempt_at <= ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(now, bounded).map((row) => ({
      eventId: row.event_id,
      payload: parseJsonSafe(row.payload_json, null),
      attempts: Number(row.attempts) || 0,
    }));
  }

  function markCallbackDelivered(eventId, now = Date.now()) {
    assertAuthorityActive();
    db.prepare(`
      UPDATE scheduler_callback_outbox
      SET delivery_state = 'delivered', delivered_at = ?, last_error = NULL
      WHERE event_id = ?
    `).run(now, eventId);
  }

  function markCallbackFailed(eventId, errorMessage, nextAttemptAt) {
    assertAuthorityActive();
    db.prepare(`
      UPDATE scheduler_callback_outbox
      SET attempts = attempts + 1,
          last_error = ?,
          next_attempt_at = ?,
          delivery_state = 'pending'
      WHERE event_id = ?
    `).run(String(errorMessage || 'callback_failed').slice(0, 500), nextAttemptAt, eventId);
  }

  function recoverInterruptedRuns() {
    assertAuthorityActive();
    const now = Date.now();
    return transaction(db, () => {
      const rows = db.prepare(`
        SELECT id, job_id, trigger
        FROM scheduler_runs
        WHERE status = 'running'
      `).all();
      for (const row of rows) {
        const summary = 'scheduler process restarted while run was active';
        db.prepare(`
          UPDATE scheduler_runs
          SET status = 'interrupted', ended_at = ?, summary = ?, lease_owner = NULL,
              lease_expires_at = NULL, terminal_at = ?
          WHERE id = ?
        `).run(now, summary, now, row.id);

        db.prepare(`
          UPDATE scheduler_jobs
          SET last_run_id = ?, last_run_status = 'interrupted', last_run_at = ?
          WHERE id = ?
        `).run(row.id, now, row.job_id);

        insertEventTx({
          eventId: `evt_${row.id}_interrupted_${now}`,
          type: 'error',
          runId: row.id,
          jobId: row.job_id,
          trigger: row.trigger,
          meta: null,
          summary,
        }, now);
      }
      return rows.length;
    });
  }

  function deleteRun(runId) {
    assertAuthorityActive();
    return transaction(db, () => {
      const row = db.prepare('SELECT id, job_id, status FROM scheduler_runs WHERE id = ?').get(runId);
      if (!row) return { notFound: true };
      if (row.status === 'running') return { active: true };

      db.prepare('DELETE FROM scheduler_runs WHERE id = ?').run(runId);
      db.prepare(`
        UPDATE scheduler_jobs
        SET last_run_id = NULL, last_run_status = NULL, last_run_at = NULL
        WHERE id = ? AND last_run_id = ?
      `).run(row.job_id, runId);
      return { ok: true };
    });
  }

  function exportCompatibilityFiles() {
    assertAuthorityActive();
    const jobs = listJobs();
    const runs = listRuns(maxRunsKept);
    const safeJobsFile = ensureRuntimeFilePath({
      runtimeRoot: kernel.runtimeRoot,
      relativePath: path.relative(kernel.runtimeRoot, canonicalCompatibilityJobsFile),
      createIfMissing: true,
      code: 'unsafe_scheduler_compat_path',
    });
    const safeRunsFile = ensureRuntimeFilePath({
      runtimeRoot: kernel.runtimeRoot,
      relativePath: path.relative(kernel.runtimeRoot, canonicalCompatibilityRunsFile),
      createIfMissing: true,
      code: 'unsafe_scheduler_compat_path',
    });
    writeJsonAtomic(safeJobsFile, jobs);
    writeJsonAtomic(safeRunsFile, runs);
  }

  function getAuthorityState() {
    const row = db.prepare('SELECT authority_mode, authority_marker, authority_activated_at FROM scheduler_state WHERE id = 1').get();
    return {
      mode: row?.authority_mode || null,
      marker: row?.authority_marker || null,
      activatedAt: row?.authority_activated_at ? Number(row.authority_activated_at) : null,
    };
  }

  return {
    runtimeRoot: kernel.runtimeRoot,
    dbPath: kernel.dbPath,
    db,
    authorityMarker: AUTHORITY_MARKER,
    getAuthorityState,
    listJobs,
    listRuns,
    getJob,
    getRun,
    createJob,
    updateJob,
    deleteJob,
    createRunWithQueuedEvent,
    markRunStartedEvent,
    heartbeatRunLease,
    markRunTerminalWithEvent,
    markRunCancelled,
    enqueueEvent,
    setJobEnabled,
    listPendingCallbacks,
    markCallbackDelivered,
    markCallbackFailed,
    recoverInterruptedRuns,
    deleteRun,
    trimRunsAndLogs,
    exportCompatibilityFiles,
  };
}
