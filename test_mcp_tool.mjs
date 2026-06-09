import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function run() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['--import', 'tsx', 'src/index.ts'],
    env: {
      ...process.env,
      MCP_TRANSPORT: 'stdio',
      AJO_API_KEY: 'b1cd32a3cbd845b09bdd8f27c3276d78',
      AJO_CLIENT_SECRET: 'p8e-rfxXbj8WggBI0KuA2Kpg69_dfhVuzOgx',
      AJO_SCOPES: 'cjm.suppression_service.client.delete,cjm.suppression_service.client.all,openid,session,AdobeID,read_organizations,additional_info.projectedProductContext',
      AJO_IMS_ORG_ID: 'C735552962AB1A800A495FFD@AdobeOrg',
      AJO_SANDBOX_NAME: 'etrakselis-sandbox'
    }
  });

  const client = new Client({
    name: 'test-client',
    version: '1.0.0'
  }, {
    capabilities: {}
  });

  try {
    await client.connect(transport);
    console.log('Connected to MCP server');

    const result = await client.callTool({
      name: 'createTemplate',
      arguments: {
        body: {
          name: 'MCP Connection Test Template',
          templateType: 'html',
          channels: ['email'],
          template: {
            html: '<html><body style="color: blue;">Hello from Codex! Testing MCP connection via node script.</body></html>'
          }
        }
      }
    });

    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

run();
