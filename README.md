# Adobe Journey Optimizer Content API MCP server

## Recommended workspace layout

```text
my-workspace/
├── config/
│   └── credentials.json
├── docker-compose.yml
└── ajo-content-mcp-server/
    ├── Dockerfile
    └── ...
```

Place the exported Adobe environment JSON at `config/credentials.json` and create a small `config/settings.json` for the sandbox name. Mount `./config` into the container.


## Dedicated settings file

Create `config/settings.json` like this:

```json
{
  "sandboxName": "dev"
}
```

The container reads this file by default from `/app/config/settings.json` and uses it to populate `AJO_SANDBOX_NAME`.

You can override the path with:

```bash
AJO_SETTINGS_FILE=/custom/path/settings.json
```

## Behavior

At startup, the container:

1. Looks for `/app/config/settings.json` and loads the sandbox name.
2. Looks for `/app/config/credentials.json` and loads the Adobe credentials.
3. Converts those JSON files into generated env files.
4. Sources the generated env files.
5. Starts the MCP server.

You can override the JSON path with:

```bash
AJO_CREDENTIALS_FILE=/custom/path/credentials.json
```

The example JSON file you shared contains keys such as `CLIENT_SECRET`, `API_KEY`, `ACCESS_TOKEN`, `SCOPES`, `TECHNICAL_ACCOUNT_ID`, `IMS`, and `IMS_ORG`. The loader maps those into the internal `AJO_*` variables used by the app. fileciteturn0file0

## Build

```bash
docker build -t ajo-content-api-mcp-server .
```

## Run

```bash
docker run --rm -it \
  -v "$(pwd)/config:/app/config:ro" \
  ajo-content-api-mcp-server
```

## Docker Compose

```yaml
services:
  ajo-content-mcp:
    build: .
    image: ajo-content-api-mcp-server
    volumes:
      - ./config:/app/config:ro
```

With this layout, `credentials.json` and `settings.json` both live under the same mounted folder.

## Available Tools for LLM Integration

This MCP server exposes the following tools to LLMs for managing Adobe Journey Optimizer content templates and fragments:

### Content Template Tools

#### `createTemplate`
Create a new content template for use in campaigns and journeys.
- **Input**: Template name, description, channel type, and content
- **Output**: Created template with auto-generated ID and metadata
- **Hint**: Destructive operation

#### `getTemplates`
List all available content templates with optional filtering and pagination.
- **Input**: Optional filters (by name, channel, template type, creation date, etc.), pagination params
- **Output**: Paginated list of template summaries
- **Hint**: Read-only operation

#### `getTemplate`
Fetch a specific content template by ID with full details.
- **Input**: Template ID, Accept header
- **Output**: Complete template details including audit information and ETag
- **Hint**: Read-only operation

#### `putTemplate`
Update an existing content template by ID.
- **Input**: Template ID, updated template payload, If-Match header (ETag for concurrency)
- **Output**: HTTP 204 No Content (success indicator)
- **Hint**: Idempotent operation

#### `deleteTemplate`
Delete a content template by ID.
- **Input**: Template ID
- **Output**: HTTP 204 No Content (success indicator)
- **Hint**: Destructive operation

#### `patchTemplate`
Patch specific fields of a content template using JSON Patch format (RFC 6902).
- **Input**: Template ID, JSON Patch operations, If-Match header
- **Output**: Updated template with new ETag
- **Supported paths**: `/name`, `/description`, `/parentFolderId`
- **Hint**: Idempotent operation

### Content Fragment Tools

#### `createFragment`
Create a new reusable content fragment.
- **Input**: Fragment name, description, channel type, and content
- **Output**: Created fragment with auto-generated ID and metadata
- **Hint**: Destructive operation

#### `getFragments`
List all available content fragments with optional filtering and pagination.
- **Input**: Optional filters (by name, channel, fragment type, creation date, etc.), pagination params
- **Output**: Paginated list of fragment summaries
- **Hint**: Read-only operation

#### `getFragment`
Fetch a specific content fragment by ID with full details.
- **Input**: Fragment ID, Accept header
- **Output**: Complete fragment details including audit information and ETag
- **Hint**: Read-only operation

#### `putFragment`
Update an existing content fragment by ID.
- **Input**: Fragment ID, updated fragment payload, If-Match header (ETag for concurrency)
- **Output**: HTTP 204 No Content (success indicator)
- **Hint**: Idempotent operation

#### `patchFragment`
Patch specific fields of a content fragment using JSON Patch format (RFC 6902).
- **Input**: Fragment ID, JSON Patch operations, If-Match header
- **Output**: HTTP 204 No Content (success indicator)
- **Supported paths**: `/name`, `/description`, `/parentFolderId`
- **Hint**: Idempotent operation

#### `publishFragment`
Publish a content fragment to freeze its content and make it available for use in campaigns/journeys.
- **Input**: Fragment ID, publication request
- **Output**: HTTP 202 Accepted (async operation)
- **Note**: Publishing is asynchronous and may take a few seconds to complete
- **Hint**: Destructive operation

#### `getLiveFragment`
Fetch the content of a fragment's last successful publication.
- **Input**: Fragment ID
- **Output**: Published fragment content ready for use
- **Note**: Returns the frozen content from the most recent successful publication
- **Hint**: Read-only operation

#### `getLastPublicationStatus`
Fetch the status of the last publication request for a fragment.
- **Input**: Fragment ID
- **Output**: Publication status (successful, in progress, or error)
- **Note**: Use this to check async publication progress
- **Hint**: Read-only operation

## Tool Usage Notes

- **Authentication**: All tools are automatically authenticated using the credentials loaded from `config/credentials.json`
- **Sandbox Context**: All operations are scoped to the sandbox specified in `config/settings.json`
- **Request Tracking**: Each request includes a unique `x-request-id` header for tracing
- **Concurrency Control**: Update operations (`put`, `patch`) use ETags for optimistic concurrency control
- **Async Operations**: Publication operations are asynchronous; use `getLastPublicationStatus` to monitor progress
- **Filtering**: List operations support powerful filtering by various attributes (name regex, date ranges, creation info, etc.)
- **Pagination**: List operations support limit and offset-based pagination via `limit` and `start` parameters
