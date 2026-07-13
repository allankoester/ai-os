import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { boardError } from './errors.mjs';

const SCOPES = ['private', 'team'];

function isPathWithin(parentAbs, targetAbs) {
  const rel = path.relative(parentAbs, targetAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function looksLikeConflictCopy(fileName, id) {
  if (!fileName.endsWith('.json')) return false;
  if (fileName === `${id}.json`) return false;
  if (!fileName.startsWith(id)) return false;
  const lower = fileName.toLowerCase();
  return lower.includes('conflict') || lower.includes('copy') || lower.includes('dupe') || lower.includes('variant') || lower.includes('(');
}

function normalizeRoot(absPath) {
  if (!absPath) return null;
  return path.resolve(String(absPath));
}

export function createBoardStorage({ rootDir, resolveRoots = null }) {
  const defaultPrivateRoot = path.join(rootDir, 'project-board');
  const legacyRoot = defaultPrivateRoot;
  const locks = new Map();
  const teamDivergence = { detected: false, reason: '', files: [] };

  function withLock(key, fn) {
    const prev = locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const queue = prev.finally(() => current);
    locks.set(key, queue);
    return prev.then(async () => {
      try {
        return await fn();
      } finally {
        release();
        if (locks.get(key) === queue) locks.delete(key);
      }
    });
  }

  async function atomicWriteJson(file, value) {
    const dir = path.dirname(file);
    const tmp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
    const data = JSON.stringify(value, null, 2);
    const fh = await fsp.open(tmp, 'w', 0o600);
    try {
      await fh.writeFile(data, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, file);
  }

  async function readEntity(file) {
    let raw;
    try {
      raw = await fsp.readFile(file, 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') throw err;
      throw boardError(500, 'storage_error', `failed to read entity file: ${path.basename(file)}`);
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw boardError(500, 'storage_corruption', `malformed entity json: ${path.basename(file)}`);
    }
  }

  async function listEntities(dir) {
    const names = await fsp.readdir(dir).catch(() => []);
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json') || name.startsWith('.')) continue;
      const file = path.join(dir, name);
      try {
        out.push(await readEntity(file));
      } catch {
        // ignore malformed files
      }
    }
    return out;
  }

  function currentRoots() {
    const resolved = typeof resolveRoots === 'function'
      ? resolveRoots()
      : {
        privateRoot: defaultPrivateRoot,
        teamRoot: null,
        sharedKnowledgeRoot: path.join(rootDir, 'knowledge'),
        personalKnowledgeRoot: path.join(rootDir, 'knowledge', 'personal'),
      };
    return {
      privateRoot: normalizeRoot(resolved?.privateRoot || defaultPrivateRoot),
      teamRoot: normalizeRoot(resolved?.teamRoot || null),
      sharedKnowledgeRoot: normalizeRoot(resolved?.sharedKnowledgeRoot || null),
      personalKnowledgeRoot: normalizeRoot(resolved?.personalKnowledgeRoot || null),
    };
  }

  function assertRootSafety(roots) {
    const privateRoot = roots.privateRoot;
    const teamRoot = roots.teamRoot;
    if (!privateRoot) {
      throw boardError(503, 'board_root_unavailable', 'private board root is not configured');
    }
    const all = [
      ['private', privateRoot],
      ['team', teamRoot],
      ['sharedKnowledge', roots.sharedKnowledgeRoot],
      ['personalKnowledge', roots.personalKnowledgeRoot],
    ].filter(([, p]) => p);

    for (const [label, abs] of all) {
      if (label === 'private' && abs && !fs.existsSync(abs)) {
        fs.mkdirSync(abs, { recursive: true });
      }
      const lst = fs.lstatSync(abs, { throwIfNoEntry: false });
      if (!lst) {
        if (label === 'team' || label === 'sharedKnowledge' || label === 'personalKnowledge') continue;
        throw boardError(503, 'board_root_unavailable', `${label} root is unavailable`, { path: abs });
      }
      if (lst.isSymbolicLink()) {
        throw boardError(422, 'board_root_unsafe', `${label} root must not be a symlink`, { path: abs });
      }
      if (!lst.isDirectory()) {
        throw boardError(422, 'board_root_unsafe', `${label} root is not a directory`, { path: abs });
      }
    }

    const overlapPairs = [
      ['private', privateRoot, 'team', teamRoot],
      ['private', privateRoot, 'sharedKnowledge', roots.sharedKnowledgeRoot],
      ['private', privateRoot, 'personalKnowledge', roots.personalKnowledgeRoot],
      ['team', teamRoot, 'sharedKnowledge', roots.sharedKnowledgeRoot],
      ['team', teamRoot, 'personalKnowledge', roots.personalKnowledgeRoot],
    ].filter(([, a, , b]) => a && b);

    for (const [aLabel, a, bLabel, b] of overlapPairs) {
      if (isPathWithin(a, b) || isPathWithin(b, a)) {
        throw boardError(422, 'board_root_unsafe', `${aLabel} root overlaps with ${bLabel} root`, { left: a, right: b });
      }
    }
  }

  function scopeRoot(scope) {
    const roots = currentRoots();
    assertRootSafety(roots);
    if (!SCOPES.includes(scope)) throw boardError(422, 'validation_error', `unknown scope: ${scope}`);
    if (scope === 'team') {
      if (!roots.teamRoot) throw boardError(503, 'team_root_unconfigured', 'team board root is not configured');
      const exists = fs.existsSync(roots.teamRoot);
      if (!exists) throw boardError(503, 'team_root_unavailable', 'team board root is unavailable', { path: roots.teamRoot });
      return roots.teamRoot;
    }
    if (!fs.existsSync(roots.privateRoot)) fs.mkdirSync(roots.privateRoot, { recursive: true });
    return roots.privateRoot;
  }

  function scopeDirs(scope) {
    const boardRoot = scopeRoot(scope);
    const dirs = {
      boardRoot,
      projectsDir: path.join(boardRoot, 'projects'),
      tasksDir: path.join(boardRoot, 'tasks'),
      activityDir: path.join(boardRoot, 'activity'),
      auditDir: path.join(boardRoot, 'audit'),
    };
    fs.mkdirSync(dirs.projectsDir, { recursive: true });
    fs.mkdirSync(dirs.tasksDir, { recursive: true });
    fs.mkdirSync(dirs.activityDir, { recursive: true });
    fs.mkdirSync(dirs.auditDir, { recursive: true });
    return dirs;
  }

  async function detectTeamDivergence(dir, id) {
    if (teamDivergence.detected) {
      throw boardError(503, 'team_scope_read_only', 'team scope is read-only due to detected storage divergence', {
        reason: teamDivergence.reason,
        files: teamDivergence.files,
      });
    }
    const names = await fsp.readdir(dir).catch(() => []);
    const conflicts = names.filter((name) => looksLikeConflictCopy(name, id));
    if (conflicts.length) {
      teamDivergence.detected = true;
      teamDivergence.reason = 'conflict_variant_files_detected';
      teamDivergence.files = conflicts;
      throw boardError(503, 'team_scope_read_only', 'team scope is read-only due to detected storage divergence', {
        reason: teamDivergence.reason,
        files: conflicts,
      });
    }
  }

  async function detectTeamDivergenceForReads(dir) {
    if (teamDivergence.detected) {
      throw boardError(503, 'team_scope_read_only', 'team scope is read-only due to detected storage divergence', {
        reason: teamDivergence.reason,
        files: teamDivergence.files,
      });
    }
    const names = await fsp.readdir(dir).catch(() => []);
    const conflicts = names.filter((name) => {
      if (!name.endsWith('.json')) return false;
      const lower = name.toLowerCase();
      return lower.includes('conflict') || lower.includes('copy') || lower.includes('dupe') || lower.includes('variant') || lower.includes('(');
    });
    if (!conflicts.length) return;
    teamDivergence.detected = true;
    teamDivergence.reason = 'conflict_variant_files_detected';
    teamDivergence.files = conflicts;
    throw boardError(503, 'team_scope_read_only', 'team scope is read-only due to detected storage divergence', {
      reason: teamDivergence.reason,
      files: conflicts,
    });
  }

  function projectFile(scope, id) {
    return path.join(scopeDirs(scope).projectsDir, `${id}.json`);
  }

  function taskFile(scope, id) {
    return path.join(scopeDirs(scope).tasksDir, `${id}.json`);
  }

  async function readProject(scope, id) {
    if (scope === 'team') {
      await detectTeamDivergenceForReads(scopeDirs(scope).projectsDir);
    }
    try {
      return await readEntity(projectFile(scope, id));
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
      return null;
    }
  }

  async function readTask(scope, id) {
    if (scope === 'team') {
      await detectTeamDivergenceForReads(scopeDirs(scope).tasksDir);
    }
    try {
      return await readEntity(taskFile(scope, id));
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
      return null;
    }
  }

  async function appendJsonl(scope, kind, record) {
    const dirs = scopeDirs(scope);
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(kind === 'activity' ? dirs.activityDir : dirs.auditDir, `${day}.jsonl`);
    await fsp.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  }

  async function readJsonlFiltered(scope, kind, filterFn) {
    const dirs = scopeDirs(scope);
    const dir = kind === 'activity' ? dirs.activityDir : dirs.auditDir;
    const names = (await fsp.readdir(dir).catch(() => []))
      .filter((n) => n.endsWith('.jsonl'))
      .sort()
      .reverse();
    const out = [];
    for (const name of names) {
      const text = await fsp.readFile(path.join(dir, name), 'utf8').catch(() => '');
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        try {
          const row = JSON.parse(line);
          if (!filterFn || filterFn(row)) out.push(row);
        } catch {
          // ignore malformed rows
        }
      }
    }
    return out;
  }

  async function writeEntityWithGuards(scope, kind, id, entity, expectedVersion = null) {
    const file = kind === 'project' ? projectFile(scope, id) : taskFile(scope, id);
    const dir = path.dirname(file);
    if (scope === 'team') {
      await detectTeamDivergence(dir, id);
      const pre = await readEntity(file).catch(() => null);
      if (pre && Number.isInteger(expectedVersion) && pre.version !== expectedVersion) {
        throw boardError(409, 'conflict', 'Version mismatch', { expected: pre.version, got: expectedVersion });
      }
    }
    await atomicWriteJson(file, entity);
    if (scope === 'team') {
      const verify = await readEntity(file).catch(() => null);
      if (!verify || verify.version !== entity.version) {
        teamDivergence.detected = true;
        teamDivergence.reason = 'post_write_verification_failed';
        teamDivergence.files = [path.basename(file)];
        throw boardError(503, 'team_scope_read_only', 'team scope is read-only due to detected storage divergence', {
          reason: teamDivergence.reason,
        });
      }
      await detectTeamDivergence(dir, id);
    }
  }

  async function listLegacyPrivateProjects() {
    if (!fs.existsSync(legacyRoot)) return [];
    const names = await fsp.readdir(path.join(legacyRoot, 'projects')).catch(() => []);
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.replace(/\.json$/i, '');
      const existsInPrimary = await readProject('private', id);
      if (existsInPrimary) continue;
      const legacy = await readEntity(path.join(legacyRoot, 'projects', name)).catch(() => null);
      if (legacy) out.push(legacy);
    }
    return out;
  }

  async function listLegacyPrivateTasks() {
    if (!fs.existsSync(legacyRoot)) return [];
    const names = await fsp.readdir(path.join(legacyRoot, 'tasks')).catch(() => []);
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.replace(/\.json$/i, '');
      const existsInPrimary = await readTask('private', id);
      if (existsInPrimary) continue;
      const legacy = await readEntity(path.join(legacyRoot, 'tasks', name)).catch(() => null);
      if (legacy) out.push(legacy);
    }
    return out;
  }

  return {
    withLock,
    atomicWriteJson,
    resolveScopeRoot: scopeRoot,
    listProjects: async (scope) => {
      const dirs = scopeDirs(scope);
      if (scope === 'team') await detectTeamDivergenceForReads(dirs.projectsDir);
      const current = await listEntities(dirs.projectsDir);
      if (scope === 'private') {
        const legacy = await listLegacyPrivateProjects();
        return [...current, ...legacy];
      }
      return current;
    },
    listTasks: async (scope) => {
      const dirs = scopeDirs(scope);
      if (scope === 'team') await detectTeamDivergenceForReads(dirs.tasksDir);
      const current = await listEntities(dirs.tasksDir);
      if (scope === 'private') {
        const legacy = await listLegacyPrivateTasks();
        return [...current, ...legacy];
      }
      return current;
    },
    readProject: (scope, id) => readProject(scope, id),
    readTask: (scope, id) => readTask(scope, id),
    writeProject: (scope, id, entity, options = {}) => writeEntityWithGuards(scope, 'project', id, entity, options.expectedVersion ?? null),
    writeTask: (scope, id, entity, options = {}) => writeEntityWithGuards(scope, 'task', id, entity, options.expectedVersion ?? null),
    deleteProject: async (scope, id) => {
      await fsp.unlink(projectFile(scope, id)).catch(() => {});
    },
    deleteTask: async (scope, id) => {
      await fsp.unlink(taskFile(scope, id)).catch(() => {});
    },
    appendActivity: (scope, record) => appendJsonl(scope, 'activity', record),
    appendAudit: (scope, record) => appendJsonl(scope, 'audit', record),
    readActivity: (scope, filterFn) => readJsonlFiltered(scope, 'activity', filterFn),
    readAudit: (scope, filterFn) => readJsonlFiltered(scope, 'audit', filterFn),
    listProjectTasks: async (scope, projectId) => {
      const dirs = scopeDirs(scope);
      if (scope === 'team') await detectTeamDivergenceForReads(dirs.tasksDir);
      const all = await listEntities(dirs.tasksDir);
      return all.filter((t) => t.project_id === projectId);
    },
  };
}
