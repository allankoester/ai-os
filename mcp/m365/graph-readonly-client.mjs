const BASE_URL = 'https://graph.microsoft.com/v1.0';
const SAFE_ID_RE = /^[A-Za-z0-9._!$,:=@~\-]+$/;
const FOLDER_MAP = {
  inbox: 'inbox',
  archive: 'archive',
  drafts: 'drafts',
  sentitems: 'sentitems',
};

function toPositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function assertSafeId(value, label) {
  const id = String(value || '').trim();
  if (!id) throw new Error(`${label} is required`);
  if (!SAFE_ID_RE.test(id)) throw new Error(`${label} contains invalid characters`);
  return id;
}

function folderToGraphId(folder) {
  const normalized = String(folder || 'inbox').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(FOLDER_MAP, normalized)) {
    throw new Error(`unsupported mail folder: ${folder}. allowed folders: ${Object.keys(FOLDER_MAP).join(', ')}`);
  }
  return FOLDER_MAP[normalized];
}

export function createGraphReadonlyClient({ tokenProvider, fetchImpl = fetch } = {}) {
  if (!tokenProvider || typeof tokenProvider.getAccessToken !== 'function') {
    throw new Error('tokenProvider with getAccessToken() is required');
  }

  async function graphGet(pathname, query = {}) {
    const token = await tokenProvider.getAccessToken();
    if (!token) throw new Error('missing access token');

    const url = new URL(`${BASE_URL}${pathname}`);
    for (const [key, raw] of Object.entries(query || {})) {
      if (raw === undefined || raw === null || raw === '') continue;
      url.searchParams.set(key, String(raw));
    }

    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    if (!response.ok) {
      const msg = data?.error?.message || response.statusText || 'Graph request failed';
      throw new Error(`Graph ${response.status} (${pathname}): ${msg}`);
    }
    return data || {};
  }

  function pickTaskListFields(list) {
    if (!list || typeof list !== 'object') return list;
    return {
      id: list.id ?? null,
      displayName: list.displayName ?? null,
      isShared: list.isShared ?? null,
      isOwner: list.isOwner ?? null,
      wellknownListName: list.wellknownListName ?? null,
    };
  }

  return {
    async getMe() {
      return await graphGet('/me', {
        $select: 'id,displayName,userPrincipalName,mail',
      });
    },

    async listMailMessages({ folder = 'inbox', top = 10 } = {}) {
      const folderId = folderToGraphId(folder);
      const limit = toPositiveInt(top, 10, 50);
      const data = await graphGet(`/me/mailFolders/${folderId}/messages`, {
        $top: limit,
        $select: 'id,subject,from,receivedDateTime,isRead,conversationId,webLink',
        $orderby: 'receivedDateTime desc',
      });
      return {
        value: Array.isArray(data.value) ? data.value : [],
        nextLink: data['@odata.nextLink'] || null,
      };
    },

    async getMailMessage({ messageId }) {
      const id = assertSafeId(messageId, 'messageId');
      return await graphGet(`/me/messages/${id}`, {
        $select: 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,body,hasAttachments,importance,isRead,conversationId,webLink',
      });
    },

    async listTaskLists() {
      const data = await graphGet('/me/todo/lists', {
        $top: 50,
      });
      return {
        value: Array.isArray(data.value) ? data.value.map(pickTaskListFields) : [],
      };
    },

    async listTasks({ listId, top = 25 } = {}) {
      const id = assertSafeId(listId, 'listId');
      const limit = toPositiveInt(top, 25, 100);
      const data = await graphGet(`/me/todo/lists/${id}/tasks`, {
        $top: limit,
        $select: 'id,title,status,importance,createdDateTime,lastModifiedDateTime,dueDateTime,body,completedDateTime',
      });
      return {
        value: Array.isArray(data.value) ? data.value : [],
        nextLink: data['@odata.nextLink'] || null,
      };
    },

    async listDriveItems({ itemId, top = 25 } = {}) {
      const limit = toPositiveInt(top, 25, 100);
      const endpoint = itemId
        ? `/me/drive/items/${assertSafeId(itemId, 'itemId')}/children`
        : '/me/drive/root/children';
      const data = await graphGet(endpoint, {
        $top: limit,
        $select: 'id,name,webUrl,size,lastModifiedDateTime,createdDateTime,file,folder,parentReference',
      });
      return {
        value: Array.isArray(data.value) ? data.value : [],
        nextLink: data['@odata.nextLink'] || null,
      };
    },

    async getDriveItem({ itemId }) {
      const id = assertSafeId(itemId, 'itemId');
      return await graphGet(`/me/drive/items/${id}`, {
        $select: 'id,name,webUrl,size,lastModifiedDateTime,createdDateTime,file,folder,parentReference',
      });
    },

  };
}
