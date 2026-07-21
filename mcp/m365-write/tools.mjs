function assertToolName(name, knownNames) {
  const normalized = String(name || '').trim();
  if (!knownNames.has(normalized)) {
    throw new Error(`unknown tool: ${normalized}`);
  }
  return normalized;
}

function assertConfirmTrue(toolName, input) {
  if (input?.confirm !== true) {
    throw new Error(`${toolName} requires explicit confirmation. Re-run with confirm=true.`);
  }
}

export const TOOL_DEFINITIONS = [
  {
    name: 'm365_write_auth_login',
    description: 'Starts native Microsoft 365 browser login for write-capable server (Authorization Code + PKCE).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'm365_write_auth_status',
    description: 'Returns auth status for write-capable Microsoft 365 MCP server.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'm365_write_auth_disconnect',
    description: 'Clears write-capable server auth session from memory and keychain.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'm365_write_calendar_list_events_range',
    description: 'Lists calendar events in a bounded date range (max 31 days).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['startDateTime', 'endDateTime'],
      properties: {
        startDateTime: { type: 'string', minLength: 1 },
        endDateTime: { type: 'string', minLength: 1 },
        top: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
    },
  },
  {
    name: 'm365_write_calendar_get_event',
    description: 'Reads one calendar event by eventId.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['eventId'],
      properties: {
        eventId: { type: 'string', minLength: 1 },
      },
    },
  },
  {
    name: 'm365_write_sharepoint_search_sites',
    description: 'Searches accessible SharePoint sites.',
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
    name: 'm365_write_sharepoint_list_site_drives',
    description: 'Lists document libraries (drives) for a SharePoint siteId.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId'],
      properties: {
        siteId: { type: 'string', minLength: 1 },
      },
    },
  },
  {
    name: 'm365_write_sharepoint_list_site_pages',
    description: 'Lists modern SharePoint pages for a siteId.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId'],
      properties: {
        siteId: { type: 'string', minLength: 1 },
        top: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
    },
  },
  {
    name: 'm365_write_sharepoint_get_site_page',
    description: 'Gets one modern SharePoint page by siteId/pageId.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId', 'pageId'],
      properties: {
        siteId: { type: 'string', minLength: 1 },
        pageId: { type: 'string', minLength: 1 },
      },
    },
  },
  {
    name: 'm365_write_sharepoint_create_site_page_draft',
    description: 'Creates a modern SharePoint page draft. Mutation safety gate: confirm=true required.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId', 'title', 'confirm'],
      properties: {
        siteId: { type: 'string', minLength: 1 },
        title: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1 },
        description: { type: 'string' },
        pageLayout: { type: 'string', minLength: 1 },
        promotionKind: { type: 'string', minLength: 1 },
        showComments: { type: 'boolean' },
        showRecommendedPages: { type: 'boolean' },
        thumbnailWebUrl: { type: 'string', minLength: 1 },
        canvasLayout: { type: 'object' },
        confirm: { type: 'boolean', const: true },
      },
    },
  },
  {
    name: 'm365_write_sharepoint_update_site_page_draft',
    description: 'Updates a modern SharePoint page draft. Mutation safety gate: confirm=true required.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId', 'pageId', 'confirm'],
      properties: {
        siteId: { type: 'string', minLength: 1 },
        pageId: { type: 'string', minLength: 1 },
        title: { type: 'string', minLength: 1 },
        description: { type: 'string' },
        pageLayout: { type: 'string', minLength: 1 },
        promotionKind: { type: 'string', minLength: 1 },
        showComments: { type: 'boolean' },
        showRecommendedPages: { type: 'boolean' },
        thumbnailWebUrl: { type: 'string', minLength: 1 },
        canvasLayout: { type: 'object' },
        ifMatchEtag: { type: 'string', minLength: 1 },
        confirm: { type: 'boolean', const: true },
      },
    },
  },
  {
    name: 'm365_write_sharepoint_list_site_lists',
    description: 'Lists SharePoint lists for a siteId.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId'],
      properties: {
        siteId: { type: 'string', minLength: 1 },
        top: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
    },
  },
  {
    name: 'm365_write_sharepoint_get_site_list',
    description: 'Gets one SharePoint list by siteId/listId.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId', 'listId'],
      properties: {
        siteId: { type: 'string', minLength: 1 },
        listId: { type: 'string', minLength: 1 },
      },
    },
  },
  {
    name: 'm365_write_sharepoint_list_site_list_items',
    description: 'Lists SharePoint list items for a siteId/listId with expanded fields.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId', 'listId'],
      properties: {
        siteId: { type: 'string', minLength: 1 },
        listId: { type: 'string', minLength: 1 },
        top: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
    },
  },
  {
    name: 'm365_write_sharepoint_get_site_list_item',
    description: 'Gets one SharePoint list item by siteId/listId/itemId.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId', 'listId', 'itemId'],
      properties: {
        siteId: { type: 'string', minLength: 1 },
        listId: { type: 'string', minLength: 1 },
        itemId: { type: 'string', minLength: 1 },
      },
    },
  },
  {
    name: 'm365_write_sharepoint_create_site_list_item',
    description: 'Creates a SharePoint list item. Mutation safety gate: confirm=true required.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId', 'listId', 'fields', 'confirm'],
      properties: {
        siteId: { type: 'string', minLength: 1 },
        listId: { type: 'string', minLength: 1 },
        fields: { type: 'object' },
        confirm: { type: 'boolean', const: true },
      },
    },
  },
  {
    name: 'm365_write_sharepoint_update_site_list_item',
    description: 'Updates a SharePoint list item. Mutation safety gate: confirm=true required.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId', 'listId', 'itemId', 'fields', 'confirm'],
      properties: {
        siteId: { type: 'string', minLength: 1 },
        listId: { type: 'string', minLength: 1 },
        itemId: { type: 'string', minLength: 1 },
        fields: { type: 'object' },
        ifMatchEtag: { type: 'string', minLength: 1 },
        confirm: { type: 'boolean', const: true },
      },
    },
  },
  {
    name: 'm365_write_sharepoint_list_drive_items',
    description: 'Lists files/folders in a drive root or folder by itemId.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['driveId'],
      properties: {
        driveId: { type: 'string', minLength: 1 },
        itemId: { type: 'string', minLength: 1 },
        top: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
    },
  },
  {
    name: 'm365_write_sharepoint_read_file',
    description: 'Reads a file metadata + content (base64) by driveId/itemId.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['driveId', 'itemId'],
      properties: {
        driveId: { type: 'string', minLength: 1 },
        itemId: { type: 'string', minLength: 1 },
      },
    },
  },
  {
    name: 'm365_write_sharepoint_create_file',
    description: 'Creates a file in drive root or folder. Mutation safety gate: confirm=true required.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['driveId', 'fileName', 'contentBase64', 'confirm'],
      properties: {
        driveId: { type: 'string', minLength: 1 },
        parentItemId: { type: 'string', minLength: 1 },
        fileName: { type: 'string', minLength: 1, maxLength: 255 },
        contentBase64: { type: 'string', minLength: 1 },
        ifMatchEtag: { type: 'string', minLength: 1 },
        confirm: { type: 'boolean', const: true },
      },
    },
  },
  {
    name: 'm365_write_sharepoint_update_file',
    description: 'Updates existing file content by driveId/itemId. Mutation safety gate: confirm=true required.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['driveId', 'itemId', 'contentBase64', 'confirm'],
      properties: {
        driveId: { type: 'string', minLength: 1 },
        itemId: { type: 'string', minLength: 1 },
        contentBase64: { type: 'string', minLength: 1 },
        ifMatchEtag: { type: 'string', minLength: 1 },
        confirm: { type: 'boolean', const: true },
      },
    },
  },
  {
    name: 'm365_write_sharepoint_delete_file',
    description: 'Deletes a file by driveId/itemId. Mutation safety gate: confirm=true required.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['driveId', 'itemId', 'confirm'],
      properties: {
        driveId: { type: 'string', minLength: 1 },
        itemId: { type: 'string', minLength: 1 },
        ifMatchEtag: { type: 'string', minLength: 1 },
        confirm: { type: 'boolean', const: true },
      },
    },
  },
];

const TOOL_NAME_SET = new Set(TOOL_DEFINITIONS.map((t) => t.name));

export async function callM365WriteTool({ name, args, authProvider, graphClient }) {
  const toolName = assertToolName(name, TOOL_NAME_SET);
  const input = args && typeof args === 'object' ? args : {};

  switch (toolName) {
    case 'm365_write_auth_login':
      return await authProvider.loginInteractive();
    case 'm365_write_auth_status':
      return await authProvider.getStatus();
    case 'm365_write_auth_disconnect':
      return await authProvider.disconnect();
    case 'm365_write_calendar_list_events_range':
      return await graphClient.listCalendarEventsRange(input);
    case 'm365_write_calendar_get_event':
      return await graphClient.getCalendarEvent(input);
    case 'm365_write_sharepoint_search_sites':
      return await graphClient.searchSites(input);
    case 'm365_write_sharepoint_list_site_drives':
      return await graphClient.listSiteDrives(input);
    case 'm365_write_sharepoint_list_site_pages':
      return await graphClient.listSitePages(input);
    case 'm365_write_sharepoint_get_site_page':
      return await graphClient.getSitePage(input);
    case 'm365_write_sharepoint_create_site_page_draft':
      assertConfirmTrue(toolName, input);
      return await graphClient.createSitePageDraft(input);
    case 'm365_write_sharepoint_update_site_page_draft':
      assertConfirmTrue(toolName, input);
      return await graphClient.updateSitePageDraft(input);
    case 'm365_write_sharepoint_list_site_lists':
      return await graphClient.listSiteLists(input);
    case 'm365_write_sharepoint_get_site_list':
      return await graphClient.getSiteList(input);
    case 'm365_write_sharepoint_list_site_list_items':
      return await graphClient.listSiteListItems(input);
    case 'm365_write_sharepoint_get_site_list_item':
      return await graphClient.getSiteListItem(input);
    case 'm365_write_sharepoint_create_site_list_item':
      assertConfirmTrue(toolName, input);
      return await graphClient.createSiteListItem(input);
    case 'm365_write_sharepoint_update_site_list_item':
      assertConfirmTrue(toolName, input);
      return await graphClient.updateSiteListItem(input);
    case 'm365_write_sharepoint_list_drive_items':
      return await graphClient.listDriveItems(input);
    case 'm365_write_sharepoint_read_file':
      return await graphClient.readFile(input);
    case 'm365_write_sharepoint_create_file':
      assertConfirmTrue(toolName, input);
      return await graphClient.createFile(input);
    case 'm365_write_sharepoint_update_file':
      assertConfirmTrue(toolName, input);
      return await graphClient.updateFile(input);
    case 'm365_write_sharepoint_delete_file':
      assertConfirmTrue(toolName, input);
      return await graphClient.deleteFile(input);
    default:
      throw new Error(`unsupported tool: ${toolName}`);
  }
}
