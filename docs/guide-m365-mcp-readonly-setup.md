# Microsoft 365 MCP (Local, Work-Account-Only, Read-only) Setup

This repo now includes a local MCP server at `mcp/m365/server.mjs` for delegated
Microsoft Graph **read-only** access.

Scope in this v1:

- local use only (no scheduler/headless support in this iteration)
- delegated user context only
- work-account tenant only
- read-only tools only (mail/tasks/files/sharepoint listing/read)
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

Use the helper script:

```bash
bash scripts/m365-app-registration.sh
```

Optional environment flags:

- `M365_APP_NAME` custom app registration display name
- `M365_TENANT_ID` explicit tenant id (otherwise current `az account` tenant)
- `M365_INCLUDE_SITES_READ_ALL=0` to skip SharePoint site search scope

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

Optional:

- `Sites.Read.All` (SharePoint site search/listing)

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

## 4) Local non-secret config (shell/session)

Set non-secret env vars in your shell profile or session:

```bash
export M365_TENANT_ID="<tenant-id>"
export M365_CLIENT_ID="<app-id>"
export M365_SCOPES="openid profile offline_access User.Read Mail.Read Tasks.Read Files.Read Sites.Read.All"
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

## Tool surface (read-only)

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
- `m365_sharepoint_search_sites`
- `m365_sharepoint_list_drives`

No write/mutate tools are exposed.
