import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_DEFINITIONS, callM365WriteTool } from '../../mcp/m365-write/tools.mjs';

function fakeAuthProvider() {
  return {
    async loginInteractive() {
      return { ok: true, mode: 'native-oauth-browser-pkce' };
    },
    async getStatus() {
      return { ok: true };
    },
    async disconnect() {
      return { ok: true, disconnected: true };
    },
  };
}

test('m365 write tool registry is fixed and has no generic graph proxy', () => {
  const names = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));
  assert.equal(names.has('m365_write_calendar_list_events_range'), true);
  assert.equal(names.has('m365_write_calendar_get_event'), true);
  assert.equal(names.has('m365_write_sharepoint_search_sites'), true);
  assert.equal(names.has('m365_write_sharepoint_list_site_drives'), true);
  assert.equal(names.has('m365_write_sharepoint_list_site_pages'), true);
  assert.equal(names.has('m365_write_sharepoint_get_site_page'), true);
  assert.equal(names.has('m365_write_sharepoint_create_site_page_draft'), true);
  assert.equal(names.has('m365_write_sharepoint_update_site_page_draft'), true);
  assert.equal(names.has('m365_write_sharepoint_list_site_lists'), true);
  assert.equal(names.has('m365_write_sharepoint_get_site_list'), true);
  assert.equal(names.has('m365_write_sharepoint_list_site_list_items'), true);
  assert.equal(names.has('m365_write_sharepoint_get_site_list_item'), true);
  assert.equal(names.has('m365_write_sharepoint_create_site_list_item'), true);
  assert.equal(names.has('m365_write_sharepoint_update_site_list_item'), true);
  assert.equal(names.has('m365_write_sharepoint_read_file'), true);
  assert.equal(names.has('m365_write_sharepoint_create_file'), true);
  assert.equal(names.has('m365_write_sharepoint_update_file'), true);
  assert.equal(names.has('m365_write_sharepoint_delete_file'), true);
  assert.equal(names.has('m365_mail_list'), false);
  assert.equal(names.has('m365_tasks_list'), false);
  assert.equal(names.has('m365_files_list'), false);
  assert.equal(names.has('m365_graph_proxy'), false);
  assert.equal(names.has('m365_write_graph_proxy'), false);
});

test('m365 write tools enforce explicit confirm=true for every mutation tool', async () => {
  const authProvider = fakeAuthProvider();
  const graphClient = {
    async createSitePageDraft() {
      return { ok: true };
    },
    async updateSitePageDraft() {
      return { ok: true };
    },
    async createSiteListItem() {
      return { ok: true };
    },
    async updateSiteListItem() {
      return { ok: true };
    },
    async createFile() {
      return { ok: true };
    },
    async updateFile() {
      return { ok: true };
    },
    async deleteFile() {
      return { ok: true };
    },
  };

  await assert.rejects(
    () => callM365WriteTool({
      name: 'm365_write_sharepoint_create_site_page_draft',
      args: { siteId: 'site-1', title: 'My draft' },
      authProvider,
      graphClient,
    }),
    /requires explicit confirmation/i,
  );

  await assert.rejects(
    () => callM365WriteTool({
      name: 'm365_write_sharepoint_update_site_page_draft',
      args: { siteId: 'site-1', pageId: 'page-1', title: 'Title', confirm: false },
      authProvider,
      graphClient,
    }),
    /requires explicit confirmation/i,
  );

  await assert.rejects(
    () => callM365WriteTool({
      name: 'm365_write_sharepoint_create_site_list_item',
      args: { siteId: 'site-1', listId: 'list-1', fields: { Title: 'Item' } },
      authProvider,
      graphClient,
    }),
    /requires explicit confirmation/i,
  );

  await assert.rejects(
    () => callM365WriteTool({
      name: 'm365_write_sharepoint_update_site_list_item',
      args: { siteId: 'site-1', listId: 'list-1', itemId: '1', fields: { Title: 'Item' }, confirm: false },
      authProvider,
      graphClient,
    }),
    /requires explicit confirmation/i,
  );

  await assert.rejects(
    () => callM365WriteTool({
      name: 'm365_write_sharepoint_create_file',
      args: { driveId: 'drive-1', fileName: 'a.txt', contentBase64: 'YQ==' },
      authProvider,
      graphClient,
    }),
    /requires explicit confirmation/i,
  );

  await assert.rejects(
    () => callM365WriteTool({
      name: 'm365_write_sharepoint_update_file',
      args: { driveId: 'drive-1', itemId: 'item-1', contentBase64: 'YQ==', confirm: false },
      authProvider,
      graphClient,
    }),
    /requires explicit confirmation/i,
  );

  await assert.rejects(
    () => callM365WriteTool({
      name: 'm365_write_sharepoint_delete_file',
      args: { driveId: 'drive-1', itemId: 'item-1' },
      authProvider,
      graphClient,
    }),
    /requires explicit confirmation/i,
  );
});

test('m365 write tools dispatch new sharepoint page/list tools through allowlist', async () => {
  const calls = [];
  const graphClient = {
    async listSitePages(input) {
      calls.push(['listSitePages', input]);
      return { value: [] };
    },
    async getSitePage(input) {
      calls.push(['getSitePage', input]);
      return { id: 'page-1' };
    },
    async createSitePageDraft(input) {
      calls.push(['createSitePageDraft', input]);
      return { ok: true };
    },
    async updateSitePageDraft(input) {
      calls.push(['updateSitePageDraft', input]);
      return { ok: true };
    },
    async listSiteLists(input) {
      calls.push(['listSiteLists', input]);
      return { value: [] };
    },
    async getSiteList(input) {
      calls.push(['getSiteList', input]);
      return { id: 'list-1' };
    },
    async listSiteListItems(input) {
      calls.push(['listSiteListItems', input]);
      return { value: [] };
    },
    async getSiteListItem(input) {
      calls.push(['getSiteListItem', input]);
      return { id: '1' };
    },
    async createSiteListItem(input) {
      calls.push(['createSiteListItem', input]);
      return { ok: true };
    },
    async updateSiteListItem(input) {
      calls.push(['updateSiteListItem', input]);
      return { ok: true };
    },
  };

  const authProvider = fakeAuthProvider();
  await callM365WriteTool({ name: 'm365_write_sharepoint_list_site_pages', args: { siteId: 'site-1', top: 5 }, authProvider, graphClient });
  await callM365WriteTool({ name: 'm365_write_sharepoint_get_site_page', args: { siteId: 'site-1', pageId: 'page-1' }, authProvider, graphClient });
  await callM365WriteTool({
    name: 'm365_write_sharepoint_create_site_page_draft',
    args: { siteId: 'site-1', title: 'Draft page', confirm: true },
    authProvider,
    graphClient,
  });
  await callM365WriteTool({
    name: 'm365_write_sharepoint_update_site_page_draft',
    args: { siteId: 'site-1', pageId: 'page-1', title: 'Updated', ifMatchEtag: 'W/"etag"', confirm: true },
    authProvider,
    graphClient,
  });
  await callM365WriteTool({ name: 'm365_write_sharepoint_list_site_lists', args: { siteId: 'site-1' }, authProvider, graphClient });
  await callM365WriteTool({ name: 'm365_write_sharepoint_get_site_list', args: { siteId: 'site-1', listId: 'list-1' }, authProvider, graphClient });
  await callM365WriteTool({ name: 'm365_write_sharepoint_list_site_list_items', args: { siteId: 'site-1', listId: 'list-1' }, authProvider, graphClient });
  await callM365WriteTool({ name: 'm365_write_sharepoint_get_site_list_item', args: { siteId: 'site-1', listId: 'list-1', itemId: '1' }, authProvider, graphClient });
  await callM365WriteTool({
    name: 'm365_write_sharepoint_create_site_list_item',
    args: { siteId: 'site-1', listId: 'list-1', fields: { Title: 'Item' }, confirm: true },
    authProvider,
    graphClient,
  });
  await callM365WriteTool({
    name: 'm365_write_sharepoint_update_site_list_item',
    args: { siteId: 'site-1', listId: 'list-1', itemId: '1', fields: { Title: 'Updated' }, confirm: true },
    authProvider,
    graphClient,
  });

  assert.deepEqual(calls.map(([name]) => name), [
    'listSitePages',
    'getSitePage',
    'createSitePageDraft',
    'updateSitePageDraft',
    'listSiteLists',
    'getSiteList',
    'listSiteListItems',
    'getSiteListItem',
    'createSiteListItem',
    'updateSiteListItem',
  ]);
});

test('m365 write tools dispatch calendar range reads through fixed allowlist', async () => {
  let capturedInput = null;
  const graphClient = {
    async listCalendarEventsRange(input) {
      capturedInput = input;
      return { value: [{ id: 'event-1' }] };
    },
  };

  const result = await callM365WriteTool({
    name: 'm365_write_calendar_list_events_range',
    args: {
      startDateTime: '2026-07-01T00:00:00Z',
      endDateTime: '2026-07-15T00:00:00Z',
      top: 20,
    },
    authProvider: fakeAuthProvider(),
    graphClient,
  });

  assert.deepEqual(capturedInput, {
    startDateTime: '2026-07-01T00:00:00Z',
    endDateTime: '2026-07-15T00:00:00Z',
    top: 20,
  });
  assert.deepEqual(result, { value: [{ id: 'event-1' }] });

  await assert.rejects(
    () => callM365WriteTool({
      name: 'm365_write_not_allowed',
      args: {},
      authProvider: fakeAuthProvider(),
      graphClient,
    }),
    /unknown tool: m365_write_not_allowed/,
  );
});
