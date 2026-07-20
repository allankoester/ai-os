import test from 'node:test';
import assert from 'node:assert/strict';

import { inspectRuntimeGate } from '../../scripts/start-runtime-gate.mjs';

test('runtime gate passes on Node 22+', () => {
  const result = inspectRuntimeGate({
    versions: { node: '22.10.0' },
    release: { name: 'node' },
    execPath: '/usr/local/bin/node',
    env: {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'runtime-ok');
});

test('runtime gate fails on Node <22', () => {
  const result = inspectRuntimeGate({
    versions: { node: '20.18.0' },
    release: { name: 'node' },
    execPath: '/usr/local/bin/node',
    env: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'runtime-node-too-old');
  assert.match(result.message, /Required: Node 22\+/);
});

test('runtime gate fails under Bun even if node version looks compatible', () => {
  const result = inspectRuntimeGate({
    versions: { node: '22.3.0', bun: '1.2.19' },
    release: { name: 'bun' },
    execPath: '/Users/test/.bun/bin/bun',
    env: { BUN_INSTALL: '/Users/test/.bun' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'runtime-bun-unsupported');
  assert.match(result.message, /Start this project with Node 22\+/);
});
