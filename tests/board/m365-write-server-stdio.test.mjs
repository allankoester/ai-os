import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

function spawnServer() {
  return spawn(process.execPath, ['mcp/m365-write/server.mjs'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function readSingleResponse(child, { timeoutMs = 5000 } = {}) {
  let buffer = '';

  return await new Promise((resolve, reject) => {
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
        cleanup();
        resolve(JSON.parse(line));
        return;
      }
    };

    const onStderr = (chunk) => {
      cleanup();
      reject(new Error(`M365 write server stderr: ${String(chunk)}`));
    };

    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`M365 write server exited before response (code=${code}, signal=${signal})`));
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

test('m365 write server initialize and tools/list succeed on line-delimited stdio', async () => {
  const child = spawnServer();
  try {
    writeLine(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26' },
    });
    const initResponse = await readSingleResponse(child);
    assert.equal(initResponse.result.serverInfo.name, 'steadymade-m365-write');

    writeLine(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    const toolsResponse = await readSingleResponse(child);
    const names = toolsResponse.result.tools.map((tool) => tool.name);
    assert.equal(names.includes('m365_write_calendar_list_events_range'), true);
    assert.equal(names.includes('m365_write_sharepoint_create_file'), true);
    assert.equal(names.includes('m365_write_sharepoint_create_site_page_draft'), true);
    assert.equal(names.includes('m365_write_sharepoint_create_site_list_item'), true);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
});
