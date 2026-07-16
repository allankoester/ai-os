import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const APP_SETTINGS_FILE = 'interface/app-settings.json';
const MAX_PATH_LENGTH = 2048;
export const APP_SETTINGS_SCHEMA_VERSION = 2;
export const APP_USER_TYPES = Object.freeze(['single-user', 'team-user', 'collaborator']);
const APP_USER_TYPE_SET = new Set(APP_USER_TYPES);

export function defaultPrivateBoardRoot() {
  return path.join(os.homedir(), '.steadymade-ai-os', 'board-private');
}

export function getAppSettingsFile(rootDir) {
  return path.join(rootDir, APP_SETTINGS_FILE);
}

function cleanPathValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function cleanUserType(value) {
  const raw = String(value || '').trim().toLowerCase();
  return APP_USER_TYPE_SET.has(raw) ? raw : '';
}

function cleanSchemaVersion(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) return APP_SETTINGS_SCHEMA_VERSION;
  return parsed;
}

export function deriveUserTypePolicy(userType) {
  const type = cleanUserType(userType);
  return {
    userType: type,
    configured: Boolean(type),
    isSingleUser: type === 'single-user',
    isTeamUser: type === 'team-user',
    isCollaborator: type === 'collaborator',
    requiresGit: type === 'collaborator',
    sharedKnowledgeExpected: type === 'team-user' || type === 'collaborator',
    canUseTeamBoard: type === 'team-user' || type === 'collaborator',
  };
}

export function validateAppSettingsPayload(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return ['body must be an object'];
  }
  if (body.schemaVersion !== undefined && !Number.isInteger(Number(body.schemaVersion))) {
    errors.push('schemaVersion must be an integer');
  }
  if (body.userType !== undefined && body.userType !== null) {
    if (typeof body.userType !== 'string') {
      errors.push('userType must be a string');
    } else {
      const cleaned = String(body.userType).trim().toLowerCase();
      if (cleaned && !APP_USER_TYPE_SET.has(cleaned)) {
        errors.push(`userType must be one of: ${APP_USER_TYPES.join(', ')}`);
      }
    }
  }
  for (const key of ['personalKnowledgeRoot', 'sharedKnowledgeRoot', 'privateBoardRoot', 'teamBoardRoot']) {
    if (body[key] !== undefined && typeof body[key] !== 'string' && body[key] !== null) {
      errors.push(`${key} must be a string`);
      continue;
    }
    const value = cleanPathValue(body[key]);
    if (value.length > MAX_PATH_LENGTH) {
      errors.push(`${key} exceeds ${MAX_PATH_LENGTH} characters`);
    }
  }
  return errors;
}

export function sanitizeAppSettings(input) {
  return {
    schemaVersion: cleanSchemaVersion(input?.schemaVersion),
    userType: cleanUserType(input?.userType),
    personalKnowledgeRoot: cleanPathValue(input?.personalKnowledgeRoot),
    sharedKnowledgeRoot: cleanPathValue(input?.sharedKnowledgeRoot),
    privateBoardRoot: cleanPathValue(input?.privateBoardRoot),
    teamBoardRoot: cleanPathValue(input?.teamBoardRoot),
  };
}

export function normalizeConfiguredPath(rootDir, configuredValue) {
  const raw = cleanPathValue(configuredValue);
  if (!raw) return null;
  let expanded = raw;
  if (raw === '~') {
    expanded = os.homedir();
  } else if (raw.startsWith('~/')) {
    expanded = path.join(os.homedir(), raw.slice(2));
  }
  if (path.isAbsolute(expanded)) return path.normalize(expanded);
  return path.resolve(rootDir, expanded);
}

function statInfo(absPath) {
  if (!absPath) return { exists: false, isSymlink: false };
  try {
    const st = fs.lstatSync(absPath);
    return { exists: true, isSymlink: st.isSymbolicLink() };
  } catch {
    return { exists: false, isSymlink: false };
  }
}

function detectSharedSubfolders(sharedRootAbs) {
  const names = ['company', 'inbox', 'team'];
  const out = {};
  for (const name of names) {
    try {
      out[name] = fs.statSync(path.join(sharedRootAbs, name)).isDirectory();
    } catch {
      out[name] = false;
    }
  }
  return out;
}

function toRootStatus(absPath, includeSharedSubfolders = false) {
  const status = {
    path: absPath,
    ...statInfo(absPath),
  };
  if (includeSharedSubfolders) {
    status.detectedSubfolders = detectSharedSubfolders(absPath);
  }
  return status;
}

export async function readAppSettings(rootDir) {
  const file = getAppSettingsFile(rootDir);
  try {
    try { await fsp.chmod(file, 0o600); } catch {}
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    return sanitizeAppSettings(parsed);
  } catch {
    return sanitizeAppSettings({});
  }
}

export async function writeAppSettings(rootDir, input, options = {}) {
  const file = getAppSettingsFile(rootDir);
  const merge = options.merge !== false;
  const previous = merge ? await readAppSettings(rootDir) : sanitizeAppSettings({});
  const settings = sanitizeAppSettings(merge ? { ...previous, ...(input || {}) } : input);

  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
  const fh = await fsp.open(tmp, 'w', 0o600);
  try {
    await fh.writeFile(JSON.stringify(settings, null, 2), 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, file);
  try {
    const dirHandle = await fsp.open(dir, 'r');
    try { await dirHandle.sync(); } finally { await dirHandle.close(); }
  } catch {}
  try { await fsp.chmod(file, 0o600); } catch {}
  return settings;
}

export function buildAppSettingsStatus({ rootDir, settings, activeRuntimeRoots }) {
  const sanitizedSettings = sanitizeAppSettings(settings);
  const fallbackSharedRoot = path.join(rootDir, 'knowledge');
  const fallbackPersonalRoot = path.join(rootDir, 'knowledge', 'personal');
  const fallbackPrivateBoardRoot = defaultPrivateBoardRoot();

  const savedSharedRoot = normalizeConfiguredPath(rootDir, sanitizedSettings.sharedKnowledgeRoot) || fallbackSharedRoot;
  const savedPersonalRoot = normalizeConfiguredPath(rootDir, sanitizedSettings.personalKnowledgeRoot) || fallbackPersonalRoot;
  const savedPrivateBoardRoot = normalizeConfiguredPath(rootDir, sanitizedSettings.privateBoardRoot) || fallbackPrivateBoardRoot;
  const savedTeamBoardRoot = normalizeConfiguredPath(rootDir, sanitizedSettings.teamBoardRoot);

  const activeSharedRoot = activeRuntimeRoots?.sharedKnowledgeRoot || fallbackSharedRoot;
  const activePersonalRoot = activeRuntimeRoots?.personalKnowledgeRoot || fallbackPersonalRoot;
  const activePrivateBoardRoot = activeRuntimeRoots?.privateBoardRoot || fallbackPrivateBoardRoot;
  const activeTeamBoardRoot = activeRuntimeRoots?.teamBoardRoot || null;

  const boardSafetyErrors = [];
  const overlaps = [
    ['private board', savedPrivateBoardRoot, 'team board', savedTeamBoardRoot],
    ['private board', savedPrivateBoardRoot, 'shared knowledge', savedSharedRoot],
    ['private board', savedPrivateBoardRoot, 'personal knowledge', savedPersonalRoot],
    ['team board', savedTeamBoardRoot, 'shared knowledge', savedSharedRoot],
    ['team board', savedTeamBoardRoot, 'personal knowledge', savedPersonalRoot],
  ].filter(([, a, , b]) => a && b);
  for (const [aLabel, a, bLabel, b] of overlaps) {
    const relAB = path.relative(a, b);
    const relBA = path.relative(b, a);
    const aContainsB = relAB === '' || (!relAB.startsWith('..') && !path.isAbsolute(relAB));
    const bContainsA = relBA === '' || (!relBA.startsWith('..') && !path.isAbsolute(relBA));
    if (aContainsB || bContainsA) boardSafetyErrors.push(`${aLabel} root overlaps ${bLabel} root`);
  }

  return {
    path: APP_SETTINGS_FILE,
    settings: sanitizedSettings,
    savedEffectiveRoots: {
      shared: toRootStatus(savedSharedRoot, true),
      personal: toRootStatus(savedPersonalRoot, false),
      board: {
        private: toRootStatus(savedPrivateBoardRoot, false),
        team: toRootStatus(savedTeamBoardRoot, false),
      },
    },
    activeRuntimeRoots: {
      shared: toRootStatus(activeSharedRoot, true),
      personal: toRootStatus(activePersonalRoot, false),
      board: {
        private: toRootStatus(activePrivateBoardRoot, false),
        team: toRootStatus(activeTeamBoardRoot, false),
      },
    },
    boardSafetyErrors,
    restartRequired:
      savedSharedRoot !== activeSharedRoot
      || savedPersonalRoot !== activePersonalRoot
      || savedPrivateBoardRoot !== activePrivateBoardRoot
      || savedTeamBoardRoot !== activeTeamBoardRoot,
  };
}

export function validateBoardRootConfig({ rootDir, settings }) {
  const shared = normalizeConfiguredPath(rootDir, settings.sharedKnowledgeRoot) || path.join(rootDir, 'knowledge');
  const personal = normalizeConfiguredPath(rootDir, settings.personalKnowledgeRoot) || path.join(rootDir, 'knowledge', 'personal');
  const privateBoard = normalizeConfiguredPath(rootDir, settings.privateBoardRoot) || defaultPrivateBoardRoot();
  const teamBoard = normalizeConfiguredPath(rootDir, settings.teamBoardRoot) || null;
  const errors = [];
  const pairs = [
    ['privateBoardRoot', privateBoard, 'teamBoardRoot', teamBoard],
    ['privateBoardRoot', privateBoard, 'sharedKnowledgeRoot', shared],
    ['privateBoardRoot', privateBoard, 'personalKnowledgeRoot', personal],
    ['teamBoardRoot', teamBoard, 'sharedKnowledgeRoot', shared],
    ['teamBoardRoot', teamBoard, 'personalKnowledgeRoot', personal],
  ].filter(([, a, , b]) => a && b);
  for (const [aLabel, a, bLabel, b] of pairs) {
    const relAB = path.relative(a, b);
    const relBA = path.relative(b, a);
    const aContainsB = relAB === '' || (!relAB.startsWith('..') && !path.isAbsolute(relAB));
    const bContainsA = relBA === '' || (!relBA.startsWith('..') && !path.isAbsolute(relBA));
    if (aContainsB || bContainsA) errors.push(`${aLabel} overlaps with ${bLabel}`);
  }
  for (const [label, abs] of [['privateBoardRoot', privateBoard], ['teamBoardRoot', teamBoard]]) {
    if (!abs) continue;
    const st = fs.lstatSync(abs, { throwIfNoEntry: false });
    if (!st) {
      errors.push(`${label} is unavailable`);
      continue;
    }
    if (!st.isDirectory()) errors.push(`${label} must be a directory`);
    if (st.isSymbolicLink()) errors.push(`${label} must not be a symlink`);
  }
  return errors;
}
