import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fsp from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'phase0-migration');
const MANIFEST_PATH = path.join(FIXTURE_ROOT, 'manifest.json');

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
];

async function walkFiles(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(abs));
      continue;
    }
    files.push(abs);
  }
  return files;
}

function validateSchedulerJobs(data) {
  return Array.isArray(data) && data.length >= 1 && data.every((job) => (
    typeof job?.id === 'string'
    && typeof job?.name === 'string'
    && typeof job?.prompt === 'string'
    && ['once', 'cron'].includes(job?.scheduleType)
    && typeof job?.enabled === 'boolean'
    && typeof job?.timeoutMinutes === 'number'
  ));
}

function validateSchedulerRuns(data) {
  return Array.isArray(data) && data.length >= 1 && data.every((run) => (
    typeof run?.id === 'string'
    && typeof run?.jobId === 'string'
    && typeof run?.status === 'string'
    && typeof run?.startedAt === 'number'
    && typeof run?.summary === 'string'
  ));
}

function validateBoardProject(data) {
  return Boolean(
    data
    && typeof data?.id === 'string'
    && typeof data?.name === 'string'
    && typeof data?.visibility === 'string'
    && typeof data?.status === 'string'
    && Number.isInteger(data?.version)
  );
}

function validateBoardTask(data) {
  return Boolean(
    data
    && typeof data?.id === 'string'
    && typeof data?.project_id === 'string'
    && typeof data?.title === 'string'
    && typeof data?.status === 'string'
    && Number.isInteger(data?.version)
    && data?.execution
    && typeof data.execution === 'object'
  );
}

function validateChatSessions(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const rows = Object.values(data);
  if (!rows.length) return false;
  return rows.every((session) => (
    typeof session?.id === 'string'
    && typeof session?.title === 'string'
    && typeof session?.agent === 'string'
    && typeof session?.createdAt === 'string'
    && typeof session?.updatedAt === 'string'
  ));
}

function validateChatHistory(lines) {
  return lines.length >= 1 && lines.every((entry) => (
    entry
    && typeof entry === 'object'
    && ['user', 'assistant', 'tool'].includes(entry.t)
    && typeof entry.ts === 'string'
  ));
}

function validateUsageRecords(lines) {
  return lines.length >= 1 && lines.every((entry) => (
    entry
    && typeof entry === 'object'
    && ['chat', 'scheduler'].includes(entry.source)
    && typeof entry.timestamp === 'string'
    && typeof entry.mode === 'string'
  ));
}

const SCHEMA_VALIDATORS = {
  schedulerJobs: validateSchedulerJobs,
  schedulerRuns: validateSchedulerRuns,
  boardProject: validateBoardProject,
  boardTask: validateBoardTask,
  chatSessions: validateChatSessions,
  chatHistory: validateChatHistory,
  usageRecords: validateUsageRecords,
};

test('phase0 migration fixtures: readability, contract shape, malformed coverage, and secret hygiene', async () => {
  const manifest = JSON.parse(await fsp.readFile(MANIFEST_PATH, 'utf8'));
  assert.equal(manifest.version, 1);
  assert.ok(Array.isArray(manifest.fixtures));
  assert.ok(manifest.fixtures.length >= 8);

  const manifestPaths = new Set(manifest.fixtures.map((entry) => entry.path));
  const fixtureFiles = await walkFiles(FIXTURE_ROOT);
  for (const absFile of fixtureFiles) {
    const rel = path.relative(FIXTURE_ROOT, absFile).split(path.sep).join('/');
    if (rel === 'manifest.json') continue;
    assert.ok(manifestPaths.has(rel), `fixture missing from manifest: ${rel}`);
    const raw = await fsp.readFile(absFile, 'utf8');
    for (const pattern of SECRET_PATTERNS) {
      assert.equal(pattern.test(raw), false, `potential secret found in ${rel}`);
    }
  }

  for (const fixture of manifest.fixtures) {
    const abs = path.join(FIXTURE_ROOT, fixture.path);
    const raw = await fsp.readFile(abs, 'utf8');

    if (fixture.format === 'json' && fixture.expectation === 'malformed-json') {
      assert.throws(() => JSON.parse(raw), `expected malformed JSON for ${fixture.path}`);
      continue;
    }

    if (fixture.format === 'jsonl' && fixture.expectation === 'malformed-jsonl') {
      const lines = raw.split(/\r?\n/).filter(Boolean);
      assert.ok(lines.length >= 1, `expected malformed JSONL lines for ${fixture.path}`);
      const hasInvalidLine = lines.some((line) => {
        try {
          JSON.parse(line);
          return false;
        } catch {
          return true;
        }
      });
      assert.equal(hasInvalidLine, true, `expected at least one malformed JSONL line for ${fixture.path}`);
      continue;
    }

    if (fixture.format === 'json') {
      const parsed = JSON.parse(raw);
      const validate = SCHEMA_VALIDATORS[fixture.schema];
      assert.equal(typeof validate, 'function', `unknown schema validator: ${fixture.schema}`);
      const ok = validate(parsed);
      if (fixture.expectation === 'valid') {
        assert.equal(ok, true, `expected valid shape for ${fixture.path}`);
      } else if (fixture.expectation === 'malformed-shape') {
        assert.equal(ok, false, `expected malformed shape for ${fixture.path}`);
      } else {
        assert.fail(`unsupported expectation for JSON fixture: ${fixture.expectation}`);
      }
      continue;
    }

    if (fixture.format === 'jsonl') {
      const lines = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      const validate = SCHEMA_VALIDATORS[fixture.schema];
      assert.equal(typeof validate, 'function', `unknown schema validator: ${fixture.schema}`);
      const ok = validate(lines);
      if (fixture.expectation === 'valid') {
        assert.equal(ok, true, `expected valid shape for ${fixture.path}`);
      } else if (fixture.expectation === 'malformed-shape') {
        assert.equal(ok, false, `expected malformed shape for ${fixture.path}`);
      } else {
        assert.fail(`unsupported expectation for JSONL fixture: ${fixture.expectation}`);
      }
      continue;
    }

    assert.fail(`unsupported fixture format: ${fixture.format}`);
  }
});
