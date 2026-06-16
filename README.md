# Engineering Command Center (MCP Apps)

Rebuilt version of `CommandCenterMCP` using the **MCP-Apps SDK**
(`@modelcontextprotocol/ext-apps`). The widget receives data via host
`postMessage` instead of HTTP fetch, so it works inside M365 Copilot's
sandboxed `mcpWidget` iframe.

```
.
├── server/        Express + Streamable HTTP MCP server (TypeScript, tsx)
├── widgets/       React + Fluent UI v9 widgets, built to single-file HTML by Vite
├── assets/        Built widget HTML — read by the server as MCP resources
├── appPackage/    Teams manifest, declarativeAgent.json, ai-plugin.json
└── dist/          Sideload zip
```

## Architecture

- Server registers each tool with `_meta.ui.resourceUri` pointing at
  `ui://engineering-command-center/dashboard.html`.
- Server registers that URI as an MCP resource whose content is the
  single-file widget HTML built by Vite.
- Tools return `structuredContent` with `{data, live, org, project, ...}`.
- Widget uses `useApp()` from `@modelcontextprotocol/ext-apps/react`,
  reads structuredContent via `app.ontoolresult`, calls back via
  `app.callServerTool({name, arguments})`.

## Tools

| name | purpose |
| --- | --- |
| `show_engineering_dashboard` | Render dashboard; shows Connect form if no PAT |
| `connect_azure_devops` | Validate + store PAT (called from widget Connect button) |
| `disconnect_azure_devops` | Clear PAT, return to demo mode |

## Quickstart (clone → run → tunnel → zip)

```bash
# 1. Clone
git clone https://github.com/Ella-ly/CommandCenterMCPApp.git
cd CommandCenterMCPApp

# 2. Install dependencies (root + server + widgets)
npm run install:all

# 3. Build the widget → generates assets/dashboard.html (REQUIRED)
#    assets/ is git-ignored (build output), so you MUST build after cloning,
#    otherwise the server has no widget HTML to serve.
npm run build:widgets

# 4. Configure env
cp server/.env.example server/.env

# 5. Start the server (Terminal A — keep it running)
npm start                                  # → http://localhost:8788

# 6. Start a tunnel (Terminal B — keep it running)
cloudflared tunnel --url http://localhost:8788
#   Note the printed https://xxx.trycloudflare.com URL.

# 7. Wire the tunnel URL into two places, then restart the server (Terminal A):
#    - appPackage/ai-plugin.json → runtimes[0].spec.url = https://xxx.trycloudflare.com/mcp
#    - server/.env               → SERVER_BASE_URL=https://xxx.trycloudflare.com

# 8. Package the sideload zip
cd appPackage && zip -r ../dist/EngineeringCommandCenterApp.zip . -x '*.DS_Store'
#    → dist/EngineeringCommandCenterApp.zip
```

Then upload `dist/EngineeringCommandCenterApp.zip` in Copilot → Agents → Add app from file.

> Note: cloudflared quick tunnels are ephemeral — the URL changes on every
> restart. Re-do step 7 (and re-zip) whenever the tunnel URL changes.


## Smoke test

```bash
# initialize
curl -s -X POST http://localhost:8788/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}'

# list tools — every tool should carry _meta.ui.resourceUri
curl -s -X POST http://localhost:8788/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# call dashboard tool — should return structuredContent
curl -s -X POST http://localhost:8788/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"show_engineering_dashboard","arguments":{}}}'
```
