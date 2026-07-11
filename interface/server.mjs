// Steadymade AI OS — Operating Interface server
// Zero-dependency Node server: serves the static frontend and a small file API
// that reads/writes the real Markdown files of this project.
//
// Run:  node interface/server.mjs   →  http://localhost:4011

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
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
const PROVIDER_SETTINGS_FILE = path.join(__dirname, 'provider-settings.json');
const USAGE_LOG = path.join(ROOT, 'runs', 'usage.jsonl');
const LEGACY_CHAT_USAGE_LOG = path.join(ROOT, 'runs', 'chat-usage.jsonl');
const PORT = process.env.PORT || 4011;
const HOST = process.env.HOST || '127.0.0.1';
const API_TOKEN = process.env.STEADYMADE_INTERFACE_TOKEN || '';
const KNOWLEDGE_PATH_PREFIX = 'knowledge/';

const scheduler = createScheduler({ rootDir: ROOT });
const pluginManager = createPluginManager({ rootDir: ROOT });
const skillHub = createSkillHub({
  rootDir: ROOT,
  listEnabledPlugins: () => pluginManager.list().filter((p) => p.enabled).map((p) => p.id),
});
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

const PROVIDER_RUNTIME_MODES = new Set(['claude-subscription', 'anthropic-api', 'opencode']);
const PROVIDER_ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
const PROVIDER_ENV_MAX_ENTRIES = 64;
const PROVIDER_ENV_MAX_KEY_LENGTH = 64;
const PROVIDER_ENV_MAX_VALUE_LENGTH = 8192;
const DEFAULT_PROVIDER_SETTINGS = Object.freeze({
  runtimeMode: 'claude-subscription',
  opencodeBin: '',
  cliBridgeEnabled: false,
  envVault: [],
  updatedAt: null,
});

// ---------- helpers ----------

function safeResolve(relPath) {
  // Guard against path traversal: resolved path must stay inside ROOT.
  const abs = path.resolve(ROOT, relPath);
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) return null;
  return abs;
}

function isKnowledgePath(relPath) {
  // knowledge/personal/ is never routed through the (OneDrive-backed) knowledge
  // storage layer — it's a local-only file outside that configured root, served
  // via the generic ROOT-relative file branch instead (see /api/file below).
  return typeof relPath === 'string' && relPath.startsWith(KNOWLEDGE_PATH_PREFIX) && relPath.endsWith('.md')
    && !relPath.startsWith('knowledge/personal/');
}

function normalizeProjectRelPath(relPath) {
  return path.posix.normalize('/' + String(relPath || '').replace(/\\/g, '/')).slice(1);
}

function isAllowedArtifactPath(relPath) {
  const normalized = normalizeProjectRelPath(relPath);
  if (normalized.startsWith('artifacts/')) return true;
  return normalized.startsWith('knowledge/company/') && normalized.includes('/_artifacts/');
}

function hasJsonContentType(req) {
  return String(req.headers['content-type'] || '').toLowerCase().includes('application/json');
}

function isTrustedLocalWebRequest(req, expectedPort) {
  const expected = Number(expectedPort);
  const origins = [req.headers.origin, req.headers.referer];
  for (const raw of origins) {
    if (!raw) continue;
    try {
      const u = new URL(String(raw));
      const host = u.hostname;
      const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
      if ((host === 'localhost' || host === '127.0.0.1') && port === expected) return true;
    } catch {
      // invalid header value
    }
  }
  return false;
}

function endpointExpectsJsonBody(req, url) {
  if (req.method === 'PUT') return true;
  if (req.method === 'POST') {
    if (url.pathname === '/api/restart') return false;
    if (/^\/api\/scheduler\/jobs\/[0-9a-f-]+\/run$/i.test(url.pathname)) return false;
    return true;
  }
  if (req.method === 'DELETE') return false;
  return false;
}

function isPathWithin(parentAbs, targetAbs) {
  const rel = path.relative(parentAbs, targetAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function isAllowedArtifactRealPath(realAbs) {
  const artifactsRootReal = await fsp.realpath(path.join(ROOT, 'artifacts')).catch(() => null);
  const companyRootReal = await fsp.realpath(path.join(ROOT, 'knowledge', 'company')).catch(() => null);
  if (artifactsRootReal && isPathWithin(artifactsRootReal, realAbs)) return true;
  if (companyRootReal && isPathWithin(companyRootReal, realAbs) && realAbs.includes(`${path.sep}_artifacts${path.sep}`)) {
    return true;
  }
  return false;
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

async function readProviderSettings() {
  const raw = await readProviderSettingsRaw();
  return toProviderSettingsResponse(raw);
}

async function readProviderSettingsRaw() {
  try {
    try { await fsp.chmod(PROVIDER_SETTINGS_FILE, 0o600); } catch {}
    const parsed = JSON.parse(await fsp.readFile(PROVIDER_SETTINGS_FILE, 'utf8'));
    const sanitized = sanitizeProviderSettings(parsed);
    return {
      ...DEFAULT_PROVIDER_SETTINGS,
      ...sanitized,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    };
  } catch {
    return { ...DEFAULT_PROVIDER_SETTINGS };
  }
}

function toProviderSettingsResponse(rawSettings) {
  const envVaultEntries = Object.entries(rawSettings.envVault || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      key,
      masked: maskSecret(value),
      hasValue: true,
    }));
  return {
    runtimeMode: rawSettings.runtimeMode,
    opencodeBin: rawSettings.opencodeBin,
    cliBridgeEnabled: rawSettings.cliBridgeEnabled,
    envVault: envVaultEntries,
    updatedAt: rawSettings.updatedAt || null,
  };
}

function maskSecret(value) {
  const len = Math.min(Math.max(String(value || '').length, 4), 16);
  return '•'.repeat(len);
}

function sanitizeEnvVaultMap(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = String(rawKey || '').trim();
    if (!PROVIDER_ENV_KEY_RE.test(key)) continue;
    if (key.length > PROVIDER_ENV_MAX_KEY_LENGTH) continue;
    const value = String(rawValue ?? '');
    out[key] = value.slice(0, PROVIDER_ENV_MAX_VALUE_LENGTH);
    if (Object.keys(out).length >= PROVIDER_ENV_MAX_ENTRIES) break;
  }
  return out;
}

function resolveEnvVaultMap(bodyEnvVault, existingMap) {
  const next = {};
  const rows = Array.isArray(bodyEnvVault) ? bodyEnvVault : [];
  for (const row of rows) {
    const key = String(row?.key || '').trim();
    if (!key) continue;
    if (!PROVIDER_ENV_KEY_RE.test(key)) continue;
    if (key.length > PROVIDER_ENV_MAX_KEY_LENGTH) continue;
    const preserve = row?.preserve === true;
    const hasValueField = typeof row?.value === 'string';
    if (hasValueField && row.value.length) {
      next[key] = row.value.slice(0, PROVIDER_ENV_MAX_VALUE_LENGTH);
    } else if (preserve && typeof existingMap[key] === 'string') {
      next[key] = existingMap[key];
    }
    if (Object.keys(next).length >= PROVIDER_ENV_MAX_ENTRIES) break;
  }
  return next;
}

function sanitizeProviderSettings(body) {
  const runtimeMode = String(body?.runtimeMode || '').trim();
  const opencodeBin = String(body?.opencodeBin || '').trim();
  const cliBridgeEnabled = body?.cliBridgeEnabled;
  const envVaultRaw = body?.envVault;
  const envVault = Array.isArray(envVaultRaw)
    ? resolveEnvVaultMap(envVaultRaw, {})
    : sanitizeEnvVaultMap(envVaultRaw);
  return {
    runtimeMode: PROVIDER_RUNTIME_MODES.has(runtimeMode) ? runtimeMode : DEFAULT_PROVIDER_SETTINGS.runtimeMode,
    opencodeBin: opencodeBin.slice(0, 1024),
    cliBridgeEnabled: typeof cliBridgeEnabled === 'boolean' ? cliBridgeEnabled : DEFAULT_PROVIDER_SETTINGS.cliBridgeEnabled,
    envVault,
  };
}

function validateProviderSettings(body) {
  const errors = [];
  if (!body || typeof body !== 'object') errors.push('body must be an object');
  if (!PROVIDER_RUNTIME_MODES.has(String(body?.runtimeMode || ''))) {
    errors.push('runtimeMode must be one of: claude-subscription, anthropic-api, opencode');
  }
  if (typeof body?.opencodeBin !== 'string') errors.push('opencodeBin must be a string');
  if (typeof body?.cliBridgeEnabled !== 'boolean') errors.push('cliBridgeEnabled must be a boolean');
  if (body?.envVault !== undefined) {
    if (!Array.isArray(body.envVault)) {
      errors.push('envVault must be an array');
    } else {
      if (body.envVault.length > PROVIDER_ENV_MAX_ENTRIES) errors.push(`envVault supports up to ${PROVIDER_ENV_MAX_ENTRIES} entries`);
      for (let i = 0; i < body.envVault.length; i++) {
        const row = body.envVault[i];
        if (!row || typeof row !== 'object') {
          errors.push(`envVault[${i}] must be an object`);
          continue;
        }
        const key = String(row.key || '').trim();
        if (!PROVIDER_ENV_KEY_RE.test(key)) {
          errors.push(`envVault[${i}].key must match ${PROVIDER_ENV_KEY_RE}`);
        }
        if (key.length > PROVIDER_ENV_MAX_KEY_LENGTH) {
          errors.push(`envVault[${i}].key exceeds ${PROVIDER_ENV_MAX_KEY_LENGTH} chars`);
        }
        if (row.value !== undefined && typeof row.value !== 'string') {
          errors.push(`envVault[${i}].value must be a string`);
        }
        if (typeof row.value === 'string' && row.value.length > PROVIDER_ENV_MAX_VALUE_LENGTH) {
          errors.push(`envVault[${i}].value exceeds ${PROVIDER_ENV_MAX_VALUE_LENGTH} chars`);
        }
        if (row.preserve !== undefined && typeof row.preserve !== 'boolean') {
          errors.push(`envVault[${i}].preserve must be boolean`);
        }
      }
    }
  }
  return errors;
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

async function readJsonl(file) {
  let text = '';
  try { text = await fsp.readFile(file, 'utf8'); }
  catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function usageEntryKey(e) {
  return JSON.stringify({
    source: e.source || 'chat',
    timestamp: e.timestamp || null,
    session_id: e.session_id || null,
    selected_agent: e.selected_agent || null,
    mode: e.mode || null,
    model: e.model || null,
    duration_ms: e.duration_ms ?? null,
    cost_usd: e.cost_usd ?? null,
    num_turns: e.num_turns ?? null,
    total_tokens: e.total_tokens ?? null,
    status: e.status || null,
    job_id: e.job_id || e.jobId || null,
    job_name: e.job_name || e.jobName || null,
    incognito: Boolean(e.incognito),
  });
}

async function readUsageLog() {
  const unified = await readJsonl(USAGE_LOG);
  const legacy = await readJsonl(LEGACY_CHAT_USAGE_LOG);

  const merged = unified.map((e) => ({ ...e, source: e.source || 'chat' }));
  const seen = new Set(merged.map(usageEntryKey));
  for (const e of legacy) {
    const normalized = { ...e, source: 'chat' };
    const key = usageEntryKey(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(normalized);
    }
  }

  const entries = merged.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const summary = entries.reduce((acc, e) => {
    acc.count += 1;
    if (e.session_id) acc.sessions.add(e.session_id);
    acc.total_cost_usd += num(e.cost_usd);
    acc.total_duration_ms += num(e.duration_ms);
    acc.total_turns += num(e.num_turns);
    acc.input_tokens += num(e.input_tokens);
    acc.output_tokens += num(e.output_tokens);
    acc.cache_creation_input_tokens += num(e.cache_creation_input_tokens);
    acc.cache_read_input_tokens += num(e.cache_read_input_tokens);
    acc.total_tokens += num(e.total_tokens);
    if (e.is_error) acc.errors += 1;
    const src = e.source || 'chat';
    acc.sources[src] = (acc.sources[src] || 0) + 1;
    return acc;
  }, { count: 0, sessions: new Set(), total_cost_usd: 0, total_duration_ms: 0, total_turns: 0, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, total_tokens: 0, errors: 0, sources: {} });
  return {
    path: fs.existsSync(USAGE_LOG)
      ? 'runs/usage.jsonl (+ runs/chat-usage.jsonl legacy merge)'
      : 'runs/chat-usage.jsonl (legacy)',
    entries,
    summary: { ...summary, sessions: summary.sessions.size },
  };
}

// ---------- active user (OS user + optional profiles/<user>.yml) ----------

function getActiveUser() {
  const username = os.userInfo().username;
  const user = { id: username, name: username, role: null };
  try {
    const text = fs.readFileSync(path.join(ROOT, 'profiles', `${username}.yml`), 'utf8');
    const get = (key) => {
      const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
      return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
    };
    user.name = get('user') || username;
    user.role = get('role');
  } catch { /* no team profile for this OS user */ }
  return user;
}

// ---------- API ----------

async function getSystem() {
  const system = { agents: [], folders: [], docs: [], artifacts: [], meta: await readMeta(), user: getActiveUser() };

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
  const artifacts = [];
  const aDir = path.join(ROOT, 'artifacts');
  if (fs.existsSync(aDir)) artifacts.push(...await scanArtifacts(aDir));
  if (typeof knowledgeStorage.listArtifacts === 'function') {
    artifacts.push(...await knowledgeStorage.listArtifacts());
  }
  system.artifacts = artifacts.sort((a, b) => (b.ctime || b.mtime || 0) - (a.ctime || a.mtime || 0));

  return system;
}

async function handleApi(req, res, url) {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  const mutating = req.method !== 'GET';
  if (mutating) {
    if (endpointExpectsJsonBody(req, url) && !hasJsonContentType(req)) {
      return send(403, { error: 'forbidden: Content-Type must include application/json' });
    }
    const trustedLocal = isTrustedLocalWebRequest(req, PORT);
    let tokenValid = false;
    if (API_TOKEN) {
      const auth = req.headers['x-steadymade-token'] || req.headers.authorization || '';
      const bearer = String(auth).replace(/^Bearer\s+/i, '');
      tokenValid = bearer === API_TOKEN;
    }
    if (!trustedLocal && !tokenValid) return send(401, { error: 'unauthorized' });
  }

  if (url.pathname === '/api/system' && req.method === 'GET') {
    return send(200, await getSystem());
  }

  if (url.pathname === '/api/usage' && req.method === 'GET') {
    return send(200, await readUsageLog());
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

  if (url.pathname === '/api/provider-settings' && req.method === 'GET') {
    const settings = await readProviderSettings();
    return send(200, {
      settings,
      path: 'interface/provider-settings.json',
      note: 'Machine-local settings only. Environment vault values are masked in responses and apply after restart.',
    });
  }

  if (url.pathname === '/api/provider-settings' && req.method === 'PUT') {
    const body = await readBody(req);
    const errors = validateProviderSettings(body);
    if (errors.length) return send(400, { errors });
    const existing = await readProviderSettingsRaw();
    const sanitized = sanitizeProviderSettings(body);
    const settings = {
      runtimeMode: sanitized.runtimeMode,
      opencodeBin: sanitized.opencodeBin,
      cliBridgeEnabled: sanitized.cliBridgeEnabled,
      envVault: body.envVault === undefined
        ? { ...(existing.envVault || {}) }
        : resolveEnvVaultMap(body.envVault, existing.envVault || {}),
      updatedAt: new Date().toISOString(),
    };
    await fsp.writeFile(PROVIDER_SETTINGS_FILE, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { await fsp.chmod(PROVIDER_SETTINGS_FILE, 0o600); } catch {}
    const responseSettings = toProviderSettingsResponse(settings);
    return send(200, {
      ok: true,
      settings: responseSettings,
      path: 'interface/provider-settings.json',
      message: 'saved — restart app/chat to apply runtime env defaults',
    });
  }

  // ---------- artifacts (open any file under artifacts/ and knowledge/company/**/_artifacts/**) ----------

  if (url.pathname === '/api/artifact' && req.method === 'GET') {
    const rel = normalizeProjectRelPath(url.searchParams.get('path') || '');
    if (!isAllowedArtifactPath(rel)) {
      return send(400, { error: 'only files under artifacts/ or knowledge/company/**/_artifacts/** can be opened here' });
    }
    const gate = guardrails.check(rel, 'read');
    if (!gate.allowed) return send(403, { error: gate.reason });
    const abs = safeResolve(rel);
    if (!abs || !fs.existsSync(abs)) return send(404, { error: 'not found' });
    const st = await fsp.lstat(abs).catch(() => null);
    if (!st) return send(404, { error: 'not found' });
    if (st.isSymbolicLink()) return send(403, { error: 'forbidden: symlink artifacts are not allowed' });
    if (!st.isFile()) return send(404, { error: 'not found' });
    const realAbs = await fsp.realpath(abs).catch(() => null);
    if (!realAbs || !(await isAllowedArtifactRealPath(realAbs))) {
      return send(403, { error: 'forbidden: artifact path resolves outside allowed roots' });
    }
    const ext = path.extname(realAbs).toLowerCase();
    const type = { '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] || MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': 'inline' });
    return fs.createReadStream(realAbs).pipe(res);
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

  if (url.pathname === '/api/skills/new' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const targetPath = normalizeProjectRelPath(`skills/${body.scope || ''}/${body.name || ''}/SKILL.md`);
      const writeGate = guardrails.check(targetPath, 'write');
      if (!writeGate.allowed) return send(403, { error: writeGate.reason });
      if (writeGate.confirmRequired && body.confirmed !== true) {
        return send(409, { confirmRequired: true, folder: writeGate.folder, error: `guardrail: ${writeGate.folder} is set to "ask" — confirm the write` });
      }
      const result = await skillHub.createPersonalSkill(body);
      return send(result.errors ? 400 : 200, result);
    } catch (err) {
      return send(500, { errors: [err.message] });
    }
  }

  if (url.pathname === '/api/skills/content' && req.method === 'PUT') {
    try {
      const body = await readBody(req);
      const targetPath = normalizeProjectRelPath(`skills/${body.scope || ''}/${body.name || ''}/SKILL.md`);
      const writeGate = guardrails.check(targetPath, 'write');
      if (!writeGate.allowed) return send(403, { error: writeGate.reason });
      if (writeGate.confirmRequired && body.confirmed !== true) {
        return send(409, { confirmRequired: true, folder: writeGate.folder, error: `guardrail: ${writeGate.folder} is set to "ask" — confirm the write` });
      }
      const result = await skillHub.savePersonalSkillContent(body);
      return send(result.errors ? 400 : 200, result);
    } catch (err) {
      return send(500, { errors: [err.message] });
    }
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

  if (url.pathname === '/api/marketplace/updates' && req.method === 'GET') {
    try {
      return send(200, await skillHub.checkUpdates());
    } catch (err) {
      return send(502, { error: err.message });
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
    const result = await guardrails.save(body);
    return send(result.errors ? 400 : 200, result);
  }

  // ---------- restart ----------

  if (url.pathname === '/api/restart' && req.method === 'POST') {
    send(200, { ok: true, message: 'restarting interface and chat runtimes' });
    console.log('[server] restart requested via API (interface + chat)');
    spawn(process.execPath, ['scripts/restart.mjs'], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      env: process.env,
    }).unref();
    setTimeout(() => process.exit(0), 200).unref();
    return;
  }

  // ---------- workspace status (profile + instructions completeness) ----------

  if (url.pathname === '/api/workspace' && req.method === 'GET') {
    const checks = [
      { id: 'claude-md', label: 'CLAUDE.md (shared instructions)', path: 'CLAUDE.md', hint: 'core project instructions' },
      { id: 'claude-local', label: 'CLAUDE.local.md (personal instructions)', path: 'CLAUDE.local.md', hint: 'run /personal-onboarding' },
      { id: 'user-profile', label: 'knowledge/personal/user-profile.md (persona profile)', path: 'knowledge/personal/user-profile.md', hint: 'run /personal-onboarding' },
      { id: 'memory-file', label: 'memory/MEMORY.md (curated durable memory)', path: 'memory/MEMORY.md', hint: 'create in Settings → Memory or run memory-consolidation setup' },
      { id: 'memory-daily', label: 'memory/daily/ (working notes folder)', path: 'memory/daily', hint: 'create in Settings → Memory' },
      { id: 'operating-profile', label: 'operating-profile.md (company profile, symlinked to AI_OS root)', path: 'operating-profile.md', hint: 'run /company-onboarding' },
      { id: 'skill-profile', label: '.skill-profile (active skills)', path: '.skill-profile', hint: 'created by the Skill Hub' },
      { id: 'settings', label: '.claude/settings.local.json (permissions)', path: '.claude/settings.local.json', hint: 'created when plugins/permissions are set' },
    ]
      .filter((c) => c.path !== '.mcp.json')
      .map((c) => {
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
      memoryDone: Boolean(byId('memory-file').exists && byId('memory-daily').exists),
      companyTodos: byId('operating-profile').todos || 0,
    };
    onboarding.complete = onboarding.personalDone && onboarding.companyDone && onboarding.memoryDone;
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

server.listen(PORT, HOST, () => {
  console.log(`Steadymade AI OS interface → http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Reading project files from: ${ROOT}`);
  console.log(`Knowledge backend: ${knowledgeStorage.kind} (${knowledgeStorage.root})`);
  console.log(`Runtime mode: ${knowledgeConfig.runtime}`);
  if (API_TOKEN) console.log('API auth: enabled for mutating /api/* calls via x-steadymade-token or Authorization: Bearer <token>');
  const claudeBin = resolveClaudeBin();
  console.log(claudeBin
    ? `Scheduler: claude CLI at ${claudeBin}`
    : 'Scheduler: WARNING — claude CLI not found, jobs will fail (set CLAUDE_BIN)');
});
