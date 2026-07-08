import path from 'node:path';

const DEFAULT_BACKEND = 'fs';
const VALID_BACKENDS = new Set(['fs', 'graph']);

function normalizeBackend(raw) {
  const value = String(raw || DEFAULT_BACKEND).trim().toLowerCase();
  if (!VALID_BACKENDS.has(value)) return DEFAULT_BACKEND;
  return value;
}

function resolveKnowledgeFsRoot(rootDir, value) {
  if (!value || !String(value).trim()) {
    return path.join(rootDir, 'knowledge');
  }
  return path.resolve(rootDir, String(value).trim());
}

export function createKnowledgeConfig({ rootDir, env = process.env }) {
  const runtime = String(env.STEADYMADE_RUNTIME || 'dev').trim().toLowerCase();
  const backend = normalizeBackend(env.STEADYMADE_KNOWLEDGE_BACKEND);

  return {
    runtime,
    backend,
    fsRoot: resolveKnowledgeFsRoot(rootDir, env.STEADYMADE_KNOWLEDGE_FS_ROOT),
    graph: {
      tenantId: env.MICROSOFT_TENANT_ID || '',
      clientId: env.MICROSOFT_CLIENT_ID || '',
      clientSecret: env.MICROSOFT_CLIENT_SECRET || '',
      driveId: env.GRAPH_DRIVE_ID || '',
      knowledgeRoot: String(env.GRAPH_KNOWLEDGE_ROOT || 'AI_OS/knowledge').trim().replace(/^\/+|\/+$/g, ''),
    },
  };
}
