import test from 'node:test';
import assert from 'node:assert/strict';

import { createGraphCalendarSharepointClient } from '../../mcp/m365-write/graph-client.mjs';

function makeClient(fetchImpl) {
  return createGraphCalendarSharepointClient({
    tokenProvider: {
      async getAccessToken() {
        return 'test-token';
      },
    },
    fetchImpl,
  });
}

function okJson(data) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    async text() {
      return JSON.stringify(data);
    },
  };
}

test('m365 write graph client calendar range uses /me/calendarView with required query parameters', async () => {
  let calledUrl;
  let calledMethod;
  const client = makeClient(async (url, init) => {
    calledUrl = new URL(url);
    calledMethod = String(init?.method || '');
    return okJson({ value: [] });
  });

  await client.listCalendarEventsRange({
    startDateTime: '2026-07-01T00:00:00Z',
    endDateTime: '2026-07-15T00:00:00Z',
    top: 20,
  });

  assert.equal(calledMethod, 'GET');
  assert.equal(calledUrl.pathname, '/v1.0/me/calendarView');
  assert.equal(calledUrl.searchParams.get('startDateTime'), '2026-07-01T00:00:00Z');
  assert.equal(calledUrl.searchParams.get('endDateTime'), '2026-07-15T00:00:00Z');
  assert.equal(calledUrl.searchParams.get('$top'), '20');
});

test('m365 write graph client rejects unbounded calendar ranges over 31 days', async () => {
  const client = makeClient(async () => okJson({ value: [] }));

  await assert.rejects(
    () => client.listCalendarEventsRange({
      startDateTime: '2026-07-01T00:00:00Z',
      endDateTime: '2026-08-15T00:00:00Z',
    }),
    /date range exceeds 31 days/i,
  );
});

test('m365 write graph client lists modern site pages with bounded top', async () => {
  let calledUrl;
  let calledMethod;
  const client = makeClient(async (url, init) => {
    calledUrl = new URL(url);
    calledMethod = String(init?.method || '');
    return okJson({ value: [] });
  });

  await client.listSitePages({ siteId: 'site-123', top: 15 });

  assert.equal(calledMethod, 'GET');
  assert.equal(calledUrl.pathname, '/v1.0/sites/site-123/pages/microsoft.graph.sitePage');
  assert.equal(calledUrl.searchParams.get('$top'), '15');
  assert.match(String(calledUrl.searchParams.get('$select')), /title/);
});

test('m365 write graph client gets one modern site page', async () => {
  let calledUrl;
  const client = makeClient(async (url) => {
    calledUrl = new URL(url);
    return okJson({ id: 'page-1' });
  });

  await client.getSitePage({ siteId: 'site-123', pageId: 'page-1' });

  assert.equal(calledUrl.pathname, '/v1.0/sites/site-123/pages/page-1/microsoft.graph.sitePage');
  assert.match(String(calledUrl.searchParams.get('$select')), /canvasLayout/);
});

test('m365 write graph client creates site page draft using /sites/{id}/pages', async () => {
  let calledUrl;
  let calledMethod;
  let calledHeaders;
  let calledBody;
  const client = makeClient(async (url, init) => {
    calledUrl = new URL(url);
    calledMethod = String(init?.method || '');
    calledHeaders = init?.headers || {};
    calledBody = JSON.parse(String(init?.body || '{}'));
    return okJson({ id: 'page-1' });
  });

  await client.createSitePageDraft({ siteId: 'site-123', title: 'Draft title', pageLayout: 'article' });

  assert.equal(calledMethod, 'POST');
  assert.equal(calledUrl.pathname, '/v1.0/sites/site-123/pages');
  assert.equal(calledHeaders['Content-Type'], 'application/json');
  assert.equal(calledBody['@odata.type'], '#microsoft.graph.sitePage');
  assert.equal(calledBody.title, 'Draft title');
  assert.equal(calledBody.pageLayout, 'article');
});

test('m365 write graph client updates site page draft and forwards If-Match ETag', async () => {
  let calledUrl;
  let calledMethod;
  let calledHeaders;
  let calledBody;
  const client = makeClient(async (url, init) => {
    calledUrl = new URL(url);
    calledMethod = String(init?.method || '');
    calledHeaders = init?.headers || {};
    calledBody = JSON.parse(String(init?.body || '{}'));
    return okJson({ id: 'page-1' });
  });

  await client.updateSitePageDraft({
    siteId: 'site-123',
    pageId: 'page-1',
    title: 'Updated title',
    ifMatchEtag: 'W/"etag-1"',
  });

  assert.equal(calledMethod, 'PATCH');
  assert.equal(calledUrl.pathname, '/v1.0/sites/site-123/pages/page-1/microsoft.graph.sitePage');
  assert.equal(calledHeaders['If-Match'], 'W/"etag-1"');
  assert.equal(calledBody.title, 'Updated title');
});

test('m365 write graph client lists site lists and list items with fields expansion', async () => {
  const requests = [];
  const client = makeClient(async (url, init) => {
    requests.push({ url: new URL(url), method: String(init?.method || '') });
    return okJson({ value: [] });
  });

  await client.listSiteLists({ siteId: 'site-123', top: 12 });
  await client.listSiteListItems({ siteId: 'site-123', listId: 'list-1', top: 20 });

  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].url.pathname, '/v1.0/sites/site-123/lists');
  assert.equal(requests[0].url.searchParams.get('$top'), '12');

  assert.equal(requests[1].method, 'GET');
  assert.equal(requests[1].url.pathname, '/v1.0/sites/site-123/lists/list-1/items');
  assert.equal(requests[1].url.searchParams.get('$top'), '20');
  assert.equal(requests[1].url.searchParams.get('$expand'), 'fields');
});

test('m365 write graph client gets one site list and one site list item', async () => {
  const requests = [];
  const client = makeClient(async (url, init) => {
    requests.push({ url: new URL(url), method: String(init?.method || '') });
    return okJson({ ok: true });
  });

  await client.getSiteList({ siteId: 'site-123', listId: 'list-1' });
  await client.getSiteListItem({ siteId: 'site-123', listId: 'list-1', itemId: '42' });

  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].url.pathname, '/v1.0/sites/site-123/lists/list-1');
  assert.equal(requests[1].method, 'GET');
  assert.equal(requests[1].url.pathname, '/v1.0/sites/site-123/lists/list-1/items/42');
  assert.equal(requests[1].url.searchParams.get('$expand'), 'fields');
});

test('m365 write graph client creates and updates site list items with fields payload and ETag', async () => {
  const requests = [];
  const client = makeClient(async (url, init) => {
    requests.push({
      url: new URL(url),
      method: String(init?.method || ''),
      headers: init?.headers || {},
      body: JSON.parse(String(init?.body || '{}')),
    });
    return okJson({ id: '1' });
  });

  await client.createSiteListItem({ siteId: 'site-123', listId: 'list-1', fields: { Title: 'Created' } });
  await client.updateSiteListItem({
    siteId: 'site-123',
    listId: 'list-1',
    itemId: '1',
    fields: { Title: 'Updated' },
    ifMatchEtag: 'W/"item-etag"',
  });

  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url.pathname, '/v1.0/sites/site-123/lists/list-1/items');
  assert.deepEqual(requests[0].body, { fields: { Title: 'Created' } });

  assert.equal(requests[1].method, 'PATCH');
  assert.equal(requests[1].url.pathname, '/v1.0/sites/site-123/lists/list-1/items/1');
  assert.equal(requests[1].headers['If-Match'], 'W/"item-etag"');
  assert.deepEqual(requests[1].body, { fields: { Title: 'Updated' } });
});

test('m365 write graph client validates unsafe IDs for new sharepoint methods', async () => {
  const client = makeClient(async () => okJson({ value: [] }));

  await assert.rejects(
    () => client.getSitePage({ siteId: 'site-123', pageId: '../bad' }),
    /contains invalid characters/i,
  );
  await assert.rejects(
    () => client.listSiteLists({ siteId: '' }),
    /siteId is required/i,
  );
});
