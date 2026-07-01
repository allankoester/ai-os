import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

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

function getKnowledgeSubpath(relPath) {
  if (!relPath.startsWith(KNOWLEDGE_PREFIX) || !relPath.endsWith('.md')) {
    throw createError('INVALID_PATH', 'only knowledge/*.md paths are supported', 400);
  }
  return relPath.slice(KNOWLEDGE_PREFIX.length);
}

function resolveInsideRoot(root, subpath) {
  const abs = path.resolve(root, subpath);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw createError('INVALID_PATH', 'path escapes configured knowledge root', 400);
  }
  return abs;
}

async function buildEntry(absPath, relPath) {
  const stat = await fsp.stat(absPath);
  const text = await fsp.readFile(absPath, 'utf8');
  const fm = parseFrontmatter(text);
  return {
    name: path.basename(absPath),
    path: relPath,
    mtime: stat.mtimeMs,
    size: stat.size,
    title: firstHeading(text) || path.basename(absPath, '.md'),
    fmName: fm.name || null,
    description: fm.description || null,
    words: text.split(/\s+/).length,
  };
}

export function createFsKnowledgeStorage({ root }) {
  return {
    kind: 'fs',
    root,
    async listFolders() {
      if (!fs.existsSync(root)) {
        throw createError('CONFIG_ERROR', `knowledge root not found: ${root}`, 500);
      }
      const folders = [];
      const dirents = await fsp.readdir(root, { withFileTypes: true });
      dirents.sort((a, b) => a.name.localeCompare(b.name));
      for (const dirent of dirents) {
        if (!dirent.isDirectory()) continue;
        const folderName = dirent.name;
        const folderPath = path.join(root, folderName);
        const files = (await fsp.readdir(folderPath)).filter((f) => f.endsWith('.md')).sort();
        const docs = [];
        for (const fileName of files) {
          const absPath = path.join(folderPath, fileName);
          const relPath = `${KNOWLEDGE_PREFIX}${folderName}/${fileName}`;
          docs.push(await buildEntry(absPath, relPath));
        }
        folders.push({ name: folderName, docs });
      }
      return folders;
    },
    async readFile(relPath) {
      const subpath = getKnowledgeSubpath(relPath);
      const absPath = resolveInsideRoot(root, subpath);
      if (!fs.existsSync(absPath)) {
        throw createError('NOT_FOUND', `knowledge file not found: ${relPath}`, 404);
      }
      const stat = await fsp.stat(absPath);
      const content = await fsp.readFile(absPath, 'utf8');
      return { path: relPath, content, mtime: stat.mtimeMs };
    },
    async writeFile(relPath, content) {
      const subpath = getKnowledgeSubpath(relPath);
      const absPath = resolveInsideRoot(root, subpath);
      await fsp.mkdir(path.dirname(absPath), { recursive: true });
      await fsp.writeFile(absPath, content, 'utf8');
      return { ok: true, mtime: (await fsp.stat(absPath)).mtimeMs };
    },
  };
}
