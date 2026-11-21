import assert from "node:assert/strict";
import test from "node:test";
import {
  escXml,
  renderApproveKey,
  renderFleetAttentionKey,
  renderModeEffortDialCanvas,
  renderModelDialCanvas,
  renderThreadDialCanvas,
  renderUsageDialCanvas,
  wrapLines
} from "./render.js";
import type { ThreadShell } from "./types.js";

const sampleThread: ThreadShell = {
  id: "t-1",
  projectId: "p-1",
  title: "Fix <auth> & Stream Deck",
  providerInstanceId: "claudeAgent",
  modelSelection: { instanceId: "claudeAgent", model: "claude-opus-4-8" },
  runtimeMode: "auto",
  interactionMode: "plan",
  branch: "feat/deck",
  worktreePath: null,
  pullRequests: [{ number: 42, url: "https://github.com/org/repo/pull/42", state: "open" }],
  latestRunId: "r-1",
  activeRunId: "r-1",
  status: "running",
  pendingRuntimeRequest: {
    id: "req-1",
    kind: "command",
    createdAt: "2026-11-20T01:00:00Z"
  },
  itemCount: 5,
  createdAt: "2026-11-20T00:00:00Z",
  updatedAt: "2026-11-20T01:00:00Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null
};

test("escXml escapes special XML entities", () => {
  assert.equal(escXml(`A & B <C> "D"`), "A &amp; B &lt;C&gt; &quot;D&quot;");
});

test("wrapLines splits cleanly within line bounds", () => {
  const lines = wrapLines("Refactor authentication middleware for edge runtime", 14, 3);
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.ok(line.length <= 14);
  }
});

test("SVG renderers emit valid escaped SVG for keys and dials", () => {
  const fleet = renderFleetAttentionKey(
    { approvals: 1, questions: 0, failed: 0, running: 3, waiting: 0, active: 5, total: 10 },
    true
  );
  assert.match(fleet, /^<svg /);
  assert.match(fleet, /1 NEED YOU/);

  const approve = renderApproveKey(sampleThread, sampleThread);
  assert.match(approve, /APPROVE/);
  assert.match(approve, /SHELL CMD/);

  const dialThread = renderThreadDialCanvas(sampleThread, "lab", "active", 0, 5, true);
  assert.match(dialThread, /Fix &lt;auth&gt; &amp; Stream Deck/);
  assert.match(dialThread, /PR #42/);

  const dialModel = renderModelDialCanvas(sampleThread, [], -1, null);
  assert.match(dialModel, /^<svg /);

  const dialMode = renderModeEffortDialCanvas(sampleThread, null);
  assert.match(dialMode, /PLAN MODE/);
  assert.match(dialMode, /MODE: AUTO/);

  const dialUsage = renderUsageDialCanvas(
    {
      id: "claudeAgent",
      label: "Claude",
      driver: "claudeAgent",
      accentColor: "#E07A5F",
      sessionWindow: { id: "s", kind: "session", label: "5h", usedPercent: 31 },
      weeklyWindow: { id: "w", kind: "weekly", label: "7d", usedPercent: 72 }
    },
    0,
    3,
    true
  );
  assert.match(dialUsage, /31%/);
  assert.match(dialUsage, /72%/);
});
