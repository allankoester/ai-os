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
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import {
  buildAppSettingsStatus,
  deriveUserTypePolicy,
  defaultPrivateBoardRoot,
  normalizeConfiguredPath,
  readAppSettings,
  validateAppSettingsPayload,
  validateBoardRootConfig,
  writeAppSettings,
} from './app-settings.mjs';
import {
  isPersonalKnowledgePath,
  isSharedKnowledgePath,
  resolvePersonalKnowledgePath,
} from './knowledge-paths.mjs';
import { createSkillHub } from './skills.mjs';
import { createPluginManager } from './plugins.mjs';
import { createGuardrails } from './guardrails.mjs';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { createBoardStorage } from './board/storage.mjs';
import { createBoardService } from './board/service.mjs';
import { asBoardEnvelopeError } from './board/errors.mjs';
import {
  createStorageKernelDiagnostics,
  ensureRuntimeFilePath,
  resolveRuntimeRoot,
} from './storage/runtime/storage-kernel.mjs';
import {
  getUsageProjectionHealth,
  rebuildUsageProjectionShadow,
} from './storage/runtime/usage-projection.mjs';
import {
  buildProviderRuntimeDiagnostics,
  importOpenCodeConfigIntoManagedRuntime,
  inspectOpenCodeConfigImport,
  prepareOpenCodeEnvironment,
  resolveManagedCliTargets,
  resolveProviderRuntimeMode,
} from '../runtime/managed-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..'); // project root: steadymade-ai-os
const PUBLIC = path.join(__dirname, 'public');
const META_FILE = path.join(__dirname, 'meta.json'); // sidecar metadata (status, scope) — keeps real docs untouched
const FLOWS_FILE = path.join(__dirname, 'workflows.json'); // user workflow edits: overrides / custom / deleted (machine-local)
const PROVIDER_SETTINGS_FILE = path.join(__dirname, 'provider-settings.json');
const RUNTIME_ROOT_HINT = resolveRuntimeRoot({
  testRootOverride: process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT || null,
});
const USAGE_LOG = path.join(RUNTIME_ROOT_HINT, 'streams', 'usage', 'usage.jsonl');
const LEGACY_CHAT_USAGE_LOG = path.join(ROOT, 'runs', 'chat-usage.jsonl');
const PORT = process.env.PORT || 4011;
const HOST = process.env.HOST || '127.0.0.1';
const API_TOKEN = process.env.STEADYMADE_INTERFACE_TOKEN || '';
const BOARD_INTERNAL_TOKEN = process.env.BOARD_INTERNAL_TOKEN || '';

const pluginManager = createPluginManager({ rootDir: ROOT });
try {
  await pluginManager.syncProjections();
} catch (err) {
  console.warn(`[plugins] failed to materialize provider projections at startup: ${err?.message || err}`);
}
const skillHub = createSkillHub({
  rootDir: ROOT,
  listEnabledPlugins: () => pluginManager.list().filter((p) => p.enabled).map((p) => p.id),
});
const guardrails = createGuardrails({ rootDir: ROOT });

const appSettingsRaw = await readAppSettings(ROOT);
const envSharedKnowledgeRoot = normalizeConfiguredPath(ROOT, process.env.STEADYMADE_KNOWLEDGE_FS_ROOT);
const activeSharedKnowledgeRoot = envSharedKnowledgeRoot
  || normalizeConfiguredPath(ROOT, appSettingsRaw.sharedKnowledgeRoot)
  || path.join(ROOT, 'knowledge');
const activePersonalKnowledgeRoot = normalizeConfiguredPath(ROOT, appSettingsRaw.personalKnowledgeRoot)
  || path.join(ROOT, 'knowledge', 'personal');
const activePrivateBoardRoot = normalizeConfiguredPath(ROOT, appSettingsRaw.privateBoardRoot)
  || defaultPrivateBoardRoot();
const configuredTeamBoardRoot = normalizeConfiguredPath(ROOT, appSettingsRaw.teamBoardRoot) || null;
const startupUserPolicy = deriveUserTypePolicy(appSettingsRaw.userType);
const startupRequestedDeployment = startupUserPolicy.canUseTeamBoard ? 'team-server' : 'local-only';
const activeTeamBoardRoot = startupRequestedDeployment === 'team-server' ? configuredTeamBoardRoot : null;
try { fs.mkdirSync(activePrivateBoardRoot, { recursive: true }); } catch {}

const boardStorage = createBoardStorage({
  rootDir: ROOT,
  resolveRoots: () => ({
    privateRoot: activePrivateBoardRoot,
    teamRoot: activeTeamBoardRoot,
    sharedKnowledgeRoot: activeSharedKnowledgeRoot,
    personalKnowledgeRoot: activePersonalKnowledgeRoot,
  }),
});

const storageKernelDiagnostics = createStorageKernelDiagnostics({
  workspaceRoot: ROOT,
  component: 'interface',
});

function teamCapabilityReasonFromError(err) {
  if (err?.code === 'team_root_unconfigured') return 'TEAM_ROOT_UNCONFIGURED';
  if (err?.code === 'team_root_unavailable' || err?.code === 'board_root_unavailable') return 'TEAM_ROOT_UNAVAILABLE';
  if (err?.code === 'team_scope_read_only') return 'TEAM_SCOPE_READ_ONLY';
  if (err?.code === 'board_root_unsafe') return 'TEAM_ROOT_UNSAFE';
  return 'TEAM_CHECK_FAILED';
}

function getRuntimeDeploymentState() {
  const requestedDeployment = startupRequestedDeployment;
  if (requestedDeployment === 'local-only') {
    return {
      requestedDeployment,
      effectiveDeployment: 'local-only',
      teamCapability: { status: 'disabled', reason: 'USER_TYPE_LOCAL_ONLY' },
    };
  }

  if (!activeTeamBoardRoot) {
    return {
      requestedDeployment,
      effectiveDeployment: 'local-only',
      teamCapability: { status: 'disabled', reason: 'TEAM_ROOT_UNCONFIGURED' },
    };
  }

  try {
    boardStorage.resolveScopeRoot('team');
    return {
      requestedDeployment,
      effectiveDeployment: 'team-server',
      teamCapability: { status: 'enabled', reason: null },
    };
  } catch (err) {
    return {
      requestedDeployment,
      effectiveDeployment: 'local-only',
      teamCapability: { status: 'disabled', reason: teamCapabilityReasonFromError(err) },
    };
  }
}

function buildSharedCapabilityState({ userPolicy, appSettings, deploymentState }) {
  const canUseTeamBoard = Boolean(userPolicy?.canUseTeamBoard);
  const configuredTeamRoot = String(appSettings?.settings?.teamBoardRoot || '').trim();
  const activeTeamExists = Boolean(appSettings?.activeRuntimeRoots?.board?.team?.exists);
  const capabilityReason = deploymentState?.teamCapability?.reason || null;

  if (!canUseTeamBoard) {
    return { status: 'disabled', enabled: false, reason: capabilityReason || 'USER_TYPE_LOCAL_ONLY' };
  }
  if (!configuredTeamRoot) {
    return { status: 'not_configured', enabled: false, reason: capabilityReason || 'TEAM_ROOT_UNCONFIGURED' };
  }
  if (deploymentState?.effectiveDeployment === 'team-server' && deploymentState?.teamCapability?.status === 'enabled') {
    return { status: 'ready', enabled: true, reason: null };
  }
  if (!activeTeamExists || appSettings?.restartRequired) {
    return { status: 'degraded', enabled: false, reason: capabilityReason || 'TEAM_ROOT_UNAVAILABLE' };
  }
  return { status: 'degraded', enabled: false, reason: capabilityReason || 'TEAM_CAPABILITY_UNAVAILABLE' };
}

const knowledgeConfig = createKnowledgeConfig({ rootDir: ROOT, fsRootOverride: activeSharedKnowledgeRoot });
const knowledgeStorage = knowledgeConfig.backend === 'graph'
  ? createGraphKnowledgeStorage({ config: knowledgeConfig.graph })
  : createFsKnowledgeStorage({ root: knowledgeConfig.fsRoot });

let boardService;
function createFailClosedScheduler(err) {
  const issues = Array.isArray(err?.issues) ? err.issues.map((issue) => String(issue)) : [];
  const failureCode = String(err?.code || 'scheduler_unavailable');
  const unavailableError = { errors: ['scheduler unavailable'], code: failureCode };
  return {
    listJobs: () => [],
    listRuns: () => [],
    getRunLog: async () => null,
    createJob: async () => unavailableError,
    updateJob: async () => unavailableError,
    deleteJob: async () => unavailableError,
    runNow: async () => unavailableError,
    cancelRun: async () => unavailableError,
    deleteRun: async () => unavailableError,
    getDiagnostics: () => ({
      available: false,
      reason: failureCode,
      issues,
    }),
  };
}

let scheduler;
try {
  scheduler = createScheduler({
    rootDir: ROOT,
    resolveRuntimeContext: async () => readProviderSettingsRaw(),
    onRunEvent: async (event) => {
      if (boardService) await boardService.applySchedulerEvent(event);
    },
  });
} catch (err) {
  if (err?.code !== 'unsafe_runtime_root') throw err;
  scheduler = createFailClosedScheduler(err);
}
boardService = createBoardService({
  rootDir: ROOT,
  guardrails,
  scheduler,
  storage: boardStorage,
  resolveDeploymentState: () => getRuntimeDeploymentState(),
  getRuntimeSettingsRaw: () => readProviderSettingsRaw(),
  listCanonicalAgentIds: async () => readCanonicalAgentIds(),
  listCanonicalWorkflowIds: async () => readCanonicalWorkflowIds(),
});

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
const MCP_TEST_TIMEOUT_MS = 9000;
const FOLDER_BROWSER_MAX_PATH_LENGTH = 2048;
const MCP_TEST_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'USER',
  'LOGNAME',
  'TERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
];
const DEFAULT_PROVIDER_SETTINGS = Object.freeze({
  runtimeMode: 'claude-subscription',
  claudeBin: '',
  opencodeBin: '',
  opencodeConfigPath: '',
  opencodeConfigImportSourcePath: '',
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
  return isSharedKnowledgePath(relPath);
}

function normalizeProjectRelPath(relPath) {
  return path.posix.normalize('/' + String(relPath || '').replace(/\\/g, '/')).slice(1);
}

function isAllowedArtifactPath(relPath) {
  const normalized = normalizeProjectRelPath(relPath);
  if (normalized.startsWith('artifacts/project-board/')) return false;
  if (normalized.startsWith('artifacts/')) return true;
  return normalized.startsWith('knowledge/company/') && normalized.includes('/_artifacts/');
}

function hasJsonContentType(req) {
  return String(req.headers['content-type'] || '').toLowerCase().includes('application/json');
}

function safeTokenEquals(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
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

function isLoopbackHost(hostValue) {
  const host = String(hostValue || '').trim().toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

function isLoopbackRemoteAddress(addressValue) {
  const address = String(addressValue || '').trim().toLowerCase();
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function endpointExpectsJsonBody(req, url) {
  if (req.method === 'PUT') return true;
  if (req.method === 'POST') {
    if (url.pathname === '/api/restart') return false;
    if (/^\/api\/scheduler\/jobs\/[0-9a-f-]+\/run$/i.test(url.pathname)) return false;
    return true;
  }
  if (req.method === 'DELETE') {
    if (/^\/api\/(projects|tasks|activities)\/[^/]+$/i.test(url.pathname)) return true;
    return false;
  }
  return false;
}

function validateAbsoluteDirectoryPathInput(rawPath) {
  if (typeof rawPath !== 'string') {
    return { ok: false, code: 'invalid_path', message: 'path must be a string' };
  }
  if (!rawPath.length) {
    return { ok: false, code: 'invalid_path', message: 'path is required' };
  }
  if (rawPath.length > FOLDER_BROWSER_MAX_PATH_LENGTH) {
    return {
      ok: false,
      code: 'invalid_path',
      message: `path exceeds ${FOLDER_BROWSER_MAX_PATH_LENGTH} characters`,
    };
  }
  if (rawPath.includes('\0')) {
    return { ok: false, code: 'invalid_path', message: 'path must not contain null bytes' };
  }
  if (!path.isAbsolute(rawPath)) {
    return { ok: false, code: 'invalid_path', message: 'path must be absolute' };
  }
  return { ok: true, path: path.normalize(rawPath) };
}

async function listFolderBrowserDirectories(targetAbsPath) {
  const names = await fsp.readdir(targetAbsPath);
  const directories = [];
  for (const name of names) {
    const childAbs = path.join(targetAbsPath, name);
    const lst = await fsp.lstat(childAbs).catch(() => null);
    if (!lst) continue;

    if (lst.isDirectory()) {
      directories.push({ name, path: childAbs, isSymlink: false, traversable: true });
      continue;
    }

    if (!lst.isSymbolicLink()) continue;
    const st = await fsp.stat(childAbs).catch(() => null);
    if (!st || !st.isDirectory()) continue;
    directories.push({ name, path: childAbs, isSymlink: true, traversable: false });
  }

  directories.sort((a, b) => a.name.localeCompare(b.name));
  return directories;
}

async function detectOneDriveAiOsRoot() {
  const home = os.homedir();
  const candidates = [path.join(home, 'OneDrive', 'AI_OS')];
  const cloudStorage = path.join(home, 'Library', 'CloudStorage');
  const cloudEntries = await fsp.readdir(cloudStorage, { withFileTypes: true }).catch(() => []);
  for (const entry of cloudEntries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith('OneDrive')) continue;
    candidates.push(path.join(cloudStorage, entry.name, 'AI_OS'));
  }
  for (const candidate of candidates) {
    const st = await fsp.lstat(candidate).catch(() => null);
    if (st?.isDirectory()) return candidate;
  }
  return null;
}

async function listFolderBrowserRoots() {
  const roots = [];
  const seen = new Set();
  const add = async (id, label, candidatePath) => {
    if (!candidatePath || seen.has(candidatePath)) return;
    const st = await fsp.lstat(candidatePath).catch(() => null);
    if (!st || !st.isDirectory()) return;
    seen.add(candidatePath);
    roots.push({ id, label, path: candidatePath });
  };

  await add('workspace', 'Workspace root', ROOT);

  const oneDriveAiOs = await detectOneDriveAiOsRoot();
  if (oneDriveAiOs) await add('onedrive-ai-os', 'OneDrive AI_OS', oneDriveAiOs);

  const configured = await readAppSettings(ROOT);
  await add('configured-shared', 'Configured shared knowledge root', normalizeConfiguredPath(ROOT, configured.sharedKnowledgeRoot));
  await add('configured-personal', 'Configured personal knowledge root', normalizeConfiguredPath(ROOT, configured.personalKnowledgeRoot));
  await add('configured-board-private', 'Configured private board root', normalizeConfiguredPath(ROOT, configured.privateBoardRoot));
  await add('configured-board-team', 'Configured team board root', normalizeConfiguredPath(ROOT, configured.teamBoardRoot));

  return roots;
}

async function resolveCanonicalDirectory(absPath) {
  const lst = await fsp.lstat(absPath).catch(() => null);
  if (!lst) return { ok: false, status: 404, code: 'path_not_found', message: 'target path does not exist' };
  if (lst.isSymbolicLink()) return { ok: false, status: 422, code: 'symlink_not_allowed', message: 'target path must not be a symlink' };
  if (!lst.isDirectory()) return { ok: false, status: 422, code: 'not_directory', message: 'target path must be a directory' };
  const real = await fsp.realpath(absPath).catch(() => null);
  if (!real) return { ok: false, status: 422, code: 'path_unresolvable', message: 'target path could not be resolved' };
  return { ok: true, path: real };
}

function isPathWithin(parentAbs, targetAbs) {
  const rel = path.relative(parentAbs, targetAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function isAllowedArtifactRealPath(realAbs) {
  const artifactsRootReal = await fsp.realpath(path.join(ROOT, 'artifacts')).catch(() => null);
  const boardArtifactsRootReal = await fsp.realpath(path.join(ROOT, 'artifacts', 'project-board')).catch(() => null);
  const companyRootReal = await fsp.realpath(path.join(ROOT, 'knowledge', 'company')).catch(() => null);
  if (boardArtifactsRootReal && isPathWithin(boardArtifactsRootReal, realAbs)) return false;
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
    claudeBin: rawSettings.claudeBin,
    opencodeBin: rawSettings.opencodeBin,
    opencodeConfigPath: rawSettings.opencodeConfigPath,
    opencodeConfigImportSourcePath: rawSettings.opencodeConfigImportSourcePath,
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
  const claudeBin = String(body?.claudeBin || '').trim();
  const opencodeBin = String(body?.opencodeBin || '').trim();
  const opencodeConfigPath = String(body?.opencodeConfigPath || '').trim();
  const opencodeConfigImportSourcePath = String(body?.opencodeConfigImportSourcePath || '').trim();
  const cliBridgeEnabled = body?.cliBridgeEnabled;
  const envVaultRaw = body?.envVault;
  const envVault = Array.isArray(envVaultRaw)
    ? resolveEnvVaultMap(envVaultRaw, {})
    : sanitizeEnvVaultMap(envVaultRaw);
  return {
    runtimeMode: resolveProviderRuntimeMode(runtimeMode),
    claudeBin: claudeBin.slice(0, 1024),
    opencodeBin: opencodeBin.slice(0, 1024),
    opencodeConfigPath: opencodeConfigPath.slice(0, 1024),
    opencodeConfigImportSourcePath: opencodeConfigImportSourcePath.slice(0, 1024),
    cliBridgeEnabled: typeof cliBridgeEnabled === 'boolean' ? cliBridgeEnabled : DEFAULT_PROVIDER_SETTINGS.cliBridgeEnabled,
    envVault,
  };
}

function providerLocalDiagnostics(rawSettings) {
  const diagnostics = buildProviderRuntimeDiagnostics({
    workspaceRoot: ROOT,
    providerSettings: rawSettings,
    env: process.env,
    testRootOverride: process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT || null,
  });
  return {
    runtimeMode: diagnostics.runtimeMode,
    ready: diagnostics.ready,
    checks: diagnostics.checks,
    blockingFailures: diagnostics.blockingFailures,
    opencodeConfigImport: diagnostics.runtimeMode === 'opencode'
      ? inspectOpenCodeConfigImport({
        workspaceRoot: ROOT,
        providerSettings: rawSettings,
        testRootOverride: process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT || null,
      })
      : null,
  };
}

function classifyDeepProviderError(text) {
  const lower = String(text || '').toLowerCase();
  if (!lower) return 'runtime_error';
  if (lower.includes('permission denied') || lower.includes('access denied') || lower.includes('eacces')) return 'access_denied';
  if (lower.includes('unauthorized') || lower.includes('not logged in') || lower.includes('authentication') || lower.includes('api key') || lower.includes('login')) {
    return 'auth_failed';
  }
  return 'runtime_error';
}

async function runProviderDeepTest(rawSettings) {
  const diagnostics = providerLocalDiagnostics(rawSettings);
  const mode = diagnostics.runtimeMode;
  const started = Date.now();
  if (!diagnostics.ready) {
    const first = diagnostics.blockingFailures[0];
    return {
      ok: false,
      runtimeMode: mode,
      category: first?.category || 'runtime_error',
      detail: first?.message || 'Local provider checks failed.',
      durationMs: Date.now() - started,
    };
  }

  const timeoutMs = 7000;
  const targets = resolveManagedCliTargets({
    workspaceRoot: ROOT,
    providerSettings: rawSettings,
    env: process.env,
    testRootOverride: process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT || null,
  });
  const command = mode === 'opencode' ? targets.opencode.resolvedPath : targets.claude.resolvedPath;
  if (!command) {
    const missingReason = mode === 'opencode' ? targets.opencode.reason : targets.claude.reason;
    return {
      ok: false,
      runtimeMode: mode,
      category: 'setup_required',
      detail: missingReason || `${mode} setup required`,
      durationMs: Date.now() - started,
    };
  }
  const args = mode === 'opencode'
    ? ['run', 'Return exactly OK.', '--format', 'json']
    : ['-p', 'Return exactly OK.', '--output-format', 'stream-json', '--permission-mode', 'default'];
  const secrets = Object.values(rawSettings.envVault || {}).filter((v) => typeof v === 'string' && v);
  const spawnEnv = mode === 'opencode'
    ? prepareOpenCodeEnvironment({
      env: { ...process.env, ...(rawSettings.envVault || {}) },
      workspaceRoot: ROOT,
      providerSettings: rawSettings,
      testRootOverride: process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT || null,
    })
    : { ...process.env, ...(rawSettings.envVault || {}) };

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: spawnEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 500).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += String(chunk || ''); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
    child.on('error', (err) => {
      clearTimeout(timeout);
      const detail = maskSecretsInText(String(err?.message || err), secrets);
      resolve({ ok: false, runtimeMode: mode, category: classifyDeepProviderError(detail), detail: truncateOutput(detail, 240), durationMs: Date.now() - started });
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        return resolve({ ok: false, runtimeMode: mode, category: 'timeout', detail: 'Provider deep test timed out.', durationMs: Date.now() - started });
      }
      const combined = maskSecretsInText(`${stdout}\n${stderr}`.trim(), secrets);
      if (code !== 0) {
        return resolve({ ok: false, runtimeMode: mode, category: classifyDeepProviderError(combined), detail: truncateOutput(combined || `provider command exited with code ${code}`, 240), durationMs: Date.now() - started });
      }
      const hasResult = mode === 'opencode'
        ? /"type"\s*:\s*"step_finish"/i.test(combined)
        : /"type"\s*:\s*"result"/i.test(combined);
      return resolve({
        ok: hasResult,
        runtimeMode: mode,
        category: hasResult ? 'success' : 'runtime_error',
        detail: hasResult ? 'Provider request completed.' : 'Provider completed without expected result event.',
        durationMs: Date.now() - started,
      });
    });
  });
}

function parseEnvVaultMarkerKeys(raw) {
  return String(raw || '')
    .split(',')
    .map((k) => k.trim())
    .filter((k) => PROVIDER_ENV_KEY_RE.test(k));
}

function truncateOutput(text, max = 3000) {
  const value = String(text || '');
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`;
}

function maskSecretsInText(text, secrets) {
  let out = String(text || '');
  for (const secret of secrets) {
    const value = String(secret || '');
    if (!value) continue;
    out = out.split(value).join('****');
  }
  return out;
}

function readOptionalDeleteBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

async function testMcpPlugin(plugin) {
  const cfg = { ...(plugin?.config || {}) };
  const envAdd = cfg.env && typeof cfg.env === 'object' && !Array.isArray(cfg.env) ? cfg.env : {};
  const envKeys = Array.isArray(cfg.envKeys)
    ? cfg.envKeys.map((k) => String(k || '').trim()).filter((k) => PROVIDER_ENV_KEY_RE.test(k))
    : [];

  const testEnv = {};
  for (const key of MCP_TEST_ENV_ALLOWLIST) {
    const val = process.env[key];
    if (typeof val === 'string' && val.length) testEnv[key] = val;
  }
  for (const key of envKeys) {
    const val = process.env[key];
    if (typeof val === 'string') testEnv[key] = val;
  }
  for (const [key, value] of Object.entries(envAdd)) {
    if (!PROVIDER_ENV_KEY_RE.test(key)) continue;
    if (typeof value === 'string') testEnv[key] = value;
  }

  const secretValues = new Set();
  for (const value of Object.values(envAdd)) {
    if (typeof value === 'string' && value) secretValues.add(value);
  }
  for (const key of envKeys) {
    const val = testEnv[key];
    if (typeof val === 'string' && val) secretValues.add(val);
  }

  const resolveTemplate = (value) => String(value || '')
    .replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, key) => (typeof testEnv[key] === 'string' ? testEnv[key] : ''))
    .replace(/\{env:([A-Z_][A-Z0-9_]*)\}/g, (_, key) => (typeof testEnv[key] === 'string' ? testEnv[key] : ''));

  const isRemote = String(cfg.type || '').trim() === 'streamable-http' || (!cfg.command && cfg.url);
  if (isRemote) {
    const url = String(cfg.url || '').trim();
    if (!url) return { errors: ['mcp streamable-http plugin url is empty'] };
    const headers = {};
    const rawHeaders = cfg.headers && typeof cfg.headers === 'object' && !Array.isArray(cfg.headers)
      ? cfg.headers
      : {};
    for (const [name, rawValue] of Object.entries(rawHeaders)) {
      const key = String(name || '').trim();
      if (!key) continue;
      const value = resolveTemplate(rawValue);
      if (!value) continue;
      headers[key] = value;
      secretValues.add(value);
    }
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MCP_TEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'mcp-plugin-test', version: '1.0.0' },
          },
        }),
        signal: controller.signal,
      });
      const bodyText = await response.text();
      const responseHeaders = {};
      for (const [name, value] of response.headers.entries()) {
        const lower = name.toLowerCase();
        if (lower === 'content-type' || lower === 'mcp-session-id' || lower === 'www-authenticate') {
          responseHeaders[name] = value;
        }
      }
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        timedOut: false,
        headers: responseHeaders,
        bodyPreview: truncateOutput(maskSecretsInText(bodyText, secretValues), 1200),
        durationMs: Date.now() - started,
      };
    } catch (err) {
      const timedOut = err?.name === 'AbortError';
      return {
        ok: false,
        status: null,
        statusText: timedOut ? 'Timeout' : 'Error',
        timedOut,
        headers: {},
        bodyPreview: truncateOutput(maskSecretsInText(String(err?.message || err), secretValues), 1200),
        durationMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  const command = String(cfg.command || '').trim();
  if (!command) return { errors: ['mcp plugin command is empty'] };
  const args = Array.isArray(cfg.args)
    ? cfg.args.map((a) => String(a))
    : String(cfg.args || '').split(/\s+/).filter(Boolean);

  return await new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd: ROOT,
      env: testEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 500).unref();
    }, MCP_TEST_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => { stdout += String(chunk || ''); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        exitCode: null,
        timedOut,
        stdout: '',
        stderr: truncateOutput(maskSecretsInText(err.message || String(err), secretValues)),
        durationMs: Date.now() - started,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: Number.isInteger(code) ? code : null,
        timedOut,
        stdout: truncateOutput(maskSecretsInText(stdout, secretValues)),
        stderr: truncateOutput(maskSecretsInText(stderr, secretValues)),
        durationMs: Date.now() - started,
      });
    });
  });
}

// Extract a { id, name, config } MCP descriptor from raw Claude CLI output.
// Handles the `--output-format json` envelope ({ result: "...text..." }) and
// tolerates surrounding prose / code fences around the JSON object.
function extractGeneratedMcp(stdout) {
  let text = String(stdout || '');
  try {
    const env = JSON.parse(text);
    if (env && typeof env === 'object' && typeof env.result === 'string') text = env.result;
  } catch { /* stdout was not a JSON envelope — use as-is */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj;
  try { obj = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!obj || typeof obj !== 'object' || !obj.config || typeof obj.config !== 'object' || Array.isArray(obj.config)) return null;
  const rawId = String(obj.id || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return {
    id: /^[a-z0-9][a-z0-9-]{1,40}$/.test(rawId) ? rawId : '',
    name: String(obj.name || '').trim().slice(0, 80),
    config: obj.config,
  };
}

// Draft an MCP server config from a natural-language description or pasted docs
// by running the local Claude CLI one-shot. Returns { ok, id, name, config } or
// { errors }. Never returns real secrets — the prompt requires ${ENV} placeholders.
async function generateMcpConfigFromText(description) {
  const text = String(description || '').trim();
  if (!text) return { errors: ['description is empty'] };
  if (text.length > 8000) return { errors: ['description too long (max 8000 chars)'] };

  const raw = await readProviderSettingsRaw();
  const targets = resolveManagedCliTargets({
    workspaceRoot: ROOT,
    providerSettings: raw,
    env: process.env,
    testRootOverride: process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT || null,
  });
  const command = targets.claude.resolvedPath;
  if (!command) return { errors: ['Claude CLI setup required: ' + (targets.claude.reason || 'configured path is not executable')] };

  const prompt = [
    'You configure a single MCP server entry for a Claude Code .mcp.json file.',
    'From the server documentation or description below, produce ONE JSON object and nothing else.',
    'Shape: {"id": "kebab-case-id", "name": "Human Name", "config": { ... }}.',
    'For a local/stdio server: config = {"command": string, "args": [strings], "env": {"KEY": "${KEY}"}}.',
    'For a remote HTTP server: config = {"type": "streamable-http", "url": string, "headers": {"Authorization": "Bearer ${TOKEN}"}}.',
    'Never invent real secret values — always use ${ENV_NAME} placeholders for tokens, keys and passwords.',
    'Output only the JSON object: no markdown code fences, no commentary, no explanation.',
    '',
    'DESCRIPTION / DOCS:',
    text,
  ].join('\n');

  const args = ['-p', prompt, '--output-format', 'json', '--permission-mode', 'default'];
  const secrets = Object.values(raw.envVault || {}).filter((v) => typeof v === 'string' && v);
  const spawnEnv = { ...process.env, ...(raw.envVault || {}) };

  return await new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd: ROOT, env: spawnEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 500).unref();
    }, 45000);

    child.stdout.on('data', (chunk) => { stdout += String(chunk || ''); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ errors: ['generation failed: ' + truncateOutput(maskSecretsInText(err.message || String(err), secrets), 200)] });
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) return resolve({ errors: ['generation timed out'] });
      if (code !== 0) return resolve({ errors: ['generation failed: ' + truncateOutput(maskSecretsInText(stderr || `claude exited with code ${code}`, secrets), 200)] });
      const parsed = extractGeneratedMcp(stdout);
      if (!parsed) return resolve({ errors: ['could not parse an MCP config from the model output — try the Manual tab'] });
      return resolve({ ok: true, ...parsed, durationMs: Date.now() - started });
    });
  });
}

function validateProviderSettings(body) {
  const errors = [];
  if (!body || typeof body !== 'object') errors.push('body must be an object');
  if (body?.runtimeMode !== undefined && !PROVIDER_RUNTIME_MODES.has(String(body?.runtimeMode || ''))) {
    errors.push('runtimeMode must be one of: claude-subscription, anthropic-api, opencode');
  }
  if (body?.claudeBin !== undefined && typeof body?.claudeBin !== 'string') errors.push('claudeBin must be a string');
  if (body?.opencodeBin !== undefined && typeof body?.opencodeBin !== 'string') errors.push('opencodeBin must be a string');
  if (body?.opencodeConfigPath !== undefined && typeof body?.opencodeConfigPath !== 'string') errors.push('opencodeConfigPath must be a string');
  if (body?.opencodeConfigImportSourcePath !== undefined && typeof body?.opencodeConfigImportSourcePath !== 'string') errors.push('opencodeConfigImportSourcePath must be a string');
  if (body?.cliBridgeEnabled !== undefined && typeof body?.cliBridgeEnabled !== 'boolean') errors.push('cliBridgeEnabled must be a boolean');
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

async function getAppSettingsResponse() {
  const settings = await readAppSettings(ROOT);
  return buildAppSettingsStatus({
    rootDir: ROOT,
    settings,
    activeRuntimeRoots: {
      sharedKnowledgeRoot: activeSharedKnowledgeRoot,
      personalKnowledgeRoot: activePersonalKnowledgeRoot,
      privateBoardRoot: activePrivateBoardRoot,
      teamBoardRoot: activeTeamBoardRoot,
    },
  });
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

async function listPersonalKnowledgeFolders(personalRootAbs) {
  if (!fs.existsSync(personalRootAbs)) {
    throw new Error(`personal knowledge root not found: ${personalRootAbs}`);
  }
  const folders = [];
  async function walk(dirAbs, dirRel) {
    const dirents = await fsp.readdir(dirAbs, { withFileTypes: true });
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    const docs = [];
    for (const dirent of dirents) {
      if (dirent.isFile() && dirent.name.endsWith('.md')) {
        const absPath = path.join(dirAbs, dirent.name);
        const stat = await fsp.stat(absPath);
        const text = await fsp.readFile(absPath, 'utf8');
        const fm = parseFrontmatter(text);
        const relSeg = dirRel ? `${dirRel}/` : '';
        docs.push({
          name: dirent.name,
          path: `knowledge/personal/${relSeg}${dirent.name}`,
          mtime: stat.mtimeMs,
          size: stat.size,
          title: firstHeading(text) || path.basename(absPath, '.md'),
          fmName: fm.name || null,
          description: fm.description || null,
          words: text.split(/\s+/).length,
        });
      }
    }
    const subdirs = dirents.filter((d) => d.isDirectory() && d.name !== '_artifacts');
    if (docs.length > 0 || subdirs.length === 0) {
      folders.push({ name: dirRel ? `personal/${dirRel}` : 'personal', docs });
    }
    for (const dirent of subdirs) {
      const subRel = dirRel ? `${dirRel}/${dirent.name}` : dirent.name;
      await walk(path.join(dirAbs, dirent.name), subRel);
    }
  }
  await walk(personalRootAbs, '');
  return folders;
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

function readDataJsText() {
  try {
    return fs.readFileSync(path.join(PUBLIC, 'data.js'), 'utf8');
  } catch {
    return '';
  }
}

function extractIdsFromSection(text, sectionName) {
  const m = text.match(new RegExp(`const\\s+${sectionName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*;`));
  if (!m) return [];
  const ids = [];
  const re = /id:\s*'([a-z0-9_-]+)'/g;
  let hit;
  while ((hit = re.exec(m[1])) !== null) ids.push(hit[1]);
  return ids;
}

function readCanonicalAgentIds() {
  const text = readDataJsText();
  return new Set(extractIdsFromSection(text, 'AGENTS'));
}

function readCanonicalWorkflowIds() {
  const text = readDataJsText();
  const base = extractIdsFromSection(text, 'WORKFLOWS');
  const cfg = readFlowsConfig();
  const set = new Set(base.filter((id) => !cfg.deleted.includes(id)));
  for (const id of Object.keys(cfg.overrides || {})) set.add(id);
  for (const flow of (cfg.custom || [])) {
    if (/^[a-z0-9][a-z0-9_-]*$/.test(flow?.id || '')) set.add(flow.id);
  }
  return set;
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
  const entries = [];
  let totalLines = 0;
  let blankLineCount = 0;
  let malformedLineCount = 0;

  const lines = text.length ? text.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  for (const line of lines) {
    totalLines += 1;
    if (!String(line).trim()) {
      blankLineCount += 1;
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) entries.push(parsed);
      else malformedLineCount += 1;
    } catch {
      malformedLineCount += 1;
    }
  }

  return {
    entries,
    diagnostics: {
      filePresent: Boolean(text.length) || fs.existsSync(file),
      totalLines,
      projectedLineCount: entries.length,
      quarantinedLineCount: blankLineCount + malformedLineCount,
      blankLineCount,
      malformedLineCount,
    },
  };
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
  let unified;
  let canonicalAccessError = null;
  try {
    const safeCanonical = ensureRuntimeFilePath({
      runtimeRoot: RUNTIME_ROOT_HINT,
      relativePath: path.join('streams', 'usage', 'usage.jsonl'),
      code: 'unsafe_usage_stream_path',
    });
    unified = await readJsonl(safeCanonical);
  } catch (err) {
    unified = {
      entries: [],
      diagnostics: {
        source: 'runs/usage.jsonl',
        filePresent: false,
        totalLines: 0,
        projectedLineCount: 0,
        quarantinedLineCount: 0,
        blankLineCount: 0,
        malformedLineCount: 0,
      },
    };
    canonicalAccessError = err?.code || 'usage_log_unavailable';
  }
  const legacy = await readJsonl(LEGACY_CHAT_USAGE_LOG);

  const merged = unified.entries.map((e) => ({ ...e, source: e.source || 'chat' }));
  const seen = new Set(merged.map(usageEntryKey));
  for (const e of legacy.entries) {
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
    diagnostics: {
      canonical: {
        source: 'runs/usage.jsonl',
        accessError: canonicalAccessError,
        ...unified.diagnostics,
      },
      legacy: {
        source: 'runs/chat-usage.jsonl',
        ...legacy.diagnostics,
      },
    },
    shadowProjection: rebuildUsageProjectionShadow({
      workspaceRoot: ROOT,
      canonicalUsageLogPath: USAGE_LOG,
      testRootOverride: process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT || null,
    }),
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
  const deploymentState = getRuntimeDeploymentState();
  const system = {
    agents: [],
    folders: [],
    docs: [],
    artifacts: [],
    meta: await readMeta(),
    user: getActiveUser(),
    appSettings: await getAppSettingsResponse(),
    requestedDeployment: deploymentState.requestedDeployment,
    effectiveDeployment: deploymentState.effectiveDeployment,
    teamCapability: deploymentState.teamCapability,
    warnings: [],
    diagnostics: {
      storageKernel: storageKernelDiagnostics.getStatus(),
      scheduler: typeof scheduler.getDiagnostics === 'function' ? scheduler.getDiagnostics() : null,
      usageProjection: getUsageProjectionHealth({
        workspaceRoot: ROOT,
        testRootOverride: process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT || null,
      }),
    },
  };

  // Agents from .claude/agents/*.md
  const agentDir = path.join(ROOT, '.claude', 'agents');
  for (const f of (await fsp.readdir(agentDir)).filter((f) => f.endsWith('.md')).sort()) {
    system.agents.push(await fileEntry(path.join(agentDir, f)));
  }

  // Knowledge folders + docs
  let sharedFolders = [];
  try {
    sharedFolders = await knowledgeStorage.listFolders();
  } catch (err) {
    system.warnings.push(`shared knowledge root unavailable: ${err.message}`);
  }

  const filteredShared = sharedFolders.filter((f) => f.name !== 'personal' && !f.name.startsWith('personal/'));

  let personalFolders = [];
  try {
    personalFolders = await listPersonalKnowledgeFolders(activePersonalKnowledgeRoot);
  } catch (err) {
    system.warnings.push(`personal knowledge root unavailable: ${err.message}`);
  }

  system.folders = [...filteredShared, ...personalFolders];

  const appStatus = system.appSettings || {};
  if (knowledgeStorage.kind === 'fs' && appStatus.activeRuntimeRoots?.shared?.exists === false) {
    system.warnings.push('shared knowledge root is not available — personal knowledge stays usable');
  }
  if (appStatus.activeRuntimeRoots?.personal?.exists === false) {
    system.warnings.push('personal knowledge root is not available — configure a valid path in Settings → Knowledge Spaces');
  }
  if (Array.isArray(appStatus.boardSafetyErrors) && appStatus.boardSafetyErrors.length) {
    system.warnings.push(...appStatus.boardSafetyErrors.map((msg) => `board roots configuration issue: ${msg}`));
  }
  if (appStatus.restartRequired) {
    system.warnings.push('knowledge root settings were changed — restart app to apply active runtime roots');
  }

  // Core docs (active project instructions and key indexes)
  for (const rel of ['CLAUDE.md', 'CLAUDE.local.md', 'README.md', 'docs/README.md', 'docs/status-and-roadmap.md']) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) system.docs.push(await fileEntry(abs));
  }

  // Artifacts (any file type, read-only listing — recursive, newest first)
  const artifacts = [];
  const aDir = path.join(ROOT, 'artifacts');
  if (fs.existsSync(aDir)) {
    const scanned = await scanArtifacts(aDir);
    artifacts.push(...scanned.filter((item) => !String(item.path || '').startsWith('artifacts/project-board/')));
  }
  if (typeof knowledgeStorage.listArtifacts === 'function') {
    try {
      artifacts.push(...await knowledgeStorage.listArtifacts());
    } catch (err) {
      system.warnings.push(`knowledge artifacts unavailable: ${err.message}`);
    }
  }
  system.artifacts = artifacts.sort((a, b) => (b.ctime || b.mtime || 0) - (a.ctime || a.mtime || 0));

  return system;
}

async function handleApi(req, res, url) {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  const sendBoard = (code, data) => send(code, { ok: true, data });

  const isBoardPath = /^\/api\/(board\/metadata|board\/artifacts\/[^/]+(?:\/[^/]+\/.+)?|projects(?:\/[^/]+(?:\/(activity|audit|visibility-migration|dashboard))?)?|activities(?:\/[^/]+)?|tasks(?:\/[^/]+(?:\/(execution\/(run|cancel|retry)|review\/decision))?)?|internal\/tasks\/execution-callback)$/.test(url.pathname);
  const isInternalExecutionCallbackPath = url.pathname === '/api/internal/tasks/execution-callback';

  const mutating = req.method !== 'GET';
  const trustedLocal = isTrustedLocalWebRequest(req, PORT);
  let tokenValid = false;
  if (API_TOKEN) {
    const auth = req.headers['x-steadymade-token'] || req.headers.authorization || '';
    const bearer = String(auth).replace(/^Bearer\s+/i, '');
    tokenValid = safeTokenEquals(bearer, API_TOKEN);
  }
  let internalBoardTokenValid = false;
  if (isBoardPath && !isInternalExecutionCallbackPath) {
    if (API_TOKEN) {
      if (!tokenValid) {
        return send(401, { ok: false, error: { code: 'unauthorized', message: 'unauthorized' } });
      }
    } else if (!trustedLocal) {
      return send(401, { ok: false, error: { code: 'unauthorized', message: 'unauthorized' } });
    }
  }
  if (mutating) {
    if (endpointExpectsJsonBody(req, url) && !hasJsonContentType(req)) {
      if (isBoardPath) return send(403, { ok: false, error: { code: 'forbidden', message: 'Content-Type must include application/json' } });
      return send(403, { error: 'forbidden: Content-Type must include application/json' });
    }
    if (isInternalExecutionCallbackPath) {
      const internalHeader = String(req.headers['x-internal-board-token'] || '').trim();
      if (!internalHeader) {
        return send(401, { ok: false, error: { code: 'unauthorized', message: 'missing internal callback token' } });
      }
      if (!BOARD_INTERNAL_TOKEN || !safeTokenEquals(internalHeader, BOARD_INTERNAL_TOKEN)) {
        return send(403, { ok: false, error: { code: 'forbidden', message: 'invalid internal callback token' } });
      }
      internalBoardTokenValid = true;
    } else if (!trustedLocal && !tokenValid) {
      if (isBoardPath) return send(401, { ok: false, error: { code: 'unauthorized', message: 'unauthorized' } });
      return send(401, { error: 'unauthorized' });
    }
  }

  const actor = {
    ...getActiveUser(),
    isHuman: true,
    isInternal: false,
    trustedLocal,
    tokenValid,
  };

  try {
    if (url.pathname === '/api/board/metadata' && req.method === 'GET') {
      return sendBoard(200, await boardService.getMetadata());
    }
    if (url.pathname === '/api/projects' && req.method === 'GET') {
      return sendBoard(200, await boardService.listProjects(Object.fromEntries(url.searchParams.entries()), actor));
    }
    if (url.pathname === '/api/projects' && req.method === 'POST') {
      const body = await readBody(req, { maxBytes: 256 * 1024 });
      return sendBoard(201, await boardService.createProject(body, actor));
    }
    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch && req.method === 'GET') {
      return sendBoard(200, await boardService.getProject(projectMatch[1], actor));
    }
    if (projectMatch && req.method === 'PATCH') {
      const body = await readBody(req, { maxBytes: 256 * 1024 });
      return sendBoard(200, await boardService.patchProject(projectMatch[1], body, actor));
    }
    if (projectMatch && req.method === 'DELETE') {
      const body = await readBody(req, { maxBytes: 256 * 1024 });
      return sendBoard(200, await boardService.deleteProject(projectMatch[1], body, actor));
    }
    const projectDashboardMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/dashboard$/);
    if (projectDashboardMatch && req.method === 'GET') {
      return sendBoard(200, await boardService.getProjectDashboard(projectDashboardMatch[1], actor));
    }
    const projectStreamMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/(activity|audit)$/);
    if (projectStreamMatch && req.method === 'GET') {
      const [, id, kind] = projectStreamMatch;
      if (kind === 'activity') return sendBoard(200, await boardService.getProjectActivity(id, actor));
      return sendBoard(200, await boardService.getProjectAudit(id, actor));
    }
    const projectMigrationMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/visibility-migration$/);
    if (projectMigrationMatch && req.method === 'POST') {
      const [, id] = projectMigrationMatch;
      const body = await readBody(req, { maxBytes: 256 * 1024 });
      return sendBoard(200, await boardService.migrateProjectVisibility(id, body, actor));
    }

    if (url.pathname === '/api/tasks' && req.method === 'GET') {
      return sendBoard(200, await boardService.listTasks(Object.fromEntries(url.searchParams.entries()), actor));
    }
    if (url.pathname === '/api/tasks' && req.method === 'POST') {
      const body = await readBody(req, { maxBytes: 256 * 1024 });
      return sendBoard(201, await boardService.createTask(body, actor));
    }
    if (url.pathname === '/api/activities' && req.method === 'GET') {
      return sendBoard(200, await boardService.listActivities(Object.fromEntries(url.searchParams.entries()), actor));
    }
    if (url.pathname === '/api/activities' && req.method === 'POST') {
      const body = await readBody(req, { maxBytes: 256 * 1024 });
      return sendBoard(201, await boardService.createActivity(body, actor));
    }
    const activityMatch = url.pathname.match(/^\/api\/activities\/([^/]+)$/);
    if (activityMatch && req.method === 'GET') {
      return sendBoard(200, await boardService.getActivity(activityMatch[1], actor));
    }
    if (activityMatch && req.method === 'PATCH') {
      const body = await readBody(req, { maxBytes: 256 * 1024 });
      return sendBoard(200, await boardService.patchActivity(activityMatch[1], body, actor));
    }
    if (activityMatch && req.method === 'DELETE') {
      const body = await readBody(req, { maxBytes: 256 * 1024 });
      return sendBoard(200, await boardService.deleteActivity(activityMatch[1], body, actor));
    }
    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch && req.method === 'GET') {
      return sendBoard(200, await boardService.getTask(taskMatch[1], actor));
    }
    if (taskMatch && req.method === 'PATCH') {
      const body = await readBody(req, { maxBytes: 256 * 1024 });
      return sendBoard(200, await boardService.patchTask(taskMatch[1], body, actor));
    }
    if (taskMatch && req.method === 'DELETE') {
      const body = await readBody(req, { maxBytes: 256 * 1024 });
      return sendBoard(200, await boardService.deleteTask(taskMatch[1], body, actor));
    }
    const taskReviewDecisionMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/review\/decision$/);
    if (taskReviewDecisionMatch && req.method === 'POST') {
      const [, id] = taskReviewDecisionMatch;
      const body = await readBody(req, { maxBytes: 256 * 1024 });
      return sendBoard(200, await boardService.decideTaskReview(id, body, actor));
    }
    const execMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/execution\/(run|cancel|retry)$/);
    if (execMatch && req.method === 'POST') {
      const [, id, action] = execMatch;
      const body = await readBody(req, { maxBytes: 256 * 1024 });
      if (action === 'run') {
        const result = await boardService.runTask(id, body, actor);
        return sendBoard(result.statusCode || 202, result.task);
      }
      if (action === 'cancel') {
        return sendBoard(200, await boardService.cancelTask(id, body, actor));
      }
      const result = await boardService.retryTask(id, body, actor);
      return sendBoard(result.statusCode || 202, result.task);
    }
    if (url.pathname === '/api/internal/tasks/execution-callback' && req.method === 'POST') {
      const body = await readBody(req, { maxBytes: 256 * 1024 });
      const internalActor = {
        ...actor,
        id: 'internal_callback',
        isHuman: false,
        isInternal: internalBoardTokenValid,
      };
      return sendBoard(200, await boardService.executionCallback(body, internalActor));
    }
    const boardArtifactIdMatch = url.pathname.match(/^\/api\/board\/artifacts\/([^/]+)$/);
    if (boardArtifactIdMatch && req.method === 'GET') {
      const [, artifactId] = boardArtifactIdMatch;
      const artifact = await boardService.readArtifactById({ artifactId: decodeURIComponent(artifactId), actor });
      const type = artifact.content_type || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': 'inline' });
      return fs.createReadStream(artifact.abs).pipe(res);
    }
    if (boardArtifactIdMatch && req.method === 'DELETE') {
      const [, artifactId] = boardArtifactIdMatch;
      const body = await readBody(req, { maxBytes: 64 * 1024 });
      const deleted = await boardService.deleteArtifactById({
        artifactId: decodeURIComponent(artifactId),
        actor,
        reason: body?.reason,
      });
      return sendBoard(200, deleted);
    }
    const boardArtifactLegacyMatch = url.pathname.match(/^\/api\/board\/artifacts\/([^/]+)\/([^/]+)\/(.+)$/);
    if (boardArtifactLegacyMatch && req.method === 'GET') {
      const [, taskId, attemptId, artifactPath] = boardArtifactLegacyMatch;
      const artifact = await boardService.readTaskArtifact({ taskId, attemptId, artifactPath, actor });
      const ext = path.extname(artifact.abs).toLowerCase();
      const type = artifact.content_type || { '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] || MIME[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': 'inline' });
      return fs.createReadStream(artifact.abs).pipe(res);
    }
  } catch (err) {
    if (isBoardPath) {
      const envelope = asBoardEnvelopeError(err);
      return send(envelope.status, envelope.body);
    }
    throw err;
  }

  if (url.pathname === '/api/system' && req.method === 'GET') {
    return send(200, await getSystem());
  }

  if (url.pathname === '/api/app-settings' && req.method === 'GET') {
    return send(200, await getAppSettingsResponse());
  }

  if (url.pathname === '/api/app-settings' && req.method === 'PUT') {
    const body = await readBody(req);
    const errors = validateAppSettingsPayload(body);
    const previous = await readAppSettings(ROOT);
    const merged = { ...previous, ...(body || {}) };
    const boardErrors = validateBoardRootConfig({ rootDir: ROOT, settings: merged });
    errors.push(...boardErrors);
    if (errors.length) return send(400, { errors });
    const saved = await writeAppSettings(ROOT, body, { merge: true });
    return send(200, {
      ok: true,
      ...buildAppSettingsStatus({
        rootDir: ROOT,
        settings: saved,
        activeRuntimeRoots: {
          sharedKnowledgeRoot: activeSharedKnowledgeRoot,
          personalKnowledgeRoot: activePersonalKnowledgeRoot,
          privateBoardRoot: activePrivateBoardRoot,
          teamBoardRoot: activeTeamBoardRoot,
        },
      }),
      message: 'saved — restart app to apply updated knowledge/board roots',
    });
  }

  if (url.pathname === '/api/folder-browser' && req.method === 'GET') {
    if (API_TOKEN) {
      if (!tokenValid) return send(401, { ok: false, error: { code: 'unauthorized', message: 'unauthorized' } });
    } else if (!isLoopbackHost(HOST) || !isLoopbackRemoteAddress(req.socket?.remoteAddress) || !trustedLocal) {
      return send(401, { ok: false, error: { code: 'unauthorized', message: 'unauthorized' } });
    }

    const mode = String(url.searchParams.get('mode') || '').trim().toLowerCase();
    const includeRoots = mode === 'roots' || url.searchParams.get('includeRoots') === '1';
    if (mode && mode !== 'roots') {
      return send(400, {
        ok: false,
        error: { code: 'invalid_mode', message: 'mode must be "roots" when provided' },
      });
    }

    if (mode === 'roots') {
      return send(200, { ok: true, roots: await listFolderBrowserRoots() });
    }

    const roots = await listFolderBrowserRoots();
    const canonicalRoots = [];
    for (const root of roots) {
      const resolved = await resolveCanonicalDirectory(root.path);
      if (!resolved.ok) continue;
      canonicalRoots.push({ ...root, path: resolved.path });
    }
    if (!canonicalRoots.length) {
      return send(503, {
        ok: false,
        error: { code: 'roots_unavailable', message: 'no browse roots are currently available' },
      });
    }

    const pathRaw = url.searchParams.get('path');
    const validated = validateAbsoluteDirectoryPathInput(pathRaw);
    if (!validated.ok) {
      return send(400, { ok: false, error: { code: validated.code, message: validated.message } });
    }

    const rootRaw = url.searchParams.get('root');
    let canonicalRoot = null;
    if (rootRaw) {
      const validatedRoot = validateAbsoluteDirectoryPathInput(rootRaw);
      if (!validatedRoot.ok) {
        return send(400, { ok: false, error: { code: validatedRoot.code, message: validatedRoot.message } });
      }
      const resolvedRoot = await resolveCanonicalDirectory(validatedRoot.path);
      if (!resolvedRoot.ok) {
        return send(resolvedRoot.status, { ok: false, error: { code: resolvedRoot.code, message: resolvedRoot.message } });
      }
      canonicalRoot = canonicalRoots.find((root) => root.path === resolvedRoot.path) || null;
      if (!canonicalRoot) {
        return send(403, { ok: false, error: { code: 'root_not_allowed', message: 'requested browse root is not allowed' } });
      }
    }

    const resolvedTarget = await resolveCanonicalDirectory(validated.path);
    if (!resolvedTarget.ok) {
      return send(resolvedTarget.status, { ok: false, error: { code: resolvedTarget.code, message: resolvedTarget.message } });
    }

    const targetPath = resolvedTarget.path;
    if (!canonicalRoot) {
      const matches = canonicalRoots.filter((root) => isPathWithin(root.path, targetPath));
      if (!matches.length) {
        return send(403, { ok: false, error: { code: 'path_outside_roots', message: 'target path must be within an allowed browse root' } });
      }
      matches.sort((a, b) => b.path.length - a.path.length);
      canonicalRoot = matches[0];
    }

    if (!isPathWithin(canonicalRoot.path, targetPath)) {
      return send(403, { ok: false, error: { code: 'path_outside_root', message: 'target path is outside the selected browse root' } });
    }

    const parentCandidate = path.dirname(targetPath);
    let parentPath = null;
    if (parentCandidate !== targetPath) {
      const resolvedParent = await fsp.realpath(parentCandidate).catch(() => null);
      if (resolvedParent && isPathWithin(canonicalRoot.path, resolvedParent)) parentPath = resolvedParent;
    }

    return send(200, {
      ok: true,
      currentPath: targetPath,
      parentPath,
      rootPath: canonicalRoot.path,
      directories: await listFolderBrowserDirectories(targetPath),
      ...(includeRoots ? { roots } : {}),
    });
  }

  const isLocalApiReadAuthorized = () => {
    if (API_TOKEN) {
      if (!tokenValid) {
        send(401, { ok: false, error: { code: 'unauthorized', message: 'unauthorized' } });
        return false;
      }
      return true;
    }
    if (!isLoopbackHost(HOST) || !isLoopbackRemoteAddress(req.socket?.remoteAddress) || !trustedLocal) {
      send(401, { ok: false, error: { code: 'unauthorized', message: 'unauthorized' } });
      return false;
    }
    return true;
  };

  if (url.pathname === '/api/usage' && req.method === 'GET') {
    return send(200, await readUsageLog());
  }

  if (url.pathname === '/api/file' && req.method === 'GET') {
    const rel = url.searchParams.get('path') || '';
    const gate = guardrails.check(rel, 'read');
    if (!gate.allowed) return send(403, { error: gate.reason });
    if (isPersonalKnowledgePath(rel)) {
      const abs = resolvePersonalKnowledgePath(activePersonalKnowledgeRoot, rel);
      if (!abs || !fs.existsSync(abs)) return send(404, { error: 'not found' });
      return send(200, { path: rel, content: await fsp.readFile(abs, 'utf8'), mtime: (await fsp.stat(abs)).mtimeMs });
    }
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
    if (isPersonalKnowledgePath(body.path || '')) {
      const abs = resolvePersonalKnowledgePath(activePersonalKnowledgeRoot, body.path || '');
      if (!abs || !abs.endsWith('.md')) return send(400, { error: 'only .md files inside personal knowledge root can be written' });
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, body.content, 'utf8');
      return send(200, { ok: true, mtime: (await fsp.stat(abs)).mtimeMs });
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

  if (url.pathname === '/api/file' && req.method === 'DELETE') {
    const rel = url.searchParams.get('path') || '';
    const deleteGate = guardrails.check(rel, 'write');
    if (!deleteGate.allowed) return send(403, { error: deleteGate.reason });
    if (deleteGate.confirmRequired && url.searchParams.get('confirmed') !== 'true') {
      return send(409, { confirmRequired: true, folder: deleteGate.folder, error: `guardrail: ${deleteGate.folder} is set to "ask" — confirm the delete` });
    }
    if (isPersonalKnowledgePath(rel)) {
      const abs = resolvePersonalKnowledgePath(activePersonalKnowledgeRoot, rel);
      if (!abs || !abs.endsWith('.md') || !fs.existsSync(abs)) return send(404, { error: 'not found' });
      await fsp.unlink(abs);
      return send(200, { ok: true });
    }
    if (isKnowledgePath(rel)) {
      try {
        return send(200, await knowledgeStorage.deleteFile(rel));
      } catch (err) {
        if (err.code === 'NOT_FOUND') return send(404, { error: 'not found' });
        if (err.status) return send(err.status, { error: err.message });
        throw err;
      }
    }

    const abs = safeResolve(rel);
    if (!abs || !abs.endsWith('.md') || !fs.existsSync(abs)) return send(404, { error: 'not found' });
    await fsp.unlink(abs);
    return send(200, { ok: true });
  }

  if (url.pathname === '/api/convert-docx' && req.method === 'POST') {
    // 20MB base64 budget (~15MB raw .docx) — generous for text documents with a few images.
    const body = await readBody(req, { maxBytes: 20 * 1024 * 1024 });
    if (!body.dataBase64) return send(400, { error: 'dataBase64 is required' });
    let buffer;
    try { buffer = Buffer.from(body.dataBase64, 'base64'); }
    catch { return send(400, { error: 'invalid base64 payload' }); }
    try {
      const { value: html, messages } = await mammoth.convertToHtml({ buffer });
      const markdown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).turndown(html);
      const warnings = messages.filter((m) => m.type === 'warning').map((m) => m.message);
      return send(200, { markdown, warnings });
    } catch (err) {
      return send(422, { error: 'docx conversion failed: ' + err.message });
    }
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
    const raw = await readProviderSettingsRaw();
    const diagnostics = providerLocalDiagnostics(raw);
    return send(200, {
      settings,
      diagnostics,
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
      runtimeMode: body?.runtimeMode === undefined ? existing.runtimeMode : sanitized.runtimeMode,
      claudeBin: body?.claudeBin === undefined ? existing.claudeBin : sanitized.claudeBin,
      opencodeBin: body?.opencodeBin === undefined ? existing.opencodeBin : sanitized.opencodeBin,
      opencodeConfigPath: body?.opencodeConfigPath === undefined ? existing.opencodeConfigPath : sanitized.opencodeConfigPath,
      opencodeConfigImportSourcePath: body?.opencodeConfigImportSourcePath === undefined ? existing.opencodeConfigImportSourcePath : sanitized.opencodeConfigImportSourcePath,
      cliBridgeEnabled: body?.cliBridgeEnabled === undefined ? existing.cliBridgeEnabled : sanitized.cliBridgeEnabled,
      envVault: body.envVault === undefined
        ? { ...(existing.envVault || {}) }
        : resolveEnvVaultMap(body.envVault, existing.envVault || {}),
      updatedAt: new Date().toISOString(),
    };
    await fsp.writeFile(PROVIDER_SETTINGS_FILE, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { await fsp.chmod(PROVIDER_SETTINGS_FILE, 0o600); } catch {}
    await pluginManager.syncProjections();
    const responseSettings = toProviderSettingsResponse(settings);
    return send(200, {
      ok: true,
      settings: responseSettings,
      path: 'interface/provider-settings.json',
      message: 'saved — restart app/chat to apply runtime env defaults',
    });
  }

  if (url.pathname === '/api/provider-settings/diagnostics' && req.method === 'GET') {
    const raw = await readProviderSettingsRaw();
    return send(200, { diagnostics: providerLocalDiagnostics(raw) });
  }

  if (url.pathname === '/api/provider-settings/opencode-config-import' && req.method === 'GET') {
    if (!isLocalApiReadAuthorized()) return;
    const raw = await readProviderSettingsRaw();
    const status = inspectOpenCodeConfigImport({
      workspaceRoot: ROOT,
      providerSettings: raw,
      testRootOverride: process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT || null,
    });
    return send(200, {
      ok: true,
      status,
      diagnostics: status.diagnostics,
    });
  }

  if (url.pathname === '/api/provider-settings/opencode-config-import' && req.method === 'POST') {
    if (!isLocalApiReadAuthorized()) return;
    const body = await readBody(req, { maxBytes: 16 * 1024 });
    const mode = String(body?.mode || 'initial').trim().toLowerCase();
    if (mode !== 'initial' && mode !== 'refresh') {
      return send(400, { ok: false, error: 'mode must be "initial" or "refresh"' });
    }
    const raw = await readProviderSettingsRaw();
    const result = importOpenCodeConfigIntoManagedRuntime({
      workspaceRoot: ROOT,
      providerSettings: raw,
      mode,
      testRootOverride: process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT || null,
    });
    if (!result.ok) {
      return send(422, {
        ok: false,
        code: result.code,
        message: result.message,
        diagnostics: result.inspection?.diagnostics || [],
      });
    }
    return send(200, {
      ok: true,
      mode: result.mode,
      importedAt: result.importedAt,
      targetPath: result.targetPath,
      sourcePath: result.sourcePath,
      sourceFile: result.sourceFile,
      backupPath: result.backupPath,
      redactedKeys: result.redactedKeys,
    });
  }

  if (url.pathname === '/api/provider-settings/deep-test' && req.method === 'POST') {
    const raw = await readProviderSettingsRaw();
    const result = await runProviderDeepTest(raw);
    return send(result.ok ? 200 : 422, {
      ok: result.ok,
      runtimeMode: result.runtimeMode,
      category: result.category,
      detail: result.detail,
      error: result.ok ? null : result.detail,
      durationMs: result.durationMs,
    });
  }

  // ---------- artifacts (open any file under artifacts/ and knowledge/company/**/_artifacts/**) ----------

  if (url.pathname === '/api/artifact' && req.method === 'GET') {
    const rel = normalizeProjectRelPath(url.searchParams.get('path') || '');
    if (!isAllowedArtifactPath(rel)) {
      return send(400, { error: 'only non-board files under artifacts/ or knowledge/company/**/_artifacts/** can be opened here' });
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

  const runMatch = url.pathname.match(/^\/api\/scheduler\/runs\/([0-9a-f-]+)$/i);
  if (runMatch && req.method === 'DELETE') {
    const result = await scheduler.deleteRun(runMatch[1]);
    if (result.code === 'RUN_ACTIVE') return send(409, result);
    return send(result.errors ? 404 : 200, result);
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

  const skillRemoveMatch = url.pathname.match(/^\/api\/skills\/([a-z0-9-]+)\/([a-z0-9-]+)$/);
  if (skillRemoveMatch && req.method === 'DELETE') {
    try {
      const [, scope, name] = skillRemoveMatch;
      const body = await readOptionalDeleteBody(req);
      const writePaths = [
        normalizeProjectRelPath(`skills/${scope}/${name}/`),
        normalizeProjectRelPath(`skills/${scope}/.trash/`),
        '.skill-profile',
        normalizeProjectRelPath(`.claude/skills/${name}`),
      ];
      for (const targetPath of writePaths) {
        const writeGate = guardrails.check(targetPath, 'write');
        if (!writeGate.allowed) return send(403, { error: writeGate.reason });
        if (writeGate.confirmRequired && body.confirmed !== true) {
          return send(409, { confirmRequired: true, folder: writeGate.folder, error: `guardrail: ${writeGate.folder} is set to "ask" — confirm the write` });
        }
      }
      const result = await skillHub.removePersonalSkill({ scope, name });
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
      const body = await readBody(req);
      const targetPath = normalizeProjectRelPath(`skills/${body.scope || 'personal'}`);
      const writeGate = guardrails.check(targetPath, 'write');
      if (!writeGate.allowed) return send(403, { error: writeGate.reason });
      if (writeGate.confirmRequired && body.confirmed !== true) {
        return send(409, { confirmRequired: true, folder: writeGate.folder, error: `guardrail: ${writeGate.folder} is set to "ask" — confirm the write` });
      }
      const result = await skillHub.installFromMarketplace(body);
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

  // ad-hoc MCP connectivity test for an unsaved config (setup wizard)
  if (url.pathname === '/api/plugins/test-config' && req.method === 'POST') {
    const body = await readBody(req);
    const config = body && typeof body.config === 'object' && body.config && !Array.isArray(body.config) ? body.config : null;
    if (!config) return send(400, { errors: ['config object required'] });
    const result = await testMcpPlugin({ config });
    return send(result.errors ? 400 : 200, result);
  }

  // AI-assisted MCP config drafting from a description / pasted docs (setup wizard)
  if (url.pathname === '/api/plugins/generate-mcp' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await generateMcpConfigFromText(body?.description);
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

  const pluginTestMatch = url.pathname.match(/^\/api\/plugins\/([a-z0-9-]+)\/test$/);
  if (pluginTestMatch && req.method === 'POST') {
    const plugin = pluginManager.getPlugin(pluginTestMatch[1]);
    if (!plugin) return send(404, { errors: ['unknown plugin: ' + pluginTestMatch[1]] });
    if (plugin.kind !== 'mcp') return send(400, { errors: ['only mcp plugins can be tested'] });
    const result = await testMcpPlugin(plugin);
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

  if (url.pathname === '/api/workspaces' && req.method === 'GET') {
    return send(200, [{
      id: 'personal',
      name: 'Personal Workspace',
      type: 'personal',
    }]);
  }

  if (url.pathname === '/api/workspace' && req.method === 'GET') {
    const appSettings = await getAppSettingsResponse();
    const userType = String(appSettings?.settings?.userType || '');
    const userPolicy = deriveUserTypePolicy(userType);
    const deploymentState = getRuntimeDeploymentState();
    const knowledgeSpaces = {
      personalReady: Boolean(appSettings.activeRuntimeRoots?.personal?.exists),
      sharedReady: knowledgeStorage.kind === 'fs'
        ? Boolean(appSettings.activeRuntimeRoots?.shared?.exists)
        : true,
      restartRequired: Boolean(appSettings.restartRequired),
    };
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
      userTypeDone: Boolean(userPolicy.configured),
      personalDone: Boolean(byId('user-profile').exists && byId('claude-local').exists),
      companyDone: Boolean(byId('operating-profile').exists && byId('operating-profile').todos === 0),
      memoryDone: Boolean(byId('memory-file').exists && byId('memory-daily').exists),
      companyTodos: byId('operating-profile').todos || 0,
      knowledgeSpacesDone: Boolean(knowledgeSpaces.personalReady && knowledgeSpaces.sharedReady),
    };
    onboarding.complete = onboarding.userTypeDone && onboarding.personalDone && onboarding.companyDone && onboarding.memoryDone;
    const workspace = {
      id: 'personal',
      name: 'Personal Workspace',
      type: 'personal',
    };
    const sharedCapability = buildSharedCapabilityState({ userPolicy, appSettings, deploymentState });
    return send(200, { workspace, checks, onboarding, knowledgeSpaces, appSettings, userType, userPolicy, sharedCapability });
  }

  if (url.pathname === '/api/meta' && req.method === 'PUT') {
    const body = await readBody(req);
    await fsp.writeFile(META_FILE, JSON.stringify(body, null, 2), 'utf8');
    return send(200, { ok: true });
  }

  return send(404, { error: 'unknown endpoint' });
}

function readBody(req, options = {}) {
  const maxBytes = Number(options.maxBytes || 0);
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (maxBytes > 0 && Buffer.byteLength(data, 'utf8') > maxBytes) {
        const err = new Error('payload too large');
        err.status = 413;
        err.code = 'payload_too_large';
        reject(err);
        req.destroy();
      }
    });
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
  const claudeBin = resolveClaudeBin({ rootDir: ROOT });
  console.log(claudeBin
    ? `Scheduler: claude CLI at ${claudeBin}`
    : 'Scheduler: WARNING — claude CLI not found, jobs will fail (set CLAUDE_BIN)');
});
