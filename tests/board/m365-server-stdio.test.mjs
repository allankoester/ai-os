import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

function spawnServer() {
  return spawn(process.execPath, ['mcp/m365/server.mjs'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function readSingleResponse(child, { timeoutMs = 5000 } = {}) {
  let buffer = '';

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for MCP response line'));
    }, timeoutMs);

    const onStdout = (chunk) => {
      buffer += Buffer.from(chunk).toString('utf8');
      while (true) {
        const lineEnd = buffer.indexOf('\n');
        if (lineEnd < 0) return;
        const rawLine = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 1);
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (!line.trim()) continue;

        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch (err) {
          cleanup();
          reject(new Error(`Invalid JSON line from M365 server: ${String(err?.message || err)}`));
          return;
        }

        cleanup();
        resolve(parsed);
        return;
      }
    };

    const onStderr = (chunk) => {
      cleanup();
      reject(new Error(`M365 server stderr: ${String(chunk)}`));
    };

    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`M365 server exited before response (code=${code}, signal=${signal})`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('exit', onExit);
    };

    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.on('exit', onExit);
  });
}

function writeLine(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`, 'utf8');
}

test('m365 server initialize succeeds with line-delimited stdio', async () => {
  const child = spawnServer();

  try {
    writeLine(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26' },
    });

    const response = await readSingleResponse(child);
    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, 1);
    assert.equal(response.result.protocolVersion, '2025-03-26');
    assert.equal(response.result.serverInfo.name, 'steadymade-m365-readonly');
    assert.ok(response.result.capabilities.tools);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
});

test('m365 server tools/list succeeds with line-delimited stdio', async () => {
  const child = spawnServer();

  try {
    writeLine(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });

    const response = await readSingleResponse(child);
    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, 2);
    assert.ok(Array.isArray(response.result.tools));
    assert.ok(response.result.tools.length > 0);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
});

test('m365 server parses split-chunk line-delimited input', async () => {
  const child = spawnServer();

  try {
    const requestLine = `${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' })}\n`;
    const splitAt = Math.floor(requestLine.length / 2);
    child.stdin.write(requestLine.slice(0, splitAt), 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 5));
    child.stdin.write(requestLine.slice(splitAt), 'utf8');

    const response = await readSingleResponse(child);
    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, 3);
    assert.deepEqual(response.result, {});
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
});
