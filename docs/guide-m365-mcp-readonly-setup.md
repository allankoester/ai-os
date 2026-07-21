# Microsoft 365 MCP (Work-Account-Only, Read-only) Setup

This guide is only for the read-only server.

For calendar-read + SharePoint write operations, use:

- `docs/guide-m365-mcp-write-setup.md`

This repo includes an MCP server at `mcp/m365/server.mjs` for delegated
Microsoft Graph **read-only** access.

Scope in this profile:

- local use only (no scheduler/headless support in this iteration)
- delegated user context only
- work-account tenant only
- read-only tools only (profile/mail/tasks/OneDrive reads)
- no generic Graph proxy tool
- no client secret required

## Security posture

- Native delegated OAuth is implemented with Authorization Code + PKCE (S256).
- Work-account-only tenant authority from `M365_TENANT_ID` (tenant-specific).
- Fixed loopback callback: `http://localhost:53682`.
- Refresh/session cache is stored in macOS Keychain via `/usr/bin/security`.
- Access tokens stay in-memory only.
- App-only client-credentials flow from `interface/storage/graph-storage.mjs` is
  explicitly out of scope for this MCP and not reused.

## 1) Register a least-privilege Entra app

Use the helper script in read-only mode:

```bash
M365_APP_PROFILE=readonly bash scripts/m365-app-registration.sh
```

Optional environment flags:

- `M365_APP_NAME` custom app registration display name
- `M365_TENANT_ID` explicit tenant id (otherwise current `az account` tenant)

The script creates/updates a public-client app (`AzureADMyOrg`) with delegated
Graph scopes:

Baseline:

- `openid`
- `profile`
- `offline_access`
- `User.Read`
- `Mail.Read`
- `Tasks.Read`
- `Files.Read`

## 2) Admin consent (tenant-dependent)

If your tenant requires admin consent, open the URL printed by the script:

```txt
https://login.microsoftonline.com/<tenant-id>/adminconsent?client_id=<app-id>
```

## 3) Enable plugin in Settings → Plugins

Enable built-in plugin:

- `m365-readonly`

Materialized `.mcp.json` entry is local-command based (no `npx -y`):

```json
{
  "mcpServers": {
    "m365-readonly": {
      "command": "node",
      "args": ["mcp/m365/server.mjs"]
    }
  }
}
```

## 4) Non-secret config (shell/session)

Set non-secret env vars in your shell profile or session:

```bash
export M365_TENANT_ID="<tenant-id>"
export M365_CLIENT_ID="<app-id>"
export M365_SCOPES="openid profile offline_access User.Read Mail.Read Tasks.Read Files.Read"
```

## 5) Sign in interactively (native default)

Use tool `m365_auth_login` once per local session setup:

- Opens your local system browser
- Runs Authorization Code + PKCE against your tenant authority
- Stores refresh/session cache in macOS Keychain
- Keeps access token in memory only

After login, read tools (`m365_me_profile`, `m365_mail_list`, etc.) refresh
silently using the stored refresh token.

Use `m365_auth_disconnect` to clear in-memory token + keychain cache.

## 6) Re-login required after scope changes

If app scopes were changed, re-consent the session:

1. `m365_auth_disconnect`
2. `m365_auth_login`

## Tool surface (read-only server)

- `m365_auth_status`
- `m365_auth_login`
- `m365_auth_disconnect`
- `m365_me_profile`
- `m365_mail_list`
- `m365_mail_get`
- `m365_tasks_list_lists`
- `m365_tasks_list`
- `m365_files_list`
- `m365_files_get`

No write/mutate tools are exposed.
