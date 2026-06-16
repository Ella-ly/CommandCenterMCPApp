/**
 * Engineering Command Center Dashboard widget.
 *
 * - When no PAT is configured (toolData.live === false because reason === "not-connected"):
 *   shows a Connect card (Org / Project / PAT inputs + Connect button + "Preview demo" button).
 * - Once connected (or in demo mode after preview): shows the dashboard with
 *   work items, pull requests, and pipeline runs, plus a Disconnect action.
 *
 * Data flow (NO http fetch from the widget — Copilot's sandbox blocks it):
 *   Host calls MCP tool → response contains structuredContent →
 *   useApp() hook → useMcpToolData() → React state.
 *   Button clicks → app.callServerTool({name, arguments}) → another tool result postMessaged in.
 */
import React, { useMemo, useState } from "react";
import {
  Badge,
  Body1,
  Body1Strong,
  Button,
  Caption1,
  Card,
  Divider,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Subtitle2,
  Title3,
  makeStyles,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkCircleFilled,
  PlugConnectedFilled,
  PlugDisconnectedFilled,
  ArrowSyncFilled,
  WarningFilled,
  ErrorCircleFilled,
} from "@fluentui/react-icons";
import { useMcpApp, useMcpToolData } from "../hooks/useMcpApp";

// ─── Types matching server's structuredContent ────────────────────
interface WorkItem {
  id: number;
  title: string;
  state: string;
  type: string;
  assignedTo?: string;
  iterationPath?: string;
  url?: string;
}
interface PullRequest {
  id: number;
  title: string;
  status: string;
  createdBy?: string;
  repository?: string;
  url?: string;
}
interface Build {
  id: number;
  buildNumber: string;
  status: string;
  result?: string;
  definition?: string;
  url?: string;
  finishTime?: string;
}
interface EngineeringData {
  workItems: WorkItem[];
  pullRequests: PullRequest[];
  builds: Build[];
}
interface DashboardPayload {
  data: EngineeringData;
  live: boolean;
  org: string;
  project: string;
  reason?: string;
  connectError?: string;
  connectOk?: boolean;
  disconnected?: boolean;
}

// ─── Styles ───────────────────────────────────────────────────────
const useStyles = makeStyles({
  root: {
    boxSizing: "border-box",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    rowGap: "16px",
    fontFamily: tokens.fontFamilyBase,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: "12px",
    flexWrap: "wrap",
    rowGap: "8px",
  },
  headerLeft: { display: "flex", flexDirection: "column", rowGap: "2px" },
  headerActions: { display: "flex", alignItems: "center", columnGap: "8px" },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "16px",
  },
  card: {
    ...shorthands.padding("16px"),
    display: "flex",
    flexDirection: "column",
    rowGap: "10px",
  },
  cardTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: "8px",
    width: "100%",
  },
  // Fluent v9 <Divider /> defaults to flex-grow:1, which makes it eat all the
  // extra vertical space when the Card is stretched to match a taller sibling
  // card in the grid row — creating a huge blank gap between the title and
  // the list. Pin it so it just sits under the title.
  divider: { flexGrow: 0, flexShrink: 0 },
  list: {
    display: "flex",
    flexDirection: "column",
    rowGap: "10px",
    // Absorb any remaining vertical space inside a stretched Card so it falls
    // below the last item rather than between the title and the first item.
    flexGrow: 1,
  },
  listItem: {
    display: "flex",
    flexDirection: "column",
    rowGap: "4px",
    ...shorthands.padding("10px", "12px"),
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  itemRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    columnGap: "8px",
  },
  // Title takes remaining width and wraps; long titles must break to give the
  // badge room. Without this, the badge gets shrunk and its label wraps.
  itemTitle: {
    flex: "1 1 auto",
    minWidth: 0,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  // Pin the badge so its label never wraps and the badge never shrinks below
  // its intrinsic width — fixes "In Progress" wrapping across two lines.
  itemBadge: {
    flex: "0 0 auto",
    whiteSpace: "nowrap",
  },
  metaRow: {
    display: "flex",
    alignItems: "center",
    columnGap: "8px",
    flexWrap: "wrap",
  },
  connectCard: {
    ...shorthands.padding("28px"),
    display: "flex",
    flexDirection: "column",
    rowGap: "14px",
    maxWidth: "520px",
    marginLeft: "auto",
    marginRight: "auto",
  },
  emptyState: {
    ...shorthands.padding("12px"),
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
  },
  footer: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    textAlign: "center",
  },
});

// ─── Helpers ──────────────────────────────────────────────────────
function buildStatusColor(
  result: string | undefined,
  status: string
): "success" | "warning" | "danger" | "informative" {
  if (status === "inProgress") return "informative";
  if (result === "succeeded") return "success";
  if (result === "partiallySucceeded") return "warning";
  if (result === "failed" || result === "canceled") return "danger";
  return "informative";
}

function prStatusColor(status: string): "success" | "warning" | "danger" | "informative" {
  if (status === "completed") return "success";
  if (status === "abandoned") return "danger";
  if (status === "active") return "informative";
  return "warning";
}

function workItemStateColor(state: string): "success" | "warning" | "informative" | "subtle" {
  const s = state.toLowerCase();
  if (s === "closed" || s === "done" || s === "resolved") return "success";
  if (s === "active" || s === "committed" || s === "in progress") return "informative";
  if (s === "new" || s === "proposed") return "warning";
  return "subtle";
}

function formatTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

// ─── Component ────────────────────────────────────────────────────
export function Dashboard() {
  const styles = useStyles();
  const { app, isConnected, setToolData } = useMcpApp();
  const payload = useMcpToolData<DashboardPayload>();

  const [org, setOrg] = useState("");
  const [project, setProject] = useState("MetaOS");
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState<null | "connect" | "disconnect" | "refresh" | "demo">(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const serverToolsSupported = useMemo(() => {
    const caps = app?.getHostCapabilities?.();
    return !!(caps && (caps as any).serverTools);
  }, [app, isConnected]);

  const needsConnect = useMemo(
    () => !!payload && !payload.live && payload.reason === "not-connected",
    [payload]
  );

  async function callTool(name: string, args: Record<string, unknown> = {}) {
    if (!app) {
      setLocalError("Widget not connected to host yet.");
      return;
    }
    if (!serverToolsSupported) {
      setLocalError(
        "This host does not allow widgets to call tools (capability `serverTools` is off). " +
          "Ask Copilot in chat to run the tool, e.g. \"Connect Azure DevOps\" or \"Show me the dashboard\"."
      );
      return;
    }
    setLocalError(null);
    try {
      const result = (await app.callServerTool(
        { name, arguments: args },
        { timeout: 20000 } as any
      )) as { structuredContent?: unknown; isError?: boolean; content?: Array<{ text?: string }> };
      if (result?.structuredContent) {
        setToolData(result.structuredContent);
      }
      if (result?.isError) {
        const txt = result?.content?.[0]?.text;
        setLocalError(txt || "Tool reported an error.");
      }
    } catch (e: any) {
      setLocalError(e?.message ?? String(e));
    }
  }

  async function handleConnect() {
    if (!org.trim() || !pat.trim()) {
      setLocalError("Organization and PAT are required.");
      return;
    }
    setBusy("connect");
    try {
      await callTool("connect_azure_devops", {
        org: org.trim(),
        project: project.trim() || "MetaOS",
        pat: pat.trim(),
      });
      setPat("");
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    setBusy("disconnect");
    try {
      await callTool("disconnect_azure_devops", {});
    } finally {
      setBusy(null);
    }
  }

  async function handleRefresh() {
    setBusy("refresh");
    try {
      await callTool("show_engineering_dashboard", {});
    } finally {
      setBusy(null);
    }
  }

  async function handlePreviewDemo() {
    setBusy("demo");
    try {
      await callTool("show_engineering_dashboard", { forceDemo: true });
    } finally {
      setBusy(null);
    }
  }

  // ─── Initial waiting state ───
  if (!payload) {
    return (
      <div className={styles.root}>
        <div style={{ display: "flex", justifyContent: "center", padding: "40px" }}>
          <Spinner label={isConnected ? "Loading dashboard…" : "Connecting to host…"} />
        </div>
      </div>
    );
  }

  // ─── Connect card ───
  if (needsConnect) {
    return (
      <div className={styles.root}>
        <Card className={styles.connectCard}>
          <div className={styles.headerLeft}>
            <Title3>Connect Azure DevOps</Title3>
            <Caption1>
              Enter a PAT to load live work items, PRs, and pipeline runs. Stored locally on the
              MCP server only — never sent to the model.
            </Caption1>
          </div>
          <Field label="Organization" required>
            <Input value={org} onChange={(_, d) => setOrg(d.value)} placeholder="e.g. msazure" />
          </Field>
          <Field label="Project">
            <Input
              value={project}
              onChange={(_, d) => setProject(d.value)}
              placeholder="MetaOS"
            />
          </Field>
          <Field label="Personal Access Token" required hint="Scopes: Work Items + Code + Build (Read)">
            <Input
              type="password"
              value={pat}
              onChange={(_, d) => setPat(d.value)}
              placeholder="paste PAT here"
            />
          </Field>
          {payload.connectError && (
            <MessageBar intent="error">
              <MessageBarBody>
                <MessageBarTitle>Connect failed</MessageBarTitle>
                {payload.connectError}
              </MessageBarBody>
            </MessageBar>
          )}
          {localError && (
            <MessageBar intent="error">
              <MessageBarBody>{localError}</MessageBarBody>
            </MessageBar>
          )}
          <div style={{ display: "flex", columnGap: "10px", justifyContent: "flex-end" }}>
            <Button
              appearance="subtle"
              onClick={handlePreviewDemo}
              disabled={busy !== null}
              icon={busy === "demo" ? <Spinner size="tiny" /> : undefined}
            >
              Preview demo
            </Button>
            <Button
              appearance="primary"
              icon={busy === "connect" ? <Spinner size="tiny" /> : <PlugConnectedFilled />}
              onClick={handleConnect}
              disabled={busy !== null || !app}
            >
              Connect
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ─── Dashboard ───
  const data = payload.data;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Title3>Engineering Command Center</Title3>
          <Caption1>
            {payload.org ? `${payload.org} / ` : ""}
            {payload.project}
            {" · "}
            {payload.live ? (
              <>
                <CheckmarkCircleFilled style={{ color: tokens.colorPaletteGreenForeground1 }} />{" "}
                Live data
              </>
            ) : (
              <>
                <WarningFilled style={{ color: tokens.colorPaletteYellowForeground1 }} /> Demo data
              </>
            )}
          </Caption1>
        </div>
        <div className={styles.headerActions}>
          <Button
            appearance="subtle"
            icon={busy === "refresh" ? <Spinner size="tiny" /> : <ArrowSyncFilled />}
            onClick={handleRefresh}
            disabled={busy !== null}
          >
            Refresh
          </Button>
          {payload.live ? (
            <Button
              appearance="subtle"
              icon={busy === "disconnect" ? <Spinner size="tiny" /> : <PlugDisconnectedFilled />}
              onClick={handleDisconnect}
              disabled={busy !== null}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              appearance="primary"
              icon={<PlugConnectedFilled />}
              onClick={() => {
                // Force a refresh that re-resolves creds (will hit Connect form
                // if no PAT, otherwise live). Simplest: clear local state and
                // re-call show_engineering_dashboard which returns the
                // "not-connected" state when no PAT — which renders the Connect form.
                handleRefresh();
              }}
              disabled={busy !== null}
            >
              Connect
            </Button>
          )}
        </div>
      </div>

      {payload.reason && payload.reason.startsWith("live-fetch-error") && (
        <MessageBar intent="warning" icon={<ErrorCircleFilled />}>
          <MessageBarBody>
            <MessageBarTitle>Live fetch failed — showing demo data</MessageBarTitle>
            {payload.reason.replace(/^live-fetch-error: /, "")}
          </MessageBarBody>
        </MessageBar>
      )}
      {localError && (
        <MessageBar intent="error">
          <MessageBarBody>{localError}</MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.grid}>
        {/* ─── Work items ─── */}
        <Card className={styles.card}>
          <div className={styles.cardTitleRow}>
            <Subtitle2>My work items</Subtitle2>
            <Badge appearance="tint">{data.workItems.length}</Badge>
          </div>
          <Divider className={styles.divider} />
          <div className={styles.list}>
            {data.workItems.length === 0 && (
              <div className={styles.emptyState}>No work items.</div>
            )}
            {data.workItems.map((wi) => (
              <div key={wi.id} className={styles.listItem}>
                <div className={styles.itemRow}>
                  <Body1Strong className={styles.itemTitle}>
                    {wi.url ? (
                      <Link href={wi.url} target="_blank" rel="noopener noreferrer">
                        #{wi.id} {wi.title}
                      </Link>
                    ) : (
                      <>
                        #{wi.id} {wi.title}
                      </>
                    )}
                  </Body1Strong>
                  <Badge
                    className={styles.itemBadge}
                    appearance="tint"
                    color={workItemStateColor(wi.state)}
                  >
                    {wi.state}
                  </Badge>
                </div>
                <div className={styles.metaRow}>
                  <Caption1>{wi.type}</Caption1>
                  {wi.assignedTo && <Caption1>· {wi.assignedTo}</Caption1>}
                  {wi.iterationPath && <Caption1>· {wi.iterationPath.split("\\").pop()}</Caption1>}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* ─── Pull requests ─── */}
        <Card className={styles.card}>
          <div className={styles.cardTitleRow}>
            <Subtitle2>Pull requests</Subtitle2>
            <Badge appearance="tint">{data.pullRequests.length}</Badge>
          </div>
          <Divider className={styles.divider} />
          <div className={styles.list}>
            {data.pullRequests.length === 0 && (
              <div className={styles.emptyState}>No pull requests.</div>
            )}
            {data.pullRequests.map((pr) => (
              <div key={pr.id} className={styles.listItem}>
                <div className={styles.itemRow}>
                  <Body1Strong className={styles.itemTitle}>
                    {pr.url ? (
                      <Link href={pr.url} target="_blank" rel="noopener noreferrer">
                        !{pr.id} {pr.title}
                      </Link>
                    ) : (
                      <>
                        !{pr.id} {pr.title}
                      </>
                    )}
                  </Body1Strong>
                  <Badge
                    className={styles.itemBadge}
                    appearance="tint"
                    color={prStatusColor(pr.status)}
                  >
                    {pr.status}
                  </Badge>
                </div>
                <div className={styles.metaRow}>
                  {pr.repository && <Caption1>{pr.repository}</Caption1>}
                  {pr.createdBy && <Caption1>· {pr.createdBy}</Caption1>}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* ─── Builds ─── */}
        <Card className={styles.card}>
          <div className={styles.cardTitleRow}>
            <Subtitle2>Recent pipeline runs</Subtitle2>
            <Badge appearance="tint">{data.builds.length}</Badge>
          </div>
          <Divider className={styles.divider} />
          <div className={styles.list}>
            {data.builds.length === 0 && (
              <div className={styles.emptyState}>No recent runs.</div>
            )}
            {data.builds.map((b) => (
              <div key={b.id} className={styles.listItem}>
                <div className={styles.itemRow}>
                  <Body1Strong className={styles.itemTitle}>
                    {b.url ? (
                      <Link href={b.url} target="_blank" rel="noopener noreferrer">
                        {b.definition ?? b.buildNumber}
                      </Link>
                    ) : (
                      b.definition ?? b.buildNumber
                    )}
                  </Body1Strong>
                  <Badge
                    className={styles.itemBadge}
                    appearance="tint"
                    color={buildStatusColor(b.result, b.status)}
                  >
                    {b.status === "inProgress" ? "running" : b.result ?? b.status}
                  </Badge>
                </div>
                <div className={styles.metaRow}>
                  <Caption1>{b.buildNumber}</Caption1>
                  <Caption1>· {formatTime(b.finishTime)}</Caption1>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Body1 className={styles.footer}>
        Engineering Command Center · MCP-Apps SDK · postMessage transport
      </Body1>
    </div>
  );
}
