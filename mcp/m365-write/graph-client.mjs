const BASE_URL = 'https://graph.microsoft.com/v1.0';
const SAFE_ID_RE = /^[A-Za-z0-9._!$,:=@~\-]+$/;
const SAFE_FILE_NAME_RE = /^[^\\/]+$/;
const MAX_CALENDAR_RANGE_DAYS = 31;

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

function normalizeSiteSearchQuery(query) {
  const raw = String(query ?? '*').trim();
  if (!raw || raw === '*' || raw === '"*"') return '"*"';
  return raw;
}

function assertBoundedDateRange({ startDateTime, endDateTime }) {
  const startRaw = String(startDateTime || '').trim();
  const endRaw = String(endDateTime || '').trim();
  if (!startRaw) throw new Error('startDateTime is required (ISO 8601).');
  if (!endRaw) throw new Error('endDateTime is required (ISO 8601).');

  const startMs = Date.parse(startRaw);
  const endMs = Date.parse(endRaw);
  if (!Number.isFinite(startMs)) throw new Error('startDateTime must be a valid ISO 8601 datetime.');
  if (!Number.isFinite(endMs)) throw new Error('endDateTime must be a valid ISO 8601 datetime.');
  if (endMs <= startMs) throw new Error('endDateTime must be after startDateTime.');

  const dayMs = 24 * 60 * 60 * 1000;
  const rangeDays = (endMs - startMs) / dayMs;
  if (rangeDays > MAX_CALENDAR_RANGE_DAYS) {
    throw new Error(`date range exceeds ${MAX_CALENDAR_RANGE_DAYS} days; use a smaller bounded window.`);
  }

  return { startDateTime: startRaw, endDateTime: endRaw };
}

function assertFileName(value) {
  const fileName = String(value || '').trim();
  if (!fileName) throw new Error('fileName is required');
  if (fileName.length > 255) throw new Error('fileName is too long (max 255 chars)');
  if (!SAFE_FILE_NAME_RE.test(fileName)) throw new Error('fileName must not contain "/" or "\\" characters');
  return fileName;
}

function decodeBase64Content(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('contentBase64 is required and must be a non-empty base64 string');
  const normalized = raw.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error('contentBase64 must be valid standard base64 without data URL prefix');
  }
  let buffer;
  try {
    buffer = Buffer.from(normalized, 'base64');
  } catch {
    throw new Error('contentBase64 must be valid base64');
  }
  if (buffer.length === 0) {
    throw new Error('contentBase64 decoded to empty content; provide non-empty content');
  }
  return buffer;
}

function assertFieldsObject(value, label = 'fields') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a non-null object`);
  }
  return value;
}

function pickDefinedEntries(source, allowedKeys) {
  const out = {};
  for (const key of allowedKeys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

export function createGraphCalendarSharepointClient({ tokenProvider, fetchImpl = fetch, maxReadBytes = 2_000_000 } = {}) {
  if (!tokenProvider || typeof tokenProvider.getAccessToken !== 'function') {
    throw new Error('tokenProvider with getAccessToken() is required');
  }

  async function graphRequest({ method = 'GET', pathname, query = {}, headers = {}, body, expect = 'json' }) {
    const token = await tokenProvider.getAccessToken();
    if (!token) throw new Error('missing access token');

    const url = new URL(`${BASE_URL}${pathname}`);
    for (const [key, raw] of Object.entries(query || {})) {
      if (raw === undefined || raw === null || raw === '') continue;
      url.searchParams.set(key, String(raw));
    }

    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: expect === 'binary' ? '*/*' : 'application/json',
        ...headers,
      },
      ...(body !== undefined ? { body } : {}),
    });

    if (expect === 'binary') {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!response.ok) {
        const text = bytes.toString('utf8');
        throw new Error(`Graph ${response.status} (${pathname}): ${text || response.statusText || 'request failed'}`);
      }
      return { status: response.status, bytes };
    }

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
      const msg = data?.error?.message || data?.raw || response.statusText || 'Graph request failed';
      throw new Error(`Graph ${response.status} (${pathname}): ${msg}`);
    }

    return {
      status: response.status,
      data: data || {},
    };
  }

  function buildCreatePath(driveId, parentItemId, fileName) {
    const encodedName = encodeURIComponent(fileName);
    if (parentItemId) {
      return `/drives/${driveId}/items/${parentItemId}:/${encodedName}:/content`;
    }
    return `/drives/${driveId}/root:/${encodedName}:/content`;
  }

  return {
    async listCalendarEventsRange({ startDateTime, endDateTime, top = 25 } = {}) {
      const range = assertBoundedDateRange({ startDateTime, endDateTime });
      const limit = toPositiveInt(top, 25, 100);
      const { data } = await graphRequest({
        method: 'GET',
        pathname: '/me/calendarView',
        query: {
          startDateTime: range.startDateTime,
          endDateTime: range.endDateTime,
          $top: limit,
          $orderby: 'start/dateTime asc',
          $select: 'id,subject,start,end,organizer,location,isAllDay,showAs,lastModifiedDateTime,webLink',
        },
      });
      return {
        value: Array.isArray(data.value) ? data.value : [],
        nextLink: data['@odata.nextLink'] || null,
      };
    },

    async getCalendarEvent({ eventId } = {}) {
      const id = assertSafeId(eventId, 'eventId');
      const { data } = await graphRequest({
        method: 'GET',
        pathname: `/me/events/${id}`,
        query: {
          $select: 'id,subject,bodyPreview,start,end,organizer,attendees,location,isAllDay,showAs,lastModifiedDateTime,webLink',
        },
      });
      return data;
    },

    async searchSites({ query = '*', top = 10 } = {}) {
      const limit = toPositiveInt(top, 10, 50);
      const search = normalizeSiteSearchQuery(query);
      const { data } = await graphRequest({
        method: 'GET',
        pathname: '/sites',
        query: {
          search,
          $top: limit,
          $select: 'id,name,displayName,webUrl,siteCollection',
        },
      });
      return {
        value: Array.isArray(data.value) ? data.value : [],
      };
    },

    async listSiteDrives({ siteId } = {}) {
      const id = assertSafeId(siteId, 'siteId');
      const { data } = await graphRequest({
        method: 'GET',
        pathname: `/sites/${id}/drives`,
        query: {
          $top: 100,
          $select: 'id,name,description,webUrl,driveType,createdDateTime,lastModifiedDateTime',
        },
      });
      return {
        value: Array.isArray(data.value) ? data.value : [],
      };
    },

    async listSitePages({ siteId, top = 25 } = {}) {
      const safeSiteId = assertSafeId(siteId, 'siteId');
      const limit = toPositiveInt(top, 25, 100);
      const { data } = await graphRequest({
        method: 'GET',
        pathname: `/sites/${safeSiteId}/pages/microsoft.graph.sitePage`,
        query: {
          $top: limit,
          $select: 'id,name,title,pageLayout,promotionKind,webUrl,createdDateTime,lastModifiedDateTime,eTag',
        },
      });
      return {
        value: Array.isArray(data.value) ? data.value : [],
        nextLink: data['@odata.nextLink'] || null,
      };
    },

    async getSitePage({ siteId, pageId } = {}) {
      const safeSiteId = assertSafeId(siteId, 'siteId');
      const safePageId = assertSafeId(pageId, 'pageId');
      const { data } = await graphRequest({
        method: 'GET',
        pathname: `/sites/${safeSiteId}/pages/${safePageId}/microsoft.graph.sitePage`,
        query: {
          $select: 'id,name,title,description,pageLayout,promotionKind,showComments,showRecommendedPages,thumbnailWebUrl,webUrl,canvasLayout,createdDateTime,lastModifiedDateTime,eTag',
        },
      });
      return data;
    },

    async createSitePageDraft(input = {}) {
      const safeSiteId = assertSafeId(input.siteId, 'siteId');
      const title = String(input.title || '').trim();
      if (!title) throw new Error('title is required');

      const pagePayload = {
        '@odata.type': '#microsoft.graph.sitePage',
        title,
        ...pickDefinedEntries(input, [
          'name',
          'description',
          'pageLayout',
          'promotionKind',
          'showComments',
          'showRecommendedPages',
          'thumbnailWebUrl',
          'canvasLayout',
        ]),
      };

      const { data } = await graphRequest({
        method: 'POST',
        pathname: `/sites/${safeSiteId}/pages`,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pagePayload),
      });
      return {
        ok: true,
        action: 'create',
        page: data,
      };
    },

    async updateSitePageDraft(input = {}) {
      const safeSiteId = assertSafeId(input.siteId, 'siteId');
      const safePageId = assertSafeId(input.pageId, 'pageId');
      const patch = pickDefinedEntries(input, [
        'title',
        'description',
        'pageLayout',
        'promotionKind',
        'showComments',
        'showRecommendedPages',
        'thumbnailWebUrl',
        'canvasLayout',
      ]);
      if (Object.keys(patch).length === 0) {
        throw new Error('at least one updatable page field is required');
      }

      const headers = { 'Content-Type': 'application/json' };
      const ifMatch = String(input.ifMatchEtag || '').trim();
      if (ifMatch) headers['If-Match'] = ifMatch;

      const { data } = await graphRequest({
        method: 'PATCH',
        pathname: `/sites/${safeSiteId}/pages/${safePageId}/microsoft.graph.sitePage`,
        headers,
        body: JSON.stringify(patch),
      });
      return {
        ok: true,
        action: 'update',
        page: data,
      };
    },

    async listSiteLists({ siteId, top = 50 } = {}) {
      const safeSiteId = assertSafeId(siteId, 'siteId');
      const limit = toPositiveInt(top, 50, 100);
      const { data } = await graphRequest({
        method: 'GET',
        pathname: `/sites/${safeSiteId}/lists`,
        query: {
          $top: limit,
          $select: 'id,name,displayName,description,webUrl,createdDateTime,lastModifiedDateTime,list',
        },
      });
      return {
        value: Array.isArray(data.value) ? data.value : [],
        nextLink: data['@odata.nextLink'] || null,
      };
    },

    async getSiteList({ siteId, listId } = {}) {
      const safeSiteId = assertSafeId(siteId, 'siteId');
      const safeListId = assertSafeId(listId, 'listId');
      const { data } = await graphRequest({
        method: 'GET',
        pathname: `/sites/${safeSiteId}/lists/${safeListId}`,
        query: {
          $select: 'id,name,displayName,description,webUrl,createdDateTime,lastModifiedDateTime,list',
        },
      });
      return data;
    },

    async listSiteListItems({ siteId, listId, top = 50 } = {}) {
      const safeSiteId = assertSafeId(siteId, 'siteId');
      const safeListId = assertSafeId(listId, 'listId');
      const limit = toPositiveInt(top, 50, 200);
      const { data } = await graphRequest({
        method: 'GET',
        pathname: `/sites/${safeSiteId}/lists/${safeListId}/items`,
        query: {
          $top: limit,
          $expand: 'fields',
          $select: 'id,webUrl,createdDateTime,lastModifiedDateTime,eTag,fields',
        },
      });
      return {
        value: Array.isArray(data.value) ? data.value : [],
        nextLink: data['@odata.nextLink'] || null,
      };
    },

    async getSiteListItem({ siteId, listId, itemId } = {}) {
      const safeSiteId = assertSafeId(siteId, 'siteId');
      const safeListId = assertSafeId(listId, 'listId');
      const safeItemId = assertSafeId(itemId, 'itemId');
      const { data } = await graphRequest({
        method: 'GET',
        pathname: `/sites/${safeSiteId}/lists/${safeListId}/items/${safeItemId}`,
        query: {
          $expand: 'fields',
          $select: 'id,webUrl,createdDateTime,lastModifiedDateTime,eTag,fields',
        },
      });
      return data;
    },

    async createSiteListItem({ siteId, listId, fields } = {}) {
      const safeSiteId = assertSafeId(siteId, 'siteId');
      const safeListId = assertSafeId(listId, 'listId');
      const safeFields = assertFieldsObject(fields, 'fields');
      const { data } = await graphRequest({
        method: 'POST',
        pathname: `/sites/${safeSiteId}/lists/${safeListId}/items`,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: safeFields }),
      });
      return {
        ok: true,
        action: 'create',
        item: data,
      };
    },

    async updateSiteListItem({ siteId, listId, itemId, fields, ifMatchEtag } = {}) {
      const safeSiteId = assertSafeId(siteId, 'siteId');
      const safeListId = assertSafeId(listId, 'listId');
      const safeItemId = assertSafeId(itemId, 'itemId');
      const safeFields = assertFieldsObject(fields, 'fields');
      const headers = { 'Content-Type': 'application/json' };
      const ifMatch = String(ifMatchEtag || '').trim();
      if (ifMatch) headers['If-Match'] = ifMatch;

      const { data } = await graphRequest({
        method: 'PATCH',
        pathname: `/sites/${safeSiteId}/lists/${safeListId}/items/${safeItemId}`,
        headers,
        body: JSON.stringify({ fields: safeFields }),
      });
      return {
        ok: true,
        action: 'update',
        item: data,
      };
    },

    async listDriveItems({ driveId, itemId, top = 50 } = {}) {
      const safeDriveId = assertSafeId(driveId, 'driveId');
      const limit = toPositiveInt(top, 50, 100);
      const endpoint = itemId
        ? `/drives/${safeDriveId}/items/${assertSafeId(itemId, 'itemId')}/children`
        : `/drives/${safeDriveId}/root/children`;
      const { data } = await graphRequest({
        method: 'GET',
        pathname: endpoint,
        query: {
          $top: limit,
          $select: 'id,name,webUrl,size,lastModifiedDateTime,createdDateTime,file,folder,parentReference,eTag',
        },
      });
      return {
        value: Array.isArray(data.value) ? data.value : [],
        nextLink: data['@odata.nextLink'] || null,
      };
    },

    async readFile({ driveId, itemId } = {}) {
      const safeDriveId = assertSafeId(driveId, 'driveId');
      const safeItemId = assertSafeId(itemId, 'itemId');

      const { data: metadata } = await graphRequest({
        method: 'GET',
        pathname: `/drives/${safeDriveId}/items/${safeItemId}`,
        query: {
          $select: 'id,name,size,webUrl,lastModifiedDateTime,file,parentReference,eTag',
        },
      });

      const expectedSize = Number.parseInt(String(metadata?.size || '0'), 10);
      if (Number.isFinite(expectedSize) && expectedSize > maxReadBytes) {
        throw new Error(`file too large to read through MCP (${expectedSize} bytes > ${maxReadBytes} bytes max)`);
      }

      const { bytes } = await graphRequest({
        method: 'GET',
        pathname: `/drives/${safeDriveId}/items/${safeItemId}/content`,
        expect: 'binary',
      });
      if (bytes.length > maxReadBytes) {
        throw new Error(`file content exceeds maximum read limit (${bytes.length} bytes > ${maxReadBytes} bytes max)`);
      }

      return {
        metadata,
        contentBytes: bytes.length,
        contentBase64: bytes.toString('base64'),
      };
    },

    async createFile({ driveId, parentItemId, fileName, contentBase64, ifMatchEtag } = {}) {
      const safeDriveId = assertSafeId(driveId, 'driveId');
      const safeParent = parentItemId ? assertSafeId(parentItemId, 'parentItemId') : '';
      const safeFileName = assertFileName(fileName);
      const contentBuffer = decodeBase64Content(contentBase64);
      const headers = {
        'Content-Type': 'application/octet-stream',
      };
      const ifMatch = String(ifMatchEtag || '').trim();
      if (ifMatch) headers['If-Match'] = ifMatch;

      const { data } = await graphRequest({
        method: 'PUT',
        pathname: buildCreatePath(safeDriveId, safeParent, safeFileName),
        headers,
        body: contentBuffer,
      });
      return {
        ok: true,
        action: 'create',
        item: data,
      };
    },

    async updateFile({ driveId, itemId, contentBase64, ifMatchEtag } = {}) {
      const safeDriveId = assertSafeId(driveId, 'driveId');
      const safeItemId = assertSafeId(itemId, 'itemId');
      const contentBuffer = decodeBase64Content(contentBase64);
      const headers = {
        'Content-Type': 'application/octet-stream',
      };
      const ifMatch = String(ifMatchEtag || '').trim();
      if (ifMatch) headers['If-Match'] = ifMatch;

      const { data } = await graphRequest({
        method: 'PUT',
        pathname: `/drives/${safeDriveId}/items/${safeItemId}/content`,
        headers,
        body: contentBuffer,
      });
      return {
        ok: true,
        action: 'update',
        item: data,
      };
    },

    async deleteFile({ driveId, itemId, ifMatchEtag } = {}) {
      const safeDriveId = assertSafeId(driveId, 'driveId');
      const safeItemId = assertSafeId(itemId, 'itemId');
      const headers = {};
      const ifMatch = String(ifMatchEtag || '').trim();
      if (ifMatch) headers['If-Match'] = ifMatch;

      await graphRequest({
        method: 'DELETE',
        pathname: `/drives/${safeDriveId}/items/${safeItemId}`,
        headers,
      });
      return {
        ok: true,
        action: 'delete',
        deleted: true,
        driveId: safeDriveId,
        itemId: safeItemId,
      };
    },
  };
}
