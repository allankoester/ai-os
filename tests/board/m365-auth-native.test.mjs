import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createM365TokenProvider,
} from '../../mcp/m365/auth.mjs';
import {
  createOAuthState as createNativeOAuthState,
  generatePkcePair as generateNativePkcePair,
  validateOAuthState as validateNativeOAuthState,
} from '../../mcp/m365/oauth-native.mjs';

test('m365 native auth generates PKCE verifier/challenge with expected format', () => {
  const { verifier, challenge } = generateNativePkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.ok(challenge.length >= 43 && challenge.length <= 128);
});

test('m365 native auth validates state token and rejects mismatch/expired values', () => {
  const now = Date.now();
  const state = createNativeOAuthState({ now, ttlMs: 60_000 });

  const ok = validateNativeOAuthState({
    expectedState: state.value,
    receivedState: state.value,
    expiresAt: state.expiresAt,
    now: now + 10_000,
  });
  assert.deepEqual(ok, { ok: true });

  const mismatch = validateNativeOAuthState({
    expectedState: state.value,
    receivedState: `${state.value}x`,
    expiresAt: state.expiresAt,
    now: now + 10_000,
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'state_mismatch');

  const expired = validateNativeOAuthState({
    expectedState: state.value,
    receivedState: state.value,
    expiresAt: state.expiresAt,
    now: state.expiresAt + 1,
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, 'state_expired');
});

test('m365 token provider status does not expose fallback auth modes', async () => {
  const provider = createM365TokenProvider({
    env: {
      M365_ACCESS_TOKEN: 'legacy-token-should-be-ignored',
      M365_TOKEN_COMMAND: 'security-risky-command',
      M365_TOKEN_COMMAND_ARGS: '["--print-token"]',
    },
  });

  const status = await provider.getStatus();
  assert.equal(status.fallback, undefined);
  assert.equal(status.tokenSource, 'none');
});

test('m365 token provider default readonly scopes exclude calendar/sharepoint scopes', async () => {
  const provider = createM365TokenProvider({ env: {} });
  const status = await provider.getStatus();

  assert.deepEqual(status.scopes, [
    'openid',
    'profile',
    'offline_access',
    'User.Read',
    'Mail.Read',
    'Tasks.Read',
    'Files.Read',
  ]);
  assert.equal(status.scopes.includes('Calendars.Read'), false);
  assert.equal(status.scopes.includes('Sites.Selected'), false);
  assert.equal(status.scopes.includes('Sites.Read.All'), false);
});

test('m365 token provider requires native login and ignores fallback env vars', async () => {
  const provider = createM365TokenProvider({
    env: {
      M365_ACCESS_TOKEN: 'legacy-token-should-be-ignored',
      M365_TOKEN_COMMAND: 'security-risky-command',
      M365_TOKEN_COMMAND_ARGS: '["--print-token"]',
    },
  });

  await assert.rejects(
    () => provider.getAccessToken(),
    /not authenticated\. Run m365_auth_login to sign in\./,
  );
});

test('m365 token provider supports write server env key overrides', async () => {
  const provider = createM365TokenProvider({
    env: {
      M365_WRITE_TENANT_ID: 'tenant-123',
      M365_WRITE_CLIENT_ID: 'client-456',
      M365_WRITE_SCOPES: 'openid profile offline_access Calendars.Read Sites.Selected',
    },
    tenantIdEnvKey: 'M365_WRITE_TENANT_ID',
    clientIdEnvKey: 'M365_WRITE_CLIENT_ID',
    scopesEnvKey: 'M365_WRITE_SCOPES',
  });

  const status = await provider.getStatus();
  assert.equal(status.tenantConfigured, true);
  assert.equal(status.clientIdConfigured, true);
  assert.deepEqual(status.scopes, [
    'openid',
    'profile',
    'offline_access',
    'Calendars.Read',
    'Sites.Selected',
  ]);
});
