/**
 * Engineering Command Center MCP server factory.
 *
 * Uses @modelcontextprotocol/ext-apps (MCP-Apps standard) so the widget renders
 * via host postMessage in M365 Copilot chat. Tools return:
 *   - structuredContent: payload the widget consumes via app.ontoolresult
 *   - _meta.ui.resourceUri: tells the host which widget HTML to render
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { fetchEngineeringData, validateCredentials, type EngineeringData } from "./ado.js";
import { demoData } from "./demo.js";
import * as store from "./store.js";
import { getPublicServerUrl } from "./index.js";

// ─── Widget HTML loader ────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, "..", "..", "assets");

function readWidgetHtml(componentName: string): string {
  const directPath = path.join(ASSETS_DIR, `${componentName}.html`);
  if (!fs.existsSync(directPath)) {
    throw new Error(
      `Widget assets not found at ${directPath}. Run "npm run build:widgets" first.`
    );
  }
  let html = fs.readFileSync(directPath, "utf8");

  // Inject public server URL so the widget knows where it lives (for diagnostics).
  // The widget itself does NOT make fetch() calls — all server data flows through
  // host postMessage. This is here purely for display in widget status footers.
  const serverUrl = getPublicServerUrl();
  const injection = `<script>window.__SERVER_BASE_URL__=${JSON.stringify(serverUrl)};</script>`;
  html = html.replace("<head>", `<head>${injection}`);
  return html;
}

// ─── Widget URI ────────────────────────────────────────────────────
const DASHBOARD_URI = "ui://engineering-command-center/dashboard.html";

// ─── Credential resolution ─────────────────────────────────────────
function resolveCreds() {
  const s = store.get();
  const envOrg = process.env.ADO_ORG ?? "";
  const envPat = process.env.ADO_PAT ?? "";
  const envProject = process.env.ADO_PROJECT ?? "MetaOS";

  if (s && s.pat) {
    return {
      org: s.org,
      project: s.project || envProject,
      creds: { pat: s.pat },
      connected: true as const,
    };
  }
  if (envPat && envOrg) {
    return {
      org: envOrg,
      project: envProject,
      creds: { pat: envPat },
      connected: true as const,
    };
  }
  return {
    org: envOrg,
    project: envProject,
    creds: {} as { pat?: string },
    connected: false as const,
  };
}

// ─── Build dashboard payload ───────────────────────────────────────
interface DashboardPayload {
  data: EngineeringData;
  live: boolean;
  org: string;
  project: string;
  reason?: string;
}

async function buildDashboardPayload(forceDemo = false): Promise<DashboardPayload> {
  const { org, project, creds, connected } = resolveCreds();
  if (forceDemo || !connected || !creds.pat || !org) {
    return {
      data: demoData(project),
      live: false,
      org,
      project,
      reason: forceDemo ? "demo-requested" : "not-connected",
    };
  }
  try {
    const data = await fetchEngineeringData(org, project, creds);
    return { data, live: true, org, project };
  } catch (err: any) {
    console.warn(`[render] live fetch failed for ${org}/${project}: ${err.message}`);
    return {
      data: demoData(project),
      live: false,
      org,
      project,
      reason: `live-fetch-error: ${err.message}`,
    };
  }
}

// ─── Server factory ────────────────────────────────────────────────
export function createCommandCenterServer(): McpServer {
  const server = new McpServer({ name: "engineering-command-center", version: "1.0.0" });

  // Widget HTML resource — registered so the host can fetch it via resources/read
  // when rendering the iframe for any tool that declares _meta.ui.resourceUri.
  registerAppResource(
    server,
    "Engineering Command Center Dashboard",
    DASHBOARD_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Interactive dashboard: work items, pull requests, and pipeline runs.",
    },
    async () => ({
      contents: [
        {
          uri: DASHBOARD_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: readWidgetHtml("dashboard"),
        },
      ],
    })
  );

  // ─── Tool: show_engineering_dashboard ───
  registerAppTool(
    server,
    "show_engineering_dashboard",
    {
      title: "Show Engineering Command Center",
      description:
        "Render the Engineering Command Center dashboard for the MetaOS project. " +
        "Shows the user's active work items, pull requests awaiting review, and recent " +
        "pipeline runs. If Azure DevOps credentials are not yet configured, the dashboard " +
        "displays demo data and includes a Connect form so the user can supply a PAT.",
      inputSchema: {
        forceDemo: z
          .boolean()
          .optional()
          .describe("When true, force demo data even if a PAT is stored."),
      },
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: DASHBOARD_URI } },
    },
    async ({ forceDemo }) => {
      const payload = await buildDashboardPayload(!!forceDemo);
      const summary = payload.live
        ? `Live ${payload.org}/${payload.project}: ${payload.data.workItems.length} work items, ${payload.data.pullRequests.length} PRs, ${payload.data.builds.length} builds.`
        : `Demo data (${payload.reason}): ${payload.data.workItems.length} work items, ${payload.data.pullRequests.length} PRs, ${payload.data.builds.length} builds.`;

      return {
        content: [{ type: "text" as const, text: summary }],
        structuredContent: payload,
        _meta: { ui: { resourceUri: DASHBOARD_URI } },
      };
    }
  );

  // ─── Tool: connect_azure_devops ───
  registerAppTool(
    server,
    "connect_azure_devops",
    {
      title: "Connect Azure DevOps",
      description:
        "Validate and store an Azure DevOps Personal Access Token so the dashboard can " +
        "load live data. Called by the widget Connect form via app.callServerTool. " +
        "Required PAT scopes: Work Items (Read), Code (Read), Build (Read).",
      inputSchema: {
        org: z.string().describe("Azure DevOps organization name, e.g. 'msazure'."),
        project: z.string().optional().describe("Project name (defaults to MetaOS)."),
        pat: z.string().describe("Personal Access Token."),
      },
      annotations: { readOnlyHint: false },
      _meta: { ui: { resourceUri: DASHBOARD_URI } },
    },
    async ({ org, project, pat }) => {
      const proj = project || process.env.ADO_PROJECT || "MetaOS";
      const result = await validateCredentials(org, proj, { pat });
      if (!result.ok) {
        const payload = await buildDashboardPayload(true);
        return {
          content: [{ type: "text" as const, text: `Connect failed: ${result.error}` }],
          structuredContent: { ...payload, connectError: result.error },
          _meta: { ui: { resourceUri: DASHBOARD_URI } },
          isError: true,
        };
      }
      store.set({ org, project: proj, pat });
      const payload = await buildDashboardPayload(false);
      return {
        content: [
          { type: "text" as const, text: `Connected to Azure DevOps ${org}/${proj}.` },
        ],
        structuredContent: { ...payload, connectOk: true },
        _meta: { ui: { resourceUri: DASHBOARD_URI } },
      };
    }
  );

  // ─── Tool: disconnect_azure_devops ───
  registerAppTool(
    server,
    "disconnect_azure_devops",
    {
      title: "Disconnect Azure DevOps",
      description:
        "Clear the stored Azure DevOps PAT so the dashboard returns to demo mode and " +
        "the Connect form is shown again.",
      inputSchema: {},
      annotations: { readOnlyHint: false },
      _meta: { ui: { resourceUri: DASHBOARD_URI } },
    },
    async () => {
      store.clear();
      const payload = await buildDashboardPayload(false);
      return {
        content: [{ type: "text" as const, text: "Disconnected from Azure DevOps." }],
        structuredContent: { ...payload, disconnected: true },
        _meta: { ui: { resourceUri: DASHBOARD_URI } },
      };
    }
  );

  return server;
}
