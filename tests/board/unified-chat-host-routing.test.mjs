import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { WebSocket } from 'ws';

function randomPort() {
  return 46600 + Math.floor(Math.random() * 500);
}

function httpRequest({ port, hostHeader, pathName, method = 'GET' }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathName,
      method,
      headers: { Host: hostHeader },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(2500, () => {
      req.destroy(new Error('http request timed out'));
    });
    req.end();
  });
}

async function waitForServerReady(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await httpRequest({ port, hostHeader: `localhost:${port}`, pathName: '/api/system' });
      if (res.status === 200) return;
    } catch {
      // startup race
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('interface server did not become ready');
}

function expectWsHandshakeStatus({ port, hostHeader, pathName, origin, expectedStatus }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      settle(reject, new Error(`websocket handshake did not resolve for status ${expectedStatus}`));
    }, 8000);

    const ws = new WebSocket(`ws://127.0.0.1:${port}${pathName}`, {
      headers: {
        Host: hostHeader,
        Origin: origin,
      },
    });

    ws.on('open', () => settle(reject, new Error(`expected handshake status ${expectedStatus}, but websocket opened`)));
    ws.on('unexpected-response', (_req, res) => {
      try {
        assert.equal(res.statusCode, expectedStatus);
        settle(resolve);
      } catch (err) {
        settle(reject, err);
      }
    });
    ws.on('error', (err) => settle(reject, err));
  });
}

async function startServer() {
  const tempHome = await fsp.mkdtemp(path.join('/private/tmp', 'host-routing-home-'));
  const runtimeRoot = await fsp.mkdtemp(path.join('/private/tmp', 'host-routing-runtime-'));
  const port = randomPort();
  const server = spawn(process.execPath, ['interface/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: tempHome,
      STEADYMADE_STORAGE_KERNEL_TEST_ROOT: runtimeRoot,
      STEADYMADE_CHAT_STORAGE_TEST_ROOT: runtimeRoot,
      PORT: String(port),
      HOST: '127.0.0.1',
      CHAT_CLI_BRIDGE_ENABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  server.stderr.on('data', (chunk) => {
    stderr += String(chunk || '');
  });

  try {
    await waitForServerReady(port);
  } catch (err) {
    try { server.kill('SIGTERM'); } catch {}
    if (server.exitCode === null && server.signalCode === null) {
      await new Promise((resolve) => server.once('exit', resolve));
    }
    throw new Error(`${err.message}; stderr=${stderr}`);
  }
  return {
    port,
    async stop() {
      if (server.exitCode === null && server.signalCode === null) {
        server.kill('SIGTERM');
        await new Promise((resolve) => server.once('exit', resolve));
      }
      await fsp.rm(tempHome, { recursive: true, force: true });
      await fsp.rm(runtimeRoot, { recursive: true, force: true });
    },
  };
}

test('unified host routing serves interface on localhost and chat on chat.localhost only', async () => {
  const runtime = await startServer();
  try {
    const interfaceRes = await httpRequest({
      port: runtime.port,
      hostHeader: `localhost:${runtime.port}`,
      pathName: '/api/system',
    });
    assert.equal(interfaceRes.status, 200);

    const chatHealth = await httpRequest({
      port: runtime.port,
      hostHeader: `chat.localhost:${runtime.port}`,
      pathName: '/api/health',
    });
    assert.equal(chatHealth.status, 200);
    const healthJson = JSON.parse(chatHealth.body);
    assert.equal(healthJson.ok, true);
    assert.equal(Number(healthJson.port), runtime.port);

    const chatIndex = await httpRequest({
      port: runtime.port,
      hostHeader: `chat.localhost:${runtime.port}`,
      pathName: '/',
    });
    assert.equal(chatIndex.status, 200);
    assert.match(String(chatIndex.headers['content-type'] || ''), /text\/html/i);

    const unknownHost = await httpRequest({
      port: runtime.port,
      hostHeader: `evil.localhost:${runtime.port}`,
      pathName: '/api/system',
    });
    assert.equal(unknownHost.status, 421);
  } finally {
    await runtime.stop();
  }
});

test('terminal websocket upgrades are delegated to chat host only', async () => {
  const runtime = await startServer();
  try {
    await expectWsHandshakeStatus({
      port: runtime.port,
      hostHeader: `chat.localhost:${runtime.port}`,
      origin: `http://chat.localhost:${runtime.port}`,
      pathName: '/api/terminal/ws?sessionId=missing-session',
      expectedStatus: 404,
    });

    await expectWsHandshakeStatus({
      port: runtime.port,
      hostHeader: `localhost:${runtime.port}`,
      origin: `http://localhost:${runtime.port}`,
      pathName: '/api/terminal/ws?sessionId=missing-session',
      expectedStatus: 421,
    });
  } finally {
    await runtime.stop();
  }
});
