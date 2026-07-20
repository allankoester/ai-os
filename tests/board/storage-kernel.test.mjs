import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import {
  applyStorageMigrations,
  createDatabaseSnapshot,
  databaseQuickCheck,
  ensureRuntimeFilePath,
  ensureRuntimeSubdirectory,
  initializeStorageKernel,
  restoreDatabaseFromSnapshot,
  resolveRuntimeRoot,
} from '../../interface/storage/runtime/storage-kernel.mjs';

async function mk(prefix) {
  return fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), prefix)));
}

test('deterministic runtime root override + persistent workspace id', async () => {
  const workspaceRoot = await mk('storage-kernel-workspace-');
  const runtimeRoot = await mk('storage-kernel-runtime-');
  try {
    const resolved = resolveRuntimeRoot({ testRootOverride: runtimeRoot });
    assert.equal(resolved, runtimeRoot);

    const first = initializeStorageKernel({ workspaceRoot, component: 'interface', testRootOverride: runtimeRoot });
    const second = initializeStorageKernel({ workspaceRoot, component: 'interface', testRootOverride: runtimeRoot });

    assert.equal(first.runtimeRoot, runtimeRoot);
    assert.equal(first.workspaceId, second.workspaceId);
    assert.match(first.workspaceId, /^[0-9a-f-]{36}$/i);

    first.db.close();
    second.db.close();
  } finally {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('storage kernel rejects unsafe roots (inside workspace, sync-like, symlink)', async () => {
  const workspaceRoot = await mk('storage-kernel-workspace-unsafe-');
  const safeRuntime = await mk('storage-kernel-runtime-safe-');
  const syncLikeRoot = path.join(os.tmpdir(), 'OneDrive-storage-kernel-sync-root');
  const symlinkRoot = path.join(os.tmpdir(), `storage-kernel-symlink-root-${Date.now()}`);
  try {
    await fsp.mkdir(syncLikeRoot, { recursive: true });
    await fsp.symlink(safeRuntime, symlinkRoot);

    assert.throws(
      () => initializeStorageKernel({
        workspaceRoot,
        component: 'interface',
        testRootOverride: path.join(workspaceRoot, 'runtime-root'),
      }),
      (err) => err?.code === 'unsafe_runtime_root' && err?.issues?.includes('runtime_root_inside_workspace'),
    );

    assert.throws(
      () => initializeStorageKernel({
        workspaceRoot,
        component: 'interface',
        testRootOverride: syncLikeRoot,
      }),
      (err) => err?.code === 'unsafe_runtime_root' && err?.issues?.includes('sync_like_path_detected'),
    );

    assert.throws(
      () => initializeStorageKernel({
        workspaceRoot,
        component: 'interface',
        testRootOverride: symlinkRoot,
      }),
      (err) => err?.code === 'unsafe_runtime_root',
    );
  } finally {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
    await fsp.rm(safeRuntime, { recursive: true, force: true });
    await fsp.rm(syncLikeRoot, { recursive: true, force: true });
    await fsp.rm(symlinkRoot, { recursive: true, force: true });
  }
});

test('runtime stream helpers enforce owner-only local paths and reject symlinked stream roots', async () => {
  const workspaceRoot = await mk('storage-stream-workspace-');
  const runtimeRoot = await mk('storage-stream-runtime-');
  try {
    initializeStorageKernel({ workspaceRoot, component: 'interface', testRootOverride: runtimeRoot }).db.close();

    const streamDir = ensureRuntimeSubdirectory({
      runtimeRoot,
      relativePath: path.join('streams', 'chat', 'history'),
      code: 'unsafe_chat_stream_path',
    });
    const transcriptFile = ensureRuntimeFilePath({
      runtimeRoot,
      relativePath: path.join('streams', 'chat', 'history', 'conv_ok.jsonl'),
      createIfMissing: true,
      code: 'unsafe_chat_stream_path',
    });

    if (process.platform !== 'win32') {
      const dirMode = (await fsp.stat(streamDir)).mode & 0o777;
      const fileMode = (await fsp.stat(transcriptFile)).mode & 0o777;
      assert.equal(dirMode, 0o700);
      assert.equal(fileMode, 0o600);
    }

    await fsp.rm(streamDir, { recursive: true, force: true });
    await fsp.symlink(path.join(runtimeRoot, 'db'), streamDir);
    assert.throws(
      () => ensureRuntimeFilePath({
        runtimeRoot,
        relativePath: path.join('streams', 'chat', 'history', 'conv_bad.jsonl'),
        createIfMissing: true,
        code: 'unsafe_chat_stream_path',
      }),
      (err) => err?.code === 'unsafe_chat_stream_path',
    );
  } finally {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('database init applies pragmas + migration ledger + quick_check + snapshot/restore', async () => {
  const workspaceRoot = await mk('storage-kernel-workspace-db-');
  const runtimeRoot = await mk('storage-kernel-runtime-db-');
  const snapshotPath = path.join(runtimeRoot, 'snapshots', 'interface-snapshot.sqlite');
  const restoredPath = path.join(runtimeRoot, 'db', 'restored.sqlite');
  try {
    const kernel = initializeStorageKernel({
      workspaceRoot,
      component: 'interface',
      testRootOverride: runtimeRoot,
      migrations: [{
        version: 1,
        name: 'create_items',
        sql: 'CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);',
      }],
    });
    const { db } = kernel;

    const journalMode = db.prepare('PRAGMA journal_mode;').get();
    const foreignKeys = db.prepare('PRAGMA foreign_keys;').get();
    const busyTimeout = db.prepare('PRAGMA busy_timeout;').get();
    const appId = db.prepare('PRAGMA application_id;').get();

    assert.equal(String(journalMode.journal_mode || '').toLowerCase(), 'wal');
    assert.equal(Number(foreignKeys.foreign_keys), 1);
    assert.equal(Number(busyTimeout.timeout ?? busyTimeout.busy_timeout), 5000);
    assert.equal(Number(appId.application_id), 0x53414f53);

    const ledger = db.prepare('SELECT version, name FROM storage_kernel_migrations ORDER BY version').all();
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].version, 1);
    assert.equal(ledger[0].name, 'create_items');

    applyStorageMigrations(db, [{ version: 1, name: 'create_items', sql: 'CREATE TABLE items2 (id INTEGER);' }]);
    const ledgerAgain = db.prepare('SELECT version FROM storage_kernel_migrations ORDER BY version').all();
    assert.equal(ledgerAgain.length, 1);

    db.prepare('INSERT INTO items (name) VALUES (?)').run('alpha');
    const health = databaseQuickCheck(db);
    assert.equal(health.ok, true);

    const snapshotAbs = createDatabaseSnapshot({ db, snapshotPath });
    await fsp.access(snapshotAbs);

    restoreDatabaseFromSnapshot({ snapshotPath: snapshotAbs, databasePath: restoredPath });
    const restored = new DatabaseSync(restoredPath);
    try {
      const row = restored.prepare('SELECT name FROM items LIMIT 1').get();
      assert.equal(row.name, 'alpha');
    } finally {
      restored.close();
    }

    db.close();
  } finally {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});

async function startServer({ testRuntimeRoot }) {
  const port = 47000 + Math.floor(Math.random() * 500);
  const server = spawn(process.execPath, ['interface/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      BOARD_INTERNAL_TOKEN: 'board_secret_test_token',
      STEADYMADE_STORAGE_KERNEL_TEST_ROOT: testRuntimeRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/system`);
      if (response.ok) {
        return {
          port,
          stop: async () => {
            server.kill('SIGTERM');
            await new Promise((resolve) => server.once('exit', resolve));
          },
        };
      }
    } catch {
      // startup race
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  server.kill('SIGTERM');
  throw new Error('server did not start in time');
}

test('system diagnostics include storage-kernel status without leaking private paths', async () => {
  const runtimeRoot = path.join(os.tmpdir(), `OneDrive-storage-kernel-diag-${Date.now()}`);
  await fsp.mkdir(runtimeRoot, { recursive: true });
  const runtime = await startServer({ testRuntimeRoot: runtimeRoot });
  try {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/system`);
    assert.equal(response.status, 200);
    const body = await response.json();
    const diag = body?.diagnostics?.storageKernel;

    assert.equal(typeof diag?.enabled, 'boolean');
    assert.equal(diag.ready, false);
    assert.equal(diag.reason, 'unsafe_runtime_root');
    assert.ok(Array.isArray(diag.issues));
    assert.ok(diag.issues.includes('sync_like_path_detected'));

    const encoded = JSON.stringify(diag);
    assert.equal(encoded.includes(runtimeRoot), false);
    assert.equal(encoded.includes(os.homedir()), false);
  } finally {
    await runtime.stop();
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});
