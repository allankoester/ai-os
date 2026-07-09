// Steadymade AI OS — guardrails
//
// Human-configured, folder-level permission levels for agent file access:
//
//   write  agents may read and change files here without asking
//   ask    agents may read; every change prompts for confirmation
//   read   agents may read; changes are blocked
//   deny   agents may neither read nor change anything here
//
// The configuration lives in interface/guardrails.json (machine-local,
// gitignored) and is enforced twice:
//
//   1. Claude Code — materialized as permission rules (Read/Edit/Write with
//      path patterns) into .claude/settings.local.json. Effective for NEW
//      Claude sessions; scheduler runs pick it up automatically because each
//      run is a fresh session. An open interactive session needs a restart.
//   2. This interface — the file API blocks writes to read/deny folders and
//      reads from deny folders immediately.
//
// Only rules created by this module (tracked in guardrails.json) are ever
// removed from settings.local.json — manual entries stay untouched.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const LEVELS = ['write', 'ask', 'read', 'deny'];
const LEVEL_RANK = { deny: 0, read: 1, ask: 2, write: 3 };

const SKIP_DIRS = new Set(['.git', 'node_modules', '.playwright-mcp', '.obsidian', 'backups']);

const RECOMMENDED_BASELINE = {
  'knowledge/company': 'ask',
  'knowledge/inbox': 'ask',
  'knowledge/personal': 'read',
  'docs': 'ask',
  'memory': 'write',
  'runs': 'write',
  'scheduler': 'ask',
  'backups': 'deny',
  '.claude': 'ask',
  'interface': 'ask',
  'scripts': 'read',
  'skills/company': 'ask',
  'skills/personal': 'read',
};

export function createGuardrails({ rootDir }) {
  const configFile = path.join(rootDir, 'interface', 'guardrails.json');
  const settingsFile = path.join(rootDir, '.claude', 'settings.local.json');

  const readJson = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  };

  function readConfig() {
    const c = readJson(configFile, {});
    return {
      folders: c.folders || {},
      agents: c.agents || {},
      managedRules: c.managedRules || [],
      updatedAt: c.updatedAt || null,
    };
  }

  function normalizeFolder(folder) {
    return String(folder || '').replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
  }

  function isSafeFolderPath(folder) {
    const norm = normalizeFolder(folder);
    if (!norm) return false;
    if (norm.includes('..') || path.isAbsolute(norm)) return false;
    return true;
  }

  function globalLevelFor(folder, folders) {
    const hit = levelFor(folder + '/x', folders);
    return hit ? hit.level : 'write';
  }

  function clampToGlobal(globalLevel, requestedLevel) {
    if (!requestedLevel || !LEVEL_RANK[requestedLevel]) return null;
    if (LEVEL_RANK[requestedLevel] > LEVEL_RANK[globalLevel]) return globalLevel;
    return requestedLevel;
  }

  function effectiveLevel(globalLevel, overrideLevel) {
    if (!overrideLevel) return globalLevel;
    return LEVEL_RANK[overrideLevel] < LEVEL_RANK[globalLevel] ? overrideLevel : globalLevel;
  }

  // ---------- folder candidates ----------

  function scanFolders() {
    const folders = [];
    const push = (rel) => { if (!folders.includes(rel)) folders.push(rel); };
    const listDirs = (relBase) => {
      try {
        const base = path.join(rootDir, relBase || '.');
        const entries = fs.readdirSync(base, { withFileTypes: true });
        const out = [];
        for (const d of entries) {
          if (d.name.startsWith('.') || SKIP_DIRS.has(d.name)) continue;
          const abs = path.join(base, d.name);
          if (d.isDirectory()) {
            out.push(relBase ? `${relBase}/${d.name}` : d.name);
            continue;
          }
          if (d.isSymbolicLink()) {
            try {
              if (fs.statSync(abs).isDirectory()) out.push(relBase ? `${relBase}/${d.name}` : d.name);
            } catch {
              // broken symlink or inaccessible target: ignore
            }
          }
        }
        return out.sort();
      } catch { return []; }
    };
    for (const top of listDirs('')) {
      push(top);
      if (top === 'knowledge') {
        for (const sub of listDirs('knowledge')) {
          push(sub);
          if (sub === 'knowledge/company') for (const dom of listDirs('knowledge/company')) push(dom);
        }
      }
      if (top === 'skills') for (const sub of listDirs('skills')) push(sub);
    }
    push('.claude');
    return folders;
  }

  // most specific folder rule wins (knowledge/personal beats knowledge)
  function levelFor(relPath, folders) {
    const norm = relPath.replace(/\\/g, '/');
    let best = null;
    for (const [folder, level] of Object.entries(folders)) {
      if (norm === folder || norm.startsWith(folder + '/')) {
        if (!best || folder.length > best.folder.length) best = { folder, level };
      }
    }
    return best;
  }

  // ---------- materialization into Claude Code permissions ----------

  function rulesForFolder(folder, level) {
    const p = `./${folder}/**`;
    const read = `Read(${p})`, edit = `Edit(${p})`, write = `Write(${p})`;
    if (level === 'write') return { allow: [read, edit, write], ask: [], deny: [] };
    if (level === 'ask') return { allow: [read], ask: [edit, write], deny: [] };
    if (level === 'read') return { allow: [read], ask: [], deny: [edit, write] };
    if (level === 'deny') return { allow: [], ask: [], deny: [read, edit, write] };
    return { allow: [], ask: [], deny: [] };
  }

  async function materialize(config) {
    const settings = readJson(settingsFile, {});
    if (typeof settings.permissions !== 'object' || !settings.permissions) settings.permissions = {};
    for (const key of ['allow', 'ask', 'deny']) {
      if (!Array.isArray(settings.permissions[key])) settings.permissions[key] = [];
    }
    const managed = new Set(config.managedRules);
    for (const key of ['allow', 'ask', 'deny']) {
      settings.permissions[key] = settings.permissions[key].filter((r) => !managed.has(r));
    }
    const newManaged = [];
    for (const [folder, level] of Object.entries(config.folders)) {
      const rules = rulesForFolder(folder, level);
      for (const key of ['allow', 'ask', 'deny']) {
        for (const rule of rules[key]) {
          if (!settings.permissions[key].includes(rule)) settings.permissions[key].push(rule);
          newManaged.push(rule);
        }
      }
    }
    config.managedRules = newManaged;
    await fsp.mkdir(path.dirname(settingsFile), { recursive: true });
    await fsp.writeFile(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
  }

  // ---------- public API ----------

  return {
    status() {
      const config = readConfig();
      const scanned = scanFolders();
      // configured folders that the scan does not surface (deeper paths, or
      // directories that were deleted) still need to show up for editing
      const all = [...new Set([...scanned, ...Object.keys(config.folders)])]
        .sort((a, b) => a.localeCompare(b));
      const folders = all.map((folder) => ({
        folder,
        level: config.folders[folder] || null,
        effective: (levelFor(folder + '/x', config.folders) || { level: 'write' }).level,
        inherited: !config.folders[folder] && Boolean(levelFor(folder + '/x', config.folders)),
        custom: !scanned.includes(folder),
        exists: fs.existsSync(path.join(rootDir, folder)),
      }));
      return {
        folders,
        agents: config.agents,
        agentFolderKeys: all,
        agentEffective: Object.fromEntries(
          Object.entries(config.agents || {}).map(([agent, rules]) => [
            agent,
            Object.fromEntries(
              [...new Set([...all, ...Object.keys(rules || {})])].map((folder) => {
                const global = globalLevelFor(folder, config.folders);
                const override = rules?.[folder] || null;
                const effective = effectiveLevel(global, override);
                return [folder, { global, override, effective, blockedByGlobalDeny: global === 'deny' }];
              }),
            ),
          ]),
        ),
        levels: LEVELS,
        levelRank: LEVEL_RANK,
        recommendedBaseline: RECOMMENDED_BASELINE,
        updatedAt: config.updatedAt,
        managedRules: config.managedRules,
        settingsFile: '.claude/settings.local.json',
        note: 'Unset folders default to "write" behavior with Claude Code\'s normal permission prompts.',
      };
    },

    async save(input) {
      const current = readConfig();
      const foldersInput = input?.folders ?? input ?? current.folders;
      const agentsInput = input?.agents ?? current.agents;
      if (typeof foldersInput !== 'object' || !foldersInput) return { errors: ['folders object required'] };
      const folders = {};
      for (const [folder, level] of Object.entries(foldersInput)) {
        if (!level) continue; // unset
        if (!LEVELS.includes(level)) return { errors: [`invalid level "${level}" for ${folder}`] };
        if (!isSafeFolderPath(folder)) return { errors: [`invalid folder path: ${folder}`] };
        folders[normalizeFolder(folder)] = level;
      }
      if (typeof agentsInput !== 'object' || !agentsInput) return { errors: ['agents object required'] };
      const agents = {};
      for (const [agent, rules] of Object.entries(agentsInput)) {
        if (!/^[a-z0-9_-]+$/.test(agent)) return { errors: [`invalid agent id: ${agent}`] };
        if (typeof rules !== 'object' || !rules) continue;
        const clean = {};
        for (const [folder, level] of Object.entries(rules)) {
          if (!level) continue;
          if (!LEVELS.includes(level)) return { errors: [`invalid level "${level}" for ${agent}:${folder}`] };
          if (!isSafeFolderPath(folder)) return { errors: [`invalid agent folder path: ${folder}`] };
          const normFolder = normalizeFolder(folder);
          const global = globalLevelFor(normFolder, folders);
          if (global === 'deny') continue;
          const clamped = clampToGlobal(global, level);
          if (clamped && clamped !== global) clean[normFolder] = clamped;
        }
        if (Object.keys(clean).length) agents[agent] = clean;
      }
      const config = current;
      config.folders = folders;
      config.agents = agents;
      config.updatedAt = Date.now();
      await materialize(config);
      await fsp.writeFile(configFile, JSON.stringify(config, null, 2), 'utf8');
      return { ok: true, status: this.status() };
    },

    // interface-side enforcement for the file API
    check(relPath, action /* 'read' | 'write' */) {
      const config = readConfig();
      const hit = levelFor(relPath, config.folders);
      if (!hit) return { allowed: true };
      const { level, folder } = hit;
      if (level === 'deny') return { allowed: false, level, folder, reason: `guardrail: ${folder} is deny — no agent/interface access` };
      if (action === 'write' && level === 'read') return { allowed: false, level, folder, reason: `guardrail: ${folder} is read-only` };
      if (action === 'write' && level === 'ask') return { allowed: true, confirmRequired: true, level, folder };
      return { allowed: true, level, folder };
    },
  };
}
