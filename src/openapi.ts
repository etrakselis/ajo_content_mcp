import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import * as z from 'zod/v4';

export type JsonSchema = Record<string, any>;

export type OpenApiDoc = {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: Array<{ url: string }>;
  paths?: Record<string, Record<string, any>>;
  components?: {
    parameters?: Record<string, any>;
    schemas?: Record<string, JsonSchema>;
    requestBodies?: Record<string, any>;
    responses?: Record<string, any>;
  };
};

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type ParameterDef = {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  schema?: JsonSchema;
  description?: string;
};

export type Operation = {
  operationId: string;
  method: HttpMethod;
  path: string;
  summary?: string;
  description?: string;
  parameters: ParameterDef[];
  requestBody?: {
    contentType: string;
    schema?: JsonSchema;
    required: boolean;
  };
  responseContentTypes: string[];
};

export type OperationDef = Operation;

const METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

export async function resolveSpecPath(specPath: string): Promise<string> {
  const abs = path.isAbsolute(specPath) ? specPath : path.resolve(process.cwd(), specPath);
  await fs.access(abs);
  return abs;
}

export async function loadOpenApiDocument(specPath: string): Promise<OpenApiDoc> {
  const raw = await fs.readFile(specPath, 'utf8');
  return YAML.parse(raw) as OpenApiDoc;
}

export function extractOperations(doc: OpenApiDoc): OperationDef[] {
  const ops: OperationDef[] = [];
  const components = doc.components ?? {};
  const paths = doc.paths ?? {};

  for (const [rawPath, pathItem] of Object.entries(paths)) {
    const pathParameters = resolveParameters(pathItem.parameters ?? [], components.parameters ?? {});

    for (const method of METHODS) {
      const op = pathItem[method];
      if (!op?.operationId) continue;

      const params = [...pathParameters, ...resolveParameters(op.parameters ?? [], components.parameters ?? {})];
      const requestBody = resolveRequestBody(op.requestBody, components.requestBodies ?? {}, components.schemas ?? {});
      const responseContentTypes = collectResponseContentTypes(op.responses ?? {}, components.responses ?? {});

      ops.push({
        operationId: op.operationId,
        method,
        path: rawPath,
        summary: op.summary,
        description: op.description,
        parameters: params,
        requestBody,
        responseContentTypes
      });
    }
  }

  return ops;
}

export function toolNameForOperationId(operationId: string): string {
  return operationId;
}

export function titleForOperation(op: OperationDef): string {
  return op.summary ?? op.operationId;
}

export function descriptionForOperation(op: OperationDef): string {
  const bodySummary = op.requestBody?.schema ? summarizeRequestSchema(op.requestBody.schema) : undefined;
  const requiredPath = op.parameters.filter((p) => p.in === 'path' && p.required).map((p) => p.name);
  const requiredQuery = op.parameters.filter((p) => p.in === 'query' && p.required).map((p) => p.name);
  const requiredHeaders = op.parameters.filter((p) => p.in === 'header' && p.required).map((p) => p.name);
  const requiredParts = [
    requiredPath.length ? `path: ${requiredPath.join(', ')}` : undefined,
    requiredQuery.length ? `query: ${requiredQuery.join(', ')}` : undefined,
    requiredHeaders.length ? `headers: ${requiredHeaders.join(', ')}` : undefined,
    op.requestBody?.required ? 'body: required' : undefined
  ].filter(Boolean);
  const parts = [
    op.summary ?? `${op.method.toUpperCase()} ${op.path}`,
    `Call ${op.method.toUpperCase()} ${op.path}.`,
    requiredParts.length ? `Required fields: ${requiredParts.join('; ')}` : 'Required fields: none',
    op.description?.replace(/\s+/g, ' ').trim(),
    bodySummary ? `Body shape: ${bodySummary}` : undefined
  ].filter(Boolean);

  return parts.join('\n\n');
}

export function buildInputSchema(op: OperationDef): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  const pathParams = op.parameters.filter((p) => p.in === 'path');
  const queryParams = op.parameters.filter((p) => p.in === 'query');
  const headerParams = op.parameters.filter((p) => p.in === 'header' && p.name.toLowerCase() === 'if-match');

  if (pathParams.length) {
    shape.path = z.object(objectShapeFromParameters(pathParams)).describe('Path parameters');
  }

  if (queryParams.length) {
    shape.query = z.object(objectShapeFromParameters(queryParams)).optional().describe('Query parameters');
  }

  if (headerParams.length) {
    const headerSchema = z.object(objectShapeFromParameters(headerParams)).describe('Additional request headers');
    shape.headers = headerParams.some((p) => p.required) ? headerSchema : headerSchema.optional();
  }

  if (op.requestBody) {
    const bodySchema = schemaFromJsonSchema(op.requestBody.schema ?? {}, {}).describe('Request body');
    shape.body = op.requestBody.required ? bodySchema : bodySchema.optional();
  }

  return z.object(shape).strict();
}

export function replacePathParams(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{([^}]+)\}/g, (_m, key) => {
    const value = params[key];
    if (value === undefined || value === null) {
      throw new Error(`Missing path parameter: ${key}`);
    }
    return encodeURIComponent(String(value));
  });
}

export function buildQueryString(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, String(entry));
    } else {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

export function denormalizeParameterObject(
  values: Record<string, unknown> | undefined,
  parameters: ParameterDef[],
): Record<string, unknown> | undefined {
  if (!values) return undefined;

  const result: Record<string, unknown> = {};
  const consumed = new Set<string>();
  for (const param of parameters) {
    const normalized = normalizeFieldName(param.name);
    if (Object.prototype.hasOwnProperty.call(values, param.name)) {
      result[param.name] = values[param.name];
      consumed.add(param.name);
    } else if (Object.prototype.hasOwnProperty.call(values, normalized)) {
      result[param.name] = values[normalized];
      consumed.add(normalized);
    }
  }

  for (const [key, value] of Object.entries(values)) {
    if (consumed.has(key) || Object.prototype.hasOwnProperty.call(result, key)) continue;
    result[key] = value;
  }

  return result;
}

export function chooseAcceptHeader(op: OperationDef): string {
  return preferJsonContentType(op.responseContentTypes) ?? op.requestBody?.contentType ?? 'application/json';
}

export function toRequestBody(body: unknown, contentType: string): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (contentType.includes('json') || contentType.includes('+json')) return JSON.stringify(body);
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

function resolveParameters(parameters: any[], componentParameters: Record<string, any>): ParameterDef[] {
  return parameters.map((parameter) => {
    const resolved = parameter.$ref ? componentParameters[parameter.$ref.split('/').pop() ?? ''] : parameter;
    if (!resolved) throw new Error(`Unable to resolve parameter: ${JSON.stringify(parameter)}`);
    return {
      name: resolved.name,
      in: resolved.in,
      required: Boolean(resolved.required),
      schema: resolved.schema,
      description: resolved.description
    };
  });
}

function resolveRequestBody(requestBody: any, componentRequestBodies: Record<string, any>, componentSchemas: Record<string, JsonSchema>): OperationDef['requestBody'] | undefined {
  if (!requestBody) return undefined;
  const resolved = requestBody.$ref ? componentRequestBodies[requestBody.$ref.split('/').pop() ?? ''] : requestBody;
  if (!resolved) return undefined;
  const entry = pickPreferredContentEntry(resolved.content ?? {});
  if (!entry) return undefined;
  const [contentType, mediaType] = entry as [string, any];
  const schema = mediaType?.schema ? prepareRequestSchema(mediaType.schema, componentSchemas) : undefined;
  return {
    contentType,
    schema,
    required: Boolean(resolved.required)
  };
}

function prepareRequestSchema(schema: JsonSchema, components: Record<string, JsonSchema>, expandDiscriminator = true): JsonSchema {
  const resolved = resolveSchemaReference(schema, components, new Set(), expandDiscriminator);
  return mergeAllOfSchema(resolved);
}

function collectResponseContentTypes(responses: Record<string, any>, componentResponses: Record<string, any>): string[] {
  const types = new Set<string>();
  for (const response of Object.values(responses)) {
    const resolved = response?.$ref ? componentResponses[response.$ref.split('/').pop() ?? ''] : response;
    for (const contentType of Object.keys(resolved?.content ?? {})) {
      types.add(contentType);
    }
  }
  return [...types];
}

function preferJsonContentType(contentTypes: string[]): string | undefined {
  return contentTypes.find((value) => value === 'application/json')
    ?? contentTypes.find((value) => value.includes('+json'))
    ?? contentTypes.find((value) => value.includes('json'))
    ?? contentTypes[0];
}

function pickPreferredContentEntry(content: Record<string, any>): [string, any] | undefined {
  const entries = Object.entries(content);
  if (!entries.length) return undefined;

  const preferredType = preferJsonContentType(entries.map(([contentType]) => contentType));
  return entries.find(([contentType]) => contentType === preferredType) as [string, any] | undefined;
}

function summarizeRequestSchema(schema: JsonSchema): string | undefined {
  if (!schema || typeof schema !== 'object') return undefined;

  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties = schema.properties && typeof schema.properties === 'object'
    ? Object.keys(schema.properties)
    : [];

  if (!properties.length) return undefined;

  const requiredText = required.length ? `Required fields: ${required.join(', ')}` : 'Required fields: none';
  const availableText = `Available fields: ${properties.join(', ')}`;

  const example = buildExampleFromSchema(schema);
  const exampleText = example ? `Example body: ${JSON.stringify(example)}` : undefined;

  return [requiredText, availableText, exampleText].filter(Boolean).join('\n');
}

function buildExampleFromSchema(schema: JsonSchema): unknown {
  if (!schema || typeof schema !== 'object') return undefined;

  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.oneOf?.length) return buildExampleFromSchema(schema.oneOf[0]);
  if (schema.anyOf?.length) return buildExampleFromSchema(schema.anyOf[0]);
  if (schema.allOf?.length) {
    const merged = mergeAllOfSchema(schema);
    return buildExampleFromSchema(merged);
  }

  switch (schema.type) {
    case 'object': {
      const properties = schema.properties ?? {};
      const required = new Set(Array.isArray(schema.required) ? schema.required : []);
      const entries = Object.entries(properties)
        .filter(([key]) => required.has(key))
        .map(([key, value]) => [key, buildExampleFromSchema(value as JsonSchema)]);
      return Object.fromEntries(entries);
    }
    case 'array':
      return schema.items ? [buildExampleFromSchema(schema.items)] : [];
    case 'string':
      return schema.format === 'date-time' ? '2026-06-08T00:00:00Z' : 'string';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      return undefined;
  }
}

function objectShapeFromParameters(parameters: ParameterDef[]): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const param of parameters) {
    const key = normalizeFieldName(param.name);
    const schema = schemaFromJsonSchema(param.schema ?? {}, {});
    shape[key] = param.required ? schema : schema.optional();
  }
  return shape;
}

function normalizeFieldName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/^_+|_+$/g, '').toLowerCase();
}

function resolveSchemaReference(
  schema: JsonSchema,
  components: Record<string, JsonSchema>,
  seen = new Set<string>(),
  expandDiscriminator = true,
): JsonSchema {
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.$ref) {
    const refName = schema.$ref.split('/').pop() ?? '';
    if (seen.has(refName)) return { type: 'object' };
    const resolved = components[refName];
    if (!resolved) return { type: 'object' };
    seen.add(refName);
    return resolveSchemaReference(resolved, components, seen, expandDiscriminator);
  }

  if (expandDiscriminator && schema.discriminator?.mapping) {
    return {
      oneOf: Object.values(schema.discriminator.mapping).map((ref) =>
        resolveSchemaReference({ $ref: ref }, components, new Set(), false),
      ),
    };
  }

  if (schema.items) {
    return { ...schema, items: resolveSchemaReference(schema.items, components, seen, expandDiscriminator) };
  }
  if (schema.properties) {
    const next: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      next[key] = resolveSchemaReference(value as JsonSchema, components, seen, expandDiscriminator);
    }
    return { ...schema, properties: next };
  }
  if (schema.oneOf) {
    return { ...schema, oneOf: schema.oneOf.map((item: JsonSchema) => resolveSchemaReference(item, components, seen, expandDiscriminator)) };
  }
  if (schema.anyOf) {
    return { ...schema, anyOf: schema.anyOf.map((item: JsonSchema) => resolveSchemaReference(item, components, seen, expandDiscriminator)) };
  }
  if (schema.allOf) {
    return { ...schema, allOf: schema.allOf.map((item: JsonSchema) => resolveSchemaReference(item, components, seen, expandDiscriminator)) };
  }
  return schema;
}

function mergeAllOfSchema(schema: JsonSchema): JsonSchema {
  if (!schema || typeof schema !== 'object') return schema;

  const mapped = mapNestedSchemas(schema);
  if (!mapped.allOf?.length) return mapped;

  const merged: JsonSchema = {
    ...mapped,
    type: mapped.type ?? 'object',
    properties: { ...(mapped.properties ?? {}) },
    required: [...(mapped.required ?? [])],
  };
  delete merged.allOf;

  for (const item of mapped.allOf) {
    const part = mergeAllOfSchema(item);
    if (part.type && !merged.type) merged.type = part.type;
    merged.properties = { ...(merged.properties ?? {}), ...(part.properties ?? {}) };
    merged.required = [...new Set([...(merged.required ?? []), ...(part.required ?? [])])];

    if (part.additionalProperties !== undefined) {
      merged.additionalProperties = part.additionalProperties;
    }
  }

  return merged;
}

function mapNestedSchemas(schema: JsonSchema): JsonSchema {
  if (!schema || typeof schema !== 'object') return schema;

  const next = { ...schema };
  if (next.items) next.items = mergeAllOfSchema(next.items);
  if (next.properties) {
    next.properties = Object.fromEntries(
      Object.entries(next.properties).map(([key, value]) => [key, mergeAllOfSchema(value as JsonSchema)]),
    );
  }
  if (next.oneOf) next.oneOf = next.oneOf.map((item: JsonSchema) => mergeAllOfSchema(item));
  if (next.anyOf) next.anyOf = next.anyOf.map((item: JsonSchema) => mergeAllOfSchema(item));
  if (next.allOf) next.allOf = next.allOf.map((item: JsonSchema) => mergeAllOfSchema(item));
  return next;
}

export function schemaFromJsonSchema(schema: JsonSchema, components: Record<string, JsonSchema>): z.ZodTypeAny {
  const resolved = resolveSchemaReference(schema ?? {}, components);
  if (!resolved || Object.keys(resolved).length === 0) return z.any();

  if (resolved.enum) {
    const values = resolved.enum as [string, ...string[]];
    return z.enum(values);
  }

  if (resolved.const !== undefined) {
    return z.literal(resolved.const);
  }

  if (resolved.oneOf?.length) {
    const parts = resolved.oneOf.map((item: JsonSchema) => schemaFromJsonSchema(item, components));
    return parts.length === 1 ? parts[0] : z.union(parts as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }

  if (resolved.anyOf?.length) {
    const parts = resolved.anyOf.map((item: JsonSchema) => schemaFromJsonSchema(item, components));
    return parts.length === 1 ? parts[0] : z.union(parts as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }

  if (resolved.allOf?.length) {
    const parts = resolved.allOf.map((item: JsonSchema) => schemaFromJsonSchema(item, components));
    let merged = parts[0] ?? z.any();
    for (const part of parts.slice(1)) {
      merged = z.intersection(merged as any, part as any) as any;
    }
    return merged;
  }

  const nullable = Boolean(resolved.nullable);
  let result: z.ZodTypeAny;

  switch (resolved.type) {
    case 'string':
      result = z.string();
      if (resolved.format === 'date-time') result = z.string().datetime();
      else if (resolved.format === 'date') result = z.string().date();
      break;
    case 'integer':
    case 'number':
      result = z.number();
      break;
    case 'boolean':
      result = z.boolean();
      break;
    case 'array':
      result = z.array(schemaFromJsonSchema(resolved.items ?? {}, components));
      break;
    case 'object': {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, value] of Object.entries(resolved.properties ?? {})) {
        const child = schemaFromJsonSchema(value as JsonSchema, components);
        const required = Array.isArray(resolved.required) && resolved.required.includes(key);
        shape[key] = required ? child : child.optional();
      }
      let objectSchema = z.object(shape);
      if (resolved.additionalProperties && typeof resolved.additionalProperties === 'object') {
        objectSchema = objectSchema.catchall(schemaFromJsonSchema(resolved.additionalProperties as JsonSchema, components));
      } else if (resolved.additionalProperties === true) {
        objectSchema = objectSchema.catchall(z.any());
      } else {
        objectSchema = objectSchema.strict();
      }
      result = objectSchema;
      break;
    }
    default:
      result = z.any();
  }

  return nullable ? result.nullable() : result;
}
