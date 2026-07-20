import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const TEST_ROOT_ENV = 'STEADYMADE_STORAGE_KERNEL_TEST_ROOT';
const STORAGE_APP_ID = 0x53414f53; // "SAOS"

const WORKSPACE_LEDGER_FILE = 'workspace-ledger.json';
const MIGRATIONS_TABLE = 'storage_kernel_migrations';
const LOCK_TABLE = 'storage_kernel_lock';

const SYNC_PATH_HINTS = [
  'onedrive',
  'dropbox',
  'google drive',
  'icloud drive',
  'nextcloud',
  'syncthing',
  'synologydrive',
  'box',
  'sharepoint',
];

function normalize(p) {
  return path.resolve(String(p || ''));
}

function isWithin(parentAbs, childAbs) {
  const rel = path.relative(parentAbs, childAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function pathContainsSyncHints(absPath) {
  const lower = String(absPath || '').toLowerCase();
  return SYNC_PATH_HINTS.some((hint) => lower.includes(hint));
}

function isNetworkLikePath(absPath) {
  const value = String(absPath || '');
  if (process.platform === 'win32') {
    return /^\\\\/.test(value);
  }
  return value.startsWith('//') || value.startsWith('/net/') || value.startsWith('/afs/');
}

function chmodOwnerOnly(absPath, mode) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(absPath, mode);
  } catch {
    // best-effort on non-POSIX filesystems
  }
}

function ensureDirOwnerOnly(absPath) {
  fs.mkdirSync(absPath, { recursive: true, mode: 0o700 });
  chmodOwnerOnly(absPath, 0o700);
}

function ensureFileOwnerOnly(absPath) {
  if (!fs.existsSync(absPath)) {
    fs.writeFileSync(absPath, '', { mode: 0o600 });
  }
  chmodOwnerOnly(absPath, 0o600);
}

function defaultRuntimeRoot() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'steadymade-ai-os');
  }
  if (process.platform === 'win32') {
    const appData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(appData, 'steadymade-ai-os');
  }
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'steadymade-ai-os');
}

export function resolveRuntimeRoot({ testRootOverride = null } = {}) {
  const selected = testRootOverride || process.env[TEST_ROOT_ENV] || defaultRuntimeRoot();
  return normalize(selected);
}

export function validateRuntimeRoot({ runtimeRoot, workspaceRoot }) {
  const rootAbs = normalize(runtimeRoot);
  const workspaceAbs = normalize(workspaceRoot);
  const issues = [];

  if (isWithin(workspaceAbs, rootAbs)) {
    issues.push('runtime_root_inside_workspace');
  }
  if (pathContainsSyncHints(rootAbs) || pathContainsSyncHints(workspaceAbs)) {
    issues.push('sync_like_path_detected');
  }
  if (isNetworkLikePath(rootAbs)) {
    issues.push('network_like_runtime_root');
  }

  return {
    ok: issues.length === 0,
    issues,
    runtimeRoot: rootAbs,
    workspaceRoot: workspaceAbs,
  };
}

function assertNoSymlink(absPath, code) {
  const lst = fs.lstatSync(absPath);
  if (lst.isSymbolicLink()) {
    const err = new Error(`${code}: symlink not allowed`);
    err.code = code;
    throw err;
  }
}

function splitRelativeSegments(relativePath) {
  return String(relativePath || '')
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function ensurePathChainNoSymlinks({ rootAbs, targetAbs, code }) {
  if (!isWithin(rootAbs, targetAbs)) {
    const err = new Error(`${code}: path escapes runtime root`);
    err.code = code;
    throw err;
  }

  let current = rootAbs;
  assertNoSymlink(current, code);
  const rel = path.relative(rootAbs, targetAbs);
  const segments = rel ? rel.split(path.sep).filter(Boolean) : [];
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    assertNoSymlink(current, code);
  }
}

function assertNoSymlinkInRealpath(absPath, expectedCode) {
  const resolved = normalize(absPath);
  const real = fs.realpathSync(resolved);
  if (real !== resolved) {
    const err = new Error(`${expectedCode}: path resolves through symlink`);
    err.code = expectedCode;
    throw err;
  }
}

function ensureSafeRuntimeRoot(runtimeRoot) {
  ensureDirOwnerOnly(runtimeRoot);
  assertNoSymlink(runtimeRoot, 'unsafe_runtime_root');
  assertNoSymlinkInRealpath(runtimeRoot, 'unsafe_runtime_root');
}

export function resolveRuntimePath(runtimeRoot, ...relativeParts) {
  const rootAbs = normalize(runtimeRoot);
  const rel = splitRelativeSegments(relativeParts.filter(Boolean).join('/')).join(path.sep);
  const abs = normalize(path.join(rootAbs, rel));
  if (!isWithin(rootAbs, abs)) {
    const err = new Error('unsafe_runtime_stream_path: path escapes runtime root');
    err.code = 'unsafe_runtime_stream_path';
    throw err;
  }
  return abs;
}

export function ensureRuntimeSubdirectory({ runtimeRoot, relativePath, code = 'unsafe_runtime_stream_path' } = {}) {
  const rootAbs = normalize(runtimeRoot);
  const targetAbs = resolveRuntimePath(rootAbs, String(relativePath || ''));
  ensureSafeRuntimeRoot(rootAbs);
  ensurePathChainNoSymlinks({ rootAbs, targetAbs, code });
  fs.mkdirSync(targetAbs, { recursive: true, mode: 0o700 });
  chmodOwnerOnly(targetAbs, 0o700);
  assertNoSymlink(targetAbs, code);
  assertNoSymlinkInRealpath(targetAbs, code);
  return targetAbs;
}

export function ensureRuntimeFilePath({
  runtimeRoot,
  relativePath,
  createIfMissing = false,
  mode = 0o600,
  code = 'unsafe_runtime_stream_path',
} = {}) {
  const rootAbs = normalize(runtimeRoot);
  const targetAbs = resolveRuntimePath(rootAbs, String(relativePath || ''));
  ensureSafeRuntimeRoot(rootAbs);
  ensureRuntimeSubdirectory({
    runtimeRoot: rootAbs,
    relativePath: path.dirname(String(relativePath || '.')),
    code,
  });
  ensurePathChainNoSymlinks({ rootAbs, targetAbs, code });
  if (fs.existsSync(targetAbs)) {
    assertNoSymlink(targetAbs, code);
    assertNoSymlinkInRealpath(targetAbs, code);
  } else if (createIfMissing) {
    fs.writeFileSync(targetAbs, '', { mode });
  }
  chmodOwnerOnly(targetAbs, mode);
  return targetAbs;
}

function readJsonFile(jsonPath, fallbackValue) {
  try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  ensureDirOwnerOnly(dir);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodOwnerOnly(tempPath, 0o600);
  fs.renameSync(tempPath, filePath);
  chmodOwnerOnly(filePath, 0o600);
}

export function resolveWorkspaceId({ runtimeRoot, workspaceRoot }) {
  const ledgerPath = path.join(runtimeRoot, WORKSPACE_LEDGER_FILE);
  const workspaceReal = fs.realpathSync(normalize(workspaceRoot));
  const now = new Date().toISOString();
  const ledger = readJsonFile(ledgerPath, { entries: [] });
  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];

  let entry = entries.find((item) => item?.workspacePath === workspaceReal && typeof item?.workspaceId === 'string');
  if (!entry) {
    entry = {
      workspacePath: workspaceReal,
      workspaceId: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    entries.push(entry);
  } else {
    entry.updatedAt = now;
  }

  writeJsonAtomic(ledgerPath, { entries });
  return entry.workspaceId;
}

export function sqliteStringLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function openStorageDatabase({
  runtimeRoot,
  component,
  workspaceId,
  applicationId = STORAGE_APP_ID,
}) {
  const componentName = String(component || '').trim();
  if (!componentName) throw new Error('component is required');

  const dbDir = path.join(runtimeRoot, 'db');
  ensureDirOwnerOnly(dbDir);
  const dbPath = path.join(dbDir, `${componentName}.sqlite`);
  ensureFileOwnerOnly(dbPath);
  assertNoSymlink(dbPath, 'unsafe_database_path');
  assertNoSymlinkInRealpath(dbPath, 'unsafe_database_path');

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(`PRAGMA application_id = ${Number(applicationId) || STORAGE_APP_ID};`);
  db.exec('PRAGMA synchronous = NORMAL;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_kernel_workspace (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      workspace_id TEXT NOT NULL,
      component TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${LOCK_TABLE} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      owner TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO storage_kernel_workspace (id, workspace_id, component, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      component = excluded.component,
      updated_at = excluded.updated_at
  `).run(workspaceId, componentName, now, now);

  return { db, dbPath };
}

export function applyStorageMigrations(db, migrations = []) {
  const items = Array.isArray(migrations)
    ? migrations
      .filter((m) => Number.isInteger(m?.version) && typeof m?.sql === 'string')
      .sort((a, b) => a.version - b.version)
    : [];

  const applied = [];
  db.exec('BEGIN EXCLUSIVE;');
  try {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO ${LOCK_TABLE} (id, owner, updated_at)
      VALUES (1, 'storage-kernel', ?)
      ON CONFLICT(id) DO UPDATE SET
        owner = excluded.owner,
        updated_at = excluded.updated_at
    `).run(now);

    const existing = new Set(
      db.prepare(`SELECT version FROM ${MIGRATIONS_TABLE} ORDER BY version ASC`).all().map((row) => row.version),
    );

    for (const migration of items) {
      if (existing.has(migration.version)) continue;
      db.exec(migration.sql);
      db.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES (?, ?, ?)`)
        .run(migration.version, migration.name || `migration_${migration.version}`, new Date().toISOString());
      applied.push(migration.version);
    }

    db.exec('COMMIT;');
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    throw err;
  }

  return applied;
}

export function databaseQuickCheck(db) {
  const rows = db.prepare('PRAGMA quick_check;').all();
  const values = rows.map((row) => row.quick_check || row['quick_check']);
  return {
    ok: values.length === 1 && values[0] === 'ok',
    details: values,
  };
}

export function createDatabaseSnapshot({ db, snapshotPath }) {
  const absSnapshot = normalize(snapshotPath);
  ensureDirOwnerOnly(path.dirname(absSnapshot));
  if (fs.existsSync(absSnapshot)) fs.rmSync(absSnapshot, { force: true });

  db.exec('PRAGMA wal_checkpoint(FULL);');
  db.exec(`VACUUM INTO ${sqliteStringLiteral(absSnapshot)};`);
  chmodOwnerOnly(absSnapshot, 0o600);
  return absSnapshot;
}

export function restoreDatabaseFromSnapshot({ snapshotPath, databasePath }) {
  const src = normalize(snapshotPath);
  const dst = normalize(databasePath);
  ensureDirOwnerOnly(path.dirname(dst));
  fs.copyFileSync(src, dst);
  chmodOwnerOnly(dst, 0o600);
  for (const suffix of ['-wal', '-shm']) {
    try { fs.rmSync(`${dst}${suffix}`, { force: true }); } catch {}
  }
}

export function initializeStorageKernel({
  workspaceRoot,
  component,
  testRootOverride = null,
  migrations = [],
} = {}) {
  const runtimeRoot = resolveRuntimeRoot({ testRootOverride });
  const validated = validateRuntimeRoot({ runtimeRoot, workspaceRoot });
  if (!validated.ok) {
    const err = new Error(`unsafe runtime root: ${validated.issues.join(', ')}`);
    err.code = 'unsafe_runtime_root';
    err.issues = validated.issues;
    throw err;
  }

  ensureSafeRuntimeRoot(runtimeRoot);
  const workspaceId = resolveWorkspaceId({ runtimeRoot, workspaceRoot });
  const { db, dbPath } = openStorageDatabase({ runtimeRoot, component, workspaceId });
  applyStorageMigrations(db, migrations);

  return {
    runtimeRoot,
    workspaceId,
    dbPath,
    db,
  };
}

export function createStorageKernelDiagnostics({ workspaceRoot, component, testRootOverride = null } = {}) {
  const state = {
    initialized: false,
    ready: false,
    reason: null,
    issues: [],
    workspaceId: null,
    runtimeRoot: null,
    dbPath: null,
  };

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    try {
      const kernel = initializeStorageKernel({ workspaceRoot, component, testRootOverride });
      state.ready = true;
      state.workspaceId = kernel.workspaceId;
      state.runtimeRoot = kernel.runtimeRoot;
      state.dbPath = kernel.dbPath;
      try { kernel.db.close(); } catch {}
    } catch (err) {
      state.ready = false;
      state.reason = err?.code || 'storage_kernel_init_failed';
      state.issues = Array.isArray(err?.issues) ? err.issues : [];
    }
  }

  return {
    getStatus() {
      init();
      return {
        enabled: true,
        ready: state.ready,
        reason: state.reason,
        issues: state.issues,
        workspaceId: state.workspaceId,
        runtimeRootKind: state.runtimeRoot ? path.basename(state.runtimeRoot) : null,
        databaseName: state.dbPath ? path.basename(state.dbPath) : null,
      };
    },
  };
}
