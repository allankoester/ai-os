import test from 'node:test';
import assert from 'node:assert/strict';

import { createGraphReadonlyClient } from '../../mcp/m365/graph-readonly-client.mjs';

function makeClient(fetchImpl) {
  return createGraphReadonlyClient({
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

test('m365 graph readonly listTaskLists omits $select and returns useful fields only', async () => {
  let calledUrl;
  const client = makeClient(async (url) => {
    calledUrl = new URL(url);
    return okJson({
      value: [
        {
          id: 'list-1',
          displayName: 'My Tasks',
          isShared: false,
          isOwner: true,
          wellknownListName: 'defaultList',
          extraField: 'should-not-leak',
        },
      ],
    });
  });

  const result = await client.listTaskLists();
  assert.equal(calledUrl.pathname, '/v1.0/me/todo/lists');
  assert.equal(calledUrl.searchParams.get('$top'), '50');
  assert.equal(calledUrl.searchParams.has('$select'), false);
  assert.deepEqual(result, {
    value: [
      {
        id: 'list-1',
        displayName: 'My Tasks',
        isShared: false,
        isOwner: true,
        wellknownListName: 'defaultList',
      },
    ],
  });
});

test('m365 graph readonly getDriveItem does not request pre-authorized download URL fields', async () => {
  let calledUrl;
  const client = makeClient(async (url) => {
    calledUrl = new URL(url);
    return okJson({ id: 'item-1' });
  });

  await client.getDriveItem({ itemId: 'item-1' });

  assert.equal(calledUrl.pathname, '/v1.0/me/drive/items/item-1');
  const select = calledUrl.searchParams.get('$select');
  assert.ok(select);
  assert.equal(select.includes('@microsoft.graph.downloadUrl'), false);
});

test('m365 graph readonly client only performs GET requests', async () => {
  const methods = [];
  const client = makeClient(async (url, init) => {
    methods.push(String(init?.method || ''));
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/me')) return okJson({ id: 'me' });
    return okJson({ value: [] });
  });

  await client.getMe();
  await client.listMailMessages({ folder: 'inbox', top: 1 });
  await client.listTaskLists();
  await client.listDriveItems({ top: 1 });

  assert.ok(methods.length >= 4);
  for (const method of methods) {
    assert.equal(method, 'GET');
  }
});
