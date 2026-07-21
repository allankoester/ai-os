import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

import { createPluginManager } from '../../interface/plugins.mjs';
import { TOOL_DEFINITIONS } from '../../mcp/m365/tools.mjs';
import { isLikelyMutatingText } from '../../mcp/m365/readonly-policy.mjs';

async function makeRoot(prefix) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  const rootDir = await fsp.realpath(tempDir);
  await fsp.mkdir(path.join(rootDir, 'interface'), { recursive: true });
  return rootDir;
}

test('m365-readonly plugin materializes fixed local MCP command and can be removed without touching unmanaged entries', async () => {
  const rootDir = await makeRoot('m365-plugin-');
  try {
    const manager = createPluginManager({ rootDir });
    const enabled = await manager.update('m365-readonly', { enabled: true });
    assert.equal(Boolean(enabled?.ok), true);

    const mcpFile = path.join(rootDir, '.mcp.json');
    const mcp = JSON.parse(await fsp.readFile(mcpFile, 'utf8'));
    assert.equal(mcp.mcpServers['m365-readonly'].command, 'node');
    assert.deepEqual(mcp.mcpServers['m365-readonly'].args, ['mcp/m365/server.mjs']);

    mcp.mcpServers['unmanaged-demo'] = { command: 'demo', args: ['--ok'] };
    await fsp.writeFile(mcpFile, JSON.stringify(mcp, null, 2), 'utf8');

    const disabled = await manager.update('m365-readonly', { enabled: false });
    assert.equal(Boolean(disabled?.ok), true);

    const mcpAfter = JSON.parse(await fsp.readFile(mcpFile, 'utf8'));
    assert.equal(mcpAfter.mcpServers['m365-readonly'], undefined);
    assert.deepEqual(mcpAfter.mcpServers['unmanaged-demo'], { command: 'demo', args: ['--ok'] });
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
  }
});

test('m365-write plugin materializes separate fixed local MCP command', async () => {
  const rootDir = await makeRoot('m365-write-plugin-');
  try {
    const manager = createPluginManager({ rootDir });
    const enabled = await manager.update('m365-write', { enabled: true });
    assert.equal(Boolean(enabled?.ok), true);

    const mcpFile = path.join(rootDir, '.mcp.json');
    const mcp = JSON.parse(await fsp.readFile(mcpFile, 'utf8'));
    assert.equal(mcp.mcpServers['m365-write'].command, 'node');
    assert.deepEqual(mcp.mcpServers['m365-write'].args, ['mcp/m365-write/server.mjs']);
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
  }
});

test('m365 plugin display labels keep stable IDs and drop local suffix', () => {
  const manager = createPluginManager({ rootDir: process.cwd() });
  const readonly = manager.getPlugin('m365-readonly');
  const write = manager.getPlugin('m365-write');

  assert.equal(readonly?.id, 'm365-readonly');
  assert.equal(readonly?.name, 'Microsoft 365 (Read-only)');
  assert.equal(write?.id, 'm365-write');
  assert.equal(write?.name, 'Microsoft 365 (Calendar read + SharePoint write)');
});

test('m365 MCP tool registry remains read-only by policy', () => {
  assert.ok(TOOL_DEFINITIONS.length > 0);
  const names = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));
  assert.equal(names.has('m365_auth_login'), true);
  assert.equal(names.has('m365_auth_status'), true);
  assert.equal(names.has('m365_auth_disconnect'), true);
  assert.equal(names.has('m365_sharepoint_search_sites'), false);
  assert.equal(names.has('m365_sharepoint_list_drives'), false);
  assert.equal(names.has('m365_graph_proxy'), false);
  for (const tool of TOOL_DEFINITIONS) {
    assert.ok(tool.name.startsWith('m365_'));
    assert.equal(isLikelyMutatingText(tool.name), false, `tool name should not be mutating: ${tool.name}`);
  }
});
