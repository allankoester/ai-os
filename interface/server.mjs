// Steadymade AI OS — Operating Interface server
// Zero-dependency Node server: serves the static frontend and a small file API
// that reads/writes the real Markdown files of this project.
//
// Run:  node interface/server.mjs   →  http://localhost:4011

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeConfig } from './storage/config.mjs';
import { createFsKnowledgeStorage } from './storage/fs-storage.mjs';
import { createGraphKnowledgeStorage } from './storage/graph-storage.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..'); // project root: steadymade-ai-os
const PUBLIC = path.join(__dirname, 'public');
const META_FILE = path.join(__dirname, 'meta.json'); // sidecar metadata (status, scope) — keeps real docs untouched
const PORT = process.env.PORT || 4011;
const KNOWLEDGE_PATH_PREFIX = 'knowledge/';

const knowledgeConfig = createKnowledgeConfig({ rootDir: ROOT });
const knowledgeStorage = knowledgeConfig.backend === 'graph'
  ? createGraphKnowledgeStorage({ config: knowledgeConfig.graph })
  : createFsKnowledgeStorage({ root: knowledgeConfig.fsRoot });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

// ---------- helpers ----------

function safeResolve(relPath) {
  // Guard against path traversal: resolved path must stay inside ROOT.
  const abs = path.resolve(ROOT, relPath);
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) return null;
  return abs;
}

function isKnowledgePath(relPath) {
  return typeof relPath === 'string' && relPath.startsWith(KNOWLEDGE_PATH_PREFIX) && relPath.endsWith('.md');
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

async function readMeta() {
  try {
    return JSON.parse(await fsp.readFile(META_FILE, 'utf8'));
  } catch {
    return { docs: {} };
  }
}

async function fileEntry(absPath) {
  const stat = await fsp.stat(absPath);
  const text = await fsp.readFile(absPath, 'utf8');
  const fm = parseFrontmatter(text);
  return {
    name: path.basename(absPath),
    path: path.relative(ROOT, absPath),
    mtime: stat.mtimeMs,
    size: stat.size,
    title: firstHeading(text) || path.basename(absPath, '.md'),
    fmName: fm.name || null,
    description: fm.description || null,
    words: text.split(/\s+/).length,
  };
}

// ---------- API ----------

async function getSystem() {
  const system = { agents: [], folders: [], docs: [], artifacts: [], meta: await readMeta() };

  // Agents from .claude/agents/*.md
  const agentDir = path.join(ROOT, '.claude', 'agents');
  for (const f of (await fsp.readdir(agentDir)).filter((f) => f.endsWith('.md')).sort()) {
    system.agents.push(await fileEntry(path.join(agentDir, f)));
  }

  // Knowledge folders + docs
  system.folders = await knowledgeStorage.listFolders();

  // Core docs (Danny prompt, routing, CLAUDE.md)
  for (const rel of ['docs/danny-orchestrator-system-prompt.md', 'docs/agent-routing.md', 'CLAUDE.md', 'README.md']) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) system.docs.push(await fileEntry(abs));
  }

  // Artifacts (any file type, read-only listing)
  const aDir = path.join(ROOT, 'artifacts');
  if (fs.existsSync(aDir)) {
    for (const f of (await fsp.readdir(aDir)).filter((f) => !f.startsWith('.')).sort()) {
      const stat = await fsp.stat(path.join(aDir, f));
      if (stat.isFile()) system.artifacts.push({ name: f, path: 'artifacts/' + f, mtime: stat.mtimeMs, size: stat.size });
    }
  }

  return system;
}

async function handleApi(req, res, url) {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === '/api/system' && req.method === 'GET') {
    return send(200, await getSystem());
  }

  if (url.pathname === '/api/file' && req.method === 'GET') {
    const rel = url.searchParams.get('path') || '';
    if (isKnowledgePath(rel)) {
      try {
        return send(200, await knowledgeStorage.readFile(rel));
      } catch (err) {
        if (err.code === 'NOT_FOUND') return send(404, { error: 'not found' });
        if (err.status) return send(err.status, { error: err.message });
        throw err;
      }
    }

    const abs = safeResolve(rel);
    if (!abs || !abs.endsWith('.md') || !fs.existsSync(abs)) return send(404, { error: 'not found' });
    return send(200, { path: rel, content: await fsp.readFile(abs, 'utf8'), mtime: (await fsp.stat(abs)).mtimeMs });
  }

  if (url.pathname === '/api/file' && req.method === 'PUT') {
    const body = await readBody(req);
    if (isKnowledgePath(body.path || '')) {
      try {
        return send(200, await knowledgeStorage.writeFile(body.path, body.content));
      } catch (err) {
        if (err.code === 'NOT_FOUND') return send(404, { error: 'not found' });
        if (err.code === 'CONFLICT') return send(409, { error: err.message });
        if (err.status) return send(err.status, { error: err.message });
        throw err;
      }
    }

    const abs = safeResolve(body.path || '');
    // Real persistence: writes back to the actual Markdown file on disk.
    if (!abs || !abs.endsWith('.md')) return send(400, { error: 'only .md files inside the project can be written' });
    await fsp.writeFile(abs, body.content, 'utf8');
    return send(200, { ok: true, mtime: (await fsp.stat(abs)).mtimeMs });
  }

  if (url.pathname === '/api/meta' && req.method === 'PUT') {
    const body = await readBody(req);
    await fsp.writeFile(META_FILE, JSON.stringify(body, null, 2), 'utf8');
    return send(200, { ok: true });
  }

  return send(404, { error: 'unknown endpoint' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    let rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const abs = path.join(PUBLIC, path.normalize(rel));
    if (!abs.startsWith(PUBLIC) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream',
      'Cache-Control': 'no-store', // always serve the latest interface files
    });
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(PORT, () => {
  console.log(`Steadymade AI OS interface → http://localhost:${PORT}`);
  console.log(`Reading project files from: ${ROOT}`);
  console.log(`Knowledge backend: ${knowledgeStorage.kind} (${knowledgeStorage.root})`);
  console.log(`Runtime mode: ${knowledgeConfig.runtime}`);
});
