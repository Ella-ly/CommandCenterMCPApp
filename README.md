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

## Run locally

```bash
cd widgets && npm install && npm run build  # → assets/dashboard.html
cd ../server && npm install
cp .env.example .env
npm start                                    # → http://localhost:8788
```

## Sideload to M365 Copilot

1. Expose 8788 publicly (cloudflared, devtunnel, ngrok).
2. Edit `appPackage/ai-plugin.json` → `runtimes[0].spec.url` to `https://…/mcp`.
3. Edit `server/.env` → `SERVER_BASE_URL=https://…`.
4. Restart server.
5. `cd appPackage && zip -r ../dist/EngineeringCommandCenterApp.zip .`
6. Upload zip in Copilot → Agents → Add app from file.

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
