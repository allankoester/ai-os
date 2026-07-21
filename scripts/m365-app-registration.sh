#!/usr/bin/env bash
set -euo pipefail

APP_PROFILE="${M365_APP_PROFILE:-readonly}"
if [[ "${APP_PROFILE}" != "readonly" && "${APP_PROFILE}" != "write" ]]; then
  echo "M365_APP_PROFILE must be 'readonly' or 'write'" >&2
  exit 1
fi

DEFAULT_APP_NAME="Steadymade AI OS MCP (${APP_PROFILE})"
APP_NAME="${M365_APP_NAME:-${DEFAULT_APP_NAME}}"
TENANT_ID="${M365_TENANT_ID:-}"

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI (az) is required." >&2
  exit 1
fi

az account show >/dev/null

if [[ -z "${TENANT_ID}" ]]; then
  TENANT_ID="$(az account show --query tenantId -o tsv)"
fi

if [[ -z "${TENANT_ID}" ]]; then
  echo "Unable to determine tenant id. Set M365_TENANT_ID." >&2
  exit 1
fi

GRAPH_APP_ID="00000003-0000-0000-c000-000000000000"

if [[ "${APP_PROFILE}" == "readonly" ]]; then
  SCOPE_NAMES=(openid profile offline_access User.Read Mail.Read Tasks.Read Files.Read)
else
  SCOPE_NAMES=(openid profile offline_access Calendars.Read Sites.Selected)
fi

echo "Resolving Microsoft Graph delegated scope IDs..."
RESOURCE_ACCESS_ITEMS=()
for scope in "${SCOPE_NAMES[@]}"; do
  scope_id="$(az ad sp show --id "${GRAPH_APP_ID}" --query "oauth2PermissionScopes[?value=='${scope}' && isEnabled].id | [0]" -o tsv)"
  if [[ -z "${scope_id}" ]]; then
    echo "Failed to resolve scope id for ${scope}" >&2
    exit 1
  fi
  RESOURCE_ACCESS_ITEMS+=("{\"id\":\"${scope_id}\",\"type\":\"Scope\"}")
done

RESOURCE_ACCESS_JSON="$(IFS=,; printf '%s' "${RESOURCE_ACCESS_ITEMS[*]}")"
REQUIRED_RESOURCE_ACCESSES="[{\"resourceAppId\":\"${GRAPH_APP_ID}\",\"resourceAccess\":[${RESOURCE_ACCESS_JSON}]}]"

APP_ID="$(az ad app list --display-name "${APP_NAME}" --query "[0].appId" -o tsv)"
if [[ -z "${APP_ID}" ]]; then
  echo "Creating app registration: ${APP_NAME}"
  APP_ID="$(az ad app create \
    --display-name "${APP_NAME}" \
    --sign-in-audience "AzureADMyOrg" \
    --is-fallback-public-client true \
    --public-client-redirect-uris "http://localhost:53682" \
    --required-resource-accesses "${REQUIRED_RESOURCE_ACCESSES}" \
    --query appId -o tsv)"
else
  echo "Updating existing app registration: ${APP_NAME} (${APP_ID})"
  az ad app update \
    --id "${APP_ID}" \
    --sign-in-audience "AzureADMyOrg" \
    --is-fallback-public-client true \
    --public-client-redirect-uris "http://localhost:53682" \
    --required-resource-accesses "${REQUIRED_RESOURCE_ACCESSES}" >/dev/null
fi

echo
echo "App registration ready."
echo "  profile:   ${APP_PROFILE}"
echo "  tenant id: ${TENANT_ID}"
echo "  app id:    ${APP_ID}"
echo
echo "Next steps (manual):"
echo "  1) Admin consent (if required by tenant):"
echo "     https://login.microsoftonline.com/${TENANT_ID}/adminconsent?client_id=${APP_ID}"
if [[ "${APP_PROFILE}" == "readonly" ]]; then
  echo "  2) Configure MCP env vars for m365-readonly (non-secret):"
  echo "     M365_TENANT_ID=${TENANT_ID}"
  echo "     M365_CLIENT_ID=${APP_ID}"
  echo "     M365_SCOPES=openid profile offline_access User.Read Mail.Read Tasks.Read Files.Read"
  echo "  3) Restart runtime and run m365_auth_login on m365-readonly."
else
  echo "  2) Configure MCP env vars for m365-write (non-secret):"
  echo "     M365_WRITE_TENANT_ID=${TENANT_ID}"
  echo "     M365_WRITE_CLIENT_ID=${APP_ID}"
  echo "     M365_WRITE_SCOPES=openid profile offline_access Calendars.Read Sites.Selected"
  echo "  3) Restart runtime and run m365_write_auth_login on m365-write."
fi
echo "  4) If scopes changed for an existing app/session, run auth disconnect and login again to force fresh consent."
