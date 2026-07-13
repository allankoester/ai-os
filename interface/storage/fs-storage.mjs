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

async function direntIsDirectory(parentAbs, dirent) {
  if (dirent.isDirectory()) return true;
  if (!dirent.isSymbolicLink()) return false;
  try {
    return (await fsp.stat(path.join(parentAbs, dirent.name))).isDirectory();
  } catch {
    return false;
  }
}

async function direntIsMarkdownFile(parentAbs, dirent) {
  if (!dirent.name.endsWith('.md')) return false;
  if (dirent.isFile()) return true;
  if (!dirent.isSymbolicLink()) return false;
  try {
    return (await fsp.stat(path.join(parentAbs, dirent.name))).isFile();
  } catch {
    return false;
  }
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
  const projectRoot = path.resolve(root, '..');

  function toProjectRelative(absPath) {
    const rel = path.relative(projectRoot, absPath).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
    return path.relative(root, absPath).replace(/\\/g, '/');
  }

  return {
    kind: 'fs',
    root,
    async listFolders() {
      if (!fs.existsSync(root)) {
        throw createError('CONFIG_ERROR', `knowledge root not found: ${root}`, 500);
      }
      // Recursive: supports the staged folder contract (company/<domain>, personal, inbox).
      // Each directory becomes one flat entry whose name is its path relative to the root.
      const folders = [];
      async function walk(dirAbs, dirRel) {
        const dirents = await fsp.readdir(dirAbs, { withFileTypes: true });
        dirents.sort((a, b) => a.name.localeCompare(b.name));
        const docs = [];
        for (const dirent of dirents) {
          if (await direntIsMarkdownFile(dirAbs, dirent)) {
            const absPath = path.join(dirAbs, dirent.name);
            docs.push(await buildEntry(absPath, `${KNOWLEDGE_PREFIX}${dirRel}/${dirent.name}`));
          }
        }
        const subdirs = [];
        for (const dirent of dirents) {
          if (dirent.name === '_artifacts') continue;
          if (await direntIsDirectory(dirAbs, dirent)) subdirs.push(dirent);
        }
        // Pure container dirs (no direct .md files, only subfolders) are not listed themselves.
        if (docs.length > 0 || subdirs.length === 0) folders.push({ name: dirRel, docs });
        for (const dirent of subdirs) {
          await walk(path.join(dirAbs, dirent.name), `${dirRel}/${dirent.name}`);
        }
      }
      const top = await fsp.readdir(root, { withFileTypes: true });
      top.sort((a, b) => a.name.localeCompare(b.name));
      for (const dirent of top) {
        if (dirent.name === '_artifacts') continue;
        if (await direntIsDirectory(root, dirent)) await walk(path.join(root, dirent.name), dirent.name);
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
    async listArtifacts() {
      if (!fs.existsSync(root)) {
        throw createError('CONFIG_ERROR', `knowledge root not found: ${root}`, 500);
      }

      const out = [];
      const maxDepth = 8;
      const companyRoot = path.join(root, 'company');
      if (!fs.existsSync(companyRoot)) return out;

      async function walk(dirAbs, depth) {
        if (depth > maxDepth) return;
        let dirents;
        try {
          dirents = await fsp.readdir(dirAbs, { withFileTypes: true });
        } catch {
          return;
        }
        for (const dirent of dirents) {
          if (dirent.name.startsWith('.')) continue;
          const absPath = path.join(dirAbs, dirent.name);
          if (dirent.isDirectory()) {
            await walk(absPath, depth + 1);
            continue;
          }
          if (!dirent.isFile()) continue;
          if (!absPath.includes(`${path.sep}_artifacts${path.sep}`)) continue;
          const stat = await fsp.stat(absPath);
          out.push({
            name: dirent.name,
            path: toProjectRelative(absPath),
            folder: toProjectRelative(path.dirname(absPath)),
            mtime: stat.mtimeMs,
            ctime: stat.birthtimeMs || stat.mtimeMs,
            size: stat.size,
          });
        }
      }

      await walk(companyRoot, 0);
      return out;
    },
  };
}
