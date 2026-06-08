import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { AdobeTokenManager } from './auth.js';
import { formatSuccessResult } from './result-format.js';
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
              await transports[sid].server.close();
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
      try { await session.server.close(); } catch { /* ignore */ }
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
      try {
        await transports[sid].server.close();
      } catch (e) {
        console.error(`Error closing server for session ${sid}:`, e);
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
