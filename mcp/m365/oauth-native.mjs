import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const KEYCHAIN_SERVICE = 'steadymade-m365-mcp-auth';
const TOKEN_REFRESH_SKEW_MS = 60_000;

export const LOOPBACK_CALLBACK_URL = 'http://localhost:53682';
export const LOOPBACK_CALLBACK_PORT = 53682;

function toBase64Url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function safeEqualText(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function isNotFoundSecurityError(stderr) {
  return /could not be found|item not found|The specified item could not be found/i.test(String(stderr || ''));
}

function getTextJson(responseText) {
  const raw = String(responseText || '').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function assertAccessTokenPayload(payload) {
  const accessToken = String(payload?.access_token || '').trim();
  if (!accessToken) {
    throw new Error('token response missing access_token');
  }
  const expiresIn = Number.parseInt(String(payload?.expires_in || '3600'), 10);
  const expiresAt = Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3600_000);
  return {
    accessToken,
    expiresAt,
    refreshToken: String(payload?.refresh_token || '').trim() || null,
    scope: String(payload?.scope || '').trim() || null,
    tokenType: String(payload?.token_type || '').trim() || null,
  };
}

function getAuthorizationErrorMessage(payload, status) {
  const errorText = String(payload?.error || '').trim();
  const message = String(payload?.error_description || payload?.error?.message || '').trim();
  const normalizedMessage = message ? message.replace(/\s+/g, ' ') : '';
  return `OAuth token exchange failed (${status}): ${errorText || 'unknown_error'}${normalizedMessage ? ` - ${normalizedMessage}` : ''}`;
}

function openBrowser(url, platform) {
  const target = String(url || '').trim();
  if (!target) throw new Error('missing URL for browser launch');
  if (platform === 'darwin') {
    const child = spawn('open', [target], { stdio: 'ignore', detached: true });
    child.unref();
    return;
  }
  if (platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', target], { stdio: 'ignore', detached: true, windowsHide: true });
    child.unref();
    return;
  }
  const child = spawn('xdg-open', [target], { stdio: 'ignore', detached: true });
  child.unref();
}

function runCommand(command, args, { input, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk || ''); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      return reject(Object.assign(new Error(`command exited with ${code}`), { code, stdout, stderr }));
    });
    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

export function generatePkcePair() {
  const verifier = toBase64Url(randomBytes(64));
  const challenge = toBase64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function createOAuthState({ ttlMs = 300_000, now = Date.now() } = {}) {
  return {
    value: toBase64Url(randomBytes(24)),
    expiresAt: now + Math.max(30_000, Number.parseInt(String(ttlMs), 10) || 300_000),
  };
}

export function validateOAuthState({ expectedState, receivedState, expiresAt, now = Date.now() } = {}) {
  if (!expectedState || !receivedState) {
    return { ok: false, reason: 'missing_state' };
  }
  if (!safeEqualText(expectedState, receivedState)) {
    return { ok: false, reason: 'state_mismatch' };
  }
  if (!Number.isFinite(expiresAt) || now > expiresAt) {
    return { ok: false, reason: 'state_expired' };
  }
  return { ok: true };
}

export async function waitForLoopbackAuthorizationCode({
  expectedState,
  stateExpiresAt,
  callbackTimeoutMs = 180_000,
  callbackPort = LOOPBACK_CALLBACK_PORT,
  callbackPath = '/',
} = {}) {
  const timeoutMs = Math.max(15_000, Number.parseInt(String(callbackTimeoutMs), 10) || 180_000);
  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close(() => fn(value));
    };
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', LOOPBACK_CALLBACK_URL);
      const fail = (statusCode, message, reason) => {
        res.statusCode = statusCode;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(message);
        finish(reject, new Error(reason));
      };

      if (url.pathname !== callbackPath) {
        return fail(400, 'Invalid callback path.', 'OAuth callback rejected: invalid path');
      }

      const check = validateOAuthState({
        expectedState,
        receivedState: url.searchParams.get('state') || '',
        expiresAt: stateExpiresAt,
      });
      if (!check.ok) {
        return fail(400, 'State validation failed.', `OAuth callback rejected: ${check.reason}`);
      }

      const authError = String(url.searchParams.get('error') || '').trim();
      if (authError) {
        return fail(400, 'Authorization was not completed.', `OAuth authorization failed: ${authError}`);
      }

      const code = String(url.searchParams.get('code') || '').trim();
      if (!code) {
        return fail(400, 'Authorization code missing.', 'OAuth callback rejected: missing code');
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Microsoft 365 login complete. You can close this tab and return to your MCP client.');
      return finish(resolve, code);
    });

    server.on('error', (err) => {
      finish(reject, new Error(`OAuth loopback listener failed: ${String(err?.message || err)}`));
    });

    server.listen(callbackPort, '127.0.0.1', () => {
      // listener is now ready
    });

    const timeout = setTimeout(() => {
      finish(reject, new Error(`OAuth callback timeout after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
  });
}

export function createNativeM365OAuthClient({
  tenantId,
  clientId,
  scopes,
  fetchImpl = fetch,
  securityCommand = '/usr/bin/security',
  callbackUrl = LOOPBACK_CALLBACK_URL,
  callbackPort = LOOPBACK_CALLBACK_PORT,
  platform = process.platform,
  callbackTimeoutMs = 180_000,
  commandEnv = process.env,
} = {}) {
  if (!tenantId || !clientId) {
    throw new Error('tenantId and clientId are required for native OAuth');
  }
  const scopeText = Array.isArray(scopes) ? scopes.join(' ').trim() : String(scopes || '').trim();
  const authorityBase = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0`;
  const authorizeEndpoint = `${authorityBase}/authorize`;
  const tokenEndpoint = `${authorityBase}/token`;
  const keychainAccount = `${tenantId}:${clientId}`;

  async function postToken(params) {
    const body = new URLSearchParams(params);
    const response = await fetchImpl(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = await response.text();
    const payload = getTextJson(text);
    if (!response.ok) {
      throw new Error(getAuthorizationErrorMessage(payload, response.status));
    }
    return assertAccessTokenPayload(payload);
  }

  function buildAuthorizeUrl({ codeChallenge, state }) {
    const url = new URL(authorizeEndpoint);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', scopeText);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  function hasUsableAccessToken(access) {
    return Boolean(access?.accessToken) && Number.isFinite(access?.expiresAt) && (Date.now() + TOKEN_REFRESH_SKEW_MS < access.expiresAt);
  }

  async function readSessionFromKeychain() {
    try {
      const { stdout } = await runCommand(securityCommand, [
        'find-generic-password',
        '-a', keychainAccount,
        '-s', KEYCHAIN_SERVICE,
        '-w',
      ], { env: commandEnv });
      const parsed = getTextJson(stdout);
      const refreshToken = String(parsed?.refreshToken || '').trim();
      if (!refreshToken) return null;
      return {
        refreshToken,
        scope: String(parsed?.scope || '').trim() || null,
        updatedAt: Number.parseInt(String(parsed?.updatedAt || '0'), 10) || Date.now(),
      };
    } catch (err) {
      if (isNotFoundSecurityError(err?.stderr || err?.message)) return null;
      throw new Error('Unable to read Microsoft 365 token cache from Keychain.');
    }
  }

  async function writeSessionToKeychain(session) {
    const refreshToken = String(session?.refreshToken || '').trim();
    if (!refreshToken) {
      throw new Error('cannot persist session without refresh token');
    }
    const payload = JSON.stringify({
      refreshToken,
      scope: session?.scope || scopeText,
      updatedAt: Date.now(),
    });
    await runCommand(securityCommand, [
      'add-generic-password',
      '-a', keychainAccount,
      '-s', KEYCHAIN_SERVICE,
      '-w', payload,
      '-U',
    ], { env: commandEnv });
  }

  async function clearSessionFromKeychain() {
    try {
      await runCommand(securityCommand, [
        'delete-generic-password',
        '-a', keychainAccount,
        '-s', KEYCHAIN_SERVICE,
      ], { env: commandEnv });
    } catch (err) {
      if (isNotFoundSecurityError(err?.stderr || err?.message)) return;
      throw new Error('Unable to clear Microsoft 365 token cache from Keychain.');
    }
  }

  return {
    hasUsableAccessToken,

    async getStoredSession() {
      return await readSessionFromKeychain();
    },

    async disconnect() {
      await clearSessionFromKeychain();
    },

    async refreshFromSession(session) {
      const refreshToken = String(session?.refreshToken || '').trim();
      if (!refreshToken) {
        throw new Error('No refresh token is available. Run m365_auth_login.');
      }
      const token = await postToken({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken,
        scope: scopeText,
      });
      if (token.refreshToken) {
        await writeSessionToKeychain({ refreshToken: token.refreshToken, scope: token.scope || scopeText });
      }
      return token;
    },

    async loginInteractive() {
      const state = createOAuthState();
      const pkce = generatePkcePair();
      const authorizeUrl = buildAuthorizeUrl({ codeChallenge: pkce.challenge, state: state.value });
      const codePromise = waitForLoopbackAuthorizationCode({
        expectedState: state.value,
        stateExpiresAt: state.expiresAt,
        callbackTimeoutMs,
        callbackPort,
        callbackPath: new URL(callbackUrl).pathname || '/',
      });
      openBrowser(authorizeUrl, platform);
      const code = await codePromise;
      const token = await postToken({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: callbackUrl,
        code_verifier: pkce.verifier,
        scope: scopeText,
      });
      if (!token.refreshToken) {
        throw new Error('OAuth login did not return a refresh token. Ensure offline_access is in M365_SCOPES.');
      }
      await writeSessionToKeychain({ refreshToken: token.refreshToken, scope: token.scope || scopeText });
      return token;
    },
  };
}
