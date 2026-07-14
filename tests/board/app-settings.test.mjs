import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

import {
  APP_SETTINGS_SCHEMA_VERSION,
  deriveUserTypePolicy,
  getAppSettingsFile,
  readAppSettings,
  validateAppSettingsPayload,
  validateBoardRootConfig,
  writeAppSettings,
} from '../../interface/app-settings.mjs';

async function makeRoot(prefix) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  return fsp.realpath(tempDir);
}

test('app settings partial write preserves unrelated keys', async () => {
  const rootDir = await makeRoot('app-settings-merge-');
  try {
    await writeAppSettings(rootDir, {
      personalKnowledgeRoot: '/tmp/personal-a',
      sharedKnowledgeRoot: '/tmp/shared-a',
      privateBoardRoot: '/tmp/private-board-a',
      teamBoardRoot: '/tmp/team-board-a',
    }, { merge: false });

    await writeAppSettings(rootDir, {
      sharedKnowledgeRoot: '/tmp/shared-b',
    }, { merge: true });

    const settings = await readAppSettings(rootDir);
    assert.equal(settings.personalKnowledgeRoot, '/tmp/personal-a');
    assert.equal(settings.sharedKnowledgeRoot, '/tmp/shared-b');
    assert.equal(settings.privateBoardRoot, '/tmp/private-board-a');
    assert.equal(settings.teamBoardRoot, '/tmp/team-board-a');
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
  }
});

test('app settings writes are atomic/secure behavior (valid JSON, no temp leftovers, mode 0600)', async () => {
  const rootDir = await makeRoot('app-settings-atomic-');
  try {
    await writeAppSettings(rootDir, {
      privateBoardRoot: '/tmp/private-board',
    }, { merge: true });

    const file = getAppSettingsFile(rootDir);
    const stat = await fsp.stat(file);
    assert.equal(stat.mode & 0o777, 0o600);

    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    assert.equal(parsed.privateBoardRoot, '/tmp/private-board');

    const interfaceDirEntries = await fsp.readdir(path.dirname(file));
    assert.equal(interfaceDirEntries.some((name) => name.includes('.app-settings.json.') && name.endsWith('.tmp')), false);

    await writeAppSettings(rootDir, { teamBoardRoot: '/tmp/team-board' }, { merge: true });
    const stat2 = await fsp.stat(file);
    assert.equal(stat2.mode & 0o777, 0o600);
    const parsedAgain = JSON.parse(await fsp.readFile(file, 'utf8'));
    assert.equal(parsedAgain.teamBoardRoot, '/tmp/team-board');
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
  }
});

test('partial payload validation is evaluated against merged effective settings', async () => {
  const rootDir = await makeRoot('app-settings-merged-validation-');
  try {
    const privateBoard = path.join(rootDir, 'private-board');
    const teamBoard = path.join(rootDir, 'team-board');
    const shared = path.join(rootDir, 'shared-knowledge');
    const personal = path.join(rootDir, 'personal-knowledge');
    await Promise.all([
      fsp.mkdir(privateBoard, { recursive: true }),
      fsp.mkdir(teamBoard, { recursive: true }),
      fsp.mkdir(shared, { recursive: true }),
      fsp.mkdir(personal, { recursive: true }),
    ]);

    await writeAppSettings(rootDir, {
      privateBoardRoot: privateBoard,
      teamBoardRoot: teamBoard,
      sharedKnowledgeRoot: shared,
      personalKnowledgeRoot: personal,
    }, { merge: false });

    const partialPayload = {
      sharedKnowledgeRoot: privateBoard,
    };
    assert.deepEqual(validateAppSettingsPayload(partialPayload), []);

    const previous = await readAppSettings(rootDir);
    const merged = { ...previous, ...partialPayload };
    const mergedErrors = validateBoardRootConfig({ rootDir, settings: merged });
    assert.ok(mergedErrors.some((msg) => msg.includes('privateBoardRoot overlaps with sharedKnowledgeRoot')));
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
  }
});

test('legacy app settings payload migrates to schemaVersion + unset userType', async () => {
  const rootDir = await makeRoot('app-settings-migrate-');
  try {
    const file = getAppSettingsFile(rootDir);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify({ sharedKnowledgeRoot: '/tmp/shared' }), 'utf8');
    const settings = await readAppSettings(rootDir);
    assert.equal(settings.schemaVersion, APP_SETTINGS_SCHEMA_VERSION);
    assert.equal(settings.userType, '');
    assert.equal(settings.sharedKnowledgeRoot, '/tmp/shared');
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
  }
});

test('user type validation + policy metadata', () => {
  const errors = validateAppSettingsPayload({ userType: 'wrong-type' });
  assert.ok(errors.some((msg) => msg.includes('userType must be one of')));
  assert.equal(deriveUserTypePolicy('collaborator').requiresGit, true);
  assert.equal(deriveUserTypePolicy('team-user').requiresGit, false);
});
