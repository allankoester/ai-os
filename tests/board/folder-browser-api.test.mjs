import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';

async function makeWorkspaceTempDir(prefix) {
  const base = path.join(process.cwd(), '.tmp-folder-browser-tests');
  await fsp.mkdir(base, { recursive: true });
  return fsp.mkdtemp(path.join(base, prefix));
}

async function startServer({ token = '' } = {}) {
  const port = 45850 + Math.floor(Math.random() * 500);
  const server = spawn(process.execPath, ['interface/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      STEADYMADE_INTERFACE_TOKEN: token,
      BOARD_INTERNAL_TOKEN: 'board_secret_test_token',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const waitUntilReady = async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/system`);
        if (response.ok) return;
      } catch {
        // startup race
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('server did not start in time');
  };

  await waitUntilReady();

  return {
    port,
    async stop() {
      server.kill('SIGTERM');
      await new Promise((resolve) => server.once('exit', resolve));
    },
  };
}

test('folder browser rejects unauthorized access', async () => {
  const runtime = await startServer();
  try {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/folder-browser?mode=roots`);
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'unauthorized');
  } finally {
    await runtime.stop();
  }
});

test('folder browser returns directory-only listing for valid path', async () => {
  const token = 'folder_browser_token';
  const runtime = await startServer({ token });
  const rootDir = await makeWorkspaceTempDir('folder-browser-valid-');
  try {
    await fsp.mkdir(path.join(rootDir, 'alpha'), { recursive: true });
    await fsp.writeFile(path.join(rootDir, 'secret.txt'), 'must not leak', 'utf8');

    const response = await fetch(
      `http://127.0.0.1:${runtime.port}/api/folder-browser?path=${encodeURIComponent(rootDir)}`,
      { headers: { 'x-steadymade-token': token } },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.currentPath, path.normalize(rootDir));
    assert.equal(typeof body.parentPath, 'string');
    assert.ok(Array.isArray(body.directories));

    const names = body.directories.map((entry) => entry.name);
    assert.ok(names.includes('alpha'));
    assert.ok(!names.includes('secret.txt'));

    const alpha = body.directories.find((entry) => entry.name === 'alpha');
    assert.equal(alpha.isSymlink, false);
  } finally {
    await runtime.stop();
    await fsp.rm(rootDir, { recursive: true, force: true });
  }
});

test('folder browser includes symlinked directories as non-traversable metadata only', async () => {
  const token = 'folder_browser_symlink_token';
  const runtime = await startServer({ token });
  const rootDir = await makeWorkspaceTempDir('folder-browser-symlink-');
  try {
    const realDir = path.join(rootDir, 'real-dir');
    const linkedDir = path.join(rootDir, 'linked-dir');
    await fsp.mkdir(realDir, { recursive: true });
    await fsp.symlink(realDir, linkedDir);

    const response = await fetch(
      `http://127.0.0.1:${runtime.port}/api/folder-browser?path=${encodeURIComponent(rootDir)}`,
      { headers: { 'x-steadymade-token': token } },
    );
    const body = await response.json();
    assert.equal(response.status, 200);

    const linked = body.directories.find((entry) => entry.name === 'linked-dir');
    assert.ok(linked);
    assert.equal(linked.isSymlink, true);
    assert.equal(linked.traversable, false);
  } finally {
    await runtime.stop();
    await fsp.rm(rootDir, { recursive: true, force: true });
  }
});

test('folder browser returns structured invalid-path errors', async () => {
  const token = 'folder_browser_invalid_token';
  const runtime = await startServer({ token });
  const rootDir = await makeWorkspaceTempDir('folder-browser-invalid-');
  try {
    const filePath = path.join(rootDir, 'a-file.txt');
    await fsp.writeFile(filePath, 'x', 'utf8');

    const relativeRes = await fetch(
      `http://127.0.0.1:${runtime.port}/api/folder-browser?path=${encodeURIComponent('relative/path')}`,
      { headers: { 'x-steadymade-token': token } },
    );
    const relativeBody = await relativeRes.json();
    assert.equal(relativeRes.status, 400);
    assert.equal(relativeBody.error.code, 'invalid_path');

    const longAbsolutePath = `/${'a'.repeat(2100)}`;
    const longRes = await fetch(
      `http://127.0.0.1:${runtime.port}/api/folder-browser?path=${encodeURIComponent(longAbsolutePath)}`,
      { headers: { 'x-steadymade-token': token } },
    );
    const longBody = await longRes.json();
    assert.equal(longRes.status, 400);
    assert.equal(longBody.error.code, 'invalid_path');

    const missingRes = await fetch(
      `http://127.0.0.1:${runtime.port}/api/folder-browser?path=${encodeURIComponent(path.join(rootDir, 'missing-dir'))}`,
      { headers: { 'x-steadymade-token': token } },
    );
    const missingBody = await missingRes.json();
    assert.equal(missingRes.status, 404);
    assert.equal(missingBody.error.code, 'path_not_found');

    const fileRes = await fetch(
      `http://127.0.0.1:${runtime.port}/api/folder-browser?path=${encodeURIComponent(filePath)}`,
      { headers: { 'x-steadymade-token': token } },
    );
    const fileBody = await fileRes.json();
    assert.equal(fileRes.status, 422);
    assert.equal(fileBody.error.code, 'not_directory');
  } finally {
    await runtime.stop();
    await fsp.rm(rootDir, { recursive: true, force: true });
  }
});

test('folder browser mode=roots returns concise starting roots list', async () => {
  const token = 'folder_browser_roots_token';
  const runtime = await startServer({ token });
  try {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/folder-browser?mode=roots`, {
      headers: { 'x-steadymade-token': token },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.roots));
    assert.ok(body.roots.some((entry) => entry.id === 'workspace'));
    assert.ok(body.roots.every((entry) => typeof entry.path === 'string'));
  } finally {
    await runtime.stop();
  }
});

test('folder browser rejects target path outside selected root', async () => {
  const token = 'folder_browser_root_guard_token';
  const runtime = await startServer({ token });
  try {
    const rootsRes = await fetch(`http://127.0.0.1:${runtime.port}/api/folder-browser?mode=roots`, {
      headers: { 'x-steadymade-token': token },
    });
    const rootsBody = await rootsRes.json();
    assert.equal(rootsRes.status, 200);
    const workspaceRoot = rootsBody.roots.find((entry) => entry.id === 'workspace');
    assert.ok(workspaceRoot?.path);

    const outsidePath = path.resolve(os.tmpdir());
    const response = await fetch(
      `http://127.0.0.1:${runtime.port}/api/folder-browser?path=${encodeURIComponent(outsidePath)}&root=${encodeURIComponent(workspaceRoot.path)}`,
      { headers: { 'x-steadymade-token': token } },
    );
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.error.code, 'path_outside_root');
  } finally {
    await runtime.stop();
  }
});
