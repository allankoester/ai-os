#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delayMs = Number(process.env.RESTART_DELAY_MS || 800);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // Give /api/restart enough time to send its HTTP response and for the current
  // interface process/supervisor to exit. Then clear both interface and chat
  // ports before relaunching through scripts/start.mjs, which owns both runtimes.
  await sleep(delayMs);

  spawnSync(process.execPath, ['scripts/stop.mjs'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: process.env,
  });

  spawn(process.execPath, ['scripts/start.mjs'], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  }).unref();
}

main().catch(() => process.exit(1));
