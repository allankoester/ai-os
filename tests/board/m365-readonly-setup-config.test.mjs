import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('provider settings m365 scopes split readonly from write scopes', async () => {
  const file = path.join(ROOT, 'interface/provider-settings.json');
  const payload = JSON.parse(await fsp.readFile(file, 'utf8'));
  const scopes = String(payload?.envVault?.M365_SCOPES || '').split(/\s+/).filter(Boolean);
  const writeScopes = String(payload?.envVault?.M365_WRITE_SCOPES || '').split(/\s+/).filter(Boolean);

  assert.equal(scopes.includes('Calendars.Read'), false);
  assert.equal(scopes.includes('Sites.Selected'), false);
  assert.equal(scopes.includes('Sites.Read.All'), false);
  assert.equal(scopes.includes('Sites.ReadWrite.All'), false);

  assert.equal(writeScopes.includes('Calendars.Read'), true);
  assert.equal(writeScopes.includes('Sites.Selected'), true);
  assert.equal(writeScopes.includes('Sites.ReadWrite.All'), false);
  assert.equal(writeScopes.includes('Mail.Read'), false);
  assert.equal(writeScopes.includes('Tasks.Read'), false);
  assert.equal(writeScopes.includes('Files.Read'), false);
});

test('m365 app registration script supports readonly + write profiles and expected scope sets', async () => {
  const file = path.join(ROOT, 'scripts/m365-app-registration.sh');
  const script = await fsp.readFile(file, 'utf8');

  assert.match(script, /M365_APP_PROFILE/);
  assert.match(script, /readonly/);
  assert.match(script, /write/);
  assert.match(script, /Sites\.Selected/);
  assert.doesNotMatch(script, /Sites\.ReadWrite\.All/);
  assert.doesNotMatch(script, /Calendars\.Read Tasks\.Read/);
  assert.doesNotMatch(script, /Sites\.Read\.All/);
});
