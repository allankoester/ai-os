#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

function runValidate() {
  logHeader('Repository validation');
  const result = spawnSync(process.execPath, ['scripts/validate.mjs'], {
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

async function main() {
  console.log(`Project root: ${ROOT}`);

  if (!checkLayout()) {
    console.error('\nStartup check failed: required files/folders are missing.');
    process.exit(1);
  }

  if (!runValidate()) {
    console.error('\nStartup check failed: scripts/validate.mjs returned errors.');
    process.exit(1);
  }

  const port = Number(process.env.PORT || 4011);
  const free = await isPortFree(port);
  if (checkOnly) {
    if (free) {
      console.log(`\nPort check: ${port} is free.`);
    } else {
      console.log(`\nPort check: ${port} is currently in use.`);
      console.log('Use node scripts/stop.mjs before starting a new instance.');
    }
    console.log('\nCheck-only passed.');
    process.exit(0);
  }

  if (!free) {
    console.error(`\nPort ${port} is already in use.`);
    console.error('Run: node scripts/stop.mjs');
    process.exit(1);
  }

  const env = {
    ...process.env,
    STEADYMADE_RUNTIME: process.env.STEADYMADE_RUNTIME || 'dev',
    STEADYMADE_KNOWLEDGE_BACKEND: process.env.STEADYMADE_KNOWLEDGE_BACKEND || 'fs',
    STEADYMADE_KNOWLEDGE_FS_ROOT: process.env.STEADYMADE_KNOWLEDGE_FS_ROOT || 'knowledge',
  };

  logHeader('Starting interface');
  console.log(`Runtime: ${env.STEADYMADE_RUNTIME}`);
  console.log(`Backend: ${env.STEADYMADE_KNOWLEDGE_BACKEND}`);
  console.log(`FS Root: ${env.STEADYMADE_KNOWLEDGE_FS_ROOT}`);
  console.log(`URL: http://localhost:${port}`);

  const child = spawn(process.execPath, ['interface/server.mjs'], {
    cwd: ROOT,
    stdio: 'inherit',
    env,
  });

  // Optionally start the Danny chat runtime (chat/server.mjs on 4012), which the
  // interface embeds as an iframe in the Chat view. Skips cleanly if the file is
  // missing or the port is busy — the rest of the interface works without it.
  let chatChild = null;
  const chatPort = Number(process.env.CHAT_PORT || 4012);
  if (exists('chat/server.mjs')) {
    if (await isPortFree(chatPort)) {
      console.log(`Chat runtime: http://localhost:${chatPort}`);
      chatChild = spawn(process.execPath, ['chat/server.mjs'], { cwd: ROOT, stdio: 'inherit', env });
      chatChild.on('exit', (code, signal) => {
        if (signal) console.error(`Chat runtime stopped by signal ${signal}.`);
        else if (code) console.error(`Chat runtime exited with code ${code}.`);
        chatChild = null;
      });
    } else {
      console.log(`Chat runtime: port ${chatPort} in use — skipping (Chat view iframe will be empty).`);
    }
  }

  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
    if (chatChild && !chatChild.killed) chatChild.kill(signal);
  };

  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));

  child.on('exit', (code, signal) => {
    if (chatChild && !chatChild.killed) chatChild.kill('SIGTERM');
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
