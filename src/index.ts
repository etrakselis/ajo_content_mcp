import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { AdobeTokenManager } from './auth.js';
import { formatCompactJsonResult, formatSuccessResult } from './result-format.js';
import {
  buildInputSchema,
  buildQueryString,
  chooseAcceptHeader,
  denormalizeParameterObject,
  extractOperations,
  loadOpenApiDocument,
  replacePathParams,
  resolveSpecPath,
  toRequestBody,
  titleForOperation,
  toolNameForOperationId,
  descriptionForOperation,
} from './openapi.js';
import * as z from 'zod/v4';

type Config = {
  baseUrl: string;
  apiKey: string;
  clientSecret: string;
  scopes: string[];
  tokenUrl: string;
  imsOrgId: string;
  sandboxName: string;
  timeoutMs: number;
  tokenSkewSeconds: number;
};

type TransportMode = 'http' | 'stdio';

function loadConfig(): Config {
  const baseUrl = process.env.AJO_BASE_URL ?? 'https://platform.adobe.io/ajo/content';
  const apiKey = process.env.AJO_API_KEY;
  const clientSecret = process.env.AJO_CLIENT_SECRET;
  const scopes = (process.env.AJO_SCOPES ?? '').split(/[\s,]+/).filter(Boolean);
  const tokenUrl = process.env.AJO_IMS_TOKEN_URL ?? 'https://ims-na1.adobelogin.com/ims/token/v3';
  const imsOrgId = process.env.AJO_IMS_ORG_ID;
  const sandboxName = process.env.AJO_SANDBOX_NAME;

  if (!apiKey) throw new Error('Missing AJO_API_KEY');
  if (!clientSecret) throw new Error('Missing AJO_CLIENT_SECRET');
  if (!scopes.length) throw new Error('Missing AJO_SCOPES');
  if (!imsOrgId) throw new Error('Missing AJO_IMS_ORG_ID');
  if (!sandboxName) {
    throw new Error('Missing AJO_SANDBOX_NAME. Set it in /app/config/settings.json or pass AJO_SANDBOX_NAME directly.');
  }

  return {
    baseUrl,
    apiKey,
    clientSecret,
    scopes,
    tokenUrl,
    imsOrgId,
    sandboxName,
    timeoutMs: Number(process.env.AJO_REQUEST_TIMEOUT_MS ?? 60000),
    tokenSkewSeconds: Number(process.env.AJO_TOKEN_SKEW_SECONDS ?? 60)
  };
}

function authHeaders(config: Config, accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'x-api-key': config.apiKey,
    'x-gw-ims-org-id': config.imsOrgId,
    'x-sandbox-name': config.sandboxName
  };
}

function makeTextResult(text: string, isError = false) {
  return {
    isError,
    content: [{ type: 'text' as const, text }]
  };
}

function buildOverviewResource(operations: any[]) {
  return {
    server: 'Adobe Journey Optimizer Content API MCP server',
    transport: 'Prefer stdio for local LLMs such as Gemma',
    commonTools: [
      'list_fragments',
      'get_fragment',
      'create_fragment',
      'publish_fragment',
      'list_templates',
      'get_template'
    ],
    notes: [
      'Use flat wrapper tools first; use generated OpenAPI tools for advanced cases.',
      'Resources are provided for discovery because some local clients rely on them.',
      'Generated tools still accept nested path/query/headers/body objects.'
    ],
    generatedToolCount: operations.length
  };
}

function buildOperationsResource(operations: any[]) {
  return operations.map((op) => ({
    tool: toolNameForOperationId(op.operationId),
    method: op.method.toUpperCase(),
    path: op.path,
    summary: titleForOperation(op)
  }));
}

function buildExamplesResource() {
  return {
    examples: [
      { tool: 'list_fragments', input: { limit: 10 } },
      { tool: 'get_fragment', input: { fragment_id: 'b6d70a45-a149-453b-85ba-809a5d40066d' } },
      { tool: 'publish_fragment', input: { fragment_id: 'b6d70a45-a149-453b-85ba-809a5d40066d' } },
      { tool: 'list_templates', input: { limit: 10 } },
      { tool: 'get_template', input: { template_id: 'template-123' } }
    ]
  };
}

async function callOperation(op: any, args: any, config: Config, tokenManager: AdobeTokenManager) {
  const pathParams = denormalizeParameterObject(args.path, op.parameters.filter((p: any) => p.in === 'path'));
  const queryParams = denormalizeParameterObject(args.query, op.parameters.filter((p: any) => p.in === 'query'));
  const url = new URL(config.baseUrl.replace(/\/$/, '') + replacePathParams(op.path, pathParams ?? {}));
  const query = buildQueryString(queryParams);
  if (query) url.search = query;

  const accept = chooseAcceptHeader(op);
  const body = op.requestBody ? toRequestBody(args.body, op.requestBody.contentType) : undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${config.timeoutMs}ms`)), config.timeoutMs);

  const execute = async (forceRefresh = false) => {
    const accessToken = await tokenManager.getAccessToken(forceRefresh);
    const headers: Record<string, string> = {
      ...authHeaders(config, accessToken),
      'x-request-id': randomUUID(),
      Accept: accept
    };
    if (args.headers?.if_match) {
      headers['If-Match'] = String(args.headers.if_match);
    }
    if (body !== undefined) {
      headers['Content-Type'] = op.requestBody?.contentType ?? 'application/json';
    }
    return fetch(url, {
      method: op.method.toUpperCase(),
      headers,
      body,
      signal: controller.signal
    });
  };

  try {
    let response = await execute(false);
    if (response.status === 401) {
      response = await execute(true);
    }

    const rawText = await response.text();
    const contentType = response.headers.get('content-type') ?? '';

    if (!response.ok) {
      return makeTextResult(`HTTP ${response.status} ${response.statusText}\n\n${rawText}`, true);
    }

    if (!rawText) {
      return formatSuccessResult(response, null);
    }

    const parsed = contentType.includes('json') || contentType.includes('+json')
      ? (() => {
          try {
            return JSON.parse(rawText);
          } catch {
            return undefined;
          }
        })()
      : undefined;

    if (parsed !== undefined) {
      return formatSuccessResult(response, parsed);
    }

    return formatSuccessResult(response, rawText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return makeTextResult(`Failed to call ${op.operationId}: ${message}`, true);
  } finally {
    clearTimeout(timeout);
  }
}

function requireOperation(operations: any[], operationId: string) {
  const operation = operations.find((item) => item.operationId === operationId);
  if (!operation) {
    throw new Error(`Missing OpenAPI operation: ${operationId}`);
  }
  return operation;
}

function registerWrapperTools(server: McpServer, operations: any[], config: Config, tokenManager: AdobeTokenManager) {
  const getFragmentsOp = requireOperation(operations, 'getFragments');
  const getFragmentOp = requireOperation(operations, 'getFragment');
  const createFragmentOp = requireOperation(operations, 'createFragment');
  const publishFragmentOp = requireOperation(operations, 'publishFragment');
  const getTemplatesOp = requireOperation(operations, 'getTemplates');
  const getTemplateOp = requireOperation(operations, 'getTemplate');

  server.registerTool(
    'list_fragments',
    {
      title: 'List fragments',
      description: 'List content fragments with simple flat arguments. Use this first for discovery.',
      inputSchema: z.object({
        limit: z.number().int().positive().max(200).optional(),
        start: z.string().optional(),
        order_by: z.string().optional(),
        property: z.array(z.string()).optional()
      }).strict()
    },
    async (args: any) => callOperation(getFragmentsOp, { query: args }, config, tokenManager)
  );

  server.registerTool(
    'get_fragment',
    {
      title: 'Get fragment',
      description: 'Fetch a content fragment by fragment ID.',
      inputSchema: z.object({ fragment_id: z.string().min(1) }).strict()
    },
    async (args: any) => callOperation(getFragmentOp, { path: { fragment_id: args.fragment_id } }, config, tokenManager)
  );

  server.registerTool(
    'create_fragment',
    {
      title: 'Create fragment',
      description: 'Create a content fragment with a flat body object matching the Adobe API.',
      inputSchema: z.object({
        body: z.record(z.string(), z.any())
      }).strict()
    },
    async (args: any) => callOperation(createFragmentOp, { body: args.body }, config, tokenManager)
  );

  server.registerTool(
    'publish_fragment',
    {
      title: 'Publish fragment',
      description: 'Publish a fragment by fragment ID.',
      inputSchema: z.object({ fragment_id: z.string().min(1) }).strict()
    },
    async (args: any) => callOperation(publishFragmentOp, { body: { fragmentId: args.fragment_id } }, config, tokenManager)
  );

  server.registerTool(
    'list_templates',
    {
      title: 'List templates',
      description: 'List content templates with simple flat arguments.',
      inputSchema: z.object({
        limit: z.number().int().positive().max(200).optional(),
        start: z.string().optional(),
        order_by: z.string().optional(),
        property: z.array(z.string()).optional()
      }).strict()
    },
    async (args: any) => callOperation(getTemplatesOp, { query: args }, config, tokenManager)
  );

  server.registerTool(
    'get_template',
    {
      title: 'Get template',
      description: 'Fetch a content template by template ID.',
      inputSchema: z.object({ template_id: z.string().min(1) }).strict()
    },
    async (args: any) => callOperation(getTemplateOp, { path: { template_id: args.template_id } }, config, tokenManager)
  );
}

async function main() {
  const config = loadConfig();
  const specPath = await resolveSpecPath(process.env.AJO_OPENAPI_SPEC_PATH ?? './spec/content-api.yaml');
  const spec = await loadOpenApiDocument(specPath);
  const operations = extractOperations(spec);
  const tokenManager = new AdobeTokenManager({
    apiKey: config.apiKey,
    clientSecret: config.clientSecret,
    scopes: config.scopes,
    tokenUrl: config.tokenUrl,
    tokenSkewSeconds: config.tokenSkewSeconds,
    timeoutMs: config.timeoutMs
  });

  const createServer = () => {
    const server = new McpServer(
      {
        name: 'ajo-content-api-mcp-server',
        version: '0.2.0',
        description: 'Adobe Journey Optimizer Content API MCP server'
      },
      {
        instructions: 'Use the tools to create, list, update, delete, and publish content templates and fragments.'
      }
    );

    const registerTool: any = server.registerTool.bind(server);
    const registerResource: any = (server as any).registerResource?.bind(server);

    if (registerResource) {
      registerResource(
        'server_overview',
        'overview://capabilities',
        {
          title: 'Server overview',
          description: 'High-level capabilities and Gemma-friendly guidance.'
        },
        async () => formatCompactJsonResult(buildOverviewResource(operations))
      );

      registerResource(
        'operation_index',
        'overview://operations',
        {
          title: 'Operation index',
          description: 'Compact list of generated API-backed tools.'
        },
        async () => formatCompactJsonResult(buildOperationsResource(operations))
      );

      registerResource(
        'usage_examples',
        'overview://examples',
        {
          title: 'Usage examples',
          description: 'Starter tool examples for local LLM clients.'
        },
        async () => formatCompactJsonResult(buildExamplesResource())
      );
    }

    registerWrapperTools(server, operations, config, tokenManager);

    for (const op of operations) {
      registerTool(
        toolNameForOperationId(op.operationId),
        {
          title: titleForOperation(op),
          description: descriptionForOperation(op),
          inputSchema: buildInputSchema(op),
          annotations: {
            title: titleForOperation(op),
            readOnlyHint: op.method === 'get',
            destructiveHint: op.method === 'delete',
            idempotentHint: op.method === 'get' || op.method === 'put' || op.method === 'delete'
          }
        },
        async (args: any) => callOperation(op, args, config, tokenManager)
      );
    }

    return server;
  };

  const transportMode = (process.env.MCP_TRANSPORT ?? 'http').trim().toLowerCase() as TransportMode;

  if (transportMode === 'stdio') {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);

    const shutdown = async () => {
      try {
        await server.close();
      } finally {
        process.exit(0);
      }
    };

    process.on('SIGINT', () => {
      void shutdown();
    });

    process.on('SIGTERM', () => {
      void shutdown();
    });

    return;
  }

  if (transportMode !== 'http') {
    throw new Error(`Unsupported MCP_TRANSPORT: ${transportMode}. Expected \"http\" or \"stdio\".`);
  }

  // If MCP should run over HTTP (streamable), create an Express app
  const MCP_PORT = Number(process.env.MCP_PORT ?? 3000);

  const app = createMcpExpressApp();

  type SessionState = {
    transport: StreamableHTTPServerTransport;
    server: McpServer;
  };

  const transports: Record<string, SessionState> = {};

  const mcpPostHandler = async (req: any, res: any) => {
    try {
      const sessionId = String(req.headers['mcp-session-id'] ?? '').trim() || undefined;

      // No session id and an initialization request: create a new transport and connect it
      if (!sessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID()
        });
        const server = createServer();

        transport.onclose = async () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            try {
              await transports[sid].transport.close();
            } catch {
              // ignore cleanup errors
            }
            delete transports[sid];
          }
        };

        transport.onerror = (error: any) => {
          console.error('Stream transport error for session', transport.sessionId, error);
        };

        // Connect transport to the MCP server before handling request so responses can flow back
        await server.connect(transport);
        // Handle the incoming initialization request
        await transport.handleRequest(req, res, req.body);
        // Store transport by its generated session id for subsequent requests
        if (transport.sessionId) transports[transport.sessionId] = { transport, server };
        return;
      }

      if (!sessionId) {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID provided' }, id: null });
        return;
      }

      const session = transports[sessionId];
      if (!session) {
        res.status(404).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Not Found: Unknown session ID' }, id: null });
        return;
      }

      await session.transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP POST request:', error);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  };

  const mcpGetHandler = async (req: any, res: any) => {
    const sessionId = String(req.headers['mcp-session-id'] ?? '').trim();
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    const transport = transports[sessionId].transport;
    await transport.handleRequest(req, res);
  };

  const mcpDeleteHandler = async (req: any, res: any) => {
    const sessionId = String(req.headers['mcp-session-id'] ?? '').trim();
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    try {
      const session = transports[sessionId];
      await session.transport.handleRequest(req, res);
      // Clean up the transport after session termination
      try { await session.transport.close(); } catch { /* ignore */ }
      delete transports[sessionId];
    } catch (error) {
      console.error('Error handling session termination:', error);
      if (!res.headersSent) res.status(500).send('Error processing session termination');
    }
  };

  app.post('/mcp', mcpPostHandler);
  app.get('/mcp', mcpGetHandler);
  app.delete('/mcp', mcpDeleteHandler);

  const serverInstance = app.listen(MCP_PORT, (err?: any) => {
    if (err) {
      console.error('Failed to start MCP HTTP server:', err);
      process.exit(1);
    }
    console.log(`MCP Streamable HTTP Server listening on port ${MCP_PORT}`);
  });

  process.on('SIGINT', async () => {
    console.log('Shutting down MCP server...');
    for (const sid of Object.keys(transports)) {
      try {
        await transports[sid].transport.close();
      } catch (e) {
        console.error(`Error closing transport ${sid}:`, e);
      }
      delete transports[sid];
    }
    serverInstance.close(() => process.exit(0));
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
