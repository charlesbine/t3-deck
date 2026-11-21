import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyThread,
  formatResetCountdown,
  resolveReasoningValue,
  T3Store
} from "./store.js";
import type { ServerProvider, ThreadShell } from "./types.js";

function makeThread(overrides: Partial<ThreadShell> = {}): ThreadShell {
  return {
    id: overrides.id ?? "t-1",
    projectId: overrides.projectId ?? "p-1",
    title: overrides.title ?? "Test Thread",
    providerInstanceId: overrides.providerInstanceId ?? "claudeAgent",
    modelSelection: overrides.modelSelection ?? {
      instanceId: "claudeAgent",
      model: "claude-opus-4-8"
    },
    runtimeMode: overrides.runtimeMode ?? "auto",
    interactionMode: overrides.interactionMode ?? "default",
    branch: null,
    worktreePath: null,
    latestRunId: "run-1",
    activeRunId: null,
    status: "completed",
    pendingRuntimeRequest: null,
    itemCount: 10,
    createdAt: "2026-11-20T00:00:00.000Z",
    updatedAt: "2026-11-20T01:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    ...overrides
  };
}

test("priority sorting places approvals > questions > recent visits, and attention sorts by severity", () => {
  const store = new T3Store();
  store.applyShellSnapshot(
    [{ id: "p-1", title: "lab", workspaceRoot: "/tmp/lab" }],
    [
      makeThread({
        id: "t-done",
        status: "completed",
        updatedAt: "2026-11-20T05:00:00Z",
        lastVisitedAt: "2026-11-20T05:00:00Z"
      }),
      makeThread({
        id: "t-run",
        status: "running",
        activeRunId: "r-2",
        updatedAt: "2026-11-20T02:00:00Z",
        lastVisitedAt: "2026-11-20T04:00:00Z"
      }),
      makeThread({
        id: "t-fail",
        status: "failed",
        updatedAt: "2026-11-20T01:00:00Z",
        lastVisitedAt: "2026-11-20T01:00:00Z"
      }),
      makeThread({
        id: "t-ask",
        status: "waiting",
        pendingRuntimeRequest: { id: "req-q", kind: "user_input", createdAt: "2026-11-20T00:10:00Z" }
      }),
      makeThread({
        id: "t-app",
        status: "waiting",
        pendingRuntimeRequest: { id: "req-a", kind: "command", createdAt: "2026-11-20T00:05:00Z" }
      })
    ],
    false
  );

  // Initial focus snaps to the most recently visited thread in T3 Code
  assert.equal(store.getFocusedThread()?.id, "t-done");

  // Active list keeps approvals/questions on top, then most recently visited (Cmd+Tab order)
  assert.deepEqual(
    store.getFilteredThreads("active").map((t) => t.id),
    ["t-app", "t-ask", "t-done", "t-run", "t-fail"]
  );

  // Attention filter sorts by severity (approval > question > failed)
  assert.deepEqual(
    store.getFilteredThreads("attention").map((t) => t.id),
    ["t-app", "t-ask", "t-fail"]
  );

  const stats = store.getFleetStats();
  assert.equal(stats.approvals, 1);
  assert.equal(stats.questions, 1);
  assert.equal(stats.failed, 1);
  assert.equal(stats.running, 1);
  assert.equal(store.getNextAttentionThread()?.id, "t-app");
});

test("live focus follows the thread opened/visited in T3 Code", () => {
  const store = new T3Store();
  store.applyShellSnapshot(
    [{ id: "p-1", title: "lab", workspaceRoot: "/tmp/lab" }],
    [
      makeThread({ id: "t-a", title: "Alpha", lastVisitedAt: "2026-11-20T01:00:00Z" }),
      makeThread({ id: "t-b", title: "Beta", lastVisitedAt: "2026-11-20T02:00:00Z" })
    ],
    false
  );
  assert.equal(store.getFocusedThread()?.id, "t-b");

  // User clicks into Alpha in T3 Code -> opens.openedAt advances
  store.applyThreadUpdated(
    makeThread({
      id: "t-a",
      title: "Alpha",
      lastVisitedAt: "2026-11-20T03:00:00Z",
      opens: { openedAt: Date.parse("2026-11-20T03:00:00Z") }
    }),
    "active"
  );
  assert.equal(store.getFocusedThread()?.id, "t-a");

  // User twists Dial 1 to Beta (and wrap-around works in both directions)
  store.stepFocus(1);
  assert.equal(store.getFocusedThread()?.id, "t-b");
  store.stepFocus(-1);
  assert.equal(store.getFocusedThread()?.id, "t-a");
  store.stepFocus(-1);
  assert.equal(store.getFocusedThread()?.id, "t-b");

  // Streaming read-watermark bump on already-open Alpha must NOT yank focus away from Beta
  store.applyThreadUpdated(
    makeThread({
      id: "t-a",
      title: "Alpha",
      lastVisitedAt: "2026-11-20T03:05:00Z",
      opens: { openedAt: Date.parse("2026-11-20T03:00:00Z") }
    }),
    "active"
  );
  assert.equal(store.getFocusedThread()?.id, "t-b");
});

test("enrichment-only snapshot merges projects without wiping threads", () => {
  const store = new T3Store();
  store.applyShellSnapshot(
    [{ id: "p-1", title: "lab", workspaceRoot: "/tmp/lab" }],
    [makeThread({ id: "t-1" })],
    false
  );
  store.applyShellSnapshot(
    [{ id: "p-1", title: "lab-renamed", workspaceRoot: "/tmp/lab" }],
    [],
    true
  );

  assert.equal(store.getAllThreads().length, 1);
  assert.equal(store.getProjectName("p-1"), "lab-renamed");
});

test("subagent threads with pending approvals surface in active and attention filters", () => {
  const store = new T3Store();
  store.applyShellSnapshot(
    [{ id: "p-1", title: "lab", workspaceRoot: "/tmp/lab" }],
    [
      makeThread({
        id: "sub-idle",
        lineage: { parentThreadId: "parent-1", relationshipToParent: "subagent" },
        status: "completed"
      }),
      makeThread({
        id: "sub-app",
        lineage: { parentThreadId: "parent-1", relationshipToParent: "subagent" },
        status: "waiting",
        pendingRuntimeRequest: { id: "req-1", kind: "file-change", createdAt: "2026-11-20T01:00:00Z" }
      })
    ],
    false
  );

  assert.deepEqual(
    store.getFilteredThreads("active").map((t) => t.id),
    ["sub-app"]
  );
  assert.equal(classifyThread(store.getFilteredThreads("active")[0]!), "approval");
});

test("model catalog, reasoning effort extraction, and usage cards", () => {
  const store = new T3Store();
  const providers: ServerProvider[] = [
    {
      instanceId: "claudeAgent",
      driver: "claudeAgent",
      displayName: "Claude",
      enabled: true,
      installed: true,
      status: "ready",
      models: [
        {
          slug: "claude-opus-4-8",
          name: "Claude Opus 4.8",
          shortName: "Opus 4.8",
          isDefault: true,
          capabilities: {
            optionDescriptors: [
              {
                id: "effort",
                label: "Effort",
                type: "select",
                role: "reasoning",
                options: [
                  { id: "low", label: "Low" },
                  { id: "high", label: "High", isDefault: true },
                  { id: "max", label: "Max" }
                ]
              }
            ]
          }
        }
      ],
      usageLimits: {
        checkedAt: "2026-11-20T01:00:00Z",
        windows: [
          { id: "sess", kind: "session", label: "5h", usedPercent: 31 },
          { id: "wk", kind: "weekly", label: "7d", usedPercent: 42 }
        ]
      }
    }
  ];

  store.applyConfigSnapshot({
    environment: { environmentId: "env-1" },
    providers
  });

  const catalog = store.getModelCatalog();
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0]?.shortName, "Opus 4.8");
  assert.equal(
    resolveReasoningValue(
      { instanceId: "claudeAgent", model: "claude-opus-4-8", options: [{ id: "effort", value: "max" }] },
      catalog[0]?.reasoningDescriptor
    ),
    "max"
  );

  const cards = store.getUsageCards();
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.sessionWindow?.usedPercent, 31);
  assert.equal(cards[0]?.weeklyWindow?.usedPercent, 42);
});

test("model catalog defaults to favorites in exact favorite order and toggles cleanly to native full order", () => {
  const store = new T3Store();
  const providers: ServerProvider[] = [
    {
      instanceId: "codex",
      driver: "codex",
      displayName: "Codex Personal",
      enabled: true,
      installed: true,
      status: "ready",
      models: [
        { slug: "gpt-6.2-sol", name: "GPT-6.2 Sol", capabilities: null },
        { slug: "gpt-6.2-astra", name: "GPT-6.2 Astra", capabilities: null },
        { slug: "gpt-6-astra", name: "GPT-6 Astra", isDefault: true, capabilities: null }
      ]
    },
    {
      instanceId: "claudeAgent",
      driver: "claudeAgent",
      displayName: "Claude",
      enabled: true,
      installed: true,
      status: "ready",
      models: [
        { slug: "claude-opus-5-5", name: "Claude Opus 5.5", shortName: "Opus 5.5", capabilities: null },
        { slug: "claude-fable-5-2", name: "Claude Fable 5.2", shortName: "Fable 5.2", capabilities: null }
      ]
    }
  ];

  store.applyConfigSnapshot({
    environment: { environmentId: "env-1" },
    providers,
    settings: {
      favorites: [
        { provider: "claudeAgent", model: "claude-opus-5-5" },
        { provider: "codex", model: "gpt-6.2-astra" }
      ]
    }
  });

  // Default scope is favorites-only in exact favorite order
  assert.equal(store.getEffectiveModelScope(), "favorites");
  assert.deepEqual(
    store.getModelCatalog().map((m) => m.slug),
    ["claude-opus-5-5", "gpt-6.2-astra"]
  );

  // Toggling to all preserves T3 Code's exact native provider order (no isDefault scramble)
  assert.equal(store.toggleModelScope(), "all");
  assert.deepEqual(
    store.getModelCatalog().map((m) => m.slug),
    ["gpt-6.2-sol", "gpt-6.2-astra", "gpt-6-astra", "claude-opus-5-5", "claude-fable-5-2"]
  );
  assert.equal(store.toggleModelScope(), "favorites");
});

test("formatResetCountdown renders compact durations", () => {
  const now = Date.parse("2026-11-20T10:00:00.000Z");
  assert.equal(formatResetCountdown("2026-11-20T10:45:00.000Z", now), "45m");
  assert.equal(formatResetCountdown("2026-11-20T13:15:00.000Z", now), "3h15m");
  assert.equal(formatResetCountdown("2026-11-22T14:00:00.000Z", now), "2d4h");
});
