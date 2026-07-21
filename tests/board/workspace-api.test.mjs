import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

async function startServer({ token = '' } = {}) {
  const tempHome = await fsp.mkdtemp(path.join('/private/tmp', 'workspace-api-home-'));
  const runtimeRoot = await fsp.mkdtemp(path.join('/private/tmp', 'workspace-api-runtime-'));
  const port = 46200 + Math.floor(Math.random() * 500);
  const server = spawn(process.execPath, ['interface/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: tempHome,
      STEADYMADE_STORAGE_KERNEL_TEST_ROOT: runtimeRoot,
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
      await fsp.rm(tempHome, { recursive: true, force: true });
      await fsp.rm(runtimeRoot, { recursive: true, force: true });
    },
  };
}

test('/api/workspace returns sharedCapability contract', async () => {
  const runtime = await startServer();
  try {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/workspace`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(typeof body, 'object');
    assert.equal(typeof body.sharedCapability, 'object');
    assert.equal(typeof body.sharedCapability.enabled, 'boolean');
    assert.ok(['disabled', 'not_configured', 'ready', 'degraded'].includes(body.sharedCapability.status));
    if (body.sharedCapability.status === 'ready') {
      assert.equal(body.sharedCapability.enabled, true);
    } else {
      assert.equal(body.sharedCapability.enabled, false);
    }
  } finally {
    await runtime.stop();
  }
});
