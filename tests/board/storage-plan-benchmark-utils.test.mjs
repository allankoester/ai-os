import test from 'node:test';
import assert from 'node:assert/strict';

import {
  percentileNearestRank,
  resolveBenchmarkConfig,
  summarizeDurationsMs,
} from '../../scripts/benchmark-storage-plan-utils.mjs';

test('benchmark config enforces minimum measured iterations and parses overrides', () => {
  const cfg = resolveBenchmarkConfig([
    '--iterations=110',
    '--warmup=15',
    '--boardProjects=333',
    '--json=true',
  ], {});
  assert.equal(cfg.iterations, 110);
  assert.equal(cfg.warmup, 15);
  assert.equal(cfg.boardProjects, 333);
  assert.equal(cfg.json, true);

  assert.throws(() => resolveBenchmarkConfig(['--iterations=99'], {}), /iterations must be >= 100/);
});

test('timing summary uses nearest-rank percentile for p50 and p95', () => {
  const stats = summarizeDurationsMs([5, 1, 9, 3, 7]);
  assert.equal(stats.count, 5);
  assert.equal(stats.p50Ms, 5);
  assert.equal(stats.p95Ms, 9);
  assert.equal(stats.maxMs, 9);

  const p95 = percentileNearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95);
  assert.equal(p95, 10);
});
