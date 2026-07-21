import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureRuntimeFilePath,
  resolveRuntimePath,
  resolveRuntimeRoot,
} from '../interface/storage/runtime/storage-kernel.mjs';

const PROVIDER_RUNTIME_MODES = new Set(['claude-subscription', 'anthropic-api', 'opencode']);
const OPENCODE_IMPORT_ALLOWED_FILES = ['config.json', 'opencode.json', 'settings.json', 'opencode.jsonc'];
const OPENCODE_IMPORT_DENIED_SEGMENTS = new Set([
  'auth',
  'account',
  'mcp-auth',
  'db',
  'log',
  'logs',
  'cache',
  'snapshots',
  'outputs',
  'output',
  'repos',
  'worktree',
  'storage',
]);
const OPENCODE_IMPORT_MAX_BYTES = 1024 * 1024;
const OPENCODE_PLUGIN_REGISTRY = [
  { id: 'context7', kind: 'mcp', defaults: { command: 'npx', args: ['-y', '@upstash/context7-mcp'], env: {} } },
  { id: 'm365-readonly', kind: 'mcp', defaults: { command: 'node', args: ['mcp/m365/server.mjs'] } },
  { id: 'm365-write', kind: 'mcp', defaults: { command: 'node', args: ['mcp/m365-write/server.mjs'] } },
  {
    id: 'twenty',
    kind: 'mcp',
    defaults: {
      type: 'streamable-http',
      url: 'https://crm.smapas.com/mcp',
      headers: { Authorization: 'Bearer ${TWENTY_API_KEY}' },
    },
  },
  { id: 'mcp-custom', kind: 'mcp', defaults: { command: '', args: [], env: {} } },
];

function nowTimestampForFile(date = new Date()) {
  return date.toISOString().replace(/[.:]/g, '-');
}

function expandHome(rawPath) {
  const value = String(rawPath || '').trim();
  if (!value) return '';
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveConfiguredPathCandidate(workspaceRoot, rawPath) {
  const expanded = expandHome(rawPath);
  if (!expanded) return { path: null, error: 'path is empty' };
  if (!expanded.includes(path.sep)) {
    return {
      path: null,
      error: `path must be explicit (no PATH lookup): ${String(rawPath || '').trim() || expanded}`,
    };
  }
  return {
    path: path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(workspaceRoot, expanded),
    error: null,
  };
}

export function resolveProviderRuntimeMode(rawMode) {
  const mode = String(rawMode || '').trim().toLowerCase();
  return PROVIDER_RUNTIME_MODES.has(mode) ? mode : 'claude-subscription';
}

export function managedRuntimePaths({ workspaceRoot, testRootOverride = null } = {}) {
  const runtimeRoot = resolveRuntimeRoot({ testRootOverride });
  return {
    runtimeRoot,
    managedRoot: resolveRuntimePath(runtimeRoot, 'managed-runtime'),
    claudeBin: resolveRuntimePath(runtimeRoot, 'managed-runtime', 'claude', 'claude'),
    opencodeBin: resolveRuntimePath(runtimeRoot, 'managed-runtime', 'opencode', 'opencode'),
    opencodeConfigPath: resolveRuntimePath(runtimeRoot, 'managed-runtime', 'opencode', 'config.json'),
    opencodeConfigStatePath: resolveRuntimePath(runtimeRoot, 'managed-runtime', 'opencode', 'import-state.json'),
    opencodeConfigBackupDir: resolveRuntimePath(runtimeRoot, 'managed-runtime', 'opencode', 'backups'),
    workspaceRoot: path.resolve(String(workspaceRoot || process.cwd())),
  };
}

export function resolveManagedCliBinary({
  workspaceRoot,
  cli,
  configuredPath = '',
  envPath = '',
  testRootOverride = null,
} = {}) {
  const workspaceAbs = path.resolve(String(workspaceRoot || process.cwd()));
  const defaults = managedRuntimePaths({ workspaceRoot: workspaceAbs, testRootOverride });
  const target = String(cli || '').trim().toLowerCase();
  const managedDefaultPath = target === 'opencode' ? defaults.opencodeBin : defaults.claudeBin;

  const envRaw = String(envPath || '').trim();
  const settingsRaw = String(configuredPath || '').trim();
  const selectedRaw = envRaw || settingsRaw;
  const source = envRaw ? 'env' : (settingsRaw ? 'settings' : 'managed-default');

  let selectedPath = managedDefaultPath;
  let reason = null;
  if (selectedRaw) {
    const resolved = resolveConfiguredPathCandidate(workspaceAbs, selectedRaw);
    if (resolved.error) {
      reason = resolved.error;
      selectedPath = null;
    } else {
      selectedPath = resolved.path;
    }
  }

  const resolvedPath = selectedPath && isExecutable(selectedPath) ? selectedPath : null;
  if (!resolvedPath && !reason) {
    reason = `configured path is not executable: ${selectedPath}`;
  }

  return {
    cli: target,
    source,
    selectedPath,
    managedDefaultPath,
    resolvedPath,
    setupRequired: !resolvedPath,
    reason,
  };
}

export function resolveManagedCliTargets({
  workspaceRoot,
  providerSettings = {},
  env = process.env,
  testRootOverride = null,
} = {}) {
  return {
    claude: resolveManagedCliBinary({
      workspaceRoot,
      cli: 'claude',
      configuredPath: providerSettings?.claudeBin,
      envPath: env.CLAUDE_BIN,
      testRootOverride,
    }),
    opencode: resolveManagedCliBinary({
      workspaceRoot,
      cli: 'opencode',
      configuredPath: providerSettings?.opencodeBin,
      envPath: env.OPENCODE_BIN,
      testRootOverride,
    }),
  };
}

function resolveOpenCodeConfigPath({ workspaceRoot, providerSettings, testRootOverride = null } = {}) {
  const defaults = managedRuntimePaths({ workspaceRoot, testRootOverride });
  const configured = String(providerSettings?.opencodeConfigPath || '').trim();
  if (!configured) return defaults.opencodeConfigPath;
  const candidate = resolveConfiguredPathCandidate(path.resolve(String(workspaceRoot || process.cwd())), configured);
  return candidate.path || defaults.opencodeConfigPath;
}

function resolveOpenCodeConfigImportSourcePath({ providerSettings } = {}) {
  const configured = String(providerSettings?.opencodeConfigImportSourcePath || '').trim();
  if (configured) return path.resolve(expandHome(configured));
  return path.join(os.homedir(), '.config', 'opencode');
}

function readOpenCodeImportState(statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      importedAt: typeof parsed.importedAt === 'string' ? parsed.importedAt : null,
      mode: typeof parsed.mode === 'string' ? parsed.mode : null,
      sourcePath: typeof parsed.sourcePath === 'string' ? parsed.sourcePath : null,
      sourceFile: typeof parsed.sourceFile === 'string' ? parsed.sourceFile : null,
      backupPath: typeof parsed.backupPath === 'string' ? parsed.backupPath : null,
      redactedKeys: Number.isFinite(Number(parsed.redactedKeys)) ? Number(parsed.redactedKeys) : 0,
    };
  } catch {
    return null;
  }
}

function isPathWithin(parentAbs, targetAbs) {
  const rel = path.relative(parentAbs, targetAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function sanitizeOpenCodeConfigObject(value, stats = { redactedKeys: 0 }) {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeOpenCodeConfigObject(item, stats))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const lowerKey = String(key || '').toLowerCase();
    const secretLike = [
      'token',
      'secret',
      'password',
      'passwd',
      'api_key',
      'apikey',
      'credential',
      'private_key',
      'privatekey',
      'authorization',
      'session',
      'cookie',
    ].some((needle) => lowerKey.includes(needle));
    if (secretLike || lowerKey === 'auth' || lowerKey.startsWith('auth_') || lowerKey.endsWith('_auth')) {
      stats.redactedKeys += 1;
      continue;
    }
    const sanitized = sanitizeOpenCodeConfigObject(child, stats);
    if (sanitized !== undefined) out[key] = sanitized;
  }
  return out;
}

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
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
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
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
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

function parseOpenCodeConfigFileContent(content) {
  const text = String(content || '');
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(stripJsoncCommentsAndTrailingCommas(text));
  }
}

function readCanonicalPluginState(workspaceRoot) {
  const statePath = path.join(path.resolve(String(workspaceRoot || process.cwd())), 'interface', 'plugins.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return {
      plugins: parsed?.plugins && typeof parsed.plugins === 'object' && !Array.isArray(parsed.plugins) ? parsed.plugins : {},
      custom: Array.isArray(parsed?.custom) ? parsed.custom : [],
      path: statePath,
    };
  } catch {
    return { plugins: {}, custom: [], path: statePath };
  }
}

function allOpenCodePluginDefs(pluginState) {
  return [
    ...OPENCODE_PLUGIN_REGISTRY,
    ...(pluginState?.custom || []).map((def) => ({ ...def, custom: true })),
  ].filter((def) => def?.kind === 'mcp');
}

function toOpenCodeMcpEntry(config) {
  const cfg = config && typeof config === 'object' ? config : {};
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

function mergeOpenCodeConfig(baseConfig, overlayConfig) {
  const base = baseConfig && typeof baseConfig === 'object' && !Array.isArray(baseConfig) ? baseConfig : {};
  const overlay = overlayConfig && typeof overlayConfig === 'object' && !Array.isArray(overlayConfig) ? overlayConfig : {};
  const out = { ...base, ...overlay };
  if (base.mcp || overlay.mcp) {
    const baseMcp = base.mcp && typeof base.mcp === 'object' && !Array.isArray(base.mcp) ? base.mcp : {};
    const overlayMcp = overlay.mcp && typeof overlay.mcp === 'object' && !Array.isArray(overlay.mcp) ? overlay.mcp : {};
    out.mcp = { ...baseMcp, ...overlayMcp };
  }
  return out;
}

function buildProjectedOpenCodeConfig({ workspaceRoot, existingConfig = {}, stateOverride = null } = {}) {
  const pluginState = stateOverride || readCanonicalPluginState(workspaceRoot);
  const defs = allOpenCodePluginDefs(pluginState);
  const out = existingConfig && typeof existingConfig === 'object' && !Array.isArray(existingConfig)
    ? { ...existingConfig }
    : {};
  if (!out.mcp || typeof out.mcp !== 'object' || Array.isArray(out.mcp)) out.mcp = {};

  const m365WriteFromLegacy = out.mcp['m365-write'] && out.mcp['m365-write'].enabled !== false;
  if (!pluginState.plugins['m365-write'] && m365WriteFromLegacy) {
    pluginState.plugins['m365-write'] = { enabled: true, config: {} };
  }

  for (const def of defs) delete out.mcp[def.id];
  for (const def of defs) {
    const enabled = Boolean(pluginState.plugins?.[def.id]?.enabled);
    if (!enabled) continue;
    const config = { ...(def.defaults || {}), ...(pluginState.plugins?.[def.id]?.config || {}) };
    const entry = toOpenCodeMcpEntry(config);
    if (!entry) continue;
    out.mcp[def.id] = entry;
  }

  return { config: out, pluginState };
}

function inspectOpenCodeImportSource({ sourcePath } = {}) {
  const diagnostics = [];
  const resolvedSource = path.resolve(String(sourcePath || ''));
  let sourceExists = false;
  let sourceSafe = false;
  let sourceRealPath = null;
  let allowedCandidates = [];

  if (!resolvedSource) {
    diagnostics.push('source path is empty');
    return {
      sourcePath: resolvedSource,
      sourceExists,
      sourceSafe,
      sourceRealPath,
      allowedCandidates,
      diagnostics,
    };
  }

  let sourceLst;
  try {
    sourceLst = fs.lstatSync(resolvedSource);
  } catch {
    diagnostics.push('source directory not found');
    return {
      sourcePath: resolvedSource,
      sourceExists,
      sourceSafe,
      sourceRealPath,
      allowedCandidates,
      diagnostics,
    };
  }

  sourceExists = true;
  if (!sourceLst.isDirectory()) {
    diagnostics.push('source path must be a directory');
    return {
      sourcePath: resolvedSource,
      sourceExists,
      sourceSafe,
      sourceRealPath,
      allowedCandidates,
      diagnostics,
    };
  }
  if (sourceLst.isSymbolicLink()) {
    diagnostics.push('source directory must not be a symlink');
    return {
      sourcePath: resolvedSource,
      sourceExists,
      sourceSafe,
      sourceRealPath,
      allowedCandidates,
      diagnostics,
    };
  }

  sourceRealPath = fs.realpathSync.native(resolvedSource);
  if (sourceRealPath !== resolvedSource) {
    diagnostics.push('source path must be canonical (no symlink indirection)');
    return {
      sourcePath: resolvedSource,
      sourceExists,
      sourceSafe,
      sourceRealPath,
      allowedCandidates,
      diagnostics,
    };
  }

  const deniedEntries = [];
  for (const entry of fs.readdirSync(sourceRealPath, { withFileTypes: true })) {
    const name = String(entry.name || '');
    const lower = name.toLowerCase();
    if (OPENCODE_IMPORT_DENIED_SEGMENTS.has(lower)) {
      deniedEntries.push(name);
      continue;
    }
    if (!OPENCODE_IMPORT_ALLOWED_FILES.includes(lower)) continue;
    const abs = path.join(sourceRealPath, name);
    let lst;
    try {
      lst = fs.lstatSync(abs);
    } catch {
      continue;
    }
    if (!lst.isFile() || lst.isSymbolicLink()) continue;
    const real = fs.realpathSync.native(abs);
    if (!isPathWithin(sourceRealPath, real)) continue;
    allowedCandidates.push(real);
  }

  if (deniedEntries.length) {
    diagnostics.push(`ignored denied entries: ${deniedEntries.sort().join(', ')}`);
  }
  allowedCandidates = OPENCODE_IMPORT_ALLOWED_FILES
    .map((name) => path.join(sourceRealPath, name))
    .filter((candidate) => allowedCandidates.includes(candidate));
  sourceSafe = true;
  if (!allowedCandidates.length) diagnostics.push('no importable OpenCode config file found');
  return {
    sourcePath: resolvedSource,
    sourceExists,
    sourceSafe,
    sourceRealPath,
    allowedCandidates,
    diagnostics,
  };
}

export function inspectOpenCodeConfigImport({
  workspaceRoot,
  providerSettings = {},
  testRootOverride = null,
} = {}) {
  const defaults = managedRuntimePaths({ workspaceRoot, testRootOverride });
  const sourcePath = resolveOpenCodeConfigImportSourcePath({ providerSettings });
  const source = inspectOpenCodeImportSource({ sourcePath });
  const state = readOpenCodeImportState(defaults.opencodeConfigStatePath);
  const targetExists = fs.existsSync(defaults.opencodeConfigPath);
  const targetNonEmpty = targetExists && fs.statSync(defaults.opencodeConfigPath).size > 0;
  return {
    sourcePath: source.sourcePath,
    sourceExists: source.sourceExists,
    sourceSafe: source.sourceSafe,
    sourceCandidates: source.allowedCandidates.map((p) => path.basename(p)),
    targetPath: defaults.opencodeConfigPath,
    targetExists,
    targetNonEmpty,
    imported: Boolean(state?.importedAt) && targetExists,
    importState: state,
    diagnostics: source.diagnostics,
    ready: source.sourceExists && source.sourceSafe && source.allowedCandidates.length > 0,
  };
}

export function importOpenCodeConfigIntoManagedRuntime({
  workspaceRoot,
  providerSettings = {},
  mode = 'initial',
  testRootOverride = null,
} = {}) {
  const normalizedMode = String(mode || '').trim().toLowerCase() === 'refresh' ? 'refresh' : 'initial';
  const inspection = inspectOpenCodeConfigImport({ workspaceRoot, providerSettings, testRootOverride });
  if (!inspection.ready) {
    return {
      ok: false,
      code: 'import_not_ready',
      message: 'OpenCode import source is not ready',
      inspection,
    };
  }

  const defaults = managedRuntimePaths({ workspaceRoot, testRootOverride });
  const sourcePath = resolveOpenCodeConfigImportSourcePath({ providerSettings });
  const source = inspectOpenCodeImportSource({ sourcePath });
  const sourceFile = source.allowedCandidates[0];
  if (!sourceFile) {
    return {
      ok: false,
      code: 'import_source_missing_candidate',
      message: 'No importable OpenCode config file found',
      inspection,
    };
  }

  let backupPath = null;
  const targetExists = fs.existsSync(defaults.opencodeConfigPath);
  const targetNonEmpty = targetExists && fs.statSync(defaults.opencodeConfigPath).size > 0;
  if (normalizedMode === 'initial' && targetNonEmpty) {
    return {
      ok: false,
      code: 'managed_config_exists',
      message: 'Managed OpenCode config already exists; use refresh mode to replace it',
      inspection,
    };
  }

  const inputBuffer = fs.readFileSync(sourceFile);
  if (inputBuffer.length > OPENCODE_IMPORT_MAX_BYTES) {
    return {
      ok: false,
      code: 'import_source_too_large',
      message: `Source config exceeds ${OPENCODE_IMPORT_MAX_BYTES} bytes`,
      inspection,
    };
  }

  let parsed;
  try {
    parsed = parseOpenCodeConfigFileContent(inputBuffer.toString('utf8'));
  } catch {
    return {
      ok: false,
      code: 'import_source_invalid_json',
      message: 'Source config is not valid JSON/JSONC',
      inspection,
    };
  }

  const stats = { redactedKeys: 0 };
  const sanitized = sanitizeOpenCodeConfigObject(parsed, stats);

  const targetRelative = path.relative(defaults.runtimeRoot, defaults.opencodeConfigPath);
  const safeTargetPath = ensureRuntimeFilePath({
    runtimeRoot: defaults.runtimeRoot,
    relativePath: targetRelative,
    createIfMissing: true,
    code: 'unsafe_opencode_config_path',
  });
  const targetDir = path.dirname(safeTargetPath);
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(targetDir, 0o700); } catch {}

  if (normalizedMode === 'refresh' && targetExists) {
    fs.mkdirSync(defaults.opencodeConfigBackupDir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(defaults.opencodeConfigBackupDir, 0o700); } catch {}
    backupPath = path.join(defaults.opencodeConfigBackupDir, `config-${nowTimestampForFile()}.json`);
    fs.copyFileSync(safeTargetPath, backupPath);
    try { fs.chmodSync(backupPath, 0o600); } catch {}
  }

  fs.writeFileSync(safeTargetPath, `${JSON.stringify(sanitized || {}, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(safeTargetPath, 0o600); } catch {}

  const statePayload = {
    importedAt: new Date().toISOString(),
    mode: normalizedMode,
    sourcePath: source.sourcePath,
    sourceFile: path.basename(sourceFile),
    backupPath,
    redactedKeys: stats.redactedKeys,
  };
  fs.writeFileSync(defaults.opencodeConfigStatePath, `${JSON.stringify(statePayload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(defaults.opencodeConfigStatePath, 0o600); } catch {}

  return {
    ok: true,
    mode: normalizedMode,
    targetPath: safeTargetPath,
    sourcePath: source.sourcePath,
    sourceFile: path.basename(sourceFile),
    backupPath,
    redactedKeys: stats.redactedKeys,
    importedAt: statePayload.importedAt,
  };
}

export function prepareOpenCodeEnvironment({
  env = process.env,
  workspaceRoot,
  providerSettings = {},
  testRootOverride = null,
  configContent = '',
} = {}) {
  const out = { ...env };
  const configPath = resolveOpenCodeConfigPath({ workspaceRoot, providerSettings, testRootOverride });
  const defaults = managedRuntimePaths({ workspaceRoot, testRootOverride });

  let existingConfig = {};
  try {
    if (fs.existsSync(configPath)) {
      existingConfig = parseOpenCodeConfigFileContent(fs.readFileSync(configPath, 'utf8'));
    }
  } catch {
    existingConfig = {};
  }

  let projected;
  try {
    projected = buildProjectedOpenCodeConfig({ workspaceRoot, existingConfig });
  } catch {
    projected = { config: existingConfig, pluginState: null };
  }

  let overlayConfig = {};
  if (configContent) {
    try {
      overlayConfig = parseOpenCodeConfigFileContent(String(configContent));
    } catch {
      overlayConfig = {};
    }
  }
  const finalConfig = mergeOpenCodeConfig(projected.config, overlayConfig);
  const finalConfigText = `${JSON.stringify(finalConfig || {}, null, 2)}\n`;

  if (configPath.startsWith(defaults.runtimeRoot)) {
    const relative = path.relative(defaults.runtimeRoot, configPath);
    const safePath = ensureRuntimeFilePath({
      runtimeRoot: defaults.runtimeRoot,
      relativePath: relative,
      createIfMissing: true,
      code: 'unsafe_opencode_config_path',
    });
    fs.writeFileSync(safePath, finalConfigText, { encoding: 'utf8', mode: 0o600 });
  } else {
    fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(configPath, finalConfigText, { encoding: 'utf8', mode: 0o600 });
  }

  out.OPENCODE_CONFIG = configPath;
  out.OPENCODE_DISABLE_AUTO_UPDATE = '1';
  out.OPENCODE_DISABLE_AUTOUPDATE = '1';
  if (!out.OPENCODE_CONFIG_CONTENT) {
    out.OPENCODE_CONFIG_CONTENT = finalConfigText;
  }
  return out;
}

export function buildProviderRuntimeDiagnostics({
  workspaceRoot,
  providerSettings = {},
  env = process.env,
  testRootOverride = null,
} = {}) {
  const runtimeMode = resolveProviderRuntimeMode(providerSettings.runtimeMode);
  const targets = resolveManagedCliTargets({ workspaceRoot, providerSettings, env, testRootOverride });
  const checks = [];
  const addCheck = (id, ok, category, message) => {
    checks.push({ id, status: ok ? 'pass' : 'fail', category: ok ? 'success' : category, message });
  };

  if (runtimeMode === 'opencode') {
    addCheck(
      'opencode-binary',
      Boolean(targets.opencode.resolvedPath),
      'setup_required',
      targets.opencode.resolvedPath
        ? `OpenCode binary found at ${targets.opencode.resolvedPath}`
        : (targets.opencode.reason || 'OpenCode setup required'),
    );
    const opencodeConfigPath = resolveOpenCodeConfigPath({ workspaceRoot, providerSettings, testRootOverride });
    addCheck(
      'opencode-managed-config',
      true,
      'info',
      fs.existsSync(opencodeConfigPath)
        ? `Managed OpenCode config available at ${opencodeConfigPath}`
        : `Managed OpenCode config will be generated from Settings at launch (${opencodeConfigPath})`,
    );
  } else {
    addCheck(
      'claude-binary',
      Boolean(targets.claude.resolvedPath),
      'setup_required',
      targets.claude.resolvedPath
        ? `Claude binary found at ${targets.claude.resolvedPath}`
        : (targets.claude.reason || 'Claude setup required'),
    );
  }

  if (runtimeMode === 'anthropic-api') {
    const apiKey = String(providerSettings?.envVault?.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '').trim();
    addCheck(
      'anthropic-api-key',
      Boolean(apiKey),
      'missing_config',
      apiKey ? 'ANTHROPIC_API_KEY is configured' : 'ANTHROPIC_API_KEY is missing',
    );
  }

  return {
    runtimeMode,
    ready: checks.every((check) => check.status === 'pass'),
    checks,
    blockingFailures: checks.filter((check) => check.status === 'fail'),
    targets,
  };
}
