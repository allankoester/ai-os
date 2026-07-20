import { assertReadonlyToolCallName, assertReadonlyToolDefinitions } from './readonly-policy.mjs';

export const TOOL_DEFINITIONS = [
  {
    name: 'm365_auth_login',
    description: 'Starts native Microsoft 365 browser login (Authorization Code + PKCE) and stores refresh session in macOS Keychain.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'm365_auth_status',
    description: 'Returns Microsoft 365 native auth status (never returns token/code/cache values).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'm365_auth_disconnect',
    description: 'Clears native Microsoft 365 auth session from memory and macOS Keychain.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'm365_me_profile',
    description: 'Reads the signed-in user profile from Microsoft Graph /me endpoint.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'm365_mail_list',
    description: 'Lists mail messages from supported folders (inbox, archive, drafts, sentitems).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        folder: { type: 'string', enum: ['inbox', 'archive', 'drafts', 'sentitems'], default: 'inbox' },
        top: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
    },
  },
  {
    name: 'm365_mail_get',
    description: 'Reads one mail message by messageId.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['messageId'],
      properties: {
        messageId: { type: 'string', minLength: 1 },
      },
    },
  },
  {
    name: 'm365_tasks_list_lists',
    description: 'Lists Microsoft To Do task lists available to the delegated user.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'm365_tasks_list',
    description: 'Lists tasks in a specific To Do list by listId.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['listId'],
      properties: {
        listId: { type: 'string', minLength: 1 },
        top: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
    },
  },
  {
    name: 'm365_files_list',
    description: 'Lists OneDrive items in drive root or in a provided itemId folder.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        itemId: { type: 'string', minLength: 1 },
        top: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
    },
  },
  {
    name: 'm365_files_get',
    description: 'Reads OneDrive metadata for a specific itemId.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['itemId'],
      properties: {
        itemId: { type: 'string', minLength: 1 },
      },
    },
  },
  {
    name: 'm365_sharepoint_search_sites',
    description: 'Searches SharePoint sites (requires Sites.Read.All if tenant policy enforces it).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', default: '"*"' },
        top: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
    },
  },
  {
    name: 'm365_sharepoint_list_drives',
    description: 'Lists document libraries (drives) for a specific SharePoint siteId.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId'],
      properties: {
        siteId: { type: 'string', minLength: 1 },
      },
    },
  },
];

assertReadonlyToolDefinitions(TOOL_DEFINITIONS);

const TOOL_NAME_SET = new Set(TOOL_DEFINITIONS.map((t) => t.name));

export async function callM365Tool({ name, args, authProvider, graphClient }) {
  const toolName = assertReadonlyToolCallName(name, TOOL_NAME_SET);
  const input = args && typeof args === 'object' ? args : {};

  switch (toolName) {
    case 'm365_auth_login':
      return await authProvider.loginInteractive();
    case 'm365_auth_status':
      return await authProvider.getStatus();
    case 'm365_auth_disconnect':
      return await authProvider.disconnect();
    case 'm365_me_profile':
      return await graphClient.getMe();
    case 'm365_mail_list':
      return await graphClient.listMailMessages(input);
    case 'm365_mail_get':
      return await graphClient.getMailMessage(input);
    case 'm365_tasks_list_lists':
      return await graphClient.listTaskLists();
    case 'm365_tasks_list':
      return await graphClient.listTasks(input);
    case 'm365_files_list':
      return await graphClient.listDriveItems(input);
    case 'm365_files_get':
      return await graphClient.getDriveItem(input);
    case 'm365_sharepoint_search_sites':
      return await graphClient.searchSites(input);
    case 'm365_sharepoint_list_drives':
      return await graphClient.listSiteDrives(input);
    default:
      throw new Error(`unsupported tool: ${toolName}`);
  }
}
