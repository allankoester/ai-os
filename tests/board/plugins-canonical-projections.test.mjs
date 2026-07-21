import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

import { createPluginManager } from '../../interface/plugins.mjs';

async function makeTempRoot(prefix) {
  const dir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), prefix)));
  await fsp.mkdir(path.join(dir, 'interface'), { recursive: true });
  await fsp.mkdir(path.join(dir, '.claude'), { recursive: true });
  return dir;
}

test('canonical plugin state materializes both Claude and OpenCode projections; websearch semantics stay separate', async () => {
  const rootDir = await makeTempRoot('plugins-projection-');
  const runtimeRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'plugins-runtime-')));
  const previous = process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT;
  process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT = runtimeRoot;
  try {
    await fsp.writeFile(path.join(rootDir, 'interface', 'plugins.json'), JSON.stringify({
      schemaVersion: 2,
      plugins: {
        websearch: { enabled: true, config: {} },
        context7: { enabled: true, config: {} },
        'm365-readonly': { enabled: true, config: {} },
      },
      custom: [],
      managedMcp: [],
      managedPermissions: [],
      managedOpenCodeMcp: [],
    }, null, 2), 'utf8');

    const managedConfigPath = path.join(runtimeRoot, 'managed-runtime', 'opencode', 'config.json');
    await fsp.mkdir(path.dirname(managedConfigPath), { recursive: true });
    await fsp.writeFile(managedConfigPath, JSON.stringify({
      mcp: {
        websearch: {
          type: 'remote',
          enabled: true,
          url: 'https://legacy-websearch.example/mcp',
        },
      },
    }, null, 2), 'utf8');

    const manager = createPluginManager({ rootDir });
    const sync = await manager.syncProjections();
    assert.equal(sync.ok, true);

    const claudeMcp = JSON.parse(await fsp.readFile(path.join(rootDir, '.mcp.json'), 'utf8'));
    assert.equal(Boolean(claudeMcp.mcpServers.context7), true);
    assert.equal(Boolean(claudeMcp.mcpServers['m365-readonly']), true);
    assert.equal(claudeMcp.mcpServers.websearch, undefined);

    const claudeSettings = JSON.parse(await fsp.readFile(path.join(rootDir, '.claude', 'settings.local.json'), 'utf8'));
    assert.equal(claudeSettings.permissions.allow.includes('WebSearch'), true);

    const openCode = JSON.parse(await fsp.readFile(managedConfigPath, 'utf8'));
    assert.equal(Boolean(openCode.mcp.context7), true);
    assert.equal(Boolean(openCode.mcp['m365-readonly']), true);
    assert.equal(Boolean(openCode.mcp.websearch), true, 'legacy OpenCode websearch MCP should remain independent');
  } finally {
    if (previous === undefined) delete process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT;
    else process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT = previous;
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('migration keeps m365-write enabled when already present in OpenCode-side config', async () => {
  const rootDir = await makeTempRoot('plugins-m365-migration-');
  const runtimeRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'plugins-runtime-')));
  const previous = process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT;
  process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT = runtimeRoot;
  try {
    const customOpenCodeConfigPath = path.join(rootDir, 'runtime', 'custom-opencode-config.json');
    await fsp.mkdir(path.dirname(customOpenCodeConfigPath), { recursive: true });
    await fsp.writeFile(customOpenCodeConfigPath, JSON.stringify({
      mcp: {
        'm365-write': {
          type: 'local',
          enabled: true,
          command: ['node', 'mcp/m365-write/server.mjs'],
        },
      },
    }, null, 2), 'utf8');

    await fsp.writeFile(path.join(rootDir, 'interface', 'provider-settings.json'), JSON.stringify({
      runtimeMode: 'opencode',
      opencodeConfigPath: customOpenCodeConfigPath,
    }, null, 2), 'utf8');

    await fsp.writeFile(path.join(rootDir, 'interface', 'plugins.json'), JSON.stringify({
      plugins: {
        context7: { enabled: true, config: {} },
      },
      custom: [],
    }, null, 2), 'utf8');

    const manager = createPluginManager({ rootDir });
    const sync = await manager.syncProjections();
    assert.equal(sync.ok, true);

    const canonical = JSON.parse(await fsp.readFile(path.join(rootDir, 'interface', 'plugins.json'), 'utf8'));
    assert.equal(canonical.plugins['m365-write']?.enabled, true);

    const customOpenCode = JSON.parse(await fsp.readFile(customOpenCodeConfigPath, 'utf8'));
    assert.equal(customOpenCode.mcp['m365-write']?.enabled, true);
    assert.deepEqual(customOpenCode.mcp['m365-write']?.command, ['node', 'mcp/m365-write/server.mjs']);
  } finally {
    if (previous === undefined) delete process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT;
    else process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT = previous;
    await fsp.rm(rootDir, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});
