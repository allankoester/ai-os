import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';

import {
  getUsageProjectionHealth,
  rebuildUsageProjectionShadow,
} from '../../interface/storage/runtime/usage-projection.mjs';

const FIXTURE_ROOT = path.join(process.cwd(), 'tests', 'board', 'fixtures', 'phase0-migration', 'usage');

async function mk(prefix) {
  return fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), prefix)));
}

async function makeWorkspaceFromUsageFixture(fixtureRelPath, extra = '') {
  const workspaceRoot = await mk('usage-projection-workspace-');
  const runtimeRoot = await mk('usage-projection-runtime-');
  const runsDir = path.join(workspaceRoot, 'runs');
  await fsp.mkdir(runsDir, { recursive: true });

  const fixturePath = path.join(FIXTURE_ROOT, fixtureRelPath);
  const fixtureText = await fsp.readFile(fixturePath, 'utf8');
  await fsp.writeFile(path.join(runsDir, 'usage.jsonl'), fixtureText + extra, 'utf8');

  return {
    workspaceRoot,
    runtimeRoot,
    usageLogPath: path.join(runsDir, 'usage.jsonl'),
    async cleanup() {
      await fsp.rm(workspaceRoot, { recursive: true, force: true });
      await fsp.rm(runtimeRoot, { recursive: true, force: true });
    },
  };
}

test('usage projection replay is idempotent with stable event digest', async () => {
  const fx = await makeWorkspaceFromUsageFixture(path.join('valid', 'usage.jsonl'));
  try {
    const first = rebuildUsageProjectionShadow({
      workspaceRoot: fx.workspaceRoot,
      canonicalUsageLogPath: fx.usageLogPath,
      testRootOverride: fx.runtimeRoot,
    });
    const second = rebuildUsageProjectionShadow({
      workspaceRoot: fx.workspaceRoot,
      canonicalUsageLogPath: fx.usageLogPath,
      testRootOverride: fx.runtimeRoot,
    });

    assert.equal(first.ready, true);
    assert.equal(second.ready, true);
    assert.equal(first.projectionState.projectedEventCount, 2);
    assert.equal(second.projectionState.projectedEventCount, 2);
    assert.equal(first.projectionState.eventIdDigest, second.projectionState.eventIdDigest);
  } finally {
    await fx.cleanup();
  }
});

test('usage projection summary matches canonical scan aggregate (shadow parity)', async () => {
  const fx = await makeWorkspaceFromUsageFixture(path.join('valid', 'usage.jsonl'));
  try {
    const result = rebuildUsageProjectionShadow({
      workspaceRoot: fx.workspaceRoot,
      canonicalUsageLogPath: fx.usageLogPath,
      testRootOverride: fx.runtimeRoot,
    });

    assert.equal(result.ready, true);
    assert.equal(result.parity.matches, true);
    assert.deepEqual(result.parity.mismatches, []);
    assert.equal(result.summary.count, 2);
    assert.equal(result.summary.sessions, 1);
    assert.equal(result.summary.total_duration_ms, 14000);
    assert.equal(result.summary.sources.chat, 1);
    assert.equal(result.summary.sources.scheduler, 1);
  } finally {
    await fx.cleanup();
  }
});

test('usage projection quarantines malformed and blank lines with diagnostics', async () => {
  const fx = await makeWorkspaceFromUsageFixture(path.join('malformed', 'usage-malformed.jsonl'), '\n\n');
  try {
    const result = rebuildUsageProjectionShadow({
      workspaceRoot: fx.workspaceRoot,
      canonicalUsageLogPath: fx.usageLogPath,
      testRootOverride: fx.runtimeRoot,
    });

    assert.equal(result.ready, true);
    assert.equal(result.projectionState.projectedEventCount, 1);
    assert.equal(result.projectionState.quarantinedLineCount, result.projectionState.malformedLineCount + result.projectionState.blankLineCount);
    assert.equal(result.projectionState.malformedLineCount, 1);
    assert.ok(result.projectionState.blankLineCount >= 1);
    assert.ok(result.scanDiagnostics.totalLines >= 3);
  } finally {
    await fx.cleanup();
  }
});

test('usage projection rebuild recovers cleanly after malformed source is corrected', async () => {
  const fx = await makeWorkspaceFromUsageFixture(path.join('malformed', 'usage-malformed.jsonl'));
  try {
    const bad = rebuildUsageProjectionShadow({
      workspaceRoot: fx.workspaceRoot,
      canonicalUsageLogPath: fx.usageLogPath,
      testRootOverride: fx.runtimeRoot,
    });
    assert.equal(bad.ready, true);
    assert.equal(bad.projectionState.quarantinedLineCount, 1);

    const validText = await fsp.readFile(path.join(FIXTURE_ROOT, 'valid', 'usage.jsonl'), 'utf8');
    await fsp.writeFile(fx.usageLogPath, validText, 'utf8');

    const recovered = rebuildUsageProjectionShadow({
      workspaceRoot: fx.workspaceRoot,
      canonicalUsageLogPath: fx.usageLogPath,
      testRootOverride: fx.runtimeRoot,
    });
    assert.equal(recovered.ready, true);
    assert.equal(recovered.projectionState.projectedEventCount, 2);
    assert.equal(recovered.projectionState.quarantinedLineCount, 0);
    assert.equal(recovered.projectionState.malformedLineCount, 0);

    const health = getUsageProjectionHealth({
      workspaceRoot: fx.workspaceRoot,
      testRootOverride: fx.runtimeRoot,
    });
    assert.equal(health.ready, true);
    assert.equal(health.state.projectedEventCount, 2);
    assert.equal(health.state.quarantinedLineCount, 0);
  } finally {
    await fx.cleanup();
  }
});

test('usage projection diagnostics do not leak absolute paths or malformed line secrets', async () => {
  const workspaceRoot = await mk('usage-projection-secret-workspace-');
  const runtimeRoot = await mk('usage-projection-secret-runtime-');
  try {
    const runsDir = path.join(workspaceRoot, 'runs');
    await fsp.mkdir(runsDir, { recursive: true });
    const usagePath = path.join(runsDir, 'usage.jsonl');
    const fakeSecret = 'sk-THISISANOTREALSECRETBUTLOOKSLIKEONE12345';
    await fsp.writeFile(usagePath, `{"source":"chat","timestamp":"2026-07-20T09:01:00.000Z","mode":"danny"}\n${fakeSecret}\n`, 'utf8');

    const result = rebuildUsageProjectionShadow({
      workspaceRoot,
      canonicalUsageLogPath: usagePath,
      testRootOverride: runtimeRoot,
    });

    const encoded = JSON.stringify(result);
    assert.equal(encoded.includes(runtimeRoot), false);
    assert.equal(encoded.includes(workspaceRoot), false);
    assert.equal(encoded.includes(fakeSecret), false);
    assert.equal(encoded.includes(path.join(workspaceRoot, 'runs', 'usage.jsonl')), false);
  } finally {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});

async function startServer({ testRuntimeRoot }) {
  const port = 47800 + Math.floor(Math.random() * 500);
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

test('interface status + usage API expose projection diagnostics without path leakage', async () => {
  const runtimeRoot = await mk('usage-projection-server-runtime-');
  const runtime = await startServer({ testRuntimeRoot: runtimeRoot });
  try {
    const systemRes = await fetch(`http://127.0.0.1:${runtime.port}/api/system`);
    assert.equal(systemRes.status, 200);
    const systemBody = await systemRes.json();
    const projectionDiag = systemBody?.diagnostics?.usageProjection;
    assert.equal(typeof projectionDiag?.enabled, 'boolean');
    assert.equal(typeof projectionDiag?.canonicalSource, 'string');

    const usageRes = await fetch(`http://127.0.0.1:${runtime.port}/api/usage`);
    assert.equal(usageRes.status, 200);
    const usageBody = await usageRes.json();
    assert.equal(typeof usageBody?.diagnostics?.canonical?.quarantinedLineCount, 'number');
    assert.equal(typeof usageBody?.shadowProjection?.ready, 'boolean');

    const encoded = JSON.stringify({ projectionDiag, usage: usageBody.shadowProjection });
    assert.equal(encoded.includes(runtimeRoot), false);
    assert.equal(encoded.includes(os.homedir()), false);
  } finally {
    await runtime.stop();
    await fsp.rm(runtimeRoot, { recursive: true, force: true });
    if (fs.existsSync(runtimeRoot)) await fsp.rm(runtimeRoot, { recursive: true, force: true });
  }
});
