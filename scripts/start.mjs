#!/usr/bin/env node
// preflight-marker

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deriveUserTypePolicy, getAppSettingsFile, readAppSettings } from '../interface/app-settings.mjs';
import { inspectRuntimeGate } from './start-runtime-gate.mjs';
import { buildProviderRuntimeDiagnostics } from '../runtime/managed-runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROVIDER_SETTINGS_FILE = path.join(ROOT, 'interface', 'provider-settings.json');
const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check-only');

const REQUIRED = [
  'CLAUDE.md',
  '.claude/agents',
  'interface/server.mjs',
  'knowledge',
  'scripts/validate.mjs',
];

const OPTIONAL = [
  '.claude/settings.local.json',
  '.mcp.json',
  'CLAUDE.local.md',
];

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function readProviderSettings() {
  try {
    try { fs.chmodSync(PROVIDER_SETTINGS_FILE, 0o600); } catch {}
    const parsed = JSON.parse(fs.readFileSync(PROVIDER_SETTINGS_FILE, 'utf8'));
    const envVault = {};
    if (parsed && typeof parsed.envVault === 'object' && !Array.isArray(parsed.envVault)) {
      for (const [key, value] of Object.entries(parsed.envVault)) {
        if (/^[A-Z_][A-Z0-9_]*$/.test(String(key)) && typeof value === 'string') {
          envVault[key] = value;
        }
      }
    }
    return {
      runtimeMode: typeof parsed.runtimeMode === 'string' ? parsed.runtimeMode.trim() : '',
      claudeBin: typeof parsed.claudeBin === 'string' ? parsed.claudeBin.trim() : '',
      opencodeBin: typeof parsed.opencodeBin === 'string' ? parsed.opencodeBin.trim() : '',
      opencodeConfigPath: typeof parsed.opencodeConfigPath === 'string' ? parsed.opencodeConfigPath.trim() : '',
      cliBridgeEnabled: typeof parsed.cliBridgeEnabled === 'boolean' ? parsed.cliBridgeEnabled : null,
      envVault,
    };
  } catch {
    return { runtimeMode: '', claudeBin: '', opencodeBin: '', opencodeConfigPath: '', cliBridgeEnabled: null, envVault: {} };
  }
}

function parseEnvVaultKeys(raw) {
  return new Set(
    String(raw || '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => /^[A-Z_][A-Z0-9_]*$/.test(k)),
  );
}

function logHeader(title) {
  console.log(`\n== ${title} ==`);
}

function checkLayout() {
  logHeader('Project layout check');
  let ok = true;
  for (const rel of REQUIRED) {
    if (exists(rel)) {
      console.log(`OK   ${rel}`);
    } else {
      console.error(`MISS ${rel}`);
      ok = false;
    }
  }

  logHeader('Optional local files');
  for (const rel of OPTIONAL) {
    console.log(`${exists(rel) ? 'FOUND' : 'NONE '} ${rel}`);
  }

  return ok;
}

function runValidate(nodeExecutablePath) {
  logHeader('Repository validation');
  const result = spawnSync(nodeExecutablePath, ['scripts/validate.mjs'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  return result.status === 0;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(true);
    });
  });
}

function resolveProviderMode(rawMode) {
  const mode = String(rawMode || '').trim().toLowerCase();
  if (mode === 'anthropic-api' || mode === 'opencode' || mode === 'claude-subscription') return mode;
  return 'claude-subscription';
}

function resolveBinary(command, fallback) {
  const configured = String(command || '').trim() || fallback;
  const hasPath = configured.includes(path.sep);
  const candidates = hasPath
    ? [path.resolve(configured), path.resolve(ROOT, configured)]
    : String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, configured));
  for (const candidate of [...new Set(candidates)]) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return { resolvedPath: candidate, reason: null };
    } catch {
      // keep searching
    }
  }
  return {
    resolvedPath: null,
    reason: hasPath ? `configured path is not executable: ${configured}` : `${configured} binary not found in PATH`,
  };
}

function validateNodeExecutable(executablePath) {
  const inspected = spawnSync(executablePath, ['-p', 'JSON.stringify({versions:process.versions,release:process.release,execPath:process.execPath})'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (inspected.status !== 0) {
    return {
      ok: false,
      reason: `failed to execute ${executablePath} (exit ${inspected.status ?? 'unknown'})`,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(String(inspected.stdout || '').trim());
  } catch {
    return {
      ok: false,
      reason: `failed to inspect runtime for ${executablePath}`,
    };
  }
  const runtimeGate = inspectRuntimeGate(parsed || {});
  if (!runtimeGate.ok) {
    return {
      ok: false,
      reason: `${executablePath} rejected: ${runtimeGate.message}`,
    };
  }
  return { ok: true, reason: null };
}

function resolveValidatedNodeExecutable() {
  const preferred = String(process.env.STEADYMADE_NODE_BIN || '').trim() || 'node';
  const resolved = resolveBinary(preferred, 'node');
  if (!resolved.resolvedPath) {
    return {
      ok: false,
      executablePath: null,
      reason: resolved.reason || 'node binary not found',
    };
  }
  const validation = validateNodeExecutable(resolved.resolvedPath);
  if (!validation.ok) {
    return {
      ok: false,
      executablePath: null,
      reason: validation.reason,
    };
  }
  return {
    ok: true,
    executablePath: resolved.resolvedPath,
    reason: null,
  };
}

function preflightResultLine(entry) {
  const status = entry.status === 'pass' ? 'PASS' : (entry.status === 'warn' ? 'WARN' : 'FAIL');
  return `[${status}] ${entry.id}: ${entry.message}`;
}

async function runPreflightChecks() {
  const checks = [];
  const add = (id, status, message, options = {}) => checks.push({ id, status, message, blocking: options.blocking !== false, code: options.code });

  const runtimeGate = inspectRuntimeGate({
    versions: process.versions,
    release: process.release,
    execPath: process.execPath,
    env: process.env,
  });
  add('runtime-gate', runtimeGate.ok ? 'pass' : 'fail', runtimeGate.message);

  const nodeExecutable = resolveValidatedNodeExecutable();
  add(
    'node-executable',
    nodeExecutable.ok ? 'pass' : 'fail',
    nodeExecutable.ok
      ? `Validated Node executable: ${nodeExecutable.executablePath}`
      : `Node executable validation failed: ${nodeExecutable.reason}`,
  );

  const missingLayout = REQUIRED.filter((rel) => !exists(rel));
  add('required-layout', missingLayout.length ? 'fail' : 'pass', missingLayout.length ? `Missing required paths: ${missingLayout.join(', ')}` : 'Required project layout exists');

  if (nodeExecutable.ok) {
    const validate = spawnSync(nodeExecutable.executablePath, ['scripts/validate.mjs'], { cwd: ROOT, stdio: 'ignore' });
    add('repository-validate', validate.status === 0 ? 'pass' : 'fail', validate.status === 0 ? 'scripts/validate.mjs passed' : 'scripts/validate.mjs failed');
  } else {
    add('repository-validate', 'fail', 'scripts/validate.mjs skipped: no validated Node executable');
  }

  const missingPackages = ['node-pty', 'ws', 'xterm', '@xterm/addon-fit']
    .filter((pkg) => !fs.existsSync(path.join(ROOT, 'node_modules', ...pkg.split('/'))));
  add('runtime-dependencies', missingPackages.length ? 'fail' : 'pass', missingPackages.length ? `Missing runtime dependencies: ${missingPackages.join(', ')} (run npm ci)` : 'Runtime dependencies are installed');

  const port = Number(process.env.PORT || 4011);
  const interfacePortFree = await isPortFree(port);
  add('interface-port', interfacePortFree ? 'pass' : 'fail', interfacePortFree ? `Interface port ${port} is free` : `Interface port ${port} is in use (run node scripts/stop.mjs)`);

  const appSettings = await readAppSettings(ROOT);
  const userPolicy = deriveUserTypePolicy(appSettings.userType);
  add(
    'onboarding-user-type',
    userPolicy.configured ? 'pass' : 'fail',
    userPolicy.configured
      ? `User type is set to ${userPolicy.userType}`
      : `User type is not set in ${path.relative(ROOT, getAppSettingsFile(ROOT))} (open Settings -> Onboarding)`,
    userPolicy.configured ? {} : { code: 'onboarding-user-type-missing', blocking: false },
  );

  if (userPolicy.requiresGit) {
    const git = spawnSync('git', ['--version'], { stdio: 'ignore' });
    add('git-required', git.status === 0 ? 'pass' : 'fail', git.status === 0 ? 'Git is available for collaborator mode' : 'Git is required for collaborator mode');
  } else {
    add('git-required', 'warn', 'Git check skipped (required only for collaborator user type)', { blocking: false });
  }

  const providerSettings = readProviderSettings();
  const mode = resolveProviderMode(providerSettings.runtimeMode);
  const providerDiagnostics = buildProviderRuntimeDiagnostics({
    workspaceRoot: ROOT,
    providerSettings,
    env: {
      ...process.env,
      ...(providerSettings.envVault || {}),
    },
    testRootOverride: process.env.STEADYMADE_STORAGE_KERNEL_TEST_ROOT || null,
  });
  const providerFailure = providerDiagnostics.blockingFailures[0];
  add(
    'provider-local-readiness',
    providerDiagnostics.ready ? 'pass' : 'fail',
    providerDiagnostics.ready
      ? `Provider ${mode} local readiness passed`
      : `Provider ${mode} local readiness failed: ${providerFailure?.message || 'setup required'}`,
  );
  const managedConfigCheck = (providerDiagnostics.checks || []).find((check) => check.id === 'opencode-managed-config');
  if (managedConfigCheck) {
    add('provider-opencode-managed-config', 'warn', managedConfigCheck.message, { blocking: false });
  }

  const blockingFailures = checks.filter((entry) => entry.status === 'fail' && entry.blocking);
  return {
    checks,
    blockingFailures,
    nodeExecutablePath: nodeExecutable.ok ? nodeExecutable.executablePath : null,
    exitCode: blockingFailures.length ? 1 : 0,
  };
}

async function main() {
  console.log(`Project root: ${ROOT}`);
  const preflight = await runPreflightChecks();
  console.log('\nPreflight checks:');
  for (const entry of preflight.checks) console.log(preflightResultLine(entry));
  if (preflight.blockingFailures.length) {
    console.log('\nBlocking failures:');
    for (const failure of preflight.blockingFailures) {
      console.log(`- ${failure.id}: ${failure.message}`);
    }
    console.log('\nResult: FAIL');
  } else {
    console.log('\nResult: PASS');
  }
  if (checkOnly) process.exit(preflight.exitCode);

  if (preflight.blockingFailures.length) {
    console.error('\nStartup aborted: blocking preflight failures found.');
    process.exit(1);
  }
  const userTypeMissing = preflight.checks.some((entry) => entry.code === 'onboarding-user-type-missing');
  if (userTypeMissing) {
    console.warn('\nOnboarding incomplete: user type not set. Startup continues; set it in Settings -> Onboarding.');
  }

  const port = Number(process.env.PORT || 4011);

  const env = {
    ...process.env,
    STEADYMADE_RUNTIME: process.env.STEADYMADE_RUNTIME || 'dev',
    STEADYMADE_KNOWLEDGE_BACKEND: process.env.STEADYMADE_KNOWLEDGE_BACKEND || 'fs',
  };
  const providerSettings = readProviderSettings();
  const inheritedEnvVaultKeys = parseEnvVaultKeys(process.env.STEADYMADE_ENV_VAULT_KEYS);
  if (process.env.STEADYMADE_PROVIDER_MODE === undefined && providerSettings.runtimeMode) {
    env.STEADYMADE_PROVIDER_MODE = providerSettings.runtimeMode;
  }
  if (process.env.CLAUDE_BIN === undefined && providerSettings.claudeBin) {
    env.CLAUDE_BIN = providerSettings.claudeBin;
  }
  if (process.env.OPENCODE_BIN === undefined && providerSettings.opencodeBin) {
    env.OPENCODE_BIN = providerSettings.opencodeBin;
  }
  if (process.env.OPENCODE_CONFIG === undefined && providerSettings.opencodeConfigPath) {
    env.OPENCODE_CONFIG = providerSettings.opencodeConfigPath;
  }
  if (process.env.CHAT_CLI_BRIDGE_ENABLED === undefined && providerSettings.cliBridgeEnabled !== null) {
    env.CHAT_CLI_BRIDGE_ENABLED = providerSettings.cliBridgeEnabled ? '1' : '0';
  }
  const envVaultKeys = [];

  // If this process was started via a previous runtime restart, `process.env`
  // may already contain old env-vault values. We only treat keys listed in the
  // inherited marker as vault-managed and refresh/remove them from the current
  // provider-settings source of truth.
  for (const key of inheritedEnvVaultKeys) {
    if (!(key in (providerSettings.envVault || {}))) {
      delete env[key];
    }
  }

  for (const [key, value] of Object.entries(providerSettings.envVault || {})) {
    envVaultKeys.push(key);
    // Env vault is the source of truth for configured keys. This prevents stale
    // shell/session variables from overriding saved local credentials.
    env[key] = value;
  }
  env.STEADYMADE_ENV_VAULT_KEYS = envVaultKeys.join(',');

  logHeader('Starting interface');
  console.log(`Runtime: ${env.STEADYMADE_RUNTIME}`);
  console.log(`Backend: ${env.STEADYMADE_KNOWLEDGE_BACKEND}`);
  console.log(`FS Root: ${env.STEADYMADE_KNOWLEDGE_FS_ROOT || '(resolved by server env/app-settings/default)'}`);
  if (env.OPENCODE_BIN) console.log(`OpenCode bin: ${env.OPENCODE_BIN}`);
  if (env.CHAT_CLI_BRIDGE_ENABLED != null) console.log(`CLI bridge default: ${env.CHAT_CLI_BRIDGE_ENABLED}`);
  console.log(`URL: http://localhost:${port}`);

  const child = spawn(preflight.nodeExecutablePath, ['interface/server.mjs'], {
    cwd: ROOT,
    stdio: 'inherit',
    env,
  });

  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };

  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));

  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`Interface stopped by signal ${signal}.`);
      process.exit(1);
    }
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
