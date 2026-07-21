import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const PROVIDER_SETTINGS_FILE = path.join(ROOT, 'interface', 'provider-settings.json');

async function makeTempDir(prefix) {
  return fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), prefix)));
}

async function startServer({ token, runtimeRoot, homeDir }) {
  const port = 46900 + Math.floor(Math.random() * 300);
  const server = spawn(process.execPath, ['interface/server.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      HOME: homeDir,
      STEADYMADE_INTERFACE_TOKEN: token,
      BOARD_INTERNAL_TOKEN: 'board_secret_test_token',
      STEADYMADE_STORAGE_KERNEL_TEST_ROOT: runtimeRoot,
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

test('OpenCode config import endpoints are local-authenticated and support initial/refresh import', async () => {
  const token = 'opencode_import_test_token';
  const runtimeRoot = await makeTempDir('opencode-import-runtime-');
  const homeDir = await makeTempDir('opencode-import-home-');
  const importSource = path.join(homeDir, '.config', 'opencode');
  await fsp.mkdir(importSource, { recursive: true });
  await fsp.writeFile(path.join(importSource, 'opencode.jsonc'), `{
  // import should allow JSONC
  "permission": { "read": "allow", },
  "apiKey": "secret-should-not-copy"
}
`, 'utf8');

  const hadProviderSettings = fs.existsSync(PROVIDER_SETTINGS_FILE);
  const providerSettingsBackup = hadProviderSettings ? await fsp.readFile(PROVIDER_SETTINGS_FILE, 'utf8') : null;
  const runtime = await startServer({ token, runtimeRoot, homeDir });
  try {
    const unauthorized = await fetch(`http://127.0.0.1:${runtime.port}/api/provider-settings/opencode-config-import`);
    assert.equal(unauthorized.status, 401);

    const putRes = await fetch(`http://127.0.0.1:${runtime.port}/api/provider-settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-steadymade-token': token,
      },
      body: JSON.stringify({
        runtimeMode: 'opencode',
        claudeBin: '',
        opencodeBin: '',
        opencodeConfigPath: '',
        opencodeConfigImportSourcePath: importSource,
        cliBridgeEnabled: false,
        envVault: [],
      }),
    });
    assert.equal(putRes.status, 200);

    const inspectRes = await fetch(`http://127.0.0.1:${runtime.port}/api/provider-settings/opencode-config-import`, {
      headers: { 'x-steadymade-token': token },
    });
    const inspectBody = await inspectRes.json();
    assert.equal(inspectRes.status, 200);
    assert.equal(inspectBody.ok, true);
    assert.equal(inspectBody.status.ready, true);
    assert.equal(inspectBody.status.sourcePath, importSource);

    const invalidModeRes = await fetch(`http://127.0.0.1:${runtime.port}/api/provider-settings/opencode-config-import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-steadymade-token': token,
      },
      body: JSON.stringify({ mode: 'replace' }),
    });
    assert.equal(invalidModeRes.status, 400);

    const initialRes = await fetch(`http://127.0.0.1:${runtime.port}/api/provider-settings/opencode-config-import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-steadymade-token': token,
      },
      body: JSON.stringify({ mode: 'initial' }),
    });
    const initialBody = await initialRes.json();
    if (initialRes.status === 200) {
      assert.equal(initialBody.ok, true);
      assert.ok(initialBody.redactedKeys >= 1);
      assert.equal(initialBody.sourceFile, 'opencode.jsonc');
    } else {
      assert.equal(initialRes.status, 422);
      assert.equal(initialBody.code, 'managed_config_exists');
    }

    const secondInitialRes = await fetch(`http://127.0.0.1:${runtime.port}/api/provider-settings/opencode-config-import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-steadymade-token': token,
      },
      body: JSON.stringify({ mode: 'initial' }),
    });
    const secondInitialBody = await secondInitialRes.json();
    assert.equal(secondInitialRes.status, 422);
    assert.equal(secondInitialBody.code, 'managed_config_exists');

    const refreshRes = await fetch(`http://127.0.0.1:${runtime.port}/api/provider-settings/opencode-config-import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-steadymade-token': token,
      },
      body: JSON.stringify({ mode: 'refresh' }),
    });
    const refreshBody = await refreshRes.json();
    assert.equal(refreshRes.status, 200);
    assert.equal(refreshBody.ok, true);
    assert.equal(typeof refreshBody.backupPath, 'string');
    assert.ok(refreshBody.backupPath.length > 0);
  } finally {
    await runtime.stop();
    if (hadProviderSettings) {
      await fsp.writeFile(PROVIDER_SETTINGS_FILE, providerSettingsBackup, 'utf8');
    } else {
      await fsp.rm(PROVIDER_SETTINGS_FILE, { force: true });
    }
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
    await fsp.rm(homeDir, { recursive: true, force: true });
  }
});

test('provider settings PUT merges omitted runtime fields and preserves existing paths/env vault', async () => {
  const token = 'opencode_merge_test_token';
  const runtimeRoot = await makeTempDir('opencode-merge-runtime-');
  const homeDir = await makeTempDir('opencode-merge-home-');

  const hadProviderSettings = fs.existsSync(PROVIDER_SETTINGS_FILE);
  const providerSettingsBackup = hadProviderSettings ? await fsp.readFile(PROVIDER_SETTINGS_FILE, 'utf8') : null;
  const runtime = await startServer({ token, runtimeRoot, homeDir });
  try {
    const seedRes = await fetch(`http://127.0.0.1:${runtime.port}/api/provider-settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-steadymade-token': token,
      },
      body: JSON.stringify({
        runtimeMode: 'opencode',
        claudeBin: '/tmp/claude-custom',
        opencodeBin: '/tmp/opencode-custom',
        opencodeConfigPath: '/tmp/custom-opencode-config.json',
        opencodeConfigImportSourcePath: '/tmp/custom-import-source',
        cliBridgeEnabled: true,
        envVault: [{ key: 'EXISTING_SECRET', value: 'seed-secret' }],
      }),
    });
    assert.equal(seedRes.status, 200);

    const mergeRes = await fetch(`http://127.0.0.1:${runtime.port}/api/provider-settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-steadymade-token': token,
      },
      body: JSON.stringify({
        runtimeMode: 'claude-subscription',
        cliBridgeEnabled: false,
      }),
    });
    const mergeBody = await mergeRes.json();
    assert.equal(mergeRes.status, 200);
    assert.equal(mergeBody.settings.runtimeMode, 'claude-subscription');
    assert.equal(mergeBody.settings.cliBridgeEnabled, false);
    assert.equal(mergeBody.settings.claudeBin, '/tmp/claude-custom');
    assert.equal(mergeBody.settings.opencodeBin, '/tmp/opencode-custom');
    assert.equal(mergeBody.settings.opencodeConfigPath, '/tmp/custom-opencode-config.json');
    assert.equal(mergeBody.settings.opencodeConfigImportSourcePath, '/tmp/custom-import-source');
    assert.equal(Array.isArray(mergeBody.settings.envVault), true);
    assert.equal(mergeBody.settings.envVault.length, 1);
    assert.equal(mergeBody.settings.envVault[0]?.key, 'EXISTING_SECRET');
  } finally {
    await runtime.stop();
    if (hadProviderSettings) {
      await fsp.writeFile(PROVIDER_SETTINGS_FILE, providerSettingsBackup, 'utf8');
    } else {
      await fsp.rm(PROVIDER_SETTINGS_FILE, { force: true });
    }
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
    await fsp.rm(homeDir, { recursive: true, force: true });
  }
});
