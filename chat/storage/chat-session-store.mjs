import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  ensureRuntimeFilePath,
  ensureRuntimeSubdirectory,
  initializeStorageKernel,
} from '../../interface/storage/runtime/storage-kernel.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_CHAT_DIR = path.resolve(__dirname, '..');

const AUTHORITY_KEY = 'sessions_metadata_authority';
const AUTHORITY_VALUE = 'chat_sqlite_v1';
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function isWithin(parentAbs, childAbs) {
  const rel = path.relative(parentAbs, childAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const CHAT_MIGRATIONS = [
  {
    version: 1,
    name: 'chat_session_metadata_sqlite_v1',
    sql: `
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        agent TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        turns INTEGER NOT NULL DEFAULT 0,
        current_session_id TEXT,
        archived INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS chat_sessions_updated_idx ON chat_sessions(updated_at DESC);

      CREATE TABLE IF NOT EXISTS chat_metadata_authority (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_import_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        import_kind TEXT NOT NULL,
        source_path TEXT,
        source_sha256 TEXT,
        imported_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        imported_at TEXT NOT NULL,
        details_json TEXT
      );

      CREATE TABLE IF NOT EXISTS chat_session_index_state (
        session_id TEXT PRIMARY KEY,
        transcript_line_count INTEGER NOT NULL DEFAULT 0,
        transcript_mtime_ms INTEGER NOT NULL DEFAULT 0,
        indexed_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS chat_session_fts
      USING fts5(session_id UNINDEXED, body);
    `,
  },
  {
    version: 2,
    name: 'chat_session_index_state_size_tracking',
    sql: `
      ALTER TABLE chat_session_index_state
      ADD COLUMN transcript_size_bytes INTEGER NOT NULL DEFAULT 0;
    `,
  },
];

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeTitle(input, fallback = '') {
  const candidate = String(input || '').replace(/\s+/g, ' ').trim();
  if (!candidate) return fallback;
  return candidate.slice(0, 80);
}

function compatibilitySessionFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    agent: row.agent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    turns: Number(row.turns || 0),
    currentSessionId: row.current_session_id || row.id,
    archived: Boolean(row.archived),
  };
}

function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
  if (process.platform !== 'win32') {
    try { fs.chmodSync(filePath, 0o600); } catch {}
  }
}

function lineCount(raw) {
  if (!raw) return 0;
  return raw.split('\n').filter(Boolean).length;
}

function resolveEntrySessionId(entry) {
  const direct = String(entry?.session_id || '').trim();
  if (direct) return direct;
  const nested = String(entry?.meta?.session_id || '').trim();
  return nested;
}

function summarizeTranscript({ sessionId, entries, fallbackAgent, fallbackTitle }) {
  let firstTimestamp = '';
  let lastTimestamp = '';
  let title = normalizeTitle(fallbackTitle, '');
  let latestAgent = String(fallbackAgent || '').trim();
  let latestSessionId = '';
  let assistantTurns = 0;

  const searchParts = [];
  for (const entry of entries) {
    const type = String(entry?.t || '').trim();
    const text = String(entry?.text || '').trim();
    const ts = String(entry?.ts || '').trim();
    if (!firstTimestamp && ts) firstTimestamp = ts;
    if (ts) lastTimestamp = ts;

    if (type === 'assistant') assistantTurns += 1;
    if (type === 'user' && text && !title) title = normalizeTitle(text, '').slice(0, 60);
    if ((type === 'user' || type === 'assistant') && text) searchParts.push(text);

    const agent = String(entry?.agent || '').trim();
    if (agent) latestAgent = agent;

    const sessionFromEntry = resolveEntrySessionId(entry);
    if (sessionFromEntry) latestSessionId = sessionFromEntry;
  }

  return {
    id: sessionId,
    title: title || sessionId,
    agent: latestAgent || 'danny',
    createdAt: firstTimestamp || nowIso(),
    updatedAt: lastTimestamp || firstTimestamp || nowIso(),
    turns: assistantTurns,
    currentSessionId: latestSessionId || sessionId,
    searchText: searchParts.join('\n'),
    transcriptLineCount: entries.length,
  };
}

function createPersistenceError(message, cause) {
  const err = new Error(message);
  err.code = 'chat_history_append_failed';
  err.cause = cause;
  return err;
}

function parseJsonlTranscriptWithDiagnostics(filePath) {
  const diagnostics = {
    filePresent: false,
    totalLines: 0,
    parsedLineCount: 0,
    malformedLineCount: 0,
    blankLineCount: 0,
    quarantinedLineCount: 0,
  };
  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf8');
    diagnostics.filePresent = true;
  } catch {
    return { entries: [], diagnostics };
  }

  const entries = [];
  const lines = raw.length ? raw.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  for (const line of lines) {
    diagnostics.totalLines += 1;
    if (!String(line).trim()) {
      diagnostics.blankLineCount += 1;
      continue;
    }
    const parsed = safeJsonParse(line, null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      entries.push(parsed);
      diagnostics.parsedLineCount += 1;
    } else {
      diagnostics.malformedLineCount += 1;
    }
  }

  diagnostics.quarantinedLineCount = diagnostics.blankLineCount + diagnostics.malformedLineCount;
  return { entries, diagnostics };
}

function assertNoSymlinkLstat(absPath, code) {
  const lst = fs.lstatSync(absPath);
  if (lst.isSymbolicLink()) {
    const err = new Error(`${code}: symlink not allowed`);
    err.code = code;
    throw err;
  }
  return lst;
}

function assertRealpathStable(absPath, code) {
  const resolved = path.resolve(absPath);
  const real = path.resolve(fs.realpathSync(resolved));
  if (real !== resolved) {
    const err = new Error(`${code}: path resolves through symlink`);
    err.code = code;
    throw err;
  }
  return real;
}

function validateDirectorySegmentsNoSymlink(absDirPath, code) {
  const resolved = path.resolve(absDirPath);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  const segments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    const lst = assertNoSymlinkLstat(current, code);
    if (!lst.isDirectory()) {
      const err = new Error(`${code}: expected directory segment`);
      err.code = code;
      throw err;
    }
    assertRealpathStable(current, code);
  }
  return resolved;
}

export function createChatSessionStore({
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
  chatDir = DEFAULT_CHAT_DIR,
  historyDir = path.join(chatDir, 'history'),
  sessionsCompatFile = path.join(chatDir, 'sessions.json'),
  testRuntimeRoot = process.env.STEADYMADE_CHAT_STORAGE_TEST_ROOT || process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT || null,
  hooks = {},
} = {}) {
  const kernel = initializeStorageKernel({
    workspaceRoot,
    component: 'chat',
    testRootOverride: testRuntimeRoot,
    migrations: CHAT_MIGRATIONS,
  });

  const db = kernel.db;
  const canonicalHistoryDir = ensureRuntimeSubdirectory({
    runtimeRoot: kernel.runtimeRoot,
    relativePath: path.join('streams', 'chat', 'history'),
    code: 'unsafe_chat_transcript_path',
  });
  const canonicalCompatDir = ensureRuntimeSubdirectory({
    runtimeRoot: kernel.runtimeRoot,
    relativePath: path.join('compat', 'chat'),
    code: 'unsafe_chat_compat_path',
  });
  const canonicalSessionsCompatFile = path.join(canonicalCompatDir, 'sessions.json');
  const legacyHistoryDir = historyDir;
  const legacySessionsCompatFile = sessionsCompatFile;
  const transcriptDiagnosticsBySession = new Map();
  const persistenceState = {
    transcriptAppendFailures: 0,
    compatibilityExportFailures: 0,
    unsafePathRejectCount: 0,
    lastFailureCode: null,
  };

  function authorityActive() {
    const authority = db.prepare('SELECT value FROM chat_metadata_authority WHERE key = ?').get(AUTHORITY_KEY);
    return authority?.value === AUTHORITY_VALUE;
  }

  function readLegacyHistoryValidated(fileName) {
    const unsafeCode = 'unsafe_legacy_chat_history_path';
    const rootAbs = path.resolve(legacyHistoryDir);
    try {
      if (!fs.existsSync(rootAbs)) {
        return {
          parsed: { entries: [], diagnostics: { filePresent: false, totalLines: 0, parsedLineCount: 0, malformedLineCount: 0, blankLineCount: 0, quarantinedLineCount: 0 } },
          source: 'legacy',
        };
      }

      validateDirectorySegmentsNoSymlink(rootAbs, unsafeCode);
      const rootReal = assertRealpathStable(rootAbs, unsafeCode);

      const fileAbs = path.resolve(path.join(rootAbs, fileName));
      if (!isWithin(rootAbs, fileAbs)) {
        const err = new Error(`${unsafeCode}: file escapes legacy history root`);
        err.code = unsafeCode;
        throw err;
      }
      if (!fs.existsSync(fileAbs)) {
        return {
          parsed: { entries: [], diagnostics: { filePresent: false, totalLines: 0, parsedLineCount: 0, malformedLineCount: 0, blankLineCount: 0, quarantinedLineCount: 0 } },
          source: 'legacy',
        };
      }

      const lst = assertNoSymlinkLstat(fileAbs, unsafeCode);
      if (!lst.isFile()) {
        const err = new Error(`${unsafeCode}: expected transcript file`);
        err.code = unsafeCode;
        throw err;
      }
      const fileReal = assertRealpathStable(fileAbs, unsafeCode);
      if (!isWithin(rootReal, fileReal)) {
        const err = new Error(`${unsafeCode}: file escapes real legacy history root`);
        err.code = unsafeCode;
        throw err;
      }
      return { parsed: parseJsonlTranscriptWithDiagnostics(fileAbs), source: 'legacy' };
    } catch (err) {
      persistenceState.unsafePathRejectCount += 1;
      persistenceState.lastFailureCode = err?.code || unsafeCode;
      return {
        parsed: { entries: [], diagnostics: { filePresent: false, totalLines: 0, parsedLineCount: 0, malformedLineCount: 0, blankLineCount: 0, quarantinedLineCount: 0 } },
        source: 'legacy_rejected',
      };
    }
  }

  function importLegacyTranscriptsIfNeeded() {
    if (authorityActive()) return;
    const unsafeCode = 'unsafe_legacy_chat_history_path';
    const rootAbs = path.resolve(legacyHistoryDir);
    if (!fs.existsSync(rootAbs)) return;

    let entries = [];
    try {
      validateDirectorySegmentsNoSymlink(rootAbs, unsafeCode);
      const rootReal = assertRealpathStable(rootAbs, unsafeCode);
      entries = fs.readdirSync(rootAbs, { withFileTypes: true });

      for (const dirent of entries) {
        if (dirent.isSymbolicLink()) {
          const err = new Error(`${unsafeCode}: symlink entry not allowed`);
          err.code = unsafeCode;
          throw err;
        }
        if (!dirent.isFile()) continue;
        if (!dirent.name.endsWith('.jsonl')) continue;
        const fileAbs = path.resolve(path.join(rootAbs, dirent.name));
        if (!isWithin(rootAbs, fileAbs)) continue;
        const lst = assertNoSymlinkLstat(fileAbs, unsafeCode);
        if (!lst.isFile()) continue;
        const fileReal = assertRealpathStable(fileAbs, unsafeCode);
        if (!isWithin(rootReal, fileReal)) continue;

        const canonicalPath = ensureRuntimeFilePath({
          runtimeRoot: kernel.runtimeRoot,
          relativePath: path.join('streams', 'chat', 'history', dirent.name),
          createIfMissing: true,
          code: 'unsafe_chat_transcript_path',
        });
        if (fs.existsSync(canonicalPath) && fs.statSync(canonicalPath).size > 0) continue;
        fs.copyFileSync(fileAbs, canonicalPath);
      }
    } catch (err) {
      persistenceState.unsafePathRejectCount += 1;
      persistenceState.lastFailureCode = err?.code || unsafeCode;
    }
  }

  function withTransaction(fn) {
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

  function readHistory(conversationId) {
    if (!SAFE_ID.test(String(conversationId || ''))) return [];
    const fileName = `${conversationId}.jsonl`;
    let parsed = {
      entries: [],
      diagnostics: {
        filePresent: false,
        totalLines: 0,
        parsedLineCount: 0,
        malformedLineCount: 0,
        blankLineCount: 0,
        quarantinedLineCount: 0,
      },
    };
    let source = 'canonical';
    try {
      const safeCanonical = ensureRuntimeFilePath({
        runtimeRoot: kernel.runtimeRoot,
        relativePath: path.join('streams', 'chat', 'history', fileName),
        code: 'unsafe_chat_transcript_path',
      });
      parsed = parseJsonlTranscriptWithDiagnostics(safeCanonical);
      if (!parsed.diagnostics.filePresent && !authorityActive()) {
        const legacy = readLegacyHistoryValidated(fileName);
        parsed = legacy.parsed;
        source = legacy.source;
      }
    } catch (err) {
      persistenceState.unsafePathRejectCount += 1;
      persistenceState.lastFailureCode = err?.code || 'unsafe_chat_transcript_path';
      source = 'canonical_rejected';
    }

    transcriptDiagnosticsBySession.set(conversationId, {
      source,
      ...parsed.diagnostics,
    });
    return parsed.entries;
  }

  function appendHistoryStrict(conversationId, entry) {
    if (!SAFE_ID.test(String(conversationId || ''))) {
      throw createPersistenceError('invalid conversation id for transcript append');
    }
    try {
      const filePath = ensureRuntimeFilePath({
        runtimeRoot: kernel.runtimeRoot,
        relativePath: path.join('streams', 'chat', 'history', `${conversationId}.jsonl`),
        createIfMissing: true,
        code: 'unsafe_chat_transcript_path',
      });
      fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (cause) {
      persistenceState.transcriptAppendFailures += 1;
      persistenceState.lastFailureCode = cause?.code || 'chat_history_append_failed';
      throw createPersistenceError('failed to append transcript event', cause);
    }
  }

  function exportCompatibilitySessionsJson() {
    const rows = db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC').all();
    const out = {};
    for (const row of rows) {
      const session = compatibilitySessionFromRow(row);
      out[session.id] = session;
    }
    try {
      const safeCompat = ensureRuntimeFilePath({
        runtimeRoot: kernel.runtimeRoot,
        relativePath: path.join('compat', 'chat', 'sessions.json'),
        createIfMissing: true,
        code: 'unsafe_chat_compat_path',
      });
      writeJsonAtomic(safeCompat, out);
    } catch (err) {
      persistenceState.compatibilityExportFailures += 1;
      persistenceState.lastFailureCode = err?.code || 'chat_compat_export_failed';
      throw err;
    }
  }

  function upsertFtsFromTranscript(sessionId) {
    const row = db.prepare('SELECT id, title, agent FROM chat_sessions WHERE id = ?').get(sessionId);
    if (!row) return;

    const entries = readHistory(sessionId);
    const summary = summarizeTranscript({
      sessionId,
      entries,
      fallbackAgent: row.agent,
      fallbackTitle: row.title,
    });
    const body = [summary.title, summary.searchText].filter(Boolean).join('\n');
    db.prepare('DELETE FROM chat_session_fts WHERE session_id = ?').run(sessionId);
    db.prepare('INSERT INTO chat_session_fts (session_id, body) VALUES (?, ?)').run(sessionId, body || summary.title);

    let transcriptPath = path.join(canonicalHistoryDir, `${sessionId}.jsonl`);
    if (!fs.existsSync(transcriptPath) && !authorityActive()) transcriptPath = path.join(legacyHistoryDir, `${sessionId}.jsonl`);
    let mtimeMs = 0;
    let sizeBytes = 0;
    try {
      const stat = fs.statSync(transcriptPath);
      mtimeMs = Math.floor(stat.mtimeMs);
      sizeBytes = Number(stat.size || 0);
    } catch {}
    db.prepare(`
      INSERT INTO chat_session_index_state (session_id, transcript_line_count, transcript_mtime_ms, transcript_size_bytes, indexed_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        transcript_line_count = excluded.transcript_line_count,
        transcript_mtime_ms = excluded.transcript_mtime_ms,
        transcript_size_bytes = excluded.transcript_size_bytes,
        indexed_at = excluded.indexed_at
    `).run(sessionId, summary.transcriptLineCount, mtimeMs, sizeBytes, nowIso());
  }

  function importLegacySessionsIfNeeded() {
    const authority = db.prepare('SELECT value FROM chat_metadata_authority WHERE key = ?').get(AUTHORITY_KEY);
    if (authority?.value === AUTHORITY_VALUE) return;

    const importedAt = nowIso();
    const sourcePath = legacySessionsCompatFile;
    let sourceSha = '';
    let sessions = {};
    let importedCount = 0;
    let skippedCount = 0;

    try {
      const raw = fs.readFileSync(sourcePath, 'utf8');
      sourceSha = crypto.createHash('sha256').update(raw).digest('hex');
      sessions = safeJsonParse(raw, {});
    } catch {
      sessions = {};
    }

    withTransaction(() => {
      for (const [id, value] of Object.entries(sessions || {})) {
        if (!SAFE_ID.test(id)) {
          skippedCount += 1;
          continue;
        }
        const createdAt = String(value?.createdAt || importedAt);
        const updatedAt = String(value?.updatedAt || createdAt);
        const title = normalizeTitle(value?.title, id);
        const agent = String(value?.agent || 'danny').trim() || 'danny';
        const turns = Number.isFinite(Number(value?.turns)) ? Number(value.turns) : 0;
        const currentSessionId = String(value?.currentSessionId || id).trim() || id;
        const archived = value?.archived ? 1 : 0;

        db.prepare(`
          INSERT INTO chat_sessions (id, title, agent, created_at, updated_at, turns, current_session_id, archived)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            agent = excluded.agent,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            turns = excluded.turns,
            current_session_id = excluded.current_session_id,
            archived = excluded.archived
        `).run(id, title, agent, createdAt, updatedAt, turns, currentSessionId, archived);
        importedCount += 1;
      }

      db.prepare(`
        INSERT INTO chat_import_ledger (import_kind, source_path, source_sha256, imported_count, skipped_count, imported_at, details_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'legacy_sessions_json_backfill',
        sourcePath,
        sourceSha,
        importedCount,
        skippedCount,
        importedAt,
        JSON.stringify({ authority: AUTHORITY_VALUE }),
      );

      db.prepare(`
        INSERT INTO chat_metadata_authority (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `).run(AUTHORITY_KEY, AUTHORITY_VALUE, importedAt);
    });
  }

  function reconcileFromTranscripts() {
    const allSources = [];
    const sourceDirs = authorityActive() ? [canonicalHistoryDir] : [canonicalHistoryDir, legacyHistoryDir];
    for (const dir of sourceDirs) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        allSources.push(...entries.map((entry) => ({ entry, dir })));
      } catch {
        // missing history source is fine
      }
    }

    const seen = new Set();
    for (const item of allSources) {
      const dirent = item.entry;
      if (!dirent.isFile()) continue;
      if (!dirent.name.endsWith('.jsonl')) continue;
      const conversationId = dirent.name.slice(0, -6);
      if (!SAFE_ID.test(conversationId)) continue;
      if (seen.has(conversationId)) continue;
      seen.add(conversationId);

      const transcriptPath = path.join(item.dir, dirent.name);
      let stat;
      try {
        stat = fs.statSync(transcriptPath);
      } catch {
        continue;
      }
      const indexed = db.prepare('SELECT transcript_mtime_ms, transcript_size_bytes FROM chat_session_index_state WHERE session_id = ?').get(conversationId);
      const currentMtime = Math.floor(stat.mtimeMs);
      const currentSize = Number(stat.size || 0);
      if (
        Number(indexed?.transcript_mtime_ms || 0) === currentMtime
        && Number(indexed?.transcript_size_bytes || 0) === currentSize
      ) {
        continue;
      }

      const transcriptEntries = readHistory(conversationId);
      const existing = db.prepare('SELECT id, title, agent, archived, created_at, updated_at FROM chat_sessions WHERE id = ?').get(conversationId);
      const summary = summarizeTranscript({
        sessionId: conversationId,
        entries: transcriptEntries,
        fallbackAgent: existing?.agent,
        fallbackTitle: existing?.title,
      });
      const archived = Number(existing?.archived || 0);

      withTransaction(() => {
        db.prepare(`
          INSERT INTO chat_sessions (id, title, agent, created_at, updated_at, turns, current_session_id, archived)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = COALESCE(NULLIF(chat_sessions.title, ''), excluded.title),
            agent = COALESCE(NULLIF(excluded.agent, ''), chat_sessions.agent),
            created_at = COALESCE(NULLIF(chat_sessions.created_at, ''), excluded.created_at),
            updated_at = CASE
              WHEN excluded.updated_at > chat_sessions.updated_at THEN excluded.updated_at
              ELSE chat_sessions.updated_at
            END,
            turns = excluded.turns,
            current_session_id = excluded.current_session_id,
            archived = chat_sessions.archived
        `).run(
          summary.id,
          summary.title,
          summary.agent,
          summary.createdAt,
          summary.updatedAt,
          summary.turns,
          summary.currentSessionId,
          archived,
        );

        upsertFtsFromTranscript(conversationId);
      });
    }

    const rows = db.prepare('SELECT id FROM chat_sessions').all();
    withTransaction(() => {
      for (const row of rows) upsertFtsFromTranscript(row.id);
    });
  }

  function listSessions({ includeArchived = false } = {}) {
    const rows = includeArchived
      ? db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC').all()
      : db.prepare('SELECT * FROM chat_sessions WHERE archived = 0 ORDER BY updated_at DESC').all();
    return rows.map(compatibilitySessionFromRow);
  }

  function getSession(id) {
    if (!SAFE_ID.test(String(id || ''))) return null;
    const row = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);
    if (!row) return null;
    return compatibilitySessionFromRow(row);
  }

  function renameSession(id, title) {
    if (!SAFE_ID.test(String(id || ''))) {
      const err = new Error('invalid id');
      err.code = 'invalid_id';
      throw err;
    }
    const trimmed = normalizeTitle(title, '');
    if (!trimmed) {
      const err = new Error('title required');
      err.code = 'title_required';
      throw err;
    }
    const updatedAt = nowIso();
    const result = db.prepare('UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?').run(trimmed, updatedAt, id);
    if (!result.changes) {
      const err = new Error('not found');
      err.code = 'not_found';
      throw err;
    }
    withTransaction(() => upsertFtsFromTranscript(id));
    exportCompatibilitySessionsJson();
    return getSession(id);
  }

  function archiveSession(id, archived) {
    if (!SAFE_ID.test(String(id || ''))) {
      const err = new Error('invalid id');
      err.code = 'invalid_id';
      throw err;
    }
    const updatedAt = nowIso();
    const result = db.prepare('UPDATE chat_sessions SET archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, updatedAt, id);
    if (!result.changes) {
      const err = new Error('not found');
      err.code = 'not_found';
      throw err;
    }
    exportCompatibilitySessionsJson();
    return getSession(id);
  }

  function findSearchSnippet({ session, entries, queryLower }) {
    if (String(session.title || '').toLowerCase().includes(queryLower)) return session.title;
    for (const entry of entries) {
      const type = String(entry?.t || '').trim();
      if (type !== 'user' && type !== 'assistant') continue;
      const text = String(entry?.text || '');
      const lower = text.toLowerCase();
      const idx = lower.indexOf(queryLower);
      if (idx >= 0) {
        return text.slice(Math.max(0, idx - 40), idx + queryLower.length + 40).replace(/\s+/g, ' ');
      }
    }
    return '';
  }

  function searchSessions(query, { limit = 20 } = {}) {
    const normalized = String(query || '').trim().toLowerCase();
    if (!normalized) return [];

    const matchQuery = `"${normalized.replace(/"/g, '""')}"`;
    let candidates = [];
    try {
      candidates = db.prepare('SELECT session_id FROM chat_session_fts WHERE chat_session_fts MATCH ? LIMIT 80').all(matchQuery);
    } catch {
      candidates = [];
    }

    const seen = new Set();
    const results = [];
    for (const row of candidates) {
      const id = String(row?.session_id || '').trim();
      if (!SAFE_ID.test(id) || seen.has(id)) continue;
      seen.add(id);

      const session = getSession(id);
      if (!session) continue;

      const snippet = findSearchSnippet({
        session,
        entries: readHistory(id),
        queryLower: normalized,
      });
      if (!snippet) continue;

      results.push({
        id: session.id,
        title: session.title,
        agent: session.agent,
        updatedAt: session.updatedAt,
        archived: Boolean(session.archived),
        snippet,
      });

      if (results.length >= limit) break;
    }

    return results;
  }

  function appendUserTurn({ conversationId, userEntry }) {
    appendHistoryStrict(conversationId, userEntry);
  }

  function createSessionFromFirstTurn({ conversationId, message, selectedAgent, sessionId, userEntry }) {
    if (!SAFE_ID.test(String(conversationId || ''))) {
      const err = new Error('invalid conversation id');
      err.code = 'invalid_id';
      throw err;
    }
    appendHistoryStrict(conversationId, userEntry);
    const timestamp = String(userEntry?.ts || nowIso());
    const title = normalizeTitle(String(message || ''), conversationId).slice(0, 60);
    withTransaction(() => {
      db.prepare(`
        INSERT INTO chat_sessions (id, title, agent, created_at, updated_at, turns, current_session_id, archived)
        VALUES (?, ?, ?, ?, ?, 0, ?, 0)
        ON CONFLICT(id) DO UPDATE SET
          title = COALESCE(NULLIF(chat_sessions.title, ''), excluded.title),
          agent = excluded.agent,
          updated_at = excluded.updated_at,
          current_session_id = excluded.current_session_id
      `).run(conversationId, title || conversationId, selectedAgent || 'danny', timestamp, timestamp, sessionId || conversationId);

      if (typeof hooks.beforeMetadataCommit === 'function') hooks.beforeMetadataCommit('create_session_first_turn');
      upsertFtsFromTranscript(conversationId);
    });
    exportCompatibilitySessionsJson();
  }

  function persistRunCompletion({ conversationId, selectedAgent, sessionId, toolEntries = [], assistantEntry = null }) {
    for (const toolEntry of toolEntries) appendHistoryStrict(conversationId, toolEntry);
    if (assistantEntry) appendHistoryStrict(conversationId, assistantEntry);

    const assistantTurns = assistantEntry ? 1 : 0;
    const updatedAt = String(assistantEntry?.ts || nowIso());
    withTransaction(() => {
      db.prepare(`
        UPDATE chat_sessions
        SET updated_at = ?,
            agent = ?,
            current_session_id = COALESCE(?, current_session_id),
            turns = turns + ?
        WHERE id = ?
      `).run(updatedAt, selectedAgent || 'danny', sessionId || null, assistantTurns, conversationId);

      if (typeof hooks.beforeMetadataCommit === 'function') hooks.beforeMetadataCommit('persist_run_completion');
      upsertFtsFromTranscript(conversationId);
    });
    exportCompatibilitySessionsJson();
  }

  function getLegacySessionsObject() {
    const out = {};
    for (const session of listSessions({ includeArchived: true })) out[session.id] = session;
    return out;
  }

  function getAuthority() {
    return db.prepare('SELECT key, value, updated_at FROM chat_metadata_authority WHERE key = ?').get(AUTHORITY_KEY) || null;
  }

  function getMigrationLedger() {
    return db.prepare('SELECT version, name FROM storage_kernel_migrations ORDER BY version ASC').all();
  }

  function getDiagnostics() {
    const transcripts = [...transcriptDiagnosticsBySession.values()];
    const totals = transcripts.reduce((acc, row) => {
      acc.totalLines += Number(row.totalLines || 0);
      acc.parsedLineCount += Number(row.parsedLineCount || 0);
      acc.blankLineCount += Number(row.blankLineCount || 0);
      acc.malformedLineCount += Number(row.malformedLineCount || 0);
      acc.quarantinedLineCount += Number(row.quarantinedLineCount || 0);
      return acc;
    }, {
      transcriptFilesObserved: transcripts.length,
      totalLines: 0,
      parsedLineCount: 0,
      blankLineCount: 0,
      malformedLineCount: 0,
      quarantinedLineCount: 0,
    });

    return {
      runtimeRootKind: path.basename(kernel.runtimeRoot),
      transcriptAppendFailures: persistenceState.transcriptAppendFailures,
      compatibilityExportFailures: persistenceState.compatibilityExportFailures,
      unsafePathRejectCount: persistenceState.unsafePathRejectCount,
      lastFailureCode: persistenceState.lastFailureCode,
      transcripts: totals,
    };
  }

  importLegacyTranscriptsIfNeeded();
  importLegacySessionsIfNeeded();
  reconcileFromTranscripts();
  exportCompatibilitySessionsJson();

  return {
    runtimeRoot: kernel.runtimeRoot,
    workspaceId: kernel.workspaceId,
    dbPath: kernel.dbPath,
    canonicalHistoryDir,
    canonicalSessionsCompatFile,
    db,
    close() {
      db.close();
    },
    readHistory,
    listSessions,
    getSession,
    renameSession,
    archiveSession,
    searchSessions,
    appendUserTurn,
    createSessionFromFirstTurn,
    persistRunCompletion,
    hasSession(id) {
      return Boolean(getSession(id));
    },
    getCurrentSessionId(id) {
      const row = db.prepare('SELECT current_session_id FROM chat_sessions WHERE id = ?').get(id);
      return row?.current_session_id || null;
    },
    getLegacySessionsObject,
    getAuthority,
    getMigrationLedger,
    getDiagnostics,
    reconcileFromTranscripts,
    exportCompatibilitySessionsJson,
  };
}
