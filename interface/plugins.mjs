// Steadymade AI OS — plugin configuration
//
// Settings state in interface/plugins.json is canonical desired state.
// Projections are materialized from that same state for both provider lanes:
// - Claude: .mcp.json + .claude/settings.local.json permissions
// - OpenCode: managed OpenCode config mcp section

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  ensureRuntimeFilePath,
  resolveRuntimeRoot,
} from './storage/runtime/storage-kernel.mjs';

const PLUGINS_STATE_SCHEMA_VERSION = 2;

const REGISTRY = [
  {
    id: 'websearch', name: 'Web Search', kind: 'permission',
    description: 'Allows Claude Code\'s built-in WebSearch tool without a permission prompt — used by agents and scheduled jobs for research tasks.',
    permission: 'WebSearch',
    defaults: {},
  },
  {
    id: 'context7', name: 'Context7', kind: 'mcp',
    description: 'MCP server providing up-to-date, version-specific library documentation and code examples straight from the source.',
    defaults: { command: 'npx', args: ['-y', '@upstash/context7-mcp'], env: {} },
  },
  {
    id: 'm365-readonly', name: 'Microsoft 365 (Read-only)', kind: 'mcp',
    description: 'Local MCP server for delegated Microsoft Graph read-only access (work-account-only OAuth/PKCE intent). No write/mutate tools and no generic Graph proxy endpoint.',
    defaults: { command: 'node', args: ['mcp/m365/server.mjs'] },
  },
  {
    id: 'm365-write', name: 'Microsoft 365 (Calendar read + SharePoint write)', kind: 'mcp',
    description: 'Local MCP server with fixed calendar-read and SharePoint read/write tools. No generic Graph proxy endpoint. Every write tool requires explicit confirm=true in arguments.',
    defaults: { command: 'node', args: ['mcp/m365-write/server.mjs'] },
  },
  {
    id: 'twenty', name: 'Twenty CRM', kind: 'mcp',
    description: 'Streamable HTTP MCP connection to the self-hosted Twenty CRM API endpoint.',
    defaults: {
      type: 'streamable-http',
      url: 'https://crm.smapas.com/mcp',
      headers: { Authorization: 'Bearer ${TWENTY_API_KEY}' },
      envKeys: ['TWENTY_API_KEY'],
    },
  },
  {
    id: 'mcp-custom', name: 'Custom MCP Server', kind: 'mcp',
    description: 'A free slot for any additional MCP server (e.g. a company API). Configure command/args/env or streamable-http url/headers — the entry is written to .mcp.json.',
    defaults: { command: '', args: [], env: {} },
  },
  {
    id: 'agent-browser', name: 'Agent Browser', kind: 'external',
    description: 'Browser automation CLI for AI agents — navigate pages, fill forms, click buttons from agent tasks.',
    setup: 'npm install -g agent-browser',
    defaults: { binary: 'agent-browser' },
  },
  {
    id: 'novnc', name: 'noVNC (VM Desktop)', kind: 'external',
    description: 'Browser access to a VM desktop through a hardened SSH tunnel — Stage 3 runtime operations (logins, visual checks on the VM).',
    setup: 'ssh -N -L 6080:localhost:6080 <vm-host>   # then open http://localhost:6080',
    defaults: { localPort: 6080, vmHost: '' },
  },
  {
    id: 'plannotator', name: 'Plannotator', kind: 'external',
    description: 'Visual review and annotation of Claude Code plans in the browser before approving them.',
    setup: 'See plannotator install instructions (hook-based Claude Code integration).',
    defaults: {},
  },
  {
    id: 'oh-my-open-code', name: 'oh-my-open-code', kind: 'external',
    description: 'Plugin pack for the OpenCode agent runtime — relevant for the multi-provider strategy (Option B), not used by Claude Code itself.',
    setup: 'See oh-my-open-code repository for OpenCode setup.',
    defaults: {},
  },
];

function stripJsoncCommentsAndTrailingCommas(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
      i -= 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 1;
      continue;
    }
    out += ch;
  }

  let cleaned = '';
  inString = false;
  escaped = false;
  quote = '';
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (inString) {
      cleaned += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      cleaned += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j])) j++;
      if (out[j] === '}' || out[j] === ']') continue;
    }
    cleaned += ch;
  }
  return cleaned;
}

function parseJsonLike(raw, fallback = {}) {
  try { return JSON.parse(raw); }
  catch {
    try { return JSON.parse(stripJsoncCommentsAndTrailingCommas(raw)); }
    catch { return fallback; }
  }
}

export function createPluginManager({ rootDir }) {
  const stateFile = path.join(rootDir, 'interface', 'plugins.json');
  const providerSettingsFile = path.join(rootDir, 'interface', 'provider-settings.json');
  const mcpFile = path.join(rootDir, '.mcp.json');
  const settingsFile = path.join(rootDir, '.claude', 'settings.local.json');

  const readJson = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  };

  const readJsonLikeFile = (file, fallback = {}) => {
    try { return parseJsonLike(fs.readFileSync(file, 'utf8'), fallback); }
    catch { return fallback; }
  };

  const atomicWriteJson = async (file, value) => {
    const dir = path.dirname(file);
    await fsp.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
    await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, file);
  };

  function supportsClaudeMcp(def) { return def.kind === 'mcp'; }
  function supportsClaudePermission(def) { return def.kind === 'permission'; }
  function supportsOpenCodeMcp(def) { return def.kind === 'mcp'; }

  function projectionFlags(def, enabled) {
    return {
      claudeMcp: { supported: supportsClaudeMcp(def), active: Boolean(enabled && supportsClaudeMcp(def)) },
      claudePermission: { supported: supportsClaudePermission(def), active: Boolean(enabled && supportsClaudePermission(def)) },
      openCodeMcp: { supported: supportsOpenCodeMcp(def), active: Boolean(enabled && supportsOpenCodeMcp(def)) },
    };
  }

  function allDefs(state) {
    return [...REGISTRY, ...state.custom.map((c) => ({ ...c, custom: true }))];
  }

  function expandHome(rawPath) {
    const value = String(rawPath || '').trim();
    if (!value) return '';
    if (value === '~') return process.env.HOME || '';
    if (value.startsWith('~/')) return path.join(process.env.HOME || '', value.slice(2));
    return value;
  }

  function resolveConfiguredPathCandidate(rawPath) {
    const expanded = expandHome(rawPath);
    if (!expanded) return null;
    if (!expanded.includes(path.sep)) return null;
    return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(rootDir, expanded);
  }

  function resolveOpenCodeProjectionPaths({ createManaged = false } = {}) {
    const out = new Set();
    const runtimeRoot = resolveRuntimeRoot({ testRootOverride: process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT || null });
    const managedDefault = createManaged
      ? ensureRuntimeFilePath({
        runtimeRoot,
        relativePath: path.join('managed-runtime', 'opencode', 'config.json'),
        createIfMissing: true,
        code: 'unsafe_opencode_config_path',
      })
      : path.join(runtimeRoot, 'managed-runtime', 'opencode', 'config.json');
    out.add(managedDefault);

    const providerSettings = readJson(providerSettingsFile, {});
    const configured = resolveConfiguredPathCandidate(providerSettings?.opencodeConfigPath);
    if (configured) out.add(configured);

    const repoDefault = path.join(rootDir, 'opencode.jsonc');
    if (fs.existsSync(repoDefault)) out.add(repoDefault);
    return [...out];
  }

  function hasLegacyM365WriteEnabled() {
    for (const file of resolveOpenCodeProjectionPaths()) {
      const config = readJsonLikeFile(file, {});
      const entry = config?.mcp && typeof config.mcp === 'object' && !Array.isArray(config.mcp)
        ? config.mcp['m365-write']
        : null;
      if (entry && entry.enabled !== false) return true;
    }
    return false;
  }

  function normalizeState(raw) {
    const state = {
      schemaVersion: Number.isInteger(raw?.schemaVersion) ? raw.schemaVersion : 1,
      plugins: raw?.plugins && typeof raw.plugins === 'object' && !Array.isArray(raw.plugins) ? raw.plugins : {},
      custom: Array.isArray(raw?.custom) ? raw.custom : [],
      managedMcp: Array.isArray(raw?.managedMcp) ? raw.managedMcp : [],
      managedPermissions: Array.isArray(raw?.managedPermissions) ? raw.managedPermissions : [],
      managedOpenCodeMcp: Array.isArray(raw?.managedOpenCodeMcp) ? raw.managedOpenCodeMcp : [],
    };

    if (!state.plugins['m365-write'] && hasLegacyM365WriteEnabled()) {
      state.plugins['m365-write'] = { enabled: true, config: {} };
    }

    const mcpServers = readJson(mcpFile, {})?.mcpServers;
    if (mcpServers && typeof mcpServers === 'object' && !Array.isArray(mcpServers)) {
      for (const def of REGISTRY.filter((d) => d.kind === 'mcp')) {
        if (!state.plugins[def.id] && mcpServers[def.id]) {
          state.plugins[def.id] = { enabled: true, config: {} };
        }
      }
    }

    const allow = readJson(settingsFile, {})?.permissions?.allow;
    const allowSet = Array.isArray(allow)
      ? new Set(allow.map((entry) => String(entry || '').trim()).filter(Boolean))
      : new Set();
    for (const def of REGISTRY.filter((d) => d.kind === 'permission' && d.permission)) {
      if (!state.plugins[def.id] && allowSet.has(def.permission)) {
        state.plugins[def.id] = { enabled: true, config: {} };
      }
    }

    if (state.schemaVersion < PLUGINS_STATE_SCHEMA_VERSION) {
      state.schemaVersion = PLUGINS_STATE_SCHEMA_VERSION;
    }
    return state;
  }

  function readStateWithMeta() {
    const raw = readJson(stateFile, {});
    const state = normalizeState(raw);
    const rawComparable = {
      schemaVersion: Number.isInteger(raw?.schemaVersion) ? raw.schemaVersion : 1,
      plugins: raw?.plugins && typeof raw.plugins === 'object' && !Array.isArray(raw.plugins) ? raw.plugins : {},
      custom: Array.isArray(raw?.custom) ? raw.custom : [],
      managedMcp: Array.isArray(raw?.managedMcp) ? raw.managedMcp : [],
      managedPermissions: Array.isArray(raw?.managedPermissions) ? raw.managedPermissions : [],
      managedOpenCodeMcp: Array.isArray(raw?.managedOpenCodeMcp) ? raw.managedOpenCodeMcp : [],
    };
    const stateComparable = {
      schemaVersion: state.schemaVersion,
      plugins: state.plugins,
      custom: state.custom,
      managedMcp: state.managedMcp,
      managedPermissions: state.managedPermissions,
      managedOpenCodeMcp: state.managedOpenCodeMcp,
    };
    const changed = JSON.stringify(rawComparable) !== JSON.stringify(stateComparable);
    return { state, changed };
  }

  function readState() {
    return normalizeState(readJson(stateFile, {}));
  }

  async function writeState(state) {
    await atomicWriteJson(stateFile, {
      schemaVersion: PLUGINS_STATE_SCHEMA_VERSION,
      plugins: state.plugins || {},
      custom: Array.isArray(state.custom) ? state.custom : [],
      managedMcp: Array.isArray(state.managedMcp) ? state.managedMcp : [],
      managedPermissions: Array.isArray(state.managedPermissions) ? state.managedPermissions : [],
      managedOpenCodeMcp: Array.isArray(state.managedOpenCodeMcp) ? state.managedOpenCodeMcp : [],
    });
  }

  function toOpenCodeMcpEntry(cfg) {
    const isRemote = String(cfg.type || '').trim() === 'streamable-http' || (!cfg.command && cfg.url);
    if (isRemote) {
      const url = String(cfg.url || '').trim();
      if (!url) return null;
      const headers = cfg.headers && typeof cfg.headers === 'object' && !Array.isArray(cfg.headers)
        ? Object.fromEntries(
          Object.entries(cfg.headers)
            .filter(([k, v]) => String(k || '').trim() && typeof v === 'string')
            .map(([k, v]) => [String(k).trim(), v]),
        )
        : null;
      return {
        type: 'remote',
        url,
        enabled: true,
        ...(headers && Object.keys(headers).length ? { headers } : {}),
      };
    }
    const command = String(cfg.command || '').trim();
    if (!command) return null;
    const args = Array.isArray(cfg.args) ? cfg.args : String(cfg.args || '').split(/\s+/).filter(Boolean);
    const env = cfg.env && typeof cfg.env === 'object' && !Array.isArray(cfg.env)
      ? Object.fromEntries(
        Object.entries(cfg.env)
          .filter(([k, v]) => String(k || '').trim() && typeof v === 'string')
          .map(([k, v]) => [String(k).trim(), v]),
      )
      : null;
    return {
      type: 'local',
      enabled: true,
      command: [command, ...args],
      ...(env && Object.keys(env).length ? { environment: env } : {}),
    };
  }

  async function applyClaudeMcp(state) {
    const mcp = readJson(mcpFile, {});
    if (typeof mcp.mcpServers !== 'object' || !mcp.mcpServers) mcp.mcpServers = {};
    const defs = allDefs(state).filter((d) => supportsClaudeMcp(d));
    for (const def of defs) delete mcp.mcpServers[def.id];
    const managed = [];
    for (const def of defs) {
      const p = state.plugins[def.id];
      if (!p?.enabled) continue;
      const cfg = { ...def.defaults, ...(p.config || {}) };
      const isRemote = String(cfg.type || '').trim() === 'streamable-http' || (!cfg.command && cfg.url);
      if (isRemote) {
        const url = String(cfg.url || '').trim();
        if (!url) continue;
        const headers = cfg.headers && typeof cfg.headers === 'object' && !Array.isArray(cfg.headers)
          ? Object.fromEntries(
            Object.entries(cfg.headers)
              .filter(([k, v]) => String(k || '').trim() && typeof v === 'string')
              .map(([k, v]) => [String(k).trim(), v]),
          )
          : null;
        mcp.mcpServers[def.id] = {
          type: 'streamable-http',
          url,
          ...(headers && Object.keys(headers).length ? { headers } : {}),
        };
        managed.push(def.id);
        continue;
      }
      if (!cfg.command) continue;
      mcp.mcpServers[def.id] = {
        command: cfg.command,
        args: Array.isArray(cfg.args) ? cfg.args : String(cfg.args || '').split(/\s+/).filter(Boolean),
        ...(cfg.env && Object.keys(cfg.env).length ? { env: cfg.env } : {}),
      };
      managed.push(def.id);
    }
    state.managedMcp = managed;
    if (Object.keys(mcp.mcpServers).length === 0 && managed.length === 0 && !fs.existsSync(mcpFile)) return;
    await atomicWriteJson(mcpFile, mcp);
  }

  async function applyClaudePermissions(state) {
    const settings = readJson(settingsFile, {});
    if (typeof settings.permissions !== 'object' || !settings.permissions) settings.permissions = {};
    if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];
    const allow = new Set(settings.permissions.allow);
    const defs = allDefs(state).filter((d) => supportsClaudePermission(d));
    for (const def of defs) {
      if (def.permission) allow.delete(def.permission);
    }
    const managed = [];
    for (const def of defs) {
      if (state.plugins[def.id]?.enabled && def.permission) {
        allow.add(def.permission);
        managed.push(def.permission);
      }
    }
    state.managedPermissions = managed;
    settings.permissions.allow = [...allow];
    await atomicWriteJson(settingsFile, settings);
  }

  async function applyOpenCodeProjection(state) {
    const defs = allDefs(state).filter((d) => supportsOpenCodeMcp(d));
    const managed = [];
    for (const file of resolveOpenCodeProjectionPaths({ createManaged: true })) {
      const config = readJsonLikeFile(file, {});
      const out = config && typeof config === 'object' && !Array.isArray(config) ? { ...config } : {};
      if (!out.mcp || typeof out.mcp !== 'object' || Array.isArray(out.mcp)) out.mcp = {};
      for (const def of defs) delete out.mcp[def.id];
      for (const def of defs) {
        const p = state.plugins[def.id];
        if (!p?.enabled) continue;
        const cfg = { ...def.defaults, ...(p.config || {}) };
        const entry = toOpenCodeMcpEntry(cfg);
        if (!entry) continue;
        out.mcp[def.id] = entry;
        if (!managed.includes(def.id)) managed.push(def.id);
      }
      await atomicWriteJson(file, out);
    }
    state.managedOpenCodeMcp = managed;
  }

  async function materializeProjections(state) {
    await applyClaudeMcp(state);
    await applyClaudePermissions(state);
    await applyOpenCodeProjection(state);
  }

  return {
    list() {
      const state = readState();
      return allDefs(state).map((def) => {
        const p = state.plugins[def.id] || {};
        return {
          id: def.id,
          name: def.name,
          kind: def.kind,
          custom: Boolean(def.custom),
          description: def.description,
          setup: def.setup || null,
          permission: def.permission || null,
          enabled: Boolean(p.enabled),
          config: { ...def.defaults, ...(p.config || {}) },
          projections: projectionFlags(def, Boolean(p.enabled)),
          effect: def.kind === 'mcp'
            ? 'writes Claude MCP (.mcp.json) + OpenCode managed MCP projection'
            : def.kind === 'permission'
              ? 'writes Claude permission projection (.claude/settings.local.json)'
              : 'config only — install/run outside this interface',
        };
      });
    },

    getPlugin(id) {
      const state = readState();
      const def = allDefs(state).find((d) => d.id === id);
      if (!def) return null;
      const p = state.plugins[id] || {};
      return {
        id: def.id,
        name: def.name,
        kind: def.kind,
        custom: Boolean(def.custom),
        description: def.description,
        setup: def.setup || null,
        permission: def.permission || null,
        enabled: Boolean(p.enabled),
        projections: projectionFlags(def, Boolean(p.enabled)),
        defaults: { ...(def.defaults || {}) },
        config: { ...(def.defaults || {}), ...(p.config || {}) },
      };
    },

    async syncProjections() {
      const meta = readStateWithMeta();
      if (meta.changed) await writeState(meta.state);
      await materializeProjections(meta.state);
      await writeState(meta.state);
      return { ok: true };
    },

    async update(id, { enabled, config }) {
      const meta = readStateWithMeta();
      const state = meta.state;
      const def = allDefs(state).find((d) => d.id === id);
      if (!def) return { errors: ['unknown plugin: ' + id] };
      const current = state.plugins[id] || { enabled: false, config: {} };
      if (enabled !== undefined) current.enabled = Boolean(enabled);
      if (config !== undefined && typeof config === 'object') current.config = config;
      state.plugins[id] = current;
      await writeState(state);
      await materializeProjections(state);
      await writeState(state);
      return { ok: true, plugin: this.list().find((p) => p.id === id) };
    },

    async create({ id, name, kind, description, setup, permission, config }) {
      const errors = [];
      if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id || '')) errors.push('id must be kebab-case (a-z, 0-9, -)');
      if (!name || !String(name).trim()) errors.push('name is required');
      if (!['mcp', 'permission', 'external'].includes(kind)) errors.push('kind must be mcp, permission or external');
      if (kind === 'permission' && !permission) errors.push('permission kind needs a permission rule (e.g. "WebSearch" or "Bash(gh:*)")');
      const state = readStateWithMeta().state;
      if (allDefs(state).some((d) => d.id === id)) errors.push(`plugin id already exists: ${id}`);
      if (errors.length) return { errors };
      state.custom.push({
        id, name: String(name).trim(), kind,
        description: String(description || '').trim() || 'Custom plugin.',
        setup: String(setup || '').trim() || null,
        ...(kind === 'permission' ? { permission: String(permission).trim() } : {}),
        defaults: kind === 'mcp' ? { command: '', args: [], env: {}, ...(config || {}) } : (config || {}),
      });
      await writeState(state);
      await materializeProjections(state);
      await writeState(state);
      return { ok: true, id };
    },

    async remove(id) {
      const state = readStateWithMeta().state;
      if (REGISTRY.some((d) => d.id === id)) return { errors: ['built-in plugins cannot be deleted — disable them instead'] };
      if (!state.custom.some((d) => d.id === id)) return { errors: ['unknown custom plugin: ' + id] };
      state.custom = state.custom.filter((d) => d.id !== id);
      delete state.plugins[id];
      await writeState(state);
      await materializeProjections(state);
      await writeState(state);
      return { ok: true };
    },
  };
}
