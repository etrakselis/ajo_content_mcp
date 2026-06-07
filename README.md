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
