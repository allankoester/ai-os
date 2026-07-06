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
import { createScheduler, resolveClaudeBin } from './scheduler.mjs';
import { createSkillHub } from './skills.mjs';
import { createPluginManager } from './plugins.mjs';
import { createGuardrails } from './guardrails.mjs';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..'); // project root: steadymade-ai-os
const PUBLIC = path.join(__dirname, 'public');
const META_FILE = path.join(__dirname, 'meta.json'); // sidecar metadata (status, scope) — keeps real docs untouched
const FLOWS_FILE = path.join(__dirname, 'workflows.json'); // user workflow edits: overrides / custom / deleted (machine-local)
const PORT = process.env.PORT || 4011;
const KNOWLEDGE_PATH_PREFIX = 'knowledge/';

const scheduler = createScheduler({ rootDir: ROOT });
const skillHub = createSkillHub({ rootDir: ROOT });
const pluginManager = createPluginManager({ rootDir: ROOT });
const guardrails = createGuardrails({ rootDir: ROOT });

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
    plugins: fm.plugins ? fm.plugins.split(',').map((s) => s.trim()).filter(Boolean) : [],
    words: text.split(/\s+/).length,
  };
}

// ---------- workflow edits (overrides / custom / deleted) ----------

function readFlowsConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(FLOWS_FILE, 'utf8'));
    return { overrides: c.overrides || {}, custom: c.custom || [], deleted: c.deleted || [] };
  } catch {
    return { overrides: {}, custom: [], deleted: [] };
  }
}

function validateFlowsConfig(body) {
  const errors = [];
  const validFlow = (f, where) => {
    if (!f || typeof f !== 'object') return errors.push(`${where}: workflow must be an object`);
    if (!String(f.name || '').trim()) errors.push(`${where}: name is required`);
    if (!Array.isArray(f.chain) || f.chain.length < 2) errors.push(`${where}: chain needs at least 2 steps`);
    else if (f.chain.some((s) => typeof s !== 'string' || !s.trim())) errors.push(`${where}: chain steps must be non-empty strings`);
  };
  if (typeof body.overrides !== 'object' || !body.overrides) errors.push('overrides object required');
  else for (const [id, f] of Object.entries(body.overrides)) validFlow(f, `override ${id}`);
  if (!Array.isArray(body.custom)) errors.push('custom array required');
  else for (const f of body.custom) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(f?.id || '')) errors.push(`custom workflow id "${f?.id}" must be kebab/snake-case`);
    validFlow(f, `custom ${f?.id}`);
  }
  if (!Array.isArray(body.deleted) || body.deleted.some((d) => typeof d !== 'string')) errors.push('deleted must be an array of workflow ids');
  return errors;
}

// ---------- artifacts (recursive, newest first) ----------

async function scanArtifacts(baseAbs) {
  const out = [];
  const walk = async (dirAbs, relFolder, depth) => {
    if (depth > 5) return;
    let entries;
    try { entries = await fsp.readdir(dirAbs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dirAbs, e.name);
      if (e.isDirectory()) { await walk(abs, relFolder ? `${relFolder}/${e.name}` : e.name, depth + 1); continue; }
      if (!e.isFile()) continue;
      const stat = await fsp.stat(abs);
      out.push({
        name: e.name,
        path: path.relative(ROOT, abs),
        folder: 'artifacts' + (relFolder ? '/' + relFolder : ''),
        mtime: stat.mtimeMs,
        ctime: stat.birthtimeMs || stat.mtimeMs,
        size: stat.size,
      });
    }
  };
  await walk(baseAbs, '', 0);
  out.sort((a, b) => b.ctime - a.ctime);
  return out;
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

  // Core docs (active project instructions and key indexes)
  for (const rel of ['CLAUDE.md', 'CLAUDE.local.md', 'README.md', 'docs/README.md', 'docs/status-and-roadmap.md']) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) system.docs.push(await fileEntry(abs));
  }

  // Artifacts (any file type, read-only listing — recursive, newest first)
  const aDir = path.join(ROOT, 'artifacts');
  if (fs.existsSync(aDir)) system.artifacts = await scanArtifacts(aDir);

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
    const gate = guardrails.check(rel, 'read');
    if (!gate.allowed) return send(403, { error: gate.reason });
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
    const writeGate = guardrails.check(body.path || '', 'write');
    if (!writeGate.allowed) return send(403, { error: writeGate.reason });
    if (writeGate.confirmRequired && body.confirmed !== true) {
      return send(409, { confirmRequired: true, folder: writeGate.folder, error: `guardrail: ${writeGate.folder} is set to "ask" — confirm the write` });
    }
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

  // ---------- workflows (edit / delete stored as overrides on the base model) ----------

  if (url.pathname === '/api/workflows' && req.method === 'GET') {
    return send(200, readFlowsConfig());
  }

  if (url.pathname === '/api/workflows' && req.method === 'PUT') {
    const body = await readBody(req);
    const errors = validateFlowsConfig(body);
    if (errors.length) return send(400, { errors });
    const config = { overrides: body.overrides, custom: body.custom, deleted: body.deleted, updatedAt: Date.now() };
    await fsp.writeFile(FLOWS_FILE, JSON.stringify(config, null, 2), 'utf8');
    return send(200, { ok: true, config });
  }

  // ---------- artifacts (open any file under artifacts/ in the browser) ----------

  if (url.pathname === '/api/artifact' && req.method === 'GET') {
    const rel = url.searchParams.get('path') || '';
    if (!rel.startsWith('artifacts/')) return send(400, { error: 'only files under artifacts/ can be opened here' });
    const gate = guardrails.check(rel, 'read');
    if (!gate.allowed) return send(403, { error: gate.reason });
    const abs = safeResolve(rel);
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return send(404, { error: 'not found' });
    const ext = path.extname(abs).toLowerCase();
    const type = { '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] || MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': 'inline' });
    return fs.createReadStream(abs).pipe(res);
  }

  // ---------- agent plugin assignment (frontmatter `plugins:` line) ----------

  if (url.pathname === '/api/agent-plugins' && req.method === 'PUT') {
    const body = await readBody(req);
    const rel = String(body.path || '');
    if (!rel.startsWith('.claude/agents/') || !rel.endsWith('.md')) {
      return send(400, { errors: ['path must be an agent file under .claude/agents/'] });
    }
    const abs = safeResolve(rel);
    if (!abs || !fs.existsSync(abs)) return send(404, { errors: ['agent file not found'] });
    if (!Array.isArray(body.plugins) || body.plugins.some((p) => !/^[a-z0-9][a-z0-9-]*$/.test(p))) {
      return send(400, { errors: ['plugins must be an array of plugin ids'] });
    }
    const known = new Set(pluginManager.list().filter((p) => p.enabled).map((p) => p.id));
    const unknown = body.plugins.filter((p) => !known.has(p));
    if (unknown.length) return send(400, { errors: [`not enabled in Settings: ${unknown.join(', ')} — enable the plugin first`] });

    const text = await fsp.readFile(abs, 'utf8');
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return send(400, { errors: ['agent file has no frontmatter'] });
    const lines = m[1].split(/\r?\n/).filter((l) => !/^plugins:/.test(l));
    if (body.plugins.length) lines.push(`plugins: ${body.plugins.join(', ')}`);
    await fsp.writeFile(abs, text.replace(m[0], `---\n${lines.join('\n')}\n---`), 'utf8');
    return send(200, { ok: true, plugins: body.plugins });
  }

  // ---------- scheduler ----------

  if (url.pathname === '/api/scheduler' && req.method === 'GET') {
    return send(200, { jobs: scheduler.listJobs(), runs: scheduler.listRuns() });
  }

  if (url.pathname === '/api/scheduler/jobs' && req.method === 'POST') {
    const result = await scheduler.createJob(await readBody(req));
    return send(result.errors ? 400 : 200, result);
  }

  const jobMatch = url.pathname.match(/^\/api\/scheduler\/jobs\/([0-9a-f-]+)(\/run)?$/i);
  if (jobMatch) {
    const [, jobId, runSuffix] = jobMatch;
    if (runSuffix && req.method === 'POST') {
      const result = await scheduler.runNow(jobId);
      return send(result.errors ? 400 : 200, result);
    }
    if (!runSuffix && req.method === 'PUT') {
      const result = await scheduler.updateJob(jobId, await readBody(req));
      return send(result.errors ? 400 : 200, result);
    }
    if (!runSuffix && req.method === 'DELETE') {
      const result = await scheduler.deleteJob(jobId);
      return send(result.errors ? 404 : 200, result);
    }
  }

  const logMatch = url.pathname.match(/^\/api\/scheduler\/runs\/([0-9a-f-]+)\/log$/i);
  if (logMatch && req.method === 'GET') {
    const log = await scheduler.getRunLog(logMatch[1]);
    if (log === null) return send(404, { error: 'log not found' });
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(log);
  }

  // ---------- skill hub ----------

  if (url.pathname === '/api/skills' && req.method === 'GET') {
    return send(200, await skillHub.list());
  }

  if (url.pathname === '/api/skills/toggle' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await skillHub.setActive(body.scope, body.name, Boolean(body.active));
    return send(result.errors ? 400 : 200, result);
  }

  if (url.pathname === '/api/marketplace' && req.method === 'GET') {
    try {
      return send(200, await skillHub.marketplace(url.searchParams.get('refresh') === '1'));
    } catch (err) {
      return send(502, { error: err.message });
    }
  }

  if (url.pathname === '/api/marketplace/install' && req.method === 'POST') {
    try {
      const result = await skillHub.installFromMarketplace(await readBody(req));
      return send(result.errors ? 400 : 200, result);
    } catch (err) {
      return send(500, { errors: [err.message] });
    }
  }

  // ---------- plugins ----------

  if (url.pathname === '/api/plugins' && req.method === 'GET') {
    return send(200, { plugins: pluginManager.list() });
  }

  if (url.pathname === '/api/plugins' && req.method === 'POST') {
    const result = await pluginManager.create(await readBody(req));
    return send(result.errors ? 400 : 200, result);
  }

  const pluginMatch = url.pathname.match(/^\/api\/plugins\/([a-z0-9-]+)$/);
  if (pluginMatch && req.method === 'PUT') {
    const result = await pluginManager.update(pluginMatch[1], await readBody(req));
    return send(result.errors ? 400 : 200, result);
  }
  if (pluginMatch && req.method === 'DELETE') {
    const result = await pluginManager.remove(pluginMatch[1]);
    return send(result.errors ? 400 : 200, result);
  }

  // ---------- guardrails ----------

  if (url.pathname === '/api/guardrails' && req.method === 'GET') {
    return send(200, guardrails.status());
  }

  if (url.pathname === '/api/guardrails' && req.method === 'PUT') {
    const body = await readBody(req);
    const result = await guardrails.save(body.folders);
    return send(result.errors ? 400 : 200, result);
  }

  // ---------- restart ----------

  if (url.pathname === '/api/restart' && req.method === 'POST') {
    send(200, { ok: true, message: 'restarting interface server' });
    console.log('[server] restart requested via API');
    let relaunched = false;
    const relaunch = () => {
      if (relaunched) return;
      relaunched = true;
      spawn(process.execPath, [fileURLToPath(import.meta.url)], {
        cwd: ROOT, detached: true, stdio: 'ignore', env: process.env,
      }).unref();
      process.exit(0);
    };
    setTimeout(() => {
      server.close(relaunch);
      setTimeout(relaunch, 1500).unref(); // safety: lingering connections must not block the swap
    }, 200);
    return;
  }

  // ---------- workspace status (profile + instructions completeness) ----------

  if (url.pathname === '/api/workspace' && req.method === 'GET') {
    const checks = [
      { id: 'claude-md', label: 'CLAUDE.md (shared instructions)', path: 'CLAUDE.md', hint: 'core project instructions' },
      { id: 'claude-local', label: 'CLAUDE.local.md (personal instructions)', path: 'CLAUDE.local.md', hint: 'run /personal-onboarding' },
      { id: 'user-profile', label: 'knowledge/personal/user-profile.md (persona profile)', path: 'knowledge/personal/user-profile.md', hint: 'run /personal-onboarding' },
      { id: 'operating-profile', label: 'knowledge/company/operating-profile.md (company profile)', path: 'knowledge/company/operating-profile.md', hint: 'run /company-onboarding' },
      { id: 'skill-profile', label: '.skill-profile (active skills)', path: '.skill-profile', hint: 'created by the Skill Hub' },
      { id: 'settings', label: '.claude/settings.local.json (permissions)', path: '.claude/settings.local.json', hint: 'created when plugins/permissions are set' },
      { id: 'mcp', label: '.mcp.json (MCP servers)', path: '.mcp.json', hint: 'optional — enable an MCP plugin in Settings' },
    ].map((c) => {
      const abs = path.join(ROOT, c.path);
      const exists = fs.existsSync(abs);
      let todos = 0;
      if (exists && c.path.endsWith('.md')) {
        try { todos = (fs.readFileSync(abs, 'utf8').match(/TODO/g) || []).length; } catch { /* ignore */ }
      }
      return { ...c, exists, todos };
    });
    const byId = (id) => checks.find((c) => c.id === id) || {};
    const onboarding = {
      personalDone: Boolean(byId('user-profile').exists && byId('claude-local').exists),
      companyDone: Boolean(byId('operating-profile').exists && byId('operating-profile').todos === 0),
      companyTodos: byId('operating-profile').todos || 0,
    };
    onboarding.complete = onboarding.personalDone && onboarding.companyDone;
    return send(200, { checks, onboarding });
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
  const claudeBin = resolveClaudeBin();
  console.log(claudeBin
    ? `Scheduler: claude CLI at ${claudeBin}`
    : 'Scheduler: WARNING — claude CLI not found, jobs will fail (set CLAUDE_BIN)');
});
