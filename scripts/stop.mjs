#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const PORT = Number(process.env.PORT || 4011);

function unique(nums) {
  return [...new Set(nums.filter((n) => Number.isInteger(n) && n > 0))];
}

function getPidsFromMacLinux(port) {
  try {
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' }).trim();
    if (!out) return [];
    return unique(out.split(/\r?\n/).map((s) => Number(s.trim())));
  } catch {
    return [];
  }
}

function getPidsFromWindows(port) {
  try {
    const cmd = `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`;
    const out = execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
    if (!out) return [];
    return unique(out.split(/\r?\n/).map((s) => Number(s.trim())));
  } catch {
    return [];
  }
}

function stopPidWindows(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function stopPidPosix(pid) {
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function main() {
  const isWindows = process.platform === 'win32';
  const pids = isWindows ? getPidsFromWindows(PORT) : getPidsFromMacLinux(PORT);

  if (pids.length === 0) {
    console.log(`No process found on port ${PORT}.`);
    return;
  }

  let stopped = 0;
  for (const pid of pids) {
    if (pid === process.pid) continue;
    const ok = isWindows ? stopPidWindows(pid) : stopPidPosix(pid);
    if (ok) {
      stopped += 1;
      console.log(`Stopped PID ${pid} on port ${PORT}.`);
    } else {
      console.log(`Could not stop PID ${pid} on port ${PORT}.`);
    }
  }

  if (stopped === 0) {
    process.exitCode = 1;
  }
}

main();
