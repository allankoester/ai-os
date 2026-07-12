import path from 'node:path';

export const KNOWLEDGE_PATH_PREFIX = 'knowledge/';
export const PERSONAL_KNOWLEDGE_PATH_PREFIX = 'knowledge/personal/';

export function isPersonalKnowledgePath(relPath) {
  return typeof relPath === 'string'
    && relPath.startsWith(PERSONAL_KNOWLEDGE_PATH_PREFIX)
    && relPath.endsWith('.md');
}

export function isSharedKnowledgePath(relPath) {
  return typeof relPath === 'string'
    && relPath.startsWith(KNOWLEDGE_PATH_PREFIX)
    && relPath.endsWith('.md')
    && !relPath.startsWith(PERSONAL_KNOWLEDGE_PATH_PREFIX);
}

export function resolvePersonalKnowledgePath(personalRootAbs, relPath) {
  if (!isPersonalKnowledgePath(relPath)) return null;
  const subpath = relPath.slice(PERSONAL_KNOWLEDGE_PATH_PREFIX.length);
  const abs = path.resolve(personalRootAbs, subpath);
  if (!abs.startsWith(personalRootAbs + path.sep) && abs !== personalRootAbs) return null;
  return abs;
}
