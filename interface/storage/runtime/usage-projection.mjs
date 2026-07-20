import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { initializeStorageKernel } from './storage-kernel.mjs';

const CANONICAL_SOURCE_NAME = 'runs/usage.jsonl';

export const USAGE_PROJECTION_MIGRATIONS = [
  {
    version: 2001,
    name: 'usage_projection_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS usage_projection_events (
        event_id TEXT PRIMARY KEY,
        source_name TEXT NOT NULL,
        line_number INTEGER NOT NULL,
        byte_offset INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        source TEXT,
        timestamp TEXT,
        session_id TEXT,
        selected_agent TEXT,
        mode TEXT,
        model TEXT,
        duration_ms REAL NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        num_turns REAL NOT NULL DEFAULT 0,
        input_tokens REAL NOT NULL DEFAULT 0,
        output_tokens REAL NOT NULL DEFAULT 0,
        cache_creation_input_tokens REAL NOT NULL DEFAULT 0,
        cache_read_input_tokens REAL NOT NULL DEFAULT 0,
        total_tokens REAL NOT NULL DEFAULT 0,
        is_error INTEGER NOT NULL DEFAULT 0,
        status TEXT,
        run_id TEXT,
        job_id TEXT,
        job_name TEXT,
        incognito INTEGER NOT NULL DEFAULT 0,
        ingested_at TEXT NOT NULL,
        UNIQUE(source_name, byte_offset, content_hash)
      );

      CREATE INDEX IF NOT EXISTS idx_usage_projection_events_timestamp ON usage_projection_events(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_usage_projection_events_source ON usage_projection_events(source);

      CREATE TABLE IF NOT EXISTS usage_projection_quarantine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_name TEXT NOT NULL,
        line_number INTEGER NOT NULL,
        byte_offset INTEGER NOT NULL,
        content_hash TEXT,
        reason TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_usage_projection_quarantine_reason ON usage_projection_quarantine(reason);

      CREATE TABLE IF NOT EXISTS usage_projection_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_rebuild_at TEXT,
        projected_event_count INTEGER NOT NULL DEFAULT 0,
        quarantined_line_count INTEGER NOT NULL DEFAULT 0,
        malformed_line_count INTEGER NOT NULL DEFAULT 0,
        blank_line_count INTEGER NOT NULL DEFAULT 0,
        event_id_digest TEXT
      );
    `,
  },
];

function hashSha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeUsageEntry(raw) {
  const entry = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    source: entry.source || 'chat',
    timestamp: entry.timestamp || null,
    session_id: entry.session_id || null,
    selected_agent: entry.selected_agent || null,
    mode: entry.mode || null,
    model: entry.model || null,
    duration_ms: toNumber(entry.duration_ms),
    cost_usd: toNumber(entry.cost_usd),
    num_turns: toNumber(entry.num_turns),
    input_tokens: toNumber(entry.input_tokens),
    output_tokens: toNumber(entry.output_tokens),
    cache_creation_input_tokens: toNumber(entry.cache_creation_input_tokens),
    cache_read_input_tokens: toNumber(entry.cache_read_input_tokens),
    total_tokens: toNumber(entry.total_tokens),
    is_error: Boolean(entry.is_error),
    status: entry.status || null,
    run_id: entry.run_id || entry.runId || null,
    job_id: entry.job_id || entry.jobId || null,
    job_name: entry.job_name || entry.jobName || null,
    incognito: Boolean(entry.incognito),
  };
}

function parseUsageJsonlWithDiagnostics({ filePath, sourceName = CANONICAL_SOURCE_NAME } = {}) {
  if (!fs.existsSync(filePath)) {
    return {
      entries: [],
      diagnostics: {
        source: sourceName,
        filePresent: false,
        totalLines: 0,
        projectedLineCount: 0,
        quarantinedLineCount: 0,
        malformedLineCount: 0,
        blankLineCount: 0,
      },
    };
  }

  const buf = fs.readFileSync(filePath);
  const entries = [];
  const quarantined = [];
  let totalLines = 0;
  let malformedLineCount = 0;
  let blankLineCount = 0;

  const processLine = (start, end) => {
    totalLines += 1;
    const lineNumber = totalLines;
    const rawBuffer = buf.subarray(start, end);
    const raw = rawBuffer.toString('utf8');
    const contentHash = hashSha256(rawBuffer);

    if (!raw.trim()) {
      blankLineCount += 1;
      quarantined.push({
        source_name: sourceName,
        line_number: lineNumber,
        byte_offset: start,
        content_hash: contentHash,
        reason: 'blank_line',
      });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      malformedLineCount += 1;
      quarantined.push({
        source_name: sourceName,
        line_number: lineNumber,
        byte_offset: start,
        content_hash: contentHash,
        reason: 'malformed_json',
      });
      return;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      malformedLineCount += 1;
      quarantined.push({
        source_name: sourceName,
        line_number: lineNumber,
        byte_offset: start,
        content_hash: contentHash,
        reason: 'invalid_shape',
      });
      return;
    }

    const normalized = normalizeUsageEntry(parsed);
    const eventId = hashSha256(`${sourceName}:${start}:${contentHash}`);
    entries.push({
      event_id: eventId,
      source_name: sourceName,
      line_number: lineNumber,
      byte_offset: start,
      content_hash: contentHash,
      ...normalized,
    });
  };

  let start = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] !== 0x0a) continue;
    let end = i;
    if (end > start && buf[end - 1] === 0x0d) end -= 1;
    processLine(start, end);
    start = i + 1;
  }
  if (start < buf.length) {
    processLine(start, buf.length);
  }

  return {
    entries,
    quarantined,
    diagnostics: {
      source: sourceName,
      filePresent: true,
      totalLines,
      projectedLineCount: entries.length,
      quarantinedLineCount: quarantined.length,
      malformedLineCount,
      blankLineCount,
    },
  };
}

function summarizeUsageEntries(entries) {
  const summary = {
    count: 0,
    sessions: 0,
    total_cost_usd: 0,
    total_duration_ms: 0,
    total_turns: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    total_tokens: 0,
    errors: 0,
    sources: {},
  };
  const sessions = new Set();
  for (const entry of entries) {
    summary.count += 1;
    if (entry.session_id) sessions.add(entry.session_id);
    summary.total_cost_usd += toNumber(entry.cost_usd);
    summary.total_duration_ms += toNumber(entry.duration_ms);
    summary.total_turns += toNumber(entry.num_turns);
    summary.input_tokens += toNumber(entry.input_tokens);
    summary.output_tokens += toNumber(entry.output_tokens);
    summary.cache_creation_input_tokens += toNumber(entry.cache_creation_input_tokens);
    summary.cache_read_input_tokens += toNumber(entry.cache_read_input_tokens);
    summary.total_tokens += toNumber(entry.total_tokens);
    if (entry.is_error) summary.errors += 1;
    const src = entry.source || 'chat';
    summary.sources[src] = (summary.sources[src] || 0) + 1;
  }
  summary.sessions = sessions.size;
  return summary;
}

function aggregateProjectionFromDb(db) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS count,
      COUNT(DISTINCT CASE WHEN session_id IS NOT NULL AND session_id <> '' THEN session_id END) AS sessions,
      COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
      COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
      COALESCE(SUM(num_turns), 0) AS total_turns,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cache_creation_input_tokens), 0) AS cache_creation_input_tokens,
      COALESCE(SUM(cache_read_input_tokens), 0) AS cache_read_input_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END), 0) AS errors
    FROM usage_projection_events
  `).get();

  const sourceRows = db.prepare(`
    SELECT source, COUNT(*) AS count
    FROM usage_projection_events
    GROUP BY source
  `).all();

  const sources = {};
  for (const srcRow of sourceRows) {
    const source = srcRow.source || 'chat';
    sources[source] = Number(srcRow.count) || 0;
  }

  return {
    count: Number(row.count) || 0,
    sessions: Number(row.sessions) || 0,
    total_cost_usd: Number(row.total_cost_usd) || 0,
    total_duration_ms: Number(row.total_duration_ms) || 0,
    total_turns: Number(row.total_turns) || 0,
    input_tokens: Number(row.input_tokens) || 0,
    output_tokens: Number(row.output_tokens) || 0,
    cache_creation_input_tokens: Number(row.cache_creation_input_tokens) || 0,
    cache_read_input_tokens: Number(row.cache_read_input_tokens) || 0,
    total_tokens: Number(row.total_tokens) || 0,
    errors: Number(row.errors) || 0,
    sources,
  };
}

function compareSummaries(projected, scanned) {
  const mismatches = [];
  for (const key of [
    'count',
    'sessions',
    'total_cost_usd',
    'total_duration_ms',
    'total_turns',
    'input_tokens',
    'output_tokens',
    'cache_creation_input_tokens',
    'cache_read_input_tokens',
    'total_tokens',
    'errors',
  ]) {
    if (toNumber(projected[key]) !== toNumber(scanned[key])) mismatches.push(key);
  }

  const projectedSources = projected.sources || {};
  const scannedSources = scanned.sources || {};
  const sourceNames = new Set([...Object.keys(projectedSources), ...Object.keys(scannedSources)]);
  for (const source of sourceNames) {
    if ((projectedSources[source] || 0) !== (scannedSources[source] || 0)) {
      mismatches.push(`sources.${source}`);
    }
  }

  return {
    matches: mismatches.length === 0,
    mismatches,
  };
}

function buildSafeFailure(err) {
  return {
    ready: false,
    reason: err?.code || 'usage_projection_failed',
    issues: Array.isArray(err?.issues) ? err.issues : [],
  };
}

export function rebuildUsageProjectionShadow({ workspaceRoot, canonicalUsageLogPath, testRootOverride = null } = {}) {
  const scan = parseUsageJsonlWithDiagnostics({
    filePath: canonicalUsageLogPath,
    sourceName: CANONICAL_SOURCE_NAME,
  });
  const scannedSummary = summarizeUsageEntries(scan.entries);

  let kernel;
  try {
    kernel = initializeStorageKernel({
      workspaceRoot,
      component: 'interface',
      testRootOverride,
      migrations: USAGE_PROJECTION_MIGRATIONS,
    });
    const { db } = kernel;

    const insertEvent = db.prepare(`
      INSERT INTO usage_projection_events (
        event_id,
        source_name,
        line_number,
        byte_offset,
        content_hash,
        source,
        timestamp,
        session_id,
        selected_agent,
        mode,
        model,
        duration_ms,
        cost_usd,
        num_turns,
        input_tokens,
        output_tokens,
        cache_creation_input_tokens,
        cache_read_input_tokens,
        total_tokens,
        is_error,
        status,
        run_id,
        job_id,
        job_name,
        incognito,
        ingested_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertQuarantine = db.prepare(`
      INSERT INTO usage_projection_quarantine (
        source_name,
        line_number,
        byte_offset,
        content_hash,
        reason,
        captured_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec('DELETE FROM usage_projection_events;');
      db.exec('DELETE FROM usage_projection_quarantine;');

      for (const entry of scan.entries) {
        insertEvent.run(
          entry.event_id,
          entry.source_name,
          entry.line_number,
          entry.byte_offset,
          entry.content_hash,
          entry.source,
          entry.timestamp,
          entry.session_id,
          entry.selected_agent,
          entry.mode,
          entry.model,
          entry.duration_ms,
          entry.cost_usd,
          entry.num_turns,
          entry.input_tokens,
          entry.output_tokens,
          entry.cache_creation_input_tokens,
          entry.cache_read_input_tokens,
          entry.total_tokens,
          entry.is_error ? 1 : 0,
          entry.status,
          entry.run_id,
          entry.job_id,
          entry.job_name,
          entry.incognito ? 1 : 0,
          now,
        );
      }

      for (const bad of scan.quarantined || []) {
        insertQuarantine.run(
          bad.source_name,
          bad.line_number,
          bad.byte_offset,
          bad.content_hash || null,
          bad.reason,
          now,
        );
      }

      const eventIdRows = db.prepare('SELECT event_id FROM usage_projection_events ORDER BY event_id ASC').all();
      const eventIdDigest = hashSha256(eventIdRows.map((row) => row.event_id).join('\n'));

      db.prepare(`
        INSERT INTO usage_projection_state (
          id,
          last_rebuild_at,
          projected_event_count,
          quarantined_line_count,
          malformed_line_count,
          blank_line_count,
          event_id_digest
        ) VALUES (1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          last_rebuild_at = excluded.last_rebuild_at,
          projected_event_count = excluded.projected_event_count,
          quarantined_line_count = excluded.quarantined_line_count,
          malformed_line_count = excluded.malformed_line_count,
          blank_line_count = excluded.blank_line_count,
          event_id_digest = excluded.event_id_digest
      `).run(
        now,
        scan.entries.length,
        (scan.quarantined || []).length,
        scan.diagnostics.malformedLineCount,
        scan.diagnostics.blankLineCount,
        eventIdDigest,
      );

      db.exec('COMMIT;');
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch {}
      throw err;
    }

    const projectedSummary = aggregateProjectionFromDb(db);
    const state = db.prepare(`
      SELECT
        last_rebuild_at,
        projected_event_count,
        quarantined_line_count,
        malformed_line_count,
        blank_line_count,
        event_id_digest
      FROM usage_projection_state
      WHERE id = 1
    `).get();

    return {
      ready: true,
      summary: projectedSummary,
      scanDiagnostics: scan.diagnostics,
      projectionState: {
        lastRebuildAt: state?.last_rebuild_at || null,
        projectedEventCount: Number(state?.projected_event_count) || 0,
        quarantinedLineCount: Number(state?.quarantined_line_count) || 0,
        malformedLineCount: Number(state?.malformed_line_count) || 0,
        blankLineCount: Number(state?.blank_line_count) || 0,
        eventIdDigest: state?.event_id_digest || null,
      },
      parity: compareSummaries(projectedSummary, scannedSummary),
    };
  } catch (err) {
    return buildSafeFailure(err);
  } finally {
    try { kernel?.db?.close(); } catch {}
  }
}

export function getUsageProjectionHealth({ workspaceRoot, testRootOverride = null } = {}) {
  let kernel;
  try {
    kernel = initializeStorageKernel({
      workspaceRoot,
      component: 'interface',
      testRootOverride,
      migrations: USAGE_PROJECTION_MIGRATIONS,
    });
    const row = kernel.db.prepare(`
      SELECT
        last_rebuild_at,
        projected_event_count,
        quarantined_line_count,
        malformed_line_count,
        blank_line_count
      FROM usage_projection_state
      WHERE id = 1
    `).get();

    return {
      enabled: true,
      ready: true,
      state: {
        lastRebuildAt: row?.last_rebuild_at || null,
        projectedEventCount: Number(row?.projected_event_count) || 0,
        quarantinedLineCount: Number(row?.quarantined_line_count) || 0,
        malformedLineCount: Number(row?.malformed_line_count) || 0,
        blankLineCount: Number(row?.blank_line_count) || 0,
      },
      runtimeRootKind: kernel.runtimeRoot ? path.basename(kernel.runtimeRoot) : null,
      databaseName: kernel.dbPath ? path.basename(kernel.dbPath) : null,
      canonicalSource: CANONICAL_SOURCE_NAME,
    };
  } catch (err) {
    return {
      enabled: true,
      ...buildSafeFailure(err),
      canonicalSource: CANONICAL_SOURCE_NAME,
    };
  } finally {
    try { kernel?.db?.close(); } catch {}
  }
}
