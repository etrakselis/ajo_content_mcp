import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function requiredEnv() {
  return ['AJO_API_KEY', 'AJO_CLIENT_SECRET', 'AJO_SCOPES', 'AJO_IMS_ORG_ID', 'AJO_SANDBOX_NAME'];
}

test('stdio MCP server lists tools when Adobe env is configured', async (t) => {
  const missing = requiredEnv().filter((key) => !process.env[key]);
  if (missing.length) {
    t.skip(`Missing required Adobe env: ${missing.join(', ')}`);
    return;
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/index.ts'],
    env: {
      ...process.env,
      MCP_TRANSPORT: 'stdio'
    }
  });

  const client = new Client({
    name: 'test-client',
    version: '1.0.0'
  }, {
    capabilities: {}
  });

  await client.connect(transport);
  t.after(async () => {
    await client.close();
  });

  const tools = await client.listTools();
  assert.ok(Array.isArray(tools.tools));
  assert.ok(tools.tools.some((tool) => tool.name === 'createTemplate'));
});
