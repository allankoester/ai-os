import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const APP_SETTINGS_FILE = 'interface/app-settings.json';
const MAX_PATH_LENGTH = 2048;

export function getAppSettingsFile(rootDir) {
  return path.join(rootDir, APP_SETTINGS_FILE);
}

function cleanPathValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

export function validateAppSettingsPayload(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return ['body must be an object'];
  }
  for (const key of ['personalKnowledgeRoot', 'sharedKnowledgeRoot']) {
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
    personalKnowledgeRoot: cleanPathValue(input?.personalKnowledgeRoot),
    sharedKnowledgeRoot: cleanPathValue(input?.sharedKnowledgeRoot),
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

export async function writeAppSettings(rootDir, input) {
  const file = getAppSettingsFile(rootDir);
  const settings = sanitizeAppSettings(input);
  await fsp.writeFile(file, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { await fsp.chmod(file, 0o600); } catch {}
  return settings;
}

export function buildAppSettingsStatus({ rootDir, settings, activeRuntimeRoots }) {
  const fallbackSharedRoot = path.join(rootDir, 'knowledge');
  const fallbackPersonalRoot = path.join(rootDir, 'knowledge', 'personal');

  const savedSharedRoot = normalizeConfiguredPath(rootDir, settings.sharedKnowledgeRoot) || fallbackSharedRoot;
  const savedPersonalRoot = normalizeConfiguredPath(rootDir, settings.personalKnowledgeRoot) || fallbackPersonalRoot;

  const activeSharedRoot = activeRuntimeRoots?.sharedKnowledgeRoot || fallbackSharedRoot;
  const activePersonalRoot = activeRuntimeRoots?.personalKnowledgeRoot || fallbackPersonalRoot;

  return {
    path: APP_SETTINGS_FILE,
    settings: sanitizeAppSettings(settings),
    savedEffectiveRoots: {
      shared: toRootStatus(savedSharedRoot, true),
      personal: toRootStatus(savedPersonalRoot, false),
    },
    activeRuntimeRoots: {
      shared: toRootStatus(activeSharedRoot, true),
      personal: toRootStatus(activePersonalRoot, false),
    },
    restartRequired: savedSharedRoot !== activeSharedRoot || savedPersonalRoot !== activePersonalRoot,
  };
}
