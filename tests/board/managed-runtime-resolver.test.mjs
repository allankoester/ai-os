import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

import {
  buildProviderRuntimeDiagnostics,
  importOpenCodeConfigIntoManagedRuntime,
  inspectOpenCodeConfigImport,
  managedRuntimePaths,
  prepareOpenCodeEnvironment,
  resolveManagedCliBinary,
} from '../../runtime/managed-runtime.mjs';

test('resolver reports setup-required when managed default binary is absent', async () => {
  const workspaceRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-workspace-')));
  const testRuntimeRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-root-')));
  try {
    const resolved = resolveManagedCliBinary({
      workspaceRoot,
      cli: 'claude',
      configuredPath: '',
      envPath: '',
      testRootOverride: testRuntimeRoot,
    });
    assert.equal(resolved.setupRequired, true);
    assert.equal(resolved.resolvedPath, null);
    assert.match(String(resolved.reason || ''), /not executable/i);
  } finally {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
    await fsp.rm(testRuntimeRoot, { recursive: true, force: true });
  }
});

test('resolver accepts explicit executable path from settings', async () => {
  const workspaceRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-workspace-')));
  const testRuntimeRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-root-')));
  const fakeCli = path.join(workspaceRoot, 'fake-claude.sh');
  await fsp.writeFile(fakeCli, '#!/bin/sh\nexit 0\n', 'utf8');
  await fsp.chmod(fakeCli, 0o755);
  try {
    const resolved = resolveManagedCliBinary({
      workspaceRoot,
      cli: 'claude',
      configuredPath: fakeCli,
      envPath: '',
      testRootOverride: testRuntimeRoot,
    });
    assert.equal(resolved.setupRequired, false);
    assert.equal(resolved.resolvedPath, fakeCli);
  } finally {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
    await fsp.rm(testRuntimeRoot, { recursive: true, force: true });
  }
});

test('resolver rejects bare command names (no PATH fallback)', async () => {
  const workspaceRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-workspace-')));
  const testRuntimeRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-root-')));
  try {
    const resolved = resolveManagedCliBinary({
      workspaceRoot,
      cli: 'opencode',
      configuredPath: 'opencode',
      envPath: '',
      testRootOverride: testRuntimeRoot,
    });
    assert.equal(resolved.setupRequired, true);
    assert.match(String(resolved.reason || ''), /no PATH lookup/i);
  } finally {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
    await fsp.rm(testRuntimeRoot, { recursive: true, force: true });
  }
});

test('provider diagnostics surfaces setup-required when runtime binary is missing', async () => {
  const workspaceRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-workspace-')));
  const testRuntimeRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-root-')));
  try {
    const diagnostics = buildProviderRuntimeDiagnostics({
      workspaceRoot,
      providerSettings: { runtimeMode: 'claude-subscription', claudeBin: '', opencodeBin: '' },
      env: {},
      testRootOverride: testRuntimeRoot,
    });
    assert.equal(diagnostics.ready, false);
    assert.equal(diagnostics.blockingFailures[0]?.category, 'setup_required');
  } finally {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
    await fsp.rm(testRuntimeRoot, { recursive: true, force: true });
  }
});

test('OpenCode env preparation writes managed config and disables auto update', async () => {
  const workspaceRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-workspace-')));
  const testRuntimeRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-root-')));
  try {
    const env = prepareOpenCodeEnvironment({
      env: {},
      workspaceRoot,
      providerSettings: {},
      testRootOverride: testRuntimeRoot,
      configContent: '{"permission":{"read":"allow"}}',
    });
    const defaults = managedRuntimePaths({ workspaceRoot, testRootOverride: testRuntimeRoot });
    assert.equal(env.OPENCODE_CONFIG, defaults.opencodeConfigPath);
    assert.equal(env.OPENCODE_DISABLE_AUTO_UPDATE, '1');
    assert.equal(env.OPENCODE_DISABLE_AUTOUPDATE, '1');
    assert.equal(fs.existsSync(defaults.opencodeConfigPath), true);
  } finally {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
    await fsp.rm(testRuntimeRoot, { recursive: true, force: true });
  }
});

test('OpenCode env preparation projects canonical plugin MCP state into managed config', async () => {
  const workspaceRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-workspace-')));
  const testRuntimeRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-root-')));
  try {
    await fsp.mkdir(path.join(workspaceRoot, 'interface'), { recursive: true });
    await fsp.writeFile(path.join(workspaceRoot, 'interface', 'plugins.json'), JSON.stringify({
      schemaVersion: 2,
      plugins: {
        websearch: { enabled: true, config: {} },
        context7: { enabled: true, config: {} },
        'm365-readonly': { enabled: true, config: {} },
      },
      custom: [],
    }, null, 2), 'utf8');

    prepareOpenCodeEnvironment({
      env: {},
      workspaceRoot,
      providerSettings: {},
      testRootOverride: testRuntimeRoot,
    });

    const defaults = managedRuntimePaths({ workspaceRoot, testRootOverride: testRuntimeRoot });
    const projected = JSON.parse(await fsp.readFile(defaults.opencodeConfigPath, 'utf8'));
    assert.equal(Boolean(projected.mcp.context7), true);
    assert.equal(Boolean(projected.mcp['m365-readonly']), true);
    assert.equal(projected.mcp.websearch, undefined);
  } finally {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
    await fsp.rm(testRuntimeRoot, { recursive: true, force: true });
  }
});

test('OpenCode config import (initial) copies allowlisted config and redacts secret keys', async () => {
  const workspaceRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-workspace-')));
  const testRuntimeRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-root-')));
  const sourceRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-opencode-source-')));
  try {
    await fsp.writeFile(path.join(sourceRoot, 'config.json'), JSON.stringify({
      permission: { read: 'allow' },
      authToken: 'SHOULD_NOT_COPY',
      nested: { api_key: 'secret-value' },
    }, null, 2), 'utf8');
    await fsp.writeFile(path.join(sourceRoot, 'cache'), 'ignored', 'utf8');

    const status = inspectOpenCodeConfigImport({
      workspaceRoot,
      providerSettings: { opencodeConfigImportSourcePath: sourceRoot },
      testRootOverride: testRuntimeRoot,
    });
    assert.equal(status.ready, true);
    assert.ok(status.sourceCandidates.includes('config.json'));

    const result = importOpenCodeConfigIntoManagedRuntime({
      workspaceRoot,
      providerSettings: { opencodeConfigImportSourcePath: sourceRoot },
      mode: 'initial',
      testRootOverride: testRuntimeRoot,
    });
    assert.equal(result.ok, true);
    assert.ok(result.redactedKeys >= 1);

    const defaults = managedRuntimePaths({ workspaceRoot, testRootOverride: testRuntimeRoot });
    const imported = JSON.parse(await fsp.readFile(defaults.opencodeConfigPath, 'utf8'));
    assert.equal(imported.permission.read, 'allow');
    assert.equal(Object.prototype.hasOwnProperty.call(imported, 'authToken'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(imported.nested || {}, 'api_key'), false);
  } finally {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
    await fsp.rm(testRuntimeRoot, { recursive: true, force: true });
    await fsp.rm(sourceRoot, { recursive: true, force: true });
  }
});

test('OpenCode config import refresh creates timestamped backup before replace', async () => {
  const workspaceRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-workspace-')));
  const testRuntimeRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-root-')));
  const sourceRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-opencode-source-')));
  try {
    await fsp.writeFile(path.join(sourceRoot, 'config.json'), JSON.stringify({ permission: { read: 'allow' } }), 'utf8');
    const defaults = managedRuntimePaths({ workspaceRoot, testRootOverride: testRuntimeRoot });
    await fsp.mkdir(path.dirname(defaults.opencodeConfigPath), { recursive: true });
    await fsp.writeFile(defaults.opencodeConfigPath, JSON.stringify({ permission: { read: 'deny' } }), 'utf8');

    const result = importOpenCodeConfigIntoManagedRuntime({
      workspaceRoot,
      providerSettings: { opencodeConfigImportSourcePath: sourceRoot },
      mode: 'refresh',
      testRootOverride: testRuntimeRoot,
    });
    assert.equal(result.ok, true);
    assert.equal(typeof result.backupPath, 'string');
    assert.equal(fs.existsSync(result.backupPath), true);
    const backup = JSON.parse(await fsp.readFile(result.backupPath, 'utf8'));
    assert.equal(backup.permission.read, 'deny');
  } finally {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
    await fsp.rm(testRuntimeRoot, { recursive: true, force: true });
    await fsp.rm(sourceRoot, { recursive: true, force: true });
  }
});

test('OpenCode config import accepts opencode.jsonc with comments and trailing commas', async () => {
  const workspaceRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-workspace-')));
  const testRuntimeRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-root-')));
  const sourceRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'managed-runtime-opencode-source-')));
  try {
    const jsonc = `{
  // user config
  "permission": {
    "read": "allow",
  },
  "apiKey": "SHOULD_NOT_COPY",
}`;
    await fsp.writeFile(path.join(sourceRoot, 'opencode.jsonc'), jsonc, 'utf8');

    const status = inspectOpenCodeConfigImport({
      workspaceRoot,
      providerSettings: { opencodeConfigImportSourcePath: sourceRoot },
      testRootOverride: testRuntimeRoot,
    });
    assert.equal(status.ready, true);
    assert.ok(status.sourceCandidates.includes('opencode.jsonc'));

    const result = importOpenCodeConfigIntoManagedRuntime({
      workspaceRoot,
      providerSettings: { opencodeConfigImportSourcePath: sourceRoot },
      mode: 'initial',
      testRootOverride: testRuntimeRoot,
    });
    assert.equal(result.ok, true);

    const defaults = managedRuntimePaths({ workspaceRoot, testRootOverride: testRuntimeRoot });
    const imported = JSON.parse(await fsp.readFile(defaults.opencodeConfigPath, 'utf8'));
    assert.equal(imported.permission.read, 'allow');
    assert.equal(Object.prototype.hasOwnProperty.call(imported, 'apiKey'), false);
  } finally {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
    await fsp.rm(testRuntimeRoot, { recursive: true, force: true });
    await fsp.rm(sourceRoot, { recursive: true, force: true });
  }
});
