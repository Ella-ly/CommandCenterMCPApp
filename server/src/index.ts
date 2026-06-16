/**
 * Engineering Command Center MCP server — Express + Streamable HTTP transport.
 *
 * Stateless mode: each /mcp request creates a fresh server + transport.
 * Mirrors the trey-research / expense-submission pattern.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createCommandCenterServer } from "./mcp-server.js";
import * as store from "./store.js";

// ─── Tiny .env loader (works on Node 18; no extra deps) ─────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadDotEnv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
})();

const PORT = parseInt(process.env.PORT ?? "8788", 10);

const app = express();

// ─── Origin allowlist ────────────────────────────────────────────────
const STATIC_ALLOWED_ORIGINS: string[] = [
  "http://localhost",
  "http://127.0.0.1",
  "https://localhost",
  "https://127.0.0.1",
  "vscode-webview://",
  // M365 Copilot / Office surfaces
  ".widgetcopilot.net",
  ".microsoft.com",
  ".cloud.microsoft",
  ".office.com",
  ".office365.com",
  ".sharepoint.com",
  ".live.com",
  ".microsoft365.com",
  ".teams.microsoft.com",
  // Tunnels
  ".devtunnels.ms",
  ".ngrok-free.app",
  ".ngrok.io",
  ".loca.lt",
  ".trycloudflare.com",
  // ChatGPT (compat)
  ".chatgpt.com",
  ".openai.com",
];

function buildAllowedOrigins(): string[] {
  const origins = [...STATIC_ALLOWED_ORIGINS];
  const serverBase = process.env.SERVER_BASE_URL;
  if (serverBase) {
    try {
      const u = new URL(serverBase);
      origins.push(u.origin);
      origins.push(`.${u.hostname}`);
    } catch {
      /* ignore */
    }
  }
  const extra = process.env.ADDITIONAL_ALLOWED_ORIGINS;
  if (extra) {
    for (const raw of extra.split(",")) {
      const trimmed = raw.trim();
      if (trimmed) origins.push(trimmed);
    }
  }
  return origins;
}

const ALLOWED_ORIGINS = buildAllowedOrigins();

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin || origin === "null") return true;
  for (const entry of ALLOWED_ORIGINS) {
    if (entry.endsWith("://") && origin.startsWith(entry)) return true;
    if (
      (entry === "http://localhost" || entry === "https://localhost") &&
      origin.startsWith(entry)
    )
      return true;
    if (
      (entry === "http://127.0.0.1" || entry === "https://127.0.0.1") &&
      origin.startsWith(entry)
    )
      return true;
    if (entry.startsWith(".")) {
      try {
        const hostname = new URL(origin).hostname;
        if (hostname.endsWith(entry) || hostname === entry.slice(1)) return true;
      } catch {
        /* ignore */
      }
      continue;
    }
    if (origin === entry) return true;
  }
  return false;
}

export function getPublicServerUrl(): string {
  const base = process.env.SERVER_BASE_URL;
  if (base) return base.replace(/\/+$/, "");
  return `http://localhost:${PORT}`;
}

// ─── CORS ────────────────────────────────────────────────────────────
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, origin ?? true);
    } else {
      console.warn(`CORS: blocked origin "${origin}"`);
      callback(null, false);
    }
  },
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Accept",
    "Mcp-Session-Id",
    "mcp-session-id",
    "Last-Event-ID",
    "Mcp-Protocol-Version",
    "mcp-protocol-version",
  ],
  exposedHeaders: ["Mcp-Session-Id"],
  credentials: false,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "4mb" }));

// ─── Request logger ──────────────────────────────────────────────────
// Logs every /mcp call with the RPC method + tool name for live debugging.
app.use((req, res, next) => {
  const start = Date.now();
  let detail = "";
  if (req.method === "POST" && req.path === "/mcp" && req.body) {
    const body: any = req.body;
    const method = body?.method;
    if (method === "tools/call") {
      detail = ` rpc:tools/call tool:${body?.params?.name}`;
    } else if (typeof method === "string") {
      detail = ` rpc:${method}`;
    }
  }
  res.on("finish", () => {
    const ms = Date.now() - start;
    const ts = new Date().toLocaleTimeString();
    console.log(`${ts}  ${res.statusCode}  ${req.method} ${req.path}${detail}  ${ms}ms`);
  });
  next();
});

// ─── Friendly status page ────────────────────────────────────────────
app.get("/", (req: Request, res: Response) => {
  const s = store.get();
  const connected = !!(s && s.pat) || !!(process.env.ADO_PAT && process.env.ADO_ORG);
  const project = (s && s.project) || process.env.ADO_PROJECT || "MetaOS";
  const payload = {
    name: "engineering-command-center",
    status: "ok",
    transport: "streamable-http",
    mcp_endpoint: "/mcp",
    base_url: getPublicServerUrl(),
    connected,
    project,
    tools: [
      "show_engineering_dashboard",
      "connect_azure_devops",
      "disconnect_azure_devops",
    ],
  };
  const wantsHtml = (req.headers["accept"] || "").includes("text/html");
  if (!wantsHtml) {
    res.json(payload);
    return;
  }
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8">
<title>Engineering Command Center · MCP server</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:"Segoe UI",system-ui,sans-serif;color:#242424;background:#faf9f8;}
  .card{text-align:center;background:#fff;border:1px solid #edebe9;border-radius:16px;
    padding:40px 48px;max-width:520px;box-shadow:0 8px 30px rgba(0,0,0,.06);}
  .emoji{font-size:56px;}
  h1{font-size:22px;margin:14px 0 6px;}
  .pill{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;
    background:rgba(16,124,16,.15);color:#107c10;padding:5px 14px;border-radius:999px;margin:6px 0 14px;}
  .pulse{width:9px;height:9px;border-radius:50%;background:#107c10;animation:p 1.6s infinite;}
  @keyframes p{0%,100%{opacity:1}50%{opacity:.35}}
  p{font-size:14px;color:#605e5c;margin:8px 0;}
  .meta{font-size:12px;color:#8a8886;margin-top:18px;}
  code{background:#f3f2f1;padding:2px 7px;border-radius:6px;font-size:12px;}
</style></head>
<body><div class="card">
  <div class="emoji">👋 ⚙️</div>
  <h1>Engineering Command Center MCP server</h1>
  <div class="pill"><span class="pulse"></span> online · MCP-Apps SDK</div>
  <p>Backend for the Azure DevOps dashboard widget in M365 Copilot.</p>
  <p>ADO: <b>${connected ? "connected" : "not connected yet"}</b> · project <b>${project}</b></p>
  <div class="meta">
    MCP endpoint: <code>${getPublicServerUrl()}/mcp</code><br>
    Tools: show_engineering_dashboard · connect_azure_devops · disconnect_azure_devops
  </div>
</div></body></html>`);
});

// ─── Health ──────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ─── MCP Streamable HTTP ─────────────────────────────────────────────
async function handleMcp(req: Request, res: Response): Promise<void> {
  try {
    const server = createCommandCenterServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}

app.post("/mcp", handleMcp);
app.get("/mcp", handleMcp);
app.delete("/mcp", handleMcp);

// ─── Boot ────────────────────────────────────────────────────────────
store.load();

app.listen(PORT, () => {
  const pub = getPublicServerUrl();
  console.log(`\n  Engineering Command Center MCP server`);
  console.log(`  Transport: Streamable HTTP (stateless)`);
  console.log(`  Local:     http://localhost:${PORT}`);
  console.log(`  Public:    ${pub}/mcp`);
  const s = store.get();
  console.log(
    `  Connection: ${
      s && s.pat
        ? `stored PAT for ${s.org}/${s.project}`
        : process.env.ADO_PAT && process.env.ADO_ORG
        ? `env PAT for ${process.env.ADO_ORG}`
        : "not connected (Connect tool will prompt)"
    }\n`
  );
});
