const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const AUTH_SCOPE = 'https://graph.microsoft.com/.default';
const KNOWLEDGE_PREFIX = 'knowledge/';

function createError(code, message, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function firstHeading(text) {
  const m = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function ensureGraphConfig(config) {
  const missing = [];
  if (!config.tenantId) missing.push('MICROSOFT_TENANT_ID');
  if (!config.clientId) missing.push('MICROSOFT_CLIENT_ID');
  if (!config.clientSecret) missing.push('MICROSOFT_CLIENT_SECRET');
  if (!config.driveId) missing.push('GRAPH_DRIVE_ID');
  if (missing.length) {
    throw createError('CONFIG_ERROR', `graph backend missing env vars: ${missing.join(', ')}`, 500);
  }
}

function toGraphPath(pathValue) {
  return pathValue
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function toKnowledgeSubpath(relPath) {
  if (!relPath.startsWith(KNOWLEDGE_PREFIX) || !relPath.endsWith('.md')) {
    throw createError('INVALID_PATH', 'only knowledge/*.md paths are supported', 400);
  }
  const subpath = relPath.slice(KNOWLEDGE_PREFIX.length);
  if (!subpath || subpath.includes('..')) {
    throw createError('INVALID_PATH', `invalid knowledge path: ${relPath}`, 400);
  }
  return subpath;
}

function buildGraphAbsolutePath(root, subpath) {
  const normalizedRoot = String(root || '').replace(/^\/+|\/+$/g, '');
  const normalizedSubpath = subpath.replace(/^\/+/, '');
  return normalizedRoot ? `${normalizedRoot}/${normalizedSubpath}` : normalizedSubpath;
}

function parseGraphMtime(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : Date.now();
}

export function createGraphKnowledgeStorage({ config }) {
  ensureGraphConfig(config);

  const state = {
    token: null,
    expiresAt: 0,
  };

  async function getAccessToken(forceRefresh = false) {
    if (!forceRefresh && state.token && Date.now() < state.expiresAt - 60_000) {
      return state.token;
    }

    const url = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: AUTH_SCOPE,
      grant_type: 'client_credentials',
    });
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw createError('GRAPH_AUTH_ERROR', `token request failed (${response.status}): ${text}`, 500);
    }

    const data = await response.json();
    state.token = data.access_token;
    state.expiresAt = Date.now() + (Number(data.expires_in || 3600) * 1000);
    return state.token;
  }

  async function graphRequest(method, endpoint, { headers = {}, body, allowNotFound = false, raw = false } = {}) {
    const token = await getAccessToken();
    const url = `${GRAPH_BASE}${endpoint}`;

    let response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...headers,
      },
      body,
    });

    if (response.status === 401) {
      const refreshed = await getAccessToken(true);
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${refreshed}`,
          ...headers,
        },
        body,
      });
    }

    if (allowNotFound && response.status === 404) {
      return null;
    }

    if (response.status === 412) {
      throw createError('CONFLICT', 'write rejected by OneDrive because file changed remotely (ETag mismatch)', 409);
    }

    if (!response.ok) {
      const text = await response.text();
      throw createError('GRAPH_API_ERROR', `graph request failed (${response.status}) ${method} ${endpoint}: ${text}`, 500);
    }

    if (raw) {
      return response;
    }

    return response.json();
  }

  async function getItemByAbsolutePath(absolutePath, { allowNotFound = false } = {}) {
    const encoded = toGraphPath(absolutePath);
    return graphRequest('GET', `/drives/${encodeURIComponent(config.driveId)}/root:/${encoded}`, {
      allowNotFound,
    });
  }

  async function getTextContentByItemId(itemId) {
    const response = await graphRequest('GET', `/drives/${encodeURIComponent(config.driveId)}/items/${encodeURIComponent(itemId)}/content`, {
      raw: true,
    });
    return response.text();
  }

  async function listChildrenByItemId(itemId) {
    const data = await graphRequest('GET', `/drives/${encodeURIComponent(config.driveId)}/items/${encodeURIComponent(itemId)}/children?$select=id,name,size,lastModifiedDateTime,file,folder,eTag`);
    return Array.isArray(data.value) ? data.value : [];
  }

  async function buildEntry(folderName, item) {
    const relPath = `${KNOWLEDGE_PREFIX}${folderName}/${item.name}`;
    const text = await getTextContentByItemId(item.id);
    const fm = parseFrontmatter(text);

    return {
      name: item.name,
      path: relPath,
      mtime: parseGraphMtime(item.lastModifiedDateTime),
      size: Number(item.size || 0),
      title: firstHeading(text) || item.name.replace(/\.md$/i, ''),
      fmName: fm.name || null,
      description: fm.description || null,
      words: text.split(/\s+/).length,
    };
  }

  async function listFolders() {
    const rootItem = await getItemByAbsolutePath(config.knowledgeRoot, { allowNotFound: true });
    if (!rootItem) {
      throw createError('CONFIG_ERROR', `graph knowledge root not found: ${config.knowledgeRoot}`, 500);
    }

    // Recursive: supports the staged folder contract (company/<domain>, personal, inbox).
    // Each directory becomes one flat entry whose name is its path relative to the root.
    const folders = [];

    async function walk(itemId, dirRel) {
      const items = await listChildrenByItemId(itemId);
      const mdItems = items
        .filter((item) => item.file && item.name && item.name.toLowerCase().endsWith('.md'))
        .sort((a, b) => a.name.localeCompare(b.name));
      const subdirs = items
        .filter((item) => item.folder && item.name && item.name !== '_artifacts')
        .sort((a, b) => a.name.localeCompare(b.name));

      const docs = [];
      for (const item of mdItems) {
        docs.push(await buildEntry(dirRel, item));
      }
      // Pure container dirs (no direct .md files, only subfolders) are not listed themselves.
      if (docs.length > 0 || subdirs.length === 0) folders.push({ name: dirRel, docs });
      for (const sub of subdirs) {
        await walk(sub.id, `${dirRel}/${sub.name}`);
      }
    }

    const children = await listChildrenByItemId(rootItem.id);
    const folderItems = children
      .filter((item) => item.folder && item.name && item.name !== '_artifacts')
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const folder of folderItems) {
      await walk(folder.id, folder.name);
    }

    return folders;
  }

  async function readFile(relPath) {
    const subpath = toKnowledgeSubpath(relPath);
    const absolutePath = buildGraphAbsolutePath(config.knowledgeRoot, subpath);
    const metadata = await getItemByAbsolutePath(absolutePath, { allowNotFound: true });
    if (!metadata || !metadata.file) {
      throw createError('NOT_FOUND', `knowledge file not found: ${relPath}`, 404);
    }

    const content = await getTextContentByItemId(metadata.id);
    return { path: relPath, content, mtime: parseGraphMtime(metadata.lastModifiedDateTime) };
  }

  async function writeFile(relPath, content) {
    const subpath = toKnowledgeSubpath(relPath);
    const absolutePath = buildGraphAbsolutePath(config.knowledgeRoot, subpath);
    const encodedPath = toGraphPath(absolutePath);

    const metadata = await getItemByAbsolutePath(absolutePath, { allowNotFound: true });
    const headers = { 'Content-Type': 'text/markdown; charset=utf-8' };
    if (metadata && metadata.eTag) {
      headers['If-Match'] = metadata.eTag;
    }

    const result = await graphRequest('PUT', `/drives/${encodeURIComponent(config.driveId)}/root:/${encodedPath}:/content`, {
      headers,
      body: content,
    });

    return {
      ok: true,
      mtime: parseGraphMtime(result.lastModifiedDateTime),
    };
  }

  async function deleteFile(relPath) {
    const subpath = toKnowledgeSubpath(relPath);
    const absolutePath = buildGraphAbsolutePath(config.knowledgeRoot, subpath);
    const metadata = await getItemByAbsolutePath(absolutePath, { allowNotFound: true });
    if (!metadata) {
      throw createError('NOT_FOUND', `knowledge file not found: ${relPath}`, 404);
    }
    await graphRequest('DELETE', `/drives/${encodeURIComponent(config.driveId)}/items/${encodeURIComponent(metadata.id)}`, {});
    return { ok: true };
  }

  return {
    kind: 'graph',
    root: config.knowledgeRoot,
    listFolders,
    async listArtifacts() {
      return [];
    },
    readFile,
    writeFile,
    deleteFile,
  };
}
