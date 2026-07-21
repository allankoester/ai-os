#!/usr/bin/env node

import process from 'node:process';
import { StringDecoder } from 'node:string_decoder';

import { createM365TokenProvider } from '../m365/auth.mjs';
import { createGraphCalendarSharepointClient } from './graph-client.mjs';
import { TOOL_DEFINITIONS, callM365WriteTool } from './tools.mjs';

const SERVER_INFO = {
  name: 'steadymade-m365-write',
  version: '0.1.0',
};

const DEFAULT_WRITE_SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'Calendars.Read',
  'Sites.Selected',
];

const authProvider = createM365TokenProvider({
  env: process.env,
  defaultScopes: DEFAULT_WRITE_SCOPES,
  tenantIdEnvKey: 'M365_WRITE_TENANT_ID',
  tenantIdFallbackEnvKey: 'M365_TENANT_ID',
  clientIdEnvKey: 'M365_WRITE_CLIENT_ID',
  clientIdFallbackEnvKey: 'M365_CLIENT_ID',
  scopesEnvKey: 'M365_WRITE_SCOPES',
  loginToolName: 'm365_write_auth_login',
});
const graphClient = createGraphCalendarSharepointClient({ tokenProvider: authProvider });

const decoder = new StringDecoder('utf8');
let readBuffer = '';

function writeRpc(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeSuccess(id, result) {
  if (id === undefined || id === null) return;
  writeRpc({ jsonrpc: '2.0', id, result });
}

function writeError(id, code, message, data) {
  writeRpc({
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  });
}

async function onMessage(message) {
  if (!message || typeof message !== 'object') {
    return writeError(null, -32600, 'Invalid Request');
  }

  const { id, method, params } = message;
  try {
    switch (method) {
      case 'initialize': {
        return writeSuccess(id, {
          protocolVersion: params?.protocolVersion || '2025-03-26',
          capabilities: {
            tools: {},
          },
          serverInfo: SERVER_INFO,
          instructions: [
            'Delegated Microsoft 365 Graph MCP server with fixed calendar-read and SharePoint read/write tools.',
            'Mutation tools require explicit confirm=true per call.',
          ].join(' '),
        });
      }

      case 'notifications/initialized':
        return;

      case 'ping':
        return writeSuccess(id, {});

      case 'tools/list':
        return writeSuccess(id, { tools: TOOL_DEFINITIONS });

      case 'tools/call': {
        const name = String(params?.name || '').trim();
        const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
        const result = await callM365WriteTool({
          name,
          args,
          authProvider,
          graphClient,
        });
        return writeSuccess(id, {
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false,
        });
      }

      default:
        return writeError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    return writeError(id, -32000, String(err?.message || err));
  }
}

function tryParseLines() {
  while (true) {
    const lineEnd = readBuffer.indexOf('\n');
    if (lineEnd < 0) return;

    const rawLine = readBuffer.slice(0, lineEnd);
    readBuffer = readBuffer.slice(lineEnd + 1);

    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.trim()) continue;

    try {
      const message = JSON.parse(line);
      void onMessage(message);
    } catch (err) {
      writeError(null, -32700, `Parse error: ${String(err?.message || err)}`);
    }
  }
}

process.stdin.on('data', (chunk) => {
  readBuffer += decoder.write(Buffer.from(chunk));
  tryParseLines();
});

process.stdin.on('end', () => {
  readBuffer += decoder.end();
  tryParseLines();
  process.exit(0);
});
process.stdin.resume();
