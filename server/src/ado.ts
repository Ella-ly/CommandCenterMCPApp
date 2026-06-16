// Azure DevOps REST client (TypeScript port).
// Accepts PAT credentials and returns shaped engineering data.

const API = "7.1";

export interface AdoCredentials {
  bearer?: string;
  pat?: string;
}

export interface WorkItem {
  id: number;
  title: string;
  type: string;
  state: string;
  priority: number;
  iteration: string;
  tags: string[];
}

export interface PullRequest {
  id: number;
  title: string;
  repo: string;
  author: string;
  isDraft: boolean;
  createdDate: string;
  reviewers: number;
  targetBranch: string;
}

export interface Build {
  id: number;
  pipeline: string;
  number: string;
  status: string;
  result: string | null;
  branch: string;
  finishTime: string | null;
  requestedFor: string;
}

export interface EngineeringData {
  workItems: WorkItem[];
  pullRequests: PullRequest[];
  builds: Build[];
}

function authHeader({ bearer, pat }: AdoCredentials): string {
  if (bearer) return `Bearer ${bearer}`;
  if (pat) return `Basic ${Buffer.from(":" + pat).toString("base64")}`;
  throw new Error("no-credentials");
}

async function adoFetch(url: string, creds: AdoCredentials, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: authHeader(creds),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...((init.headers as Record<string, string>) || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ADO ${res.status} ${res.statusText} for ${url} :: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function base(org: string, project: string): string {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis`;
}

async function getMyWorkItems(org: string, project: string, creds: AdoCredentials): Promise<WorkItem[]> {
  const wiql = {
    query:
      "SELECT [System.Id] FROM WorkItems " +
      "WHERE [System.TeamProject] = @project " +
      "AND [System.AssignedTo] = @Me " +
      "AND [System.State] NOT IN ('Closed','Done','Removed','Completed') " +
      "ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.ChangedDate] DESC",
  };
  const q = await adoFetch(`${base(org, project)}/wit/wiql?api-version=${API}`, creds, {
    method: "POST",
    body: JSON.stringify(wiql),
  });
  const ids: number[] = (q.workItems || []).slice(0, 25).map((w: any) => w.id);
  if (ids.length === 0) return [];
  const fields = [
    "System.Id",
    "System.Title",
    "System.WorkItemType",
    "System.State",
    "Microsoft.VSTS.Common.Priority",
    "System.IterationPath",
    "System.Tags",
  ];
  const batch = await adoFetch(`${base(org, project)}/wit/workitemsbatch?api-version=${API}`, creds, {
    method: "POST",
    body: JSON.stringify({ ids, fields }),
  });
  return (batch.value || []).map((wi: any) => ({
    id: wi.id,
    title: wi.fields["System.Title"],
    type: wi.fields["System.WorkItemType"],
    state: wi.fields["System.State"],
    priority: wi.fields["Microsoft.VSTS.Common.Priority"] ?? 4,
    iteration: (wi.fields["System.IterationPath"] || "").split("\\").pop() || "",
    tags: (wi.fields["System.Tags"] || "")
      .split(";")
      .map((t: string) => t.trim())
      .filter(Boolean),
  }));
}

async function getActivePullRequests(org: string, project: string, creds: AdoCredentials): Promise<PullRequest[]> {
  const data = await adoFetch(
    `${base(org, project)}/git/pullrequests?searchCriteria.status=active&$top=25&api-version=${API}`,
    creds
  );
  return (data.value || []).map((pr: any) => ({
    id: pr.pullRequestId,
    title: pr.title,
    repo: pr.repository?.name ?? "",
    author: pr.createdBy?.displayName ?? "",
    isDraft: !!pr.isDraft,
    createdDate: pr.creationDate,
    reviewers: (pr.reviewers || []).length,
    targetBranch: (pr.targetRefName || "").replace("refs/heads/", ""),
  }));
}

async function getRecentBuilds(org: string, project: string, creds: AdoCredentials): Promise<Build[]> {
  const data = await adoFetch(
    `${base(org, project)}/build/builds?$top=15&queryOrder=finishTimeDescending&api-version=${API}`,
    creds
  );
  return (data.value || []).map((b: any) => ({
    id: b.id,
    pipeline: b.definition?.name ?? "",
    number: b.buildNumber,
    status: b.status,
    result: b.result ?? null,
    branch: (b.sourceBranch || "").replace("refs/heads/", ""),
    finishTime: b.finishTime ?? null,
    requestedFor: b.requestedFor?.displayName ?? "",
  }));
}

export async function fetchEngineeringData(
  org: string,
  project: string,
  creds: AdoCredentials
): Promise<EngineeringData> {
  if (!org) throw new Error("ADO_ORG not configured");
  const [workItems, pullRequests, builds] = await Promise.all([
    getMyWorkItems(org, project, creds),
    getActivePullRequests(org, project, creds),
    getRecentBuilds(org, project, creds),
  ]);
  return { workItems, pullRequests, builds };
}

export async function validateCredentials(
  org: string,
  _project: string,
  creds: AdoCredentials
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!org) return { ok: false, error: "Organization is required." };
  try {
    await adoFetch(
      `https://dev.azure.com/${encodeURIComponent(org)}/_apis/projects?$top=1&api-version=${API}`,
      creds
    );
    return { ok: true };
  } catch (e: any) {
    const msg = /401|403/.test(e.message)
      ? "Token rejected (check scopes: Work Items/Code/Build Read) or wrong organization."
      : /404/.test(e.message)
      ? `Organization "${org}" not found.`
      : `Could not reach Azure DevOps: ${e.message}`;
    return { ok: false, error: msg };
  }
}
