import * as z from 'zod/v4';
export type JsonSchema = Record<string, any>;
export type OpenApiDoc = {
    openapi?: string;
    info?: {
        title?: string;
        version?: string;
        description?: string;
    };
    servers?: Array<{
        url: string;
    }>;
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
export declare function resolveSpecPath(specPath: string): Promise<string>;
export declare function loadOpenApiDocument(specPath: string): Promise<OpenApiDoc>;
export declare function extractOperations(doc: OpenApiDoc): OperationDef[];
export declare function toolNameForOperationId(operationId: string): string;
export declare function titleForOperation(op: OperationDef): string;
export declare function descriptionForOperation(op: OperationDef): string;
export declare function buildInputSchema(op: OperationDef): z.ZodTypeAny;
export declare function replacePathParams(template: string, params: Record<string, unknown>): string;
export declare function buildQueryString(query: Record<string, unknown> | undefined): string;
export declare function denormalizeParameterObject(values: Record<string, unknown> | undefined, parameters: ParameterDef[]): Record<string, unknown> | undefined;
export declare function chooseAcceptHeader(op: OperationDef): string;
type RequestBodyValue = string | Uint8Array;
export declare function toRequestBody(body: unknown, contentType: string): RequestBodyValue | undefined;
export declare function schemaFromJsonSchema(schema: JsonSchema, components: Record<string, JsonSchema>): z.ZodTypeAny;
export {};
