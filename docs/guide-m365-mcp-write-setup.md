# Microsoft 365 MCP (Calendar Read + SharePoint Read/Write) Setup

This repo includes a separate write-capable MCP server at
`mcp/m365-write/server.mjs`.

Important boundaries:

- fixed tool allowlist only (no generic Graph proxy)
- calendar is read-only (`Calendars.Read`)
- SharePoint includes bounded page/list/list-item + file operations
- every write tool requires explicit `confirm=true`

## 1) Register or update app registration for write profile

Use the helper script:

```bash
M365_APP_PROFILE=write bash scripts/m365-app-registration.sh
```

Delegated scopes in write profile:

- `openid`
- `profile`
- `offline_access`
- `Calendars.Read`
- `Sites.Selected`

## 2) Admin consent

Open the admin-consent URL printed by the script:

```txt
https://login.microsoftonline.com/<tenant-id>/adminconsent?client_id=<app-id>
```

## 3) Enable plugin in Settings -> Plugins

Enable built-in plugin:

- `m365-write`

Materialized `.mcp.json` entry:

```json
{
  "mcpServers": {
    "m365-write": {
      "command": "node",
      "args": ["mcp/m365-write/server.mjs"]
    }
  }
}
```

## 4) Local non-secret env vars

```bash
export M365_WRITE_TENANT_ID="<tenant-id>"
export M365_WRITE_CLIENT_ID="<app-id>"
export M365_WRITE_SCOPES="openid profile offline_access Calendars.Read Sites.Selected"
```

The write server can fall back to `M365_TENANT_ID` and `M365_CLIENT_ID` if
write-specific env vars are not provided, but explicit write env vars are
recommended to avoid accidental scope drift.

## 5) Re-auth flow (required after new scopes/admin consent)

Run once after scope/app changes:

1. `m365_write_auth_disconnect`
2. `m365_write_auth_login`

This forces a fresh consent/token session for the write-capable server.

## 6) Grant selected SharePoint sites to the app

With `Sites.Selected`, tenant-wide SharePoint write is disabled by default.
An admin must grant the app explicit access to each target site (for example via
Microsoft Graph/PowerShell site permission grant flows).

## Tool surface (write-capable server)

- `m365_write_auth_status`
- `m365_write_auth_login`
- `m365_write_auth_disconnect`
- `m365_write_calendar_list_events_range`
- `m365_write_calendar_get_event`
- `m365_write_sharepoint_search_sites`
- `m365_write_sharepoint_list_site_drives`
- `m365_write_sharepoint_list_site_pages`
- `m365_write_sharepoint_get_site_page`
- `m365_write_sharepoint_create_site_page_draft` (`confirm=true` required)
- `m365_write_sharepoint_update_site_page_draft` (`confirm=true` required)
- `m365_write_sharepoint_list_site_lists`
- `m365_write_sharepoint_get_site_list`
- `m365_write_sharepoint_list_site_list_items`
- `m365_write_sharepoint_get_site_list_item`
- `m365_write_sharepoint_create_site_list_item` (`confirm=true` required)
- `m365_write_sharepoint_update_site_list_item` (`confirm=true` required)
- `m365_write_sharepoint_list_drive_items`
- `m365_write_sharepoint_read_file`
- `m365_write_sharepoint_create_file` (`confirm=true` required)
- `m365_write_sharepoint_update_file` (`confirm=true` required)
- `m365_write_sharepoint_delete_file` (`confirm=true` required)
