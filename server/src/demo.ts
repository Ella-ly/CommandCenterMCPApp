// Rich synthetic data themed around the MetaOS project, used when no ADO credentials
// are present or ADO is unreachable — so the widget always renders something compelling.

import type { EngineeringData } from "./ado.js";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function hoursAgo(n: number): string {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d.toISOString();
}

export function demoData(project = "MetaOS"): EngineeringData {
  return {
    workItems: [
      { id: 80421, title: `Stabilize ${project} host SDK init race on cold start`, type: "Bug", state: "Active", priority: 1, iteration: "Sprint 142", tags: ["reliability", "host-sdk"] },
      { id: 80455, title: "Add telemetry for app activation latency P95", type: "Task", state: "Active", priority: 2, iteration: "Sprint 142", tags: ["telemetry"] },
      { id: 80390, title: "Design doc: declarative agent widget consent flow", type: "User Story", state: "New", priority: 2, iteration: "Sprint 142", tags: ["design", "widgets"] },
      { id: 80502, title: "Flaky e2e: manifest sideload smoke test", type: "Bug", state: "Active", priority: 1, iteration: "Sprint 142", tags: ["test-debt"] },
      { id: 80288, title: "Adopt v2.4 plugin manifest for MCP runtimes", type: "Task", state: "Active", priority: 3, iteration: "Sprint 143", tags: ["mcp"] },
      { id: 80517, title: "Spec review: cross-file consistency validator", type: "User Story", state: "New", priority: 3, iteration: "Sprint 143", tags: ["spec"] },
    ],
    pullRequests: [
      { id: 41233, title: "feat: inline x-layout_manifest renderer", repo: "metaos-web", author: "Priya N.", isDraft: false, createdDate: daysAgo(1), reviewers: 3, targetBranch: "main" },
      { id: 41240, title: "fix: null guard in widget consent dialog", repo: "metaos-web", author: "You", isDraft: false, createdDate: daysAgo(0), reviewers: 2, targetBranch: "main" },
      { id: 41201, title: "chore: bump MCP sdk to 1.12", repo: "metaos-mcp", author: "Sam O.", isDraft: true, createdDate: daysAgo(3), reviewers: 1, targetBranch: "main" },
      { id: 41255, title: "docs: appify app package authoring guide", repo: "metaos-docs", author: "You", isDraft: false, createdDate: daysAgo(2), reviewers: 1, targetBranch: "main" },
    ],
    builds: [
      { id: 99812, pipeline: "metaos-web-CI", number: "20260612.4", status: "completed", result: "succeeded", branch: "main", finishTime: hoursAgo(1), requestedFor: "Priya N." },
      { id: 99805, pipeline: "metaos-mcp-CI", number: "20260612.2", status: "completed", result: "failed", branch: "users/sam/sdk-bump", finishTime: hoursAgo(3), requestedFor: "Sam O." },
      { id: 99799, pipeline: "metaos-web-CI", number: "20260612.1", status: "completed", result: "succeeded", branch: "main", finishTime: hoursAgo(5), requestedFor: "You" },
      { id: 99780, pipeline: "metaos-release", number: "20260611.7", status: "completed", result: "partiallySucceeded", branch: "main", finishTime: hoursAgo(20), requestedFor: "Release Bot" },
      { id: 99770, pipeline: "metaos-web-CI", number: "20260611.6", status: "inProgress", result: null, branch: "main", finishTime: null, requestedFor: "You" },
    ],
  };
}
