import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyApprovalDanger,
  classifyThread,
  formatResetCountdown,
  resolveReasoningValue,
  T3Store
} from "./store.js";
import {
  geometryFromDevice,
  handleOverlayDialRotate,
  handleOverlayDialTapOrPress,
  handleOverlayKeyPress,
  itemIndexForSlot,
  renderCompleteDeckSvgs,
  usesVirtualTopBanner,
  type SurfaceDispatchCallbacks
} from "./surface.js";
import { renderThreadDialCanvas, renderUsageDialCanvas } from "./render.js";
import { T3Client } from "./t3-client.js";
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

test("approval danger classifier flags destructive commands and overrides", () => {
  assert.equal(classifyApprovalDanger("npm test -- auth.spec.ts").dangerous, false);
  assert.equal(classifyApprovalDanger("rm -rf dist/migrations && prisma migrate reset --force").dangerous, true);
  assert.equal(classifyApprovalDanger("git push --force origin main").reason, "FORCE PUSH");
  assert.equal(classifyApprovalDanger("echo hi", "unskippable_safety").reason, "SAFETY CHECK");
});

test("panoramic approval & question queue advances across subagents and closes cleanly", () => {
  const store = new T3Store();
  store.setConnection("connected");
  const proj = { id: "proj-1", title: "t3code", workspaceRoot: "/tmp/t3code", deletedAt: null, archivedAt: null };
  const parent = makeThread({ id: "t-parent", title: "Refactor Auth Middleware" });
  const sub1 = makeThread({
    id: "t-sub-1",
    title: "Auth Migration Tests",
    lineage: { parentThreadId: "t-parent", relationshipToParent: "subagent" },
    pendingRuntimeRequest: { id: "req-1", kind: "command", createdAt: "2026-11-20T10:00:00Z" }
  });
  const sub2 = makeThread({
    id: "t-sub-2",
    title: "Schema Diff Audit",
    lineage: { parentThreadId: "t-parent", relationshipToParent: "subagent" },
    pendingRuntimeRequest: { id: "req-2", kind: "command", createdAt: "2026-11-20T10:01:00Z" }
  });
  const qThread = makeThread({
    id: "t-q",
    title: "Token Strategy",
    pendingRuntimeRequest: { id: "req-q1", kind: "user_input", createdAt: "2026-11-20T10:02:00Z" }
  });

  store.applyShellSnapshot([proj], [parent, sub1, sub2, qThread], false);
  assert.deepEqual(store.getThreadsNeedingProjectionFetch().sort(), ["t-q", "t-sub-1", "t-sub-2"]);

  store.applyThreadProjection("t-sub-1", {
    runtimeRequests: [
      {
        id: "req-1",
        nodeId: "n1",
        kind: "command",
        status: "pending",
        responseCapability: { type: "live" },
        createdAt: "2026-11-20T10:00:00Z"
      }
    ],
    turnItems: [
      {
        id: "ti-1",
        type: "approval_request",
        requestId: "req-1",
        requestKind: "command",
        prompt: "npm test -- src/auth/middleware.test.ts --run",
        reason: "Verify middleware token expiry"
      }
    ]
  });

  store.applyThreadProjection("t-sub-2", {
    runtimeRequests: [
      {
        id: "req-2",
        nodeId: "n2",
        kind: "command",
        status: "pending",
        responseCapability: { type: "live" },
        createdAt: "2026-11-20T10:01:00Z"
      }
    ],
    turnItems: [
      {
        id: "ti-2",
        type: "approval_request",
        requestId: "req-2",
        requestKind: "command",
        prompt: "rm -rf dist/migrations && prisma migrate reset --force",
        reason: "Reset local dev DB schema"
      }
    ]
  });

  store.applyThreadProjection("t-q", {
    runtimeRequests: [
      {
        id: "req-q1",
        nodeId: "n3",
        kind: "user_input",
        status: "pending",
        responseCapability: { type: "live" },
        createdAt: "2026-11-20T10:02:00Z"
      }
    ],
    turnItems: [
      {
        id: "ti-q1",
        type: "user_input_request",
        requestId: "req-q1",
        questions: [
          {
            id: "auth_mode",
            header: "Auth",
            question: "Which token format should we use for local sessions?",
            options: [
              { label: "Opaque Bearer", description: "Revocable random token in sqlite" },
              { label: "Short-lived JWT", description: "Signed Ed25519 with refresh" }
            ]
          }
        ]
      }
    ]
  });

  assert.equal(store.openApprovalOverlay(), true);
  let active = store.getActiveOverlayApproval();
  assert.equal(active.total, 2);
  assert.equal(active.item?.requestId, "req-1");
  assert.equal(active.item?.parentThreadTitle, "Refactor Auth Middleware");
  assert.equal(active.item?.dangerous, false);

  const deckApproval1 = renderCompleteDeckSvgs(store);
  assert.equal(deckApproval1.keys.length, 8);
  assert.equal(deckApproval1.dials.length, 4);
  assert.ok(deckApproval1.dials[1]!.includes("npm test"));

  // Resolving req-1 immediately slides req-2 into view
  store.markRequestResolvedLocally("t-sub-1", "req-1");
  active = store.getActiveOverlayApproval();
  assert.equal(store.overlay.kind, "approval");
  assert.equal(active.total, 1);
  assert.equal(active.item?.requestId, "req-2");
  assert.equal(active.item?.dangerous, true);

  // Resolving req-2 transitions seamlessly to waiting question req-q1
  store.markRequestResolvedLocally("t-sub-2", "req-2");
  assert.equal(String(store.overlay.kind), "question");
  const picked = store.selectQuestionOption(0);
  assert.equal(picked.readyToSubmit, true);
  assert.deepEqual(picked.answers, { auth_mode: "Opaque Bearer" });

  // Resolving the question closes the overlay back to Base Mission Control
  store.markRequestResolvedLocally("t-q", "req-q1");
  assert.equal(String(store.overlay.kind), "none");
});

test("Dial 1 renders SNOOZED badge and ETA when focused thread is snoozed", () => {
  const futureIso = new Date(Date.now() + 55 * 60_000).toISOString();
  const snoozed = makeThread({
    id: "t-snoozed",
    title: "Refactor Auth Middleware",
    snoozedUntil: futureIso
  });
  const svg = renderThreadDialCanvas(snoozed, "t3code", "active", 0, 4, true);
  assert.ok(svg.includes("SNOOZED"));
  assert.ok(svg.includes("55M") || svg.includes("54M"));
});

test("dynamic 8-preset T3 snooze settings split cleanly into default tap + 7 hold slots", () => {
  const store = new T3Store();
  store.applySettingsUpdated({
    snoozePresets: [
      { kind: "after", minutes: 15 },
      { kind: "after", minutes: 30 },
      { kind: "after", minutes: 60 },
      { kind: "after", minutes: 180 },
      { kind: "after", minutes: 240 },
      { kind: "at", day: "today", time: "18:00" },
      { kind: "at", day: "tomorrow", time: "09:00" },
      { kind: "at", day: "monday", time: "09:00" }
    ]
  });
  const now = Date.parse("2026-11-21T10:00:00");
  const def = store.getDefaultSnoozePreset(now);
  const secondary = store.getSecondarySnoozePresets(now);
  assert.equal(def.shortLabel, "15M");
  assert.equal(secondary.length, 7);
  assert.equal(secondary[0]?.shortLabel, "30M");
});

test("two-level New Chat overlay drills from project picker to model picker and renders cleanly", () => {
  const store = new T3Store();
  store.setConnection("connected");
  store.applyConfigSnapshot({
    environment: { environmentId: "env-1" },
    providers: [
      {
        instanceId: "claude-default",
        driver: "claudeAgent",
        displayName: "Claude",
        accentColor: "#E07A5F",
        enabled: true,
        installed: true,
        status: "ready",
        models: [
          { slug: "claude-opus-5-5", name: "Opus 5.5", shortName: "Opus 5.5", capabilities: null }
        ]
      }
    ],
    settings: {
      favorites: [{ provider: "claudeAgent", model: "claude-opus-5-5" }]
    }
  });
  store.applyShellSnapshot(
    [
      { id: "p1", title: "t3code", workspaceRoot: "/tmp/t3code", pinnedAt: "2026-11-20T00:00:00Z" },
      { id: "p2", title: "t3-deck", workspaceRoot: "/tmp/t3-deck" }
    ],
    [],
    false
  );

  store.openNewChatProjectOverlay(4);
  assert.equal(store.overlay.kind, "new-chat-project");
  const projSvgs = renderCompleteDeckSvgs(store);
  // BACK sits right at originSlot 4 (row 1, col 0 — NEW CHAT's exact key!)
  assert.ok(projSvgs.keys[4]!.includes("BACK"));
  assert.ok(projSvgs.keys[0]!.includes("T3CODE"));
  assert.ok(projSvgs.dials[0]!.includes("PICK PROJECT"));

  // Drilling from slot 1 into Model Picker places BACK at slot 1
  store.openNewChatModelOverlay("p1", { originSlot: 1, parentKind: "new-chat-project", parentOriginSlot: 4 });
  assert.equal(String(store.overlay.kind), "new-chat-model");
  store.toggleNewChatInteractionMode();
  const modelSvgs = renderCompleteDeckSvgs(store);
  assert.ok(modelSvgs.keys[1]!.includes("BACK"));
  assert.ok(modelSvgs.keys[0]!.includes("OPUS 5.5"));
  assert.ok(modelSvgs.dials[0]!.includes("PICK MODEL"));

  // Environment-first picker also places BACK at originSlot 4
  store.applyPeerLinksUpdated([{ environmentId: "env-vps", label: "VPS" }]);
  store.openNewChatEnvOverlay(4);
  const envSvgs = renderCompleteDeckSvgs(store);
  assert.ok(envSvgs.keys[4]!.includes("BACK"));
  assert.ok(envSvgs.keys[0]!.includes("LOCAL"));
  assert.ok(envSvgs.keys[1]!.includes("WORKTREE"));
  assert.ok(envSvgs.keys[5]!.includes("VPS"));

  // 4-knob Cockpit New Chat Builder uses all 4 dials + BACK at slot 4 + LAUNCH at slot 0
  store.openNewChatBuilderOverlay(4, "project", "default");
  assert.equal(String(store.overlay.kind), "new-chat-builder");
  store.stepNewChatBuilderDial(0, 1); // switch project via Dial 1
  store.stepNewChatBuilderDial(2, 1); // switch workspace local -> worktree via Dial 3
  store.toggleNewChatBuilderDial(2);  // toggle CODE -> PLAN via Dial 3 tap
  const builderSvgs = renderCompleteDeckSvgs(store);
  assert.ok(builderSvgs.keys[4]!.includes("BACK"));
  assert.ok(builderSvgs.keys[0]!.includes("LAUNCH"));
  assert.ok(builderSvgs.dials[0]!.includes("t3-deck"));
  assert.ok(builderSvgs.dials[2]!.includes("WORKTREE"));
  assert.ok(builderSvgs.dials[3]!.includes("LAUNCH CHAT"));
});

test("T3Client outbound orchestration commands include required T3 Code v2 wire fields", async () => {
  const calls: Array<{ tag: string; payload: Record<string, unknown> }> = [];
  const client = new T3Client({
    onConnectionChange: () => {},
    onConfigSnapshot: () => {},
    onProvidersUpdated: () => {},
    onUsageLimitSourcesUpdated: () => {},
    onShellSnapshot: () => {},
    onProjectUpdated: () => {},
    onProjectRemoved: () => {},
    onThreadUpdated: () => {},
    onThreadRemoved: () => {}
  });
  client.callRpc = async (tag: string, payload: unknown) => {
    calls.push({ tag, payload: payload as Record<string, unknown> });
    if (tag === "projects.ensureScratch") return { projectId: "scratch-proj" };
    if (tag === "orchestration.launchThread") return { threadId: "wt-thread-1" };
    return {};
  };

  // message.dispatch: idle -> start_immediately, active+auto -> steer_active, active+queue -> queue_after_active
  await client.sendQuickMessage("t-1", "Continue", "auto", null);
  await client.sendQuickMessage("t-1", "Fix tests", "auto", "run-active");
  await client.sendQuickMessage("t-1", "Run lint", "queue", "run-active");
  assert.equal(calls[0]?.tag, "orchestration.dispatchCommand");
  assert.equal(calls[0]?.payload.type, "message.dispatch");
  assert.equal(calls[0]?.payload.createdBy, "user");
  assert.equal(calls[0]?.payload.creationSource, "web");
  assert.deepEqual(calls[0]?.payload.dispatchMode, { type: "start_immediately" });
  assert.deepEqual(calls[1]?.payload.dispatchMode, { type: "steer_active", targetRunId: "run-active" });
  assert.deepEqual(calls[2]?.payload.dispatchMode, { type: "queue_after_active" });

  // thread.create (local + scratch) and orchestration.launchThread (worktree)
  await client.createThread({
    projectId: "proj-1",
    modelSelection: { instanceId: "claudeAgent", provider: "claudeAgent", model: "claude-opus-5-5" },
    workspaceMode: "local"
  });
  const localCreate = calls[3]!;
  assert.equal(localCreate.payload.type, "thread.create");
  assert.equal(localCreate.payload.createdBy, "user");
  assert.equal(localCreate.payload.creationSource, "web");

  const wtId = await client.createThread({
    projectId: "proj-1",
    modelSelection: { instanceId: "claudeAgent", provider: "claudeAgent", model: "claude-opus-5-5" },
    workspaceMode: "worktree"
  });
  assert.equal(wtId, "wt-thread-1");
  assert.equal(calls[4]?.tag, "orchestration.launchThread");
  assert.equal(calls[4]?.payload.creationSource, "web");

  await client.createThread({
    projectId: "proj-1",
    modelSelection: { instanceId: "claudeAgent", provider: "claudeAgent", model: "claude-opus-5-5" },
    workspaceMode: "scratch"
  });
  assert.equal(calls[5]?.tag, "projects.ensureScratch");
  assert.equal(calls[6]?.payload.projectId, "scratch-proj");

  // runtime-request.respond (approval + user input), dismiss, interrupt, mark-unread
  await client.approveRequest("t-1", "req-1", "acceptForSession");
  await client.respondToUserInput("t-1", "req-q", { q1: "Option A" });
  await client.dismissUserInput("t-1", "req-q");
  await client.interruptRun("t-1", "run-1");
  await client.markThreadUnread("t-1");
  assert.equal(calls[7]?.payload.type, "runtime-request.respond");
  assert.equal(calls[7]?.payload.decision, "acceptForSession");
  assert.deepEqual(calls[8]?.payload.answers, { q1: "Option A" });
  assert.equal(calls[9]?.payload.type, "thread.user-input.dismiss");
  assert.equal(calls[10]?.payload.type, "run.interrupt");
  assert.equal(calls[11]?.payload.type, "thread.mark-unread");
});

test("Thread Tools disables UNREAD on threads without a completed run", async () => {
  const store = new T3Store();
  store.setConnection("connected");
  const emptyThread = makeThread({ id: "t-empty", latestRunId: null, status: "idle" });
  const doneThread = makeThread({ id: "t-done", latestRunId: "run-9", status: "completed" });
  store.applyShellSnapshot([{ id: "p-1", title: "lab", workspaceRoot: "/tmp/lab" }], [emptyThread, doneThread], false);

  const unreadCalls: string[] = [];
  const noopCb: SurfaceDispatchCallbacks = {
    approveRequest: async () => {},
    respondToUserInput: async () => {},
    dismissUserInput: async () => {},
    sendPrompt: async () => {},
    snoozeThreadUntil: async () => {},
    unsnoozeThread: async () => {},
    settleToggle: async () => {},
    pinToggle: async () => {},
    markThreadUnread: async (id) => {
      unreadCalls.push(id);
    },
    interruptOrStop: async () => {},
    createAndOpenThread: async () => {},
    openThread: () => {},
    openUrl: () => {},
    resync: async () => {}
  };

  store.focusThread("t-empty");
  store.openThreadToolsOverlay(3);
  // With originSlot = 3, slot 2 maps to item idx 2 (UNREAD)
  const emptySvgs = renderCompleteDeckSvgs(store);
  assert.ok(emptySvgs.keys[2]!.includes("NO RUNS"));
  await handleOverlayKeyPress(store, 2, 0, false, noopCb);
  assert.deepEqual(unreadCalls, []);

  store.focusThread("t-done");
  store.openThreadToolsOverlay(3);
  const doneSvgs = renderCompleteDeckSvgs(store);
  assert.ok(doneSvgs.keys[2]!.includes("MARK NEW"));
  await handleOverlayKeyPress(store, 2, 0, false, noopCb);
  assert.deepEqual(unreadCalls, ["t-done"]);
});

test("Usage dial surfaces probeFailed providers (like expired Antigravity) while hiding unsupported ones", () => {
  const store = new T3Store();
  store.applyProvidersUpdated([
    {
      instanceId: "opencode",
      driver: "opencode",
      displayName: "OpenCode",
      enabled: true,
      installed: true,
      status: "ready",
      models: [],
      usageLimits: {
        checkedAt: "2026-11-22T02:00:00Z",
        windows: [],
        unavailable: { reason: "unsupported", message: "No OpenCode workspace signed in." }
      }
    },
    {
      instanceId: "antigravity",
      driver: "antigravity",
      displayName: "Antigravity",
      enabled: true,
      installed: true,
      status: "ready",
      models: [],
      usageLimits: {
        checkedAt: "2026-11-22T02:54:00Z",
        windows: [],
        unavailable: {
          reason: "probeFailed",
          message: "Antigravity's saved sign-in has expired. Start an Antigravity turn to renew it."
        }
      }
    }
  ]);

  const cards = store.getUsageCards();
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.id, "antigravity");
  assert.equal(cards[0]?.unavailable?.reason, "probeFailed");
  const svg = renderUsageDialCanvas(cards[0]!, 0, 1, true);
  assert.ok(svg.includes("ANTIGRAVITY"));
  assert.ok(svg.includes("SIGN-IN EXPIRED"));
});

test("itemIndexForSlot reserves originSlot for BACK and maps all other 7 slots monotonically", () => {
  for (let origin = 0; origin < 8; origin++) {
    const mapped: number[] = [];
    for (let slot = 0; slot < 8; slot++) {
      const idx = itemIndexForSlot(slot, origin);
      if (slot === origin) {
        assert.equal(idx, -1, `Expected -1 at originSlot=${origin}`);
      } else {
        mapped.push(idx);
      }
    }
    assert.deepEqual(mapped, [0, 1, 2, 3, 4, 5, 6]);
  }
});

test("overlay key & dial handlers dispatch Approval, Multi-Select Question, Snooze Scrubber, AI Prompt, and 4-Knob New Chat", async () => {
  const store = new T3Store();
  store.setConnection("connected");
  store.applyConfigSnapshot({
    environment: { environmentId: "env-1" },
    providers: [
      {
        instanceId: "claude-default",
        driver: "claudeAgent",
        displayName: "Claude",
        accentColor: "#E07A5F",
        enabled: true,
        installed: true,
        status: "ready",
        models: [
          { slug: "claude-opus-5-5", name: "Opus 5.5", shortName: "Opus 5.5", capabilities: null },
          { slug: "claude-fable-5-2", name: "Fable 5.2", shortName: "Fable 5.2", capabilities: null }
        ]
      }
    ],
    settings: {
      favorites: [{ provider: "claudeAgent", model: "claude-opus-5-5" }],
      snoozePresets: [
        { kind: "after", minutes: 15 },
        { kind: "after", minutes: 30 },
        { kind: "after", minutes: 60 }
      ]
    }
  });

  const t1 = makeThread({
    id: "t-app",
    projectId: "p-1",
    title: "Approve Task",
    pendingRuntimeRequest: { id: "req-a", kind: "command", createdAt: "2026-11-21T10:00:00Z" }
  });
  const t2 = makeThread({
    id: "t-multi",
    projectId: "p-1",
    title: "Multi Question",
    pendingRuntimeRequest: { id: "req-m", kind: "user_input", createdAt: "2026-11-21T10:01:00Z" }
  });
  store.applyShellSnapshot(
    [
      { id: "p-1", title: "lab", workspaceRoot: "/tmp/lab" },
      { id: "p-2", title: "t3code", workspaceRoot: "/tmp/t3code" }
    ],
    [t1, t2],
    false
  );
  store.applyThreadProjection("t-app", {
    runtimeRequests: [
      {
        id: "req-a",
        nodeId: "n1",
        kind: "command",
        status: "pending",
        responseCapability: { type: "live" },
        createdAt: "2026-11-21T10:00:00Z"
      }
    ],
    turnItems: [
      {
        id: "ti-a",
        type: "approval_request",
        requestId: "req-a",
        requestKind: "command",
        prompt: "npm test"
      }
    ]
  });
  store.applyThreadProjection("t-multi", {
    runtimeRequests: [
      {
        id: "req-m",
        nodeId: "n2",
        kind: "user_input",
        status: "pending",
        responseCapability: { type: "live" },
        createdAt: "2026-11-21T10:01:00Z"
      }
    ],
    turnItems: [
      {
        id: "ti-m",
        type: "user_input_request",
        requestId: "req-m",
        questions: [
          {
            id: "targets",
            header: "Targets",
            question: "Which platforms?",
            multiSelect: true,
            options: [
              { label: "macOS", description: "Apple Silicon" },
              { label: "Linux", description: "x86_64" }
            ]
          }
        ]
      }
    ]
  });
  store.setPromptSuggestion({ threadId: "t-app", runId: "r-1", text: "Push and open PR" });

  const events: string[] = [];
  const cb: SurfaceDispatchCallbacks = {
    approveRequest: async (tid, rid, dec) => {
      events.push(`approve:${tid}:${rid}:${dec}`);
    },
    respondToUserInput: async (tid, rid, ans) => {
      events.push(`answer:${tid}:${rid}:${JSON.stringify(ans)}`);
    },
    dismissUserInput: async (tid, rid) => {
      events.push(`dismiss:${tid}:${rid}`);
    },
    sendPrompt: async (tid, text) => {
      events.push(`prompt:${tid}:${text}`);
    },
    snoozeThreadUntil: async (tid) => {
      events.push(`snooze:${tid}`);
    },
    unsnoozeThread: async () => {},
    settleToggle: async () => {},
    pinToggle: async () => {},
    markThreadUnread: async () => {},
    interruptOrStop: async () => {},
    createAndOpenThread: async (inp) => {
      events.push(`create:${inp.projectId}:${inp.modelSelection.model}:${inp.workspaceMode}:${inp.interactionMode}`);
    },
    openThread: () => {},
    openUrl: () => {},
    resync: async () => {}
  };

  // 1. Approval Inspector: hold slot 1 (col 1, row 0) approves for session and advances to multi-select question
  assert.equal(store.openApprovalOverlay(), true);
  await handleOverlayKeyPress(store, 1, 0, true, cb);
  assert.equal(events[0], "approve:t-app:req-a:acceptForSession");
  assert.equal(String(store.overlay.kind), "question");

  // 2. Multi-select question: tap option 0 & option 1 on touch strip (dials 0 & 1), then press SUBMIT (slot 1)
  await handleOverlayDialTapOrPress(store, 0, cb);
  await handleOverlayDialTapOrPress(store, 1, cb);
  await handleOverlayKeyPress(store, 1, 0, false, cb);
  assert.equal(events[1], 'answer:t-multi:req-m:{"targets":["macOS","Linux"]}');
  assert.equal(String(store.overlay.kind), "none");

  // 3. Snooze custom dial scrubber: twist Dial 1 -> tap Dial 1 to apply custom snooze
  store.focusThread("t-app");
  store.openSnoozeOverlay(7);
  handleOverlayDialRotate(store, 0, 2);
  await handleOverlayDialTapOrPress(store, 0, cb);
  assert.equal(events[2], "snooze:t-app");
  assert.equal(String(store.overlay.kind), "none");

  // 4. Quick Prompts drawer: Dial 1 tap at index 0 dispatches live AI-predicted prompt
  store.openPromptsOverlay(5);
  await handleOverlayDialTapOrPress(store, 0, cb);
  assert.equal(events[3], "prompt:t-app:Push and open PR");
  assert.equal(String(store.overlay.kind), "none");

  // 5. 4-Knob Cockpit New Chat Builder: select 2nd project, toggle ALL models + pick 2nd model, switch to worktree + plan, launch via Dial 4
  store.openNewChatBuilderOverlay(4, "project", "default");
  handleOverlayDialRotate(store, 0, 1); // project -> t3code
  await handleOverlayDialTapOrPress(store, 1, cb); // FAVS -> ALL
  handleOverlayDialRotate(store, 1, 1); // model -> claude-fable-5-2
  handleOverlayDialRotate(store, 2, 1); // local -> worktree
  await handleOverlayDialTapOrPress(store, 2, cb); // default -> plan
  await handleOverlayDialTapOrPress(store, 3, cb); // Dial 4 LAUNCH CHAT
  assert.equal(events[4], "create:p-2:claude-fable-5-2:worktree:plan");
  assert.equal(String(store.overlay.kind), "none");
});

test("renderCompleteDeckSvgs emits 8 valid key SVGs and 4 valid dial SVGs for every overlay mode", () => {
  const store = new T3Store();
  store.setConnection("connected");
  store.applyConfigSnapshot({
    environment: { environmentId: "env-1" },
    providers: [
      {
        instanceId: "claude-default",
        driver: "claudeAgent",
        displayName: "Claude",
        accentColor: "#E07A5F",
        enabled: true,
        installed: true,
        status: "ready",
        models: [{ slug: "claude-opus-5-5", name: "Opus 5.5", shortName: "Opus 5.5", capabilities: null }]
      }
    ],
    settings: { favorites: [{ provider: "claudeAgent", model: "claude-opus-5-5" }] }
  });
  const t = makeThread({
    id: "t-1",
    projectId: "p-1",
    title: "Refactor & Fix <Auth>",
    pendingRuntimeRequest: { id: "r-1", kind: "command", createdAt: "2026-11-21T10:00:00Z" }
  });
  store.applyShellSnapshot([{ id: "p-1", title: "lab & dev", workspaceRoot: "/tmp/lab" }], [t], false);
  store.applyThreadProjection("t-1", {
    runtimeRequests: [
      {
        id: "r-1",
        nodeId: "n1",
        kind: "command",
        status: "pending",
        responseCapability: { type: "live" },
        createdAt: "2026-11-21T10:00:00Z"
      }
    ],
    turnItems: [
      { id: "ti-1", type: "approval_request", requestId: "r-1", requestKind: "command", prompt: "echo a && echo b" }
    ]
  });

  const assertValidDeck = (label: string) => {
    const { keys, dials } = renderCompleteDeckSvgs(store);
    assert.equal(keys.length, 8, `${label}: 8 keys`);
    assert.equal(dials.length, 4, `${label}: 4 dials`);
    for (const svg of [...keys, ...dials]) {
      assert.ok(svg.startsWith("<svg ") && svg.trimEnd().endsWith("</svg>"), `${label}: valid SVG envelope`);
      assert.ok(!/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(svg), `${label}: escaped XML entities`);
    }
  };

  assertValidDeck("base");
  store.openApprovalOverlay();
  assertValidDeck("approval");
  store.openSnoozeOverlay(7);
  assertValidDeck("snooze");
  store.openPromptsOverlay(5);
  assertValidDeck("prompts");
  store.openFleetOverlay(0);
  assertValidDeck("fleet");
  store.openThreadToolsOverlay(3);
  assertValidDeck("thread-tools");
  store.openNewChatBuilderOverlay(4);
  assertValidDeck("new-chat-builder");
  store.openNewChatProjectOverlay(4);
  assertValidDeck("new-chat-project");
  store.openNewChatEnvOverlay(4);
  assertValidDeck("new-chat-env");
  store.openNewChatModelOverlay("p-1", { originSlot: 4 });
  assertValidDeck("new-chat-model");
  store.openModelPickerOverlay(1);
  assertValidDeck("model-picker");
  store.openModeEffortOverlay(2);
  assertValidDeck("mode-effort");
});

test("multi-device geometry adapts across Plus XL, MK.2, XL, Neo, and Mini with independent per-device overlays", async () => {
  const store = new T3Store();
  store.setConnection("connected");
  store.applyConfigSnapshot({
    environment: { environmentId: "env-1" },
    providers: [
      {
        instanceId: "claude-default",
        driver: "claudeAgent",
        displayName: "Claude",
        accentColor: "#E07A5F",
        enabled: true,
        installed: true,
        status: "ready",
        models: [
          {
            slug: "claude-opus-5-5",
            name: "Opus 5.5",
            shortName: "Opus 5.5",
            capabilities: {
              optionDescriptors: [
                {
                  id: "effort",
                  label: "Effort",
                  type: "select",
                  role: "reasoning",
                  options: [
                    { id: "low", label: "Low" },
                    { id: "high", label: "High", isDefault: true }
                  ]
                }
              ]
            }
          },
          { slug: "claude-fable-5-2", name: "Fable 5.2", shortName: "Fable 5.2", capabilities: null }
        ]
      }
    ],
    settings: { favorites: [{ provider: "claudeAgent", model: "claude-opus-5-5" }] }
  });

  const t = makeThread({
    id: "t-multi-dev",
    projectId: "p-1",
    title: "Deploy Worker",
    modelSelection: { instanceId: "claude-default", model: "claude-opus-5-5" },
    pendingRuntimeRequest: { id: "req-1", kind: "command", createdAt: "2026-11-21T10:00:00Z" }
  });
  store.applyShellSnapshot([{ id: "p-1", title: "lab", workspaceRoot: "/tmp/lab" }], [t], false);
  store.applyThreadProjection("t-multi-dev", {
    runtimeRequests: [
      {
        id: "req-1",
        nodeId: "n1",
        kind: "command",
        status: "pending",
        responseCapability: { type: "live" },
        createdAt: "2026-11-21T10:00:00Z"
      }
    ],
    turnItems: [
      {
        id: "ti-1",
        type: "approval_request",
        requestId: "req-1",
        requestKind: "command",
        prompt: "rm -rf dist && npm run build"
      }
    ]
  });

  const mk2 = geometryFromDevice({ id: "dev-mk2", type: 0, size: { columns: 5, rows: 3 } });
  const mini = geometryFromDevice({ id: "dev-mini", type: 1, size: { columns: 3, rows: 2 } });
  const xl = geometryFromDevice({ id: "dev-xl", type: 2, size: { columns: 8, rows: 4 } });
  const neo = geometryFromDevice({ id: "dev-neo", type: 9, size: { columns: 4, rows: 2 } });
  const plusXl = geometryFromDevice({ id: "dev-pxl", type: 13, size: { columns: 9, rows: 4 } });

  assert.equal(usesVirtualTopBanner(mk2, "approval"), true);
  assert.equal(usesVirtualTopBanner(xl, "approval"), true);
  assert.equal(usesVirtualTopBanner(mini, "approval"), false);
  assert.equal(usesVirtualTopBanner(neo, "approval"), false);
  assert.equal(usesVirtualTopBanner(plusXl, "approval"), false);
  assert.equal(plusXl.stripCols, 6);

  // Open approval overlay on MK.2 while Plus XL opens model-picker independently!
  store.openApprovalOverlay("t-multi-dev", 1, mk2.deviceId);
  store.openModelPickerOverlay(1, plusXl.deviceId);
  assert.equal(store.getOverlay(mk2.deviceId).kind, "approval");
  assert.equal(store.getOverlay(plusXl.deviceId).kind, "model-picker");
  assert.equal(store.getOverlay(mini.deviceId).kind, "none");

  // MK.2 renders 15 keys with Row 0 (cols 0..4) as a 720px stitched virtual banner!
  const mk2Deck = renderCompleteDeckSvgs(store, undefined, undefined, mk2);
  assert.equal(mk2Deck.keys.length, 15);
  assert.equal(mk2Deck.dials.length, 0);
  assert.ok(mk2Deck.keys[0]!.includes('width="712"'), "MK.2 Row 0 uses 5-key 720px virtual banner");
  assert.ok(mk2Deck.keys[0]!.includes("DANGER"));
  assert.ok(mk2Deck.keys[5]!.includes("BACK")); // Row 1 Col 0 = BACK
  assert.ok(mk2Deck.keys[6]!.includes("APPROVE")); // Row 1 Col 1 = APPROVE

  // Plus XL renders 36 keys + 6 dials (2400px panoramic strip!)
  const pxlDeck = renderCompleteDeckSvgs(store, undefined, undefined, plusXl);
  assert.equal(pxlDeck.keys.length, 36);
  assert.equal(pxlDeck.dials.length, 6);
  assert.ok(pxlDeck.dials[5]!.includes('width="2392"'), "Plus XL extends strip to 2400px");

  // Mini (3x2) compact approval overlay fits all 6 keys cleanly with inline DANGER inspect tile
  store.openApprovalOverlay("t-multi-dev", 1, mini.deviceId);
  const miniDeck = renderCompleteDeckSvgs(store, undefined, undefined, mini);
  assert.equal(miniDeck.keys.length, 6);
  assert.ok(miniDeck.keys[0]!.includes("BACK"));
  assert.ok(miniDeck.keys[1]!.includes("APPROVE"));
  assert.ok(miniDeck.keys[3]!.includes("DANGER"));

  // Keypad-native Model Picker & Mode/Effort overlays dispatch live RPC callbacks cleanly
  const actions: string[] = [];
  const cb: SurfaceDispatchCallbacks = {
    approveRequest: async () => {},
    respondToUserInput: async () => {},
    dismissUserInput: async () => {},
    sendPrompt: async () => {},
    snoozeThreadUntil: async () => {},
    unsnoozeThread: async () => {},
    settleToggle: async () => {},
    pinToggle: async () => {},
    markThreadUnread: async () => {},
    interruptOrStop: async () => {},
    setModelSelection: async (tid, sel) => {
      actions.push(`model:${tid}:${sel.model}:${JSON.stringify(sel.options ?? [])}`);
    },
    setRuntimeMode: async (tid, mode) => {
      actions.push(`runtime:${tid}:${mode}`);
    },
    setInteractionMode: async (tid, mode) => {
      actions.push(`interaction:${tid}:${mode}`);
    },
    createAndOpenThread: async () => {},
    openThread: () => {},
    openUrl: () => {},
    resync: async () => {}
  };

  // On Plus XL model-picker (originSlot = 1): slot 0 = idx 0 (FAVS/ALL toggle), slot 2 = idx 1 (1st model)
  await handleOverlayKeyPress(store, 0, 0, false, cb, plusXl); // FAVS -> ALL
  await handleOverlayKeyPress(store, 3, 0, false, cb, plusXl); // idx 2 -> 2nd model (Fable 5.2)
  assert.equal(actions[0], "model:t-multi-dev:claude-fable-5-2:[]");
  assert.equal(store.getOverlay(plusXl.deviceId).kind, "none");

  // On XL (8x4) mode-effort (originSlot = 0): slot 1 = idx 0 (PLAN/CODE), slot 2 = idx 1 (ASK)
  store.openModeEffortOverlay(0, xl.deviceId);
  const xlModeDeck = renderCompleteDeckSvgs(store, undefined, undefined, xl);
  assert.equal(xlModeDeck.keys.length, 32);
  assert.ok(xlModeDeck.keys[0]!.includes("BACK"));
  assert.ok(xlModeDeck.keys[1]!.includes("CODE MODE"));
  await handleOverlayKeyPress(store, 1, 0, false, cb, xl); // toggle PLAN
  assert.equal(actions[1], "interaction:t-multi-dev:plan");

  // Approving on MK.2 reconciles and closes BOTH MK.2 and Mini approval overlays!
  store.markRequestResolvedLocally("t-multi-dev", "req-1");
  assert.equal(store.getOverlay(mk2.deviceId).kind, "none");
  assert.equal(store.getOverlay(mini.deviceId).kind, "none");
});
