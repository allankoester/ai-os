// Steadymade AI OS — plugin configuration
//
// A plugin is a known integration that the interface can enable/configure.
// What "enable" really does depends on the kind — and the UI says so honestly:
//
//   mcp         → writes a server entry into .mcp.json (Claude Code loads it
//                 on next session start). Real effect.
//   permission  → adds the tool to permissions.allow in
//                 .claude/settings.local.json. Real effect.
//   external    → stores enabled state + config and shows the setup command;
//                 installation/tunnelling happens outside this interface.
//
// State lives in interface/plugins.json (machine-local, gitignored). Only
// entries this module created are ever removed from .mcp.json / settings.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

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
    id: 'mcp-custom', name: 'Custom MCP Server', kind: 'mcp',
    description: 'A free slot for any additional MCP server (e.g. a company API). Configure command, args and env — the entry is written to .mcp.json.',
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

export function createPluginManager({ rootDir }) {
  const stateFile = path.join(rootDir, 'interface', 'plugins.json');
  const mcpFile = path.join(rootDir, '.mcp.json');
  const settingsFile = path.join(rootDir, '.claude', 'settings.local.json');

  const readJson = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  };

  function readState() {
    const s = readJson(stateFile, {});
    return {
      plugins: s.plugins || {},
      custom: Array.isArray(s.custom) ? s.custom : [],
      managedMcp: s.managedMcp || [],
      managedPermissions: s.managedPermissions || [],
    };
  }
  async function writeState(state) {
    await fsp.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
  }

  function allDefs(state) {
    return [...REGISTRY, ...state.custom.map((c) => ({ ...c, custom: true }))];
  }

  // ---------- materialization ----------

  async function applyMcp(state) {
    const mcp = readJson(mcpFile, {});
    if (typeof mcp.mcpServers !== 'object' || !mcp.mcpServers) mcp.mcpServers = {};
    // remove entries we manage, then re-add the enabled ones
    for (const id of state.managedMcp) delete mcp.mcpServers[id];
    const managed = [];
    for (const def of allDefs(state).filter((d) => d.kind === 'mcp')) {
      const p = state.plugins[def.id];
      if (!p?.enabled) continue;
      const cfg = { ...def.defaults, ...(p.config || {}) };
      if (!cfg.command) continue; // unconfigured custom slot
      mcp.mcpServers[def.id] = {
        command: cfg.command,
        args: Array.isArray(cfg.args) ? cfg.args : String(cfg.args || '').split(/\s+/).filter(Boolean),
        ...(cfg.env && Object.keys(cfg.env).length ? { env: cfg.env } : {}),
      };
      managed.push(def.id);
    }
    state.managedMcp = managed;
    if (Object.keys(mcp.mcpServers).length === 0 && managed.length === 0 && !fs.existsSync(mcpFile)) return;
    await fsp.writeFile(mcpFile, JSON.stringify(mcp, null, 2), 'utf8');
  }

  async function applyPermissions(state) {
    const settings = readJson(settingsFile, {});
    if (typeof settings.permissions !== 'object' || !settings.permissions) settings.permissions = {};
    if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];
    const allow = new Set(settings.permissions.allow);
    for (const perm of state.managedPermissions) allow.delete(perm);
    const managed = [];
    for (const def of allDefs(state).filter((d) => d.kind === 'permission')) {
      if (state.plugins[def.id]?.enabled && def.permission) { allow.add(def.permission); managed.push(def.permission); }
    }
    state.managedPermissions = managed;
    settings.permissions.allow = [...allow];
    await fsp.mkdir(path.dirname(settingsFile), { recursive: true });
    await fsp.writeFile(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
  }

  // ---------- public API ----------

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
          effect: def.kind === 'mcp' ? 'writes .mcp.json (loaded on next Claude session)'
            : def.kind === 'permission' ? 'writes .claude/settings.local.json permissions'
            : 'config only — install/run outside this interface',
        };
      });
    },

    async update(id, { enabled, config }) {
      const state = readState();
      const def = allDefs(state).find((d) => d.id === id);
      if (!def) return { errors: ['unknown plugin: ' + id] };
      const current = state.plugins[id] || { enabled: false, config: {} };
      if (enabled !== undefined) current.enabled = Boolean(enabled);
      if (config !== undefined && typeof config === 'object') current.config = config;
      state.plugins[id] = current;
      await applyMcp(state);
      await applyPermissions(state);
      await writeState(state);
      return { ok: true, plugin: this.list().find((p) => p.id === id) };
    },

    async create({ id, name, kind, description, setup, permission, config }) {
      const errors = [];
      if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id || '')) errors.push('id must be kebab-case (a-z, 0-9, -)');
      if (!name || !String(name).trim()) errors.push('name is required');
      if (!['mcp', 'permission', 'external'].includes(kind)) errors.push('kind must be mcp, permission or external');
      if (kind === 'permission' && !permission) errors.push('permission kind needs a permission rule (e.g. "WebSearch" or "Bash(gh:*)")');
      const state = readState();
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
      return { ok: true, id };
    },

    async remove(id) {
      const state = readState();
      if (REGISTRY.some((d) => d.id === id)) return { errors: ['built-in plugins cannot be deleted — disable them instead'] };
      if (!state.custom.some((d) => d.id === id)) return { errors: ['unknown custom plugin: ' + id] };
      state.custom = state.custom.filter((d) => d.id !== id);
      delete state.plugins[id];
      await applyMcp(state);
      await applyPermissions(state);
      await writeState(state);
      return { ok: true };
    },
  };
}
