import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('repo opencode config includes both m365-readonly and m365-write MCP entries', async () => {
  const file = path.join(ROOT, 'opencode.jsonc');
  const payload = JSON.parse(await fsp.readFile(file, 'utf8'));
  const mcp = payload?.mcp || {};

  assert.equal(mcp['m365-readonly']?.type, 'local');
  assert.equal(mcp['m365-readonly']?.enabled, true);
  assert.deepEqual(mcp['m365-readonly']?.command, ['node', 'mcp/m365/server.mjs']);

  assert.equal(mcp['m365-write']?.type, 'local');
  assert.equal(mcp['m365-write']?.enabled, true);
  assert.deepEqual(mcp['m365-write']?.command, ['node', 'mcp/m365-write/server.mjs']);
});
