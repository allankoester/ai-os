import {
  LOOPBACK_CALLBACK_URL,
  createNativeM365OAuthClient,
} from './oauth-native.mjs';

const DEFAULT_SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'User.Read',
  'Mail.Read',
  'Tasks.Read',
  'Files.Read',
];

function parseScopes(raw) {
  const fromEnv = String(raw || '').trim();
  if (!fromEnv) return DEFAULT_SCOPES;
  return fromEnv.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

export function createM365TokenProvider({ env = process.env } = {}) {
  const tenantId = String(env.M365_TENANT_ID || '').trim();
  const clientId = String(env.M365_CLIENT_ID || '').trim();
  const scopes = parseScopes(env.M365_SCOPES);

  let currentAccess = null;
  let refreshInFlight = null;

  if (tenantId && ['common', 'organizations', 'consumers'].includes(tenantId.toLowerCase())) {
    throw new Error('M365_TENANT_ID must be tenant-specific and work-account-only; common/organizations/consumers are not supported.');
  }

  const nativeConfigured = Boolean(tenantId && clientId);
  const nativeOAuth = nativeConfigured
    ? createNativeM365OAuthClient({ tenantId, clientId, scopes })
    : null;

  function setCurrentAccess(token, expiresAt) {
    currentAccess = {
      token: String(token || '').trim(),
      expiresAt: Number.parseInt(String(expiresAt || '0'), 10) || (Date.now() + 3_600_000),
    };
  }

  function hasCurrentAccessToken() {
    return Boolean(currentAccess?.token)
      && Number.isFinite(currentAccess?.expiresAt)
      && currentAccess.expiresAt > Date.now() + 60_000;
  }

  async function refreshNativeAccessToken() {
    if (!nativeOAuth) return '';
    const session = await nativeOAuth.getStoredSession();
    if (!session?.refreshToken) return '';
    const token = await nativeOAuth.refreshFromSession(session);
    setCurrentAccess(token.accessToken, token.expiresAt);
    return currentAccess.token;
  }

  return {
    async getStatus() {
      const storedSession = nativeOAuth ? await nativeOAuth.getStoredSession() : null;
      return {
        flowIntent: 'oauth-authorization-code-pkce-s256',
        workAccountOnly: true,
        tenantConfigured: Boolean(tenantId),
        clientIdConfigured: Boolean(clientId),
        callbackUrl: LOOPBACK_CALLBACK_URL,
        scopes,
        native: {
          configured: nativeConfigured,
          keychainSessionPresent: Boolean(storedSession?.refreshToken),
          accessTokenInMemory: hasCurrentAccessToken(),
        },
        tokenSource: hasCurrentAccessToken()
          ? 'native:in-memory-access-token'
          : storedSession?.refreshToken
            ? 'native:keychain-refresh-token'
            : 'none',
      };
    },

    async loginInteractive() {
      if (!nativeOAuth) {
        throw new Error('native OAuth is not configured. Set M365_TENANT_ID and M365_CLIENT_ID first.');
      }
      const token = await nativeOAuth.loginInteractive();
      setCurrentAccess(token.accessToken, token.expiresAt);
      return {
        ok: true,
        mode: 'native-oauth-browser-pkce',
        callbackUrl: LOOPBACK_CALLBACK_URL,
        hasRefreshToken: true,
        expiresAt: token.expiresAt,
      };
    },

    async disconnect() {
      currentAccess = null;
      if (nativeOAuth) await nativeOAuth.disconnect();
      return {
        ok: true,
        disconnected: true,
        cleared: ['in-memory-access-token', 'keychain-refresh-session'],
      };
    },

    async getAccessToken() {
      if (hasCurrentAccessToken()) return currentAccess.token;
      if (!refreshInFlight) {
        refreshInFlight = (async () => {
          try {
            const refreshedToken = await refreshNativeAccessToken();
            if (refreshedToken) return refreshedToken;
            throw new Error('not authenticated. Run m365_auth_login to sign in.');
          } finally {
            refreshInFlight = null;
          }
        })();
      }
      try {
        return await refreshInFlight;
      } catch (err) {
        if (/invalid_grant|interaction_required|consent_required/i.test(String(err?.message || ''))) {
          throw new Error('session expired or revoked. Run m365_auth_login again.');
        }
        throw err;
      }
    },
  };
}
