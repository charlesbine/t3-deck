import { spawn } from "node:child_process";
import streamDeck, {
  action,
  type DialAction,
  type DialDownEvent,
  type DialRotateEvent,
  type DialUpEvent,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  type KeyUpEvent,
  SingletonAction,
  type TouchTapEvent,
  type WillAppearEvent
} from "@elgato/streamdeck";
import {
  renderApproveKey,
  renderFleetAttentionKey,
  renderModeEffortDialCanvas,
  renderModeEffortKey,
  renderModelDialCanvas,
  renderModelKey,
  renderNewThreadKey,
  renderOpenThreadKey,
  renderQuickPromptDialCanvas,
  renderQuickPromptKey,
  renderSettlePinKey,
  renderSnoozeDialCanvas,
  renderSnoozeSyncKey,
  renderStopDenyKey,
  renderThreadDialCanvas,
  renderThreadKey,
  renderThreadSlotKey,
  renderUsageDialCanvas,
  renderUsageKey,
  svgDataUri
} from "./render.js";
import {
  isApprovalRequest,
  isQuestionRequest,
  isThreadRunning,
  isThreadSettled,
  isThreadSnoozed,
  normalizeOptionSelections,
  primaryPullRequest,
  QUICK_PROMPT_PRESETS,
  resolveReasoningValue,
  RUNTIME_MODE_ORDER,
  T3Store
} from "./store.js";
import {
  geometryFromDevice,
  handleOverlayDialRotate,
  handleOverlayDialTapOrPress,
  handleOverlayKeyPress,
  keySlotForCoords,
  renderOverlayDialSvg,
  renderOverlayKeySvg,
  type SurfaceDispatchCallbacks
} from "./surface.js";
import { T3Client } from "./t3-client.js";
import type {
  NewThreadSettings,
  QuickPromptSettings,
  RuntimeMode,
  SurfaceGeometry
} from "./types.js";

const PLUGIN_ID = "com.charlesbine.t3-deck";
const LONG_PRESS_MS = 650;

function openUrl(url: string): void {
  const child = spawn("/usr/bin/open", [url], { detached: true, stdio: "ignore" });
  child.unref();
}

function openThreadInApp(envId: string | null, threadId: string): void {
  if (envId) {
    openUrl(`t3code://threads/${encodeURIComponent(envId)}/${encodeURIComponent(threadId)}`);
  } else {
    openUrl("t3code://app/");
  }
}

class LongPressTracker {
  private timers = new Map<string, NodeJS.Timeout>();
  private firedLong = new Set<string>();

  down(actionId: string, onLong: () => void | Promise<void>): void {
    this.clear(actionId);
    this.firedLong.delete(actionId);
    const timer = setTimeout(() => {
      this.timers.delete(actionId);
      this.firedLong.add(actionId);
      void onLong();
    }, LONG_PRESS_MS);
    this.timers.set(actionId, timer);
  }

  /** Consumes a pending long-press release so releasing a key that opened an overlay won't tap inside it. */
  consumeLongRelease(actionId: string): boolean {
    if (this.firedLong.has(actionId)) {
      this.firedLong.delete(actionId);
      this.clear(actionId);
      return true;
    }
    return false;
  }

  up(actionId: string, onShort: () => void | Promise<void>): void {
    this.clear(actionId);
    if (this.firedLong.has(actionId)) {
      this.firedLong.delete(actionId);
      return;
    }
    void onShort();
  }

  clear(actionId: string): void {
    const timer = this.timers.get(actionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(actionId);
    }
  }
}

const store = new T3Store();
const pressTracker = new LongPressTracker();
const fetchingProjections = new Set<string>();

const client = new T3Client(
  {
    onConnectionChange: (state, detail) => store.setConnection(state, detail),
    onConfigSnapshot: (cfg) => store.applyConfigSnapshot(cfg),
    onProvidersUpdated: (providers) => store.applyProvidersUpdated(providers),
    onSettingsUpdated: (settings) => store.applySettingsUpdated(settings),
    onPeerLinksUpdated: (links) => store.applyPeerLinksUpdated(links),
    onUsageLimitSourcesUpdated: (sources) => store.applyUsageLimitSourcesUpdated(sources),
    onShellSnapshot: (projects, threads, isEnrichment) =>
      store.applyShellSnapshot(projects, threads, isEnrichment),
    onProjectUpdated: (project) => store.applyProjectUpdated(project),
    onProjectRemoved: (projectId) => store.applyProjectRemoved(projectId),
    onThreadUpdated: (thread, location) => store.applyThreadUpdated(thread, location),
    onThreadRemoved: (threadId) => store.applyThreadRemoved(threadId)
  },
  {
    logger: (level, msg) => {
      if (level === "error") streamDeck.logger.error(msg);
      else if (level === "warn") streamDeck.logger.warn(msg);
      else streamDeck.logger.info(msg);
    }
  }
);

const surfaceCallbacks: SurfaceDispatchCallbacks = {
  approveRequest: (threadId, requestId, decision) =>
    client.approveRequest(threadId, requestId, decision),
  respondToUserInput: (threadId, requestId, answers) =>
    client.respondToUserInput(threadId, requestId, answers),
  dismissUserInput: (threadId, requestId) => client.dismissUserInput(threadId, requestId),
  sendPrompt: async (threadId, text, mode) => {
    const thread = store.getThreadById(threadId);
    await client.sendQuickMessage(threadId, text, mode, thread?.activeRunId ?? null);
  },
  snoozeThreadUntil: (threadId, iso) => client.snoozeThreadUntil(threadId, iso),
  unsnoozeThread: (threadId) => client.unsnoozeThread(threadId),
  settleToggle: async (threadId) => {
    const thread = store.getThreadById(threadId);
    if (!thread) return;
    if (isThreadSettled(thread)) {
      await client.unsettleThread(threadId);
      store.setToast("settle", "UNSETTLED", "#38BDF8");
    } else {
      await client.settleThread(threadId);
      store.setToast("settle", "SETTLED", "#10B981");
    }
  },
  pinToggle: async (threadId) => {
    const thread = store.getThreadById(threadId);
    if (!thread) return;
    if (thread.pinnedAt) {
      await client.unpinThread(threadId);
      store.setToast("settle", "UNPINNED", "#94A3B8");
    } else {
      await client.pinThread(threadId);
      store.setToast("settle", "PINNED ★", "#F59E0B");
    }
  },
  markThreadUnread: (threadId) => client.markThreadUnread(threadId),
  interruptOrStop: async (threadId) => {
    const thread = store.getThreadById(threadId);
    const runId = thread?.activeRunId ?? thread?.latestRunId;
    if (thread && runId && isThreadRunning(thread)) {
      await client.interruptRun(thread.id, runId);
      store.setToast("stop", "STOPPED", "#EF4444");
    }
  },
  setModelSelection: (threadId, modelSelection) =>
    client.setModelSelection(threadId, modelSelection),
  setRuntimeMode: (threadId, runtimeMode) => client.setRuntimeMode(threadId, runtimeMode),
  setInteractionMode: (threadId, interactionMode) =>
    client.setInteractionMode(threadId, interactionMode),
  createAndOpenThread: async (input) => {
    const threadId = await client.createThread(input);
    store.focusThread(threadId);
    openThreadInApp(store.environmentId, threadId);
  },
  openThread: (threadId) => openThreadInApp(store.environmentId, threadId),
  openUrl: (url) => openUrl(url),
  resync: () => client.reconnectNow()
};

function geometryForAction(actionObj: {
  device?: { id?: string; type?: number; size?: { columns?: number; rows?: number } };
}): SurfaceGeometry {
  return geometryFromDevice(actionObj.device);
}

function keySlot(
  actionObj: {
    isKey(): boolean;
    coordinates?: { column: number; row: number };
    device?: { id?: string; type?: number; size?: { columns?: number; rows?: number } };
  },
  fallback: number
): number {
  const c = actionObj.isKey() ? actionObj.coordinates : undefined;
  return c ? keySlotForCoords(c.column, c.row, geometryForAction(actionObj)) : fallback;
}

function setKeySvg(key: KeyAction, svg: string): Promise<void> {
  return key.setImage(svgDataUri(svg));
}

function setDialSvg(dial: DialAction, svg: string): Promise<void> {
  return dial.setFeedback({ canvas: svgDataUri(svg) });
}

function renderKeySurface(key: KeyAction, baseSvg: () => string): Promise<void> {
  const geom = geometryForAction(key);
  if (store.getOverlay(geom.deviceId).kind !== "none" && key.coordinates) {
    const ovSvg = renderOverlayKeySvg(store, key.coordinates.column, key.coordinates.row, geom);
    if (ovSvg) return setKeySvg(key, ovSvg);
  }
  return setKeySvg(key, baseSvg());
}

function renderDialSurface(dial: DialAction, baseSvg: () => string): Promise<void> {
  const geom = geometryForAction(dial);
  if (store.getOverlay(geom.deviceId).kind !== "none") {
    const ovSvg = renderOverlayDialSvg(store, dial.coordinates.column, geom);
    if (ovSvg) return setDialSvg(dial, ovSvg);
  }
  return setDialSvg(dial, baseSvg());
}

function routeOverlayKeyDown(ev: KeyDownEvent): boolean {
  const geom = geometryForAction(ev.action);
  if (store.getOverlay(geom.deviceId).kind === "none") return false;
  if (!ev.action.isKey() || !ev.action.coordinates) return false;
  const { column, row } = ev.action.coordinates;
  pressTracker.down(ev.action.id, async () => {
    try {
      await handleOverlayKeyPress(store, column, row, true, surfaceCallbacks, geom);
    } catch (err) {
      streamDeck.logger.error(`overlay long key failed: ${String(err)}`);
      await ev.action.showAlert();
    }
  });
  return true;
}

function routeOverlayKeyUp(ev: KeyUpEvent): boolean {
  if (pressTracker.consumeLongRelease(ev.action.id)) return true;
  const geom = geometryForAction(ev.action);
  if (store.getOverlay(geom.deviceId).kind === "none") return false;
  if (!ev.action.isKey() || !ev.action.coordinates) return false;
  const { column, row } = ev.action.coordinates;
  pressTracker.up(ev.action.id, async () => {
    try {
      await handleOverlayKeyPress(store, column, row, false, surfaceCallbacks, geom);
    } catch (err) {
      streamDeck.logger.error(`overlay key failed: ${String(err)}`);
      await ev.action.showAlert();
    }
  });
  return true;
}

function routeOverlayDialRotate(ev: DialRotateEvent): boolean {
  const geom = geometryForAction(ev.action);
  if (store.getOverlay(geom.deviceId).kind === "none") return false;
  return handleOverlayDialRotate(store, ev.action.coordinates.column, ev.payload.ticks, geom);
}

function routeOverlayDialTapOrPress(dial: DialAction): boolean {
  const geom = geometryForAction(dial);
  if (store.getOverlay(geom.deviceId).kind === "none") return false;
  void handleOverlayDialTapOrPress(store, dial.coordinates.column, surfaceCallbacks, geom).catch(
    (err) => {
      streamDeck.logger.error(`overlay dial action failed: ${String(err)}`);
      void dial.showAlert();
    }
  );
  return true;
}

function syncBackgroundData(): void {
  if (!client.isConnected) return;

  // 1. Fetch full thread projection on demand whenever a pending approval/question arrives
  for (const threadId of store.getThreadsNeedingProjectionFetch()) {
    if (fetchingProjections.has(threadId)) continue;
    fetchingProjections.add(threadId);
    void client
      .getThreadProjection(threadId)
      .then((payload) => {
        store.applyThreadProjection(threadId, payload);
      })
      .catch((err) => {
        streamDeck.logger.warn(`getThreadProjection(${threadId}) failed: ${String(err)}`);
      })
      .finally(() => {
        fetchingProjections.delete(threadId);
      });
  }

  // 2. Keep live AI prompt suggestion subscribed for the focused thread
  const focusedId = store.getFocusedThread()?.id ?? null;
  client.watchPromptSuggestion(focusedId, (suggestion) => {
    store.setPromptSuggestion(suggestion);
  });
}

// ============================================================
// KEY ACTIONS (4x2 Mission Control + Panoramic Overlays)
// ============================================================

@action({ UUID: `${PLUGIN_ID}.fleet-attention` })
class FleetAttentionAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isKey()) return this.render(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    if (routeOverlayKeyDown(ev)) return;
    const slot = keySlot(ev.action, 0);
    const deviceId = geometryForAction(ev.action).deviceId;
    pressTracker.down(ev.action.id, () => {
      store.openFleetOverlay(slot, deviceId);
    });
  }

  override onKeyUp(ev: KeyUpEvent): void {
    if (routeOverlayKeyUp(ev)) return;
    const slot = keySlot(ev.action, 0);
    const deviceId = geometryForAction(ev.action).deviceId;
    pressTracker.up(ev.action.id, async () => {
      if (store.connectionState !== "connected") {
        await client.reconnectNow();
        store.setToast("fleet", "RECONNECTING", "#38BDF8");
        return;
      }
      if (store.openApprovalOverlay(undefined, slot, deviceId)) return;
      if (store.openQuestionOverlay(undefined, slot, deviceId)) return;
      const target = store.getNextAttentionThread();
      if (!target) {
        store.openFleetOverlay(slot, deviceId);
        return;
      }
      store.focusThread(target.id);
      openThreadInApp(store.environmentId, target.id);
      store.setToast("fleet", "FOCUSED", "#38BDF8", 900);
    });
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isKey()) void this.render(a);
    });
  }

  private render(key: KeyAction): Promise<void> {
    return renderKeySurface(key, () =>
      renderFleetAttentionKey(
        store.getFleetStats(),
        store.connectionState === "connected",
        store.getToast("fleet")
      )
    );
  }
}

@action({ UUID: `${PLUGIN_ID}.approve` })
class ApproveAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isKey()) return this.render(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    if (routeOverlayKeyDown(ev)) return;
    const slot = keySlot(ev.action, 1);
    const deviceId = geometryForAction(ev.action).deviceId;
    pressTracker.down(ev.action.id, () => {
      // Never blindly session-approve from base layer — open panoramic Approval Inspector first
      if (
        !store.openApprovalOverlay(undefined, slot, deviceId) &&
        !store.openQuestionOverlay(undefined, slot, deviceId)
      ) {
        void ev.action.showAlert();
      }
    });
  }

  override onKeyUp(ev: KeyUpEvent): void {
    if (routeOverlayKeyUp(ev)) return;
    const slot = keySlot(ev.action, 1);
    const deviceId = geometryForAction(ev.action).deviceId;
    pressTracker.up(ev.action.id, async () => {
      const target = store.getActionableApprovalThread();
      if (!target || !target.pendingRuntimeRequest) {
        const focused = store.getFocusedThread();
        if (focused) openThreadInApp(store.environmentId, focused.id);
        else await ev.action.showAlert();
        return;
      }

      if (isQuestionRequest(target)) {
        store.openQuestionOverlay(target.id, slot, deviceId);
        return;
      }

      // 2-step safe approval: first press opens the panoramic Approval Inspector
      store.openApprovalOverlay(target.id, slot, deviceId);
    });
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isKey()) void this.render(a);
    });
  }

  private render(key: KeyAction): Promise<void> {
    return renderKeySurface(key, () =>
      renderApproveKey(
        store.getActionableApprovalThread(),
        store.getFocusedThread(),
        store.getToast("approve"),
        store.getPendingApprovalQueue().length
      )
    );
  }
}

@action({ UUID: `${PLUGIN_ID}.stop-deny` })
class StopDenyAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isKey()) return this.render(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    if (routeOverlayKeyDown(ev)) return;
    pressTracker.down(ev.action.id, async () => {
      const focused = store.getFocusedThread();
      if (!focused) {
        await ev.action.showAlert();
        return;
      }
      try {
        await client.forceStopThread(focused.id);
        store.setToast("stop", "FORCE KILLED", "#EF4444");
      } catch (err) {
        streamDeck.logger.error(`forceStopThread failed: ${String(err)}`);
        await ev.action.showAlert();
      }
    });
  }

  override onKeyUp(ev: KeyUpEvent): void {
    if (routeOverlayKeyUp(ev)) return;
    pressTracker.up(ev.action.id, async () => {
      const approval = store.getActionableApprovalThread();
      if (approval && isApprovalRequest(approval) && approval.pendingRuntimeRequest) {
        const slot = keySlot(ev.action, 2);
        const deviceId = geometryForAction(ev.action).deviceId;
        // Open Approval Inspector so you can confirm which request you are declining
        store.openApprovalOverlay(approval.id, slot, deviceId);
        return;
      }

      const focused = store.getFocusedThread();
      const runId = focused?.activeRunId ?? focused?.latestRunId;
      if (!focused || !isThreadRunning(focused) || !runId) {
        await ev.action.showAlert();
        return;
      }
      try {
        await client.interruptRun(focused.id, runId);
        store.setToast("stop", "STOPPED", "#EF4444");
      } catch (err) {
        streamDeck.logger.error(`interruptRun failed: ${String(err)}`);
        await ev.action.showAlert();
      }
    });
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isKey()) void this.render(a);
    });
  }

  private render(key: KeyAction): Promise<void> {
    return renderKeySurface(key, () =>
      renderStopDenyKey(
        store.getActionableApprovalThread(),
        store.getFocusedThread(),
        store.getToast("stop")
      )
    );
  }
}

@action({ UUID: `${PLUGIN_ID}.settle-pin` })
class SettlePinAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isKey()) return this.render(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    if (routeOverlayKeyDown(ev)) return;
    const slot = keySlot(ev.action, 3);
    const deviceId = geometryForAction(ev.action).deviceId;
    pressTracker.down(ev.action.id, () => {
      store.openThreadToolsOverlay(slot, deviceId);
    });
  }

  override onKeyUp(ev: KeyUpEvent): void {
    if (routeOverlayKeyUp(ev)) return;
    pressTracker.up(ev.action.id, async () => {
      const thread = store.getFocusedThread();
      if (!thread) {
        await ev.action.showAlert();
        return;
      }
      try {
        await surfaceCallbacks.settleToggle(thread.id);
      } catch (err) {
        streamDeck.logger.error(`settle toggle failed: ${String(err)}`);
        await ev.action.showAlert();
      }
    });
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isKey()) void this.render(a);
    });
  }

  private render(key: KeyAction): Promise<void> {
    return renderKeySurface(key, () =>
      renderSettlePinKey(store.getFocusedThread(), store.getToast("settle"))
    );
  }
}

@action({ UUID: `${PLUGIN_ID}.new-thread` })
class NewThreadAction extends SingletonAction<NewThreadSettings> {
  private settingsByAction = new Map<string, NewThreadSettings>();

  override onWillAppear(ev: WillAppearEvent<NewThreadSettings>): void | Promise<void> {
    this.settingsByAction.set(ev.action.id, ev.payload.settings ?? {});
    if (ev.action.isKey()) return this.render(ev.action);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<NewThreadSettings>): void {
    this.settingsByAction.set(ev.action.id, ev.payload.settings ?? {});
    if (ev.action.isKey()) void this.render(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent<NewThreadSettings>): void {
    this.settingsByAction.set(ev.action.id, ev.payload.settings ?? {});
    if (routeOverlayKeyDown(ev)) return;
    const slot = keySlot(ev.action, 4);
    const deviceId = geometryForAction(ev.action).deviceId;
    const cfg = this.settingsByAction.get(ev.action.id) ?? {};
    const firstPicker = cfg.firstPicker ?? "project";
    const defaultMode = cfg.defaultInteractionMode === "plan" ? "plan" : "default";

    pressTracker.down(ev.action.id, () => {
      store.openNewChatBuilderOverlay(slot, firstPicker, defaultMode, deviceId);
    });
  }

  override onKeyUp(ev: KeyUpEvent): void {
    if (routeOverlayKeyUp(ev)) return;
    pressTracker.up(ev.action.id, async () => {
      const cfg = this.settingsByAction.get(ev.action.id) ?? {};
      const defaultMode = cfg.defaultInteractionMode === "plan" ? "plan" : "default";
      const focused = store.getFocusedThread();
      const targetProj =
        (focused ? store.getProjectById(focused.projectId) : null) ?? store.getLaunchProjects()[0];
      if (!targetProj) {
        await ev.action.showAlert();
        return;
      }
      const modelSelection = store.getDefaultModelSelectionForProject(targetProj);
      if (!modelSelection) {
        await ev.action.showAlert();
        return;
      }
      try {
        await surfaceCallbacks.createAndOpenThread({
          projectId: targetProj.id,
          modelSelection,
          interactionMode: defaultMode,
          workspaceMode: targetProj.defaultThreadEnvMode === "worktree" ? "worktree" : "local"
        });
        store.setToast("new", targetProj.title.toUpperCase(), "#38BDF8", 1100);
      } catch (err) {
        streamDeck.logger.error(`createAndOpenThread failed: ${String(err)}`);
        await ev.action.showAlert();
      }
    });
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isKey()) void this.render(a);
    });
  }

  private render(key: KeyAction): Promise<void> {
    return renderKeySurface(key, () => {
      const focused = store.getFocusedThread();
      const proj = focused ? store.getProjectName(focused.projectId) : undefined;
      const cfg = this.settingsByAction.get(key.id) ?? {};
      const holdHint =
        cfg.firstPicker === "environment"
          ? "HOLD: PICK ENV"
          : cfg.firstPicker === "model"
            ? "HOLD: MODELS"
            : "HOLD: PROJECTS";
      return renderNewThreadKey(proj, store.getToast("new"), holdHint);
    });
  }
}

@action({ UUID: `${PLUGIN_ID}.quick-prompt` })
class QuickPromptAction extends SingletonAction<QuickPromptSettings> {
  private settingsByAction = new Map<string, QuickPromptSettings>();

  override onWillAppear(ev: WillAppearEvent<QuickPromptSettings>): void | Promise<void> {
    this.settingsByAction.set(ev.action.id, ev.payload.settings ?? {});
    if (ev.action.isKey()) return this.renderKey(ev.action);
    if (ev.action.isDial()) return this.renderDial(ev.action);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<QuickPromptSettings>): void {
    this.settingsByAction.set(ev.action.id, ev.payload.settings ?? {});
    if (ev.action.isKey()) void this.renderKey(ev.action);
    if (ev.action.isDial()) void this.renderDial(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent<QuickPromptSettings>): void {
    this.settingsByAction.set(ev.action.id, ev.payload.settings ?? {});
    if (routeOverlayKeyDown(ev)) return;
    const slot = keySlot(ev.action, 5);
    const deviceId = geometryForAction(ev.action).deviceId;
    pressTracker.down(ev.action.id, () => {
      store.openPromptsOverlay(slot, deviceId);
    });
  }

  override onKeyUp(ev: KeyUpEvent<QuickPromptSettings>): void {
    if (routeOverlayKeyUp(ev)) return;
    pressTracker.up(ev.action.id, async () => {
      const thread = store.getFocusedThread();
      if (!thread) {
        await ev.action.showAlert();
        return;
      }
      const cfg = this.settingsByAction.get(ev.action.id) ?? {};
      const promptText = (cfg.prompt || "Continue").trim();
      const mode = cfg.mode === "steer" || cfg.mode === "queue" ? cfg.mode : "auto";
      try {
        await client.sendQuickMessage(thread.id, promptText, mode, thread.activeRunId);
        store.setToast(
          `prompt:${ev.action.id}`,
          thread.activeRunId ? "STEERED" : "SENT",
          "#22D3EE"
        );
      } catch (err) {
        streamDeck.logger.error(`sendQuickMessage failed: ${String(err)}`);
        await ev.action.showAlert();
      }
    });
  }

  override onDialRotate(ev: DialRotateEvent): void {
    if (routeOverlayDialRotate(ev)) return;
    store.stepPromptDial(ev.payload.ticks);
  }

  override async onDialUp(ev: DialUpEvent): Promise<void> {
    if (routeOverlayDialTapOrPress(ev.action)) return;
    await this.dispatchDialPrompt(ev.action);
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    if (routeOverlayDialTapOrPress(ev.action)) return;
    await this.dispatchDialPrompt(ev.action);
  }

  private resolveDialPrompt(): { label: string; text: string; isAiNext: boolean } {
    const thread = store.getFocusedThread();
    const idx = store.promptDialIndex;
    if (idx === 0) {
      if (store.promptSuggestion && thread && store.promptSuggestion.threadId === thread.id) {
        return { label: "AI NEXT", text: store.promptSuggestion.text, isAiNext: true };
      }
      return { label: "CONTINUE", text: "Continue", isAiNext: false };
    }
    if (idx === 1) {
      return { label: "IMPLEMENT", text: "Implement the proposed plan.", isAiNext: false };
    }
    const preset = QUICK_PROMPT_PRESETS[idx - 2];
    return preset
      ? { label: preset.label, text: preset.prompt, isAiNext: false }
      : { label: "CONTINUE", text: "Continue", isAiNext: false };
  }

  private async dispatchDialPrompt(dial: DialAction): Promise<void> {
    const thread = store.getFocusedThread();
    if (!thread) {
      await dial.showAlert();
      return;
    }
    const picked = this.resolveDialPrompt();
    try {
      await client.sendQuickMessage(thread.id, picked.text, "auto", thread.activeRunId);
      store.setToast("prompt-dial", `SENT: ${picked.label}`, "#22D3EE", 1200);
    } catch (err) {
      streamDeck.logger.error(`prompt dial dispatch failed: ${String(err)}`);
      await dial.showAlert();
    }
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isKey()) void this.renderKey(a);
      else if (a.isDial()) void this.renderDial(a);
    });
  }

  private renderKey(key: KeyAction): Promise<void> {
    return renderKeySurface(key, () => {
      const cfg = this.settingsByAction.get(key.id) ?? {};
      const label = (cfg.label || "CONTINUE").trim();
      const mode = cfg.mode === "steer" || cfg.mode === "queue" ? cfg.mode : "auto";
      return renderQuickPromptKey(
        store.getFocusedThread(),
        label,
        mode,
        store.getToast(`prompt:${key.id}`)
      );
    });
  }

  private renderDial(dial: DialAction): Promise<void> {
    return renderDialSurface(dial, () => {
      const picked = this.resolveDialPrompt();
      const total = 2 + QUICK_PROMPT_PRESETS.length;
      return renderQuickPromptDialCanvas(
        store.getFocusedThread(),
        picked.label,
        picked.text,
        store.promptDialIndex,
        total,
        picked.isAiNext,
        store.getToast("prompt-dial")
      );
    });
  }
}

@action({ UUID: `${PLUGIN_ID}.open-thread` })
class OpenThreadAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isKey()) return this.render(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    if (routeOverlayKeyDown(ev)) return;
    pressTracker.down(ev.action.id, () => {
      const thread = store.getFocusedThread();
      const pr = thread ? primaryPullRequest(thread) : null;
      if (pr?.url) {
        openUrl(pr.url);
        store.setToast("open", `PR #${pr.number}`, "#10B981", 1000);
      } else if (thread) {
        openThreadInApp(store.environmentId, thread.id);
        store.setToast("open", "OPENED", "#38BDF8", 900);
      }
    });
  }

  override onKeyUp(ev: KeyUpEvent): void {
    if (routeOverlayKeyUp(ev)) return;
    pressTracker.up(ev.action.id, async () => {
      const thread = store.getFocusedThread();
      if (!thread) {
        await ev.action.showAlert();
        return;
      }
      openThreadInApp(store.environmentId, thread.id);
      store.setToast("open", "OPENED", "#38BDF8", 900);
    });
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isKey()) void this.render(a);
    });
  }

  private render(key: KeyAction): Promise<void> {
    return renderKeySurface(key, () => {
      const thread = store.getFocusedThread();
      const projectName = thread ? store.getProjectName(thread.projectId) : "T3";
      return renderOpenThreadKey(thread, projectName, store.getToast("open"));
    });
  }
}

@action({ UUID: `${PLUGIN_ID}.snooze-sync` })
class SnoozeSyncAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isKey()) return this.renderKey(ev.action);
    if (ev.action.isDial()) return this.renderDial(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    if (routeOverlayKeyDown(ev)) return;
    const slot = keySlot(ev.action, 7);
    const deviceId = geometryForAction(ev.action).deviceId;
    pressTracker.down(ev.action.id, () => {
      if (store.connectionState !== "connected") {
        store.setToast("snooze", "SYNCING", "#38BDF8", 1200);
        void client.reconnectNow();
        return;
      }
      store.openSnoozeOverlay(slot, deviceId);
    });
  }

  override onKeyUp(ev: KeyUpEvent): void {
    if (routeOverlayKeyUp(ev)) return;
    pressTracker.up(ev.action.id, async () => {
      if (store.connectionState !== "connected") {
        await client.reconnectNow();
        return;
      }
      const thread = store.getFocusedThread();
      if (!thread) {
        await ev.action.showAlert();
        return;
      }
      try {
        if (isThreadSnoozed(thread)) {
          await client.unsnoozeThread(thread.id);
          store.setToast("snooze", "UNSNOOZED", "#38BDF8");
        } else {
          const def = store.getDefaultSnoozePreset();
          await client.snoozeThreadUntil(thread.id, def.snoozedUntilIso);
          store.setToast("snooze", `SNOOZED ${def.shortLabel}`, "#818CF8");
        }
      } catch (err) {
        streamDeck.logger.error(`snooze toggle failed: ${String(err)}`);
        await ev.action.showAlert();
      }
    });
  }

  override onDialRotate(ev: DialRotateEvent): void {
    if (routeOverlayDialRotate(ev)) return;
    store.stepSnoozeDial(ev.payload.ticks);
  }

  override async onDialUp(ev: DialUpEvent): Promise<void> {
    if (routeOverlayDialTapOrPress(ev.action)) return;
    await this.applyDialSnooze(ev.action);
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    if (routeOverlayDialTapOrPress(ev.action)) return;
    await this.applyDialSnooze(ev.action);
  }

  private async applyDialSnooze(dial: DialAction): Promise<void> {
    if (store.connectionState !== "connected") {
      await client.reconnectNow();
      return;
    }
    const thread = store.getFocusedThread();
    if (!thread) {
      await dial.showAlert();
      return;
    }
    try {
      if (isThreadSnoozed(thread)) {
        await client.unsnoozeThread(thread.id);
        store.setToast("snooze-dial", "UNSNOOZED", "#10B981", 1100);
        return;
      }
      const presets = store.getResolvedSnoozePresets();
      const preset = presets[store.snoozeDialIndex % Math.max(1, presets.length)] ?? store.getDefaultSnoozePreset();
      await client.snoozeThreadUntil(thread.id, preset.snoozedUntilIso);
      store.setToast("snooze-dial", `SNOOZED ${preset.shortLabel}`, "#818CF8", 1200);
    } catch (err) {
      streamDeck.logger.error(`snooze dial apply failed: ${String(err)}`);
      await dial.showAlert();
    }
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isKey()) void this.renderKey(a);
      else if (a.isDial()) void this.renderDial(a);
    });
  }

  private renderKey(key: KeyAction): Promise<void> {
    return renderKeySurface(key, () =>
      renderSnoozeSyncKey(
        store.getFocusedThread(),
        store.connectionState === "connected",
        store.getToast("snooze"),
        store.getDefaultSnoozePreset().shortLabel
      )
    );
  }

  private renderDial(dial: DialAction): Promise<void> {
    return renderDialSurface(dial, () => {
      const presets = store.getResolvedSnoozePresets();
      const idx = store.snoozeDialIndex % Math.max(1, presets.length);
      const preset = presets[idx] ?? store.getDefaultSnoozePreset();
      return renderSnoozeDialCanvas(
        store.getFocusedThread(),
        preset.label,
        preset.sublabel,
        idx,
        presets.length,
        store.connectionState === "connected",
        store.getToast("snooze-dial")
      );
    });
  }
}

@action({ UUID: `${PLUGIN_ID}.thread-slot` })
class ThreadSlotAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isKey()) {
      this.refreshAll();
    }
  }

  override onWillDisappear(): void {
    this.refreshAll();
  }

  override onKeyDown(ev: KeyDownEvent): void {
    if (routeOverlayKeyDown(ev)) return;
    if (!ev.action.isKey()) return;
    const idx = this.slotIndex(ev.action);
    const thread = store.getFilteredThreads()[idx];
    if (!thread) {
      void ev.action.showAlert();
      return;
    }
    const slot = keySlot(ev.action, idx);
    const deviceId = geometryForAction(ev.action).deviceId;
    store.focusThread(thread.id);
    if (store.openApprovalOverlay(thread.id, slot, deviceId)) return;
    if (store.openQuestionOverlay(thread.id, slot, deviceId)) return;
    openThreadInApp(store.environmentId, thread.id);
  }

  override onKeyUp(ev: KeyUpEvent): void {
    routeOverlayKeyUp(ev);
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isKey()) void this.render(a);
    });
  }

  /**
   * Auto-numbers all placed Thread Slot keys on the same device in reading order (row, col),
   * so MK.2's 3-slot column, XL's 16-slot Fleet Wall, and Plus XL's 20-slot wall map cleanly to #1..#N.
   */
  private slotIndex(key: KeyAction): number {
    const deviceId = geometryForAction(key).deviceId;
    const peers: KeyAction[] = [];
    this.actions.forEach((a) => {
      if (a.isKey() && geometryForAction(a).deviceId === deviceId) {
        peers.push(a);
      }
    });
    peers.sort((a, b) => {
      const ar = a.coordinates?.row ?? 0;
      const br = b.coordinates?.row ?? 0;
      if (ar !== br) return ar - br;
      return (a.coordinates?.column ?? 0) - (b.coordinates?.column ?? 0);
    });
    const idx = peers.findIndex((p) => p.id === key.id);
    return idx >= 0 ? idx : 0;
  }

  private render(key: KeyAction): Promise<void> {
    return renderKeySurface(key, () => {
      const idx = this.slotIndex(key);
      const thread = store.getFilteredThreads()[idx] ?? null;
      const projectName = thread ? store.getProjectName(thread.projectId) : "";
      return renderThreadSlotKey(
        idx + 1,
        thread,
        projectName,
        store.connectionState === "connected"
      );
    });
  }
}

// ============================================================
// DUAL-CONTROLLER DIAL & KEYPAD ACTIONS (All Stream Deck Devices)
// ============================================================

@action({ UUID: `${PLUGIN_ID}.thread-dial` })
class ThreadDialAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isDial()) return this.renderDial(ev.action);
    if (ev.action.isKey()) return this.renderKey(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    if (routeOverlayKeyDown(ev)) return;
    const slot = keySlot(ev.action, 0);
    const deviceId = geometryForAction(ev.action).deviceId;
    pressTracker.down(ev.action.id, () => {
      store.openFleetOverlay(slot, deviceId);
    });
  }

  override onKeyUp(ev: KeyUpEvent): void {
    if (routeOverlayKeyUp(ev)) return;
    pressTracker.up(ev.action.id, () => {
      store.stepFocus(1);
    });
  }

  override onDialRotate(ev: DialRotateEvent): void {
    if (routeOverlayDialRotate(ev)) return;
    store.stepFocus(ev.payload.ticks);
  }

  override onDialUp(ev: DialUpEvent): void {
    if (routeOverlayDialTapOrPress(ev.action)) return;
    const thread = store.getFocusedThread();
    if (!thread) {
      void ev.action.showAlert();
      return;
    }
    openThreadInApp(store.environmentId, thread.id);
    store.setToast("thread-dial", "OPENED IN T3", "#38BDF8", 900);
  }

  override onTouchTap(ev: TouchTapEvent): void {
    if (routeOverlayDialTapOrPress(ev.action)) return;
    const next = store.cycleFilterMode();
    store.setToast("thread-dial", `FILTER: ${next.toUpperCase()}`, "#38BDF8", 900);
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isDial()) void this.renderDial(a);
      else if (a.isKey()) void this.renderKey(a);
    });
  }

  private renderKey(key: KeyAction): Promise<void> {
    return renderKeySurface(key, () => {
      const thread = store.getFocusedThread();
      const { index, total } = store.getFocusedIndex();
      const projectName = thread ? store.getProjectName(thread.projectId) : "";
      return renderThreadKey(
        thread,
        projectName,
        store.filterMode,
        index,
        total,
        store.connectionState === "connected",
        store.getToast("thread-dial")
      );
    });
  }

  private renderDial(dial: DialAction): Promise<void> {
    return renderDialSurface(dial, () => {
      const thread = store.getFocusedThread();
      const { index, total } = store.getFocusedIndex();
      const projectName = thread ? store.getProjectName(thread.projectId) : "";
      return renderThreadDialCanvas(
        thread,
        projectName,
        store.filterMode,
        index,
        total,
        store.connectionState === "connected",
        store.getToast("thread-dial")
      );
    });
  }
}

@action({ UUID: `${PLUGIN_ID}.model-dial` })
class ModelDialAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isDial()) return this.renderDial(ev.action);
    if (ev.action.isKey()) return this.renderKey(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    if (routeOverlayKeyDown(ev)) return;
    pressTracker.down(ev.action.id, () => {
      this.toggleScope();
    });
  }

  override onKeyUp(ev: KeyUpEvent): void {
    if (routeOverlayKeyUp(ev)) return;
    const slot = keySlot(ev.action, 1);
    const deviceId = geometryForAction(ev.action).deviceId;
    pressTracker.up(ev.action.id, () => {
      store.openModelPickerOverlay(slot, deviceId);
    });
  }

  override onDialRotate(ev: DialRotateEvent): void {
    if (routeOverlayDialRotate(ev)) return;
    store.scrubModel(ev.payload.ticks);
  }

  override onDialDown(ev: DialDownEvent): void {
    const geom = geometryForAction(ev.action);
    if (store.getOverlay(geom.deviceId).kind !== "none") return;
    pressTracker.down(ev.action.id, () => {
      this.toggleScope();
    });
  }

  override onDialUp(ev: DialUpEvent): void {
    if (routeOverlayDialTapOrPress(ev.action)) return;
    pressTracker.up(ev.action.id, async () => {
      if (store.pendingModelIndex !== null) {
        await this.commitPending(ev.action);
      } else {
        this.toggleScope();
      }
    });
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    if (routeOverlayDialTapOrPress(ev.action)) return;
    if (store.pendingModelIndex !== null) {
      await this.commitPending(ev.action);
    } else {
      this.toggleScope();
    }
  }

  private toggleScope(): void {
    const next = store.toggleModelScope();
    store.setToast(
      "model-dial",
      next === "favorites" ? "★ FAVORITES ONLY" : "ALL MODELS",
      next === "favorites" ? "#F59E0B" : "#38BDF8",
      1100
    );
  }

  private async commitPending(dial: DialAction): Promise<void> {
    const thread = store.getFocusedThread();
    const { catalog } = store.getActiveModelEntry(thread);
    if (!thread || store.pendingModelIndex === null) {
      return;
    }
    const chosen = catalog[store.pendingModelIndex];
    if (!chosen) return;
    store.clearPendingModel();

    try {
      await client.setModelSelection(thread.id, {
        instanceId: chosen.instanceId,
        model: chosen.slug
      });
      store.setToast("model-dial", `SET: ${chosen.shortName}`, chosen.accentColor, 1300);
    } catch (err) {
      streamDeck.logger.error(`setModelSelection failed: ${String(err)}`);
      await dial.showAlert();
    }
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isDial()) void this.renderDial(a);
      else if (a.isKey()) void this.renderKey(a);
    });
  }

  private renderKey(key: KeyAction): Promise<void> {
    return renderKeySurface(key, () => {
      const thread = store.getFocusedThread();
      const { entry, scope } = store.getActiveModelEntry(thread);
      return renderModelKey(thread, entry, scope, store.getToast("model-dial"));
    });
  }

  private renderDial(dial: DialAction): Promise<void> {
    return renderDialSurface(dial, () => {
      const thread = store.getFocusedThread();
      const { catalog, activeIndex, entry, scope } = store.getActiveModelEntry(thread);
      return renderModelDialCanvas(
        thread,
        catalog,
        activeIndex,
        store.pendingModelIndex,
        scope,
        entry,
        store.getToast("model-dial")
      );
    });
  }
}

@action({ UUID: `${PLUGIN_ID}.mode-dial` })
class ModeEffortDialAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isDial()) return this.renderDial(ev.action);
    if (ev.action.isKey()) return this.renderKey(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    if (routeOverlayKeyDown(ev)) return;
    pressTracker.down(ev.action.id, async () => {
      const thread = store.getFocusedThread();
      if (!thread) {
        await ev.action.showAlert();
        return;
      }
      const next = thread.interactionMode === "plan" ? "default" : "plan";
      try {
        await client.setInteractionMode(thread.id, next);
        store.setToast(
          "mode-dial",
          next === "plan" ? "PLAN MODE ON" : "CODE MODE",
          next === "plan" ? "#C084FC" : "#10B981",
          1100
        );
      } catch (err) {
        streamDeck.logger.error(`interaction mode toggle failed: ${String(err)}`);
        await ev.action.showAlert();
      }
    });
  }

  override onKeyUp(ev: KeyUpEvent): void {
    if (routeOverlayKeyUp(ev)) return;
    const slot = keySlot(ev.action, 2);
    const deviceId = geometryForAction(ev.action).deviceId;
    pressTracker.up(ev.action.id, () => {
      store.openModeEffortOverlay(slot, deviceId);
    });
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    if (routeOverlayDialRotate(ev)) return;
    const thread = store.getFocusedThread();
    if (!thread) return;
    const entry = store.getThreadModelEntry(thread);
    const desc = entry?.reasoningDescriptor;
    if (desc && desc.type === "select" && desc.options && desc.options.length > 0) {
      const current = resolveReasoningValue(thread.modelSelection, desc);
      const curIdx = desc.options.findIndex((o) => o.id === current);
      const base = curIdx >= 0 ? curIdx : 0;
      const nextIdx = Math.max(0, Math.min(desc.options.length - 1, base + ev.payload.ticks));
      const chosen = desc.options[nextIdx];
      if (!chosen || chosen.id === current) return;

      const existing = normalizeOptionSelections(thread.modelSelection?.options).filter(
        (o) => o.id !== desc.id
      );
      existing.push({ id: desc.id, value: chosen.id });

      try {
        await client.setModelSelection(thread.id, {
          instanceId: thread.modelSelection?.instanceId || thread.providerInstanceId,
          model: thread.modelSelection.model,
          options: existing
        });
        store.setToast("mode-dial", `EFFORT: ${chosen.label.toUpperCase()}`, "#38BDF8", 1000);
      } catch (err) {
        streamDeck.logger.error(`effort update failed: ${String(err)}`);
        await ev.action.showAlert();
      }
      return;
    }

    await this.cycleRuntimeMode(ev.action, ev.payload.ticks >= 0 ? 1 : -1);
  }

  override async onDialUp(ev: DialUpEvent): Promise<void> {
    if (routeOverlayDialTapOrPress(ev.action)) return;
    await this.cycleRuntimeMode(ev.action, 1);
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    if (routeOverlayDialTapOrPress(ev.action)) return;
    const thread = store.getFocusedThread();
    if (!thread) return;
    const next = thread.interactionMode === "plan" ? "default" : "plan";
    try {
      await client.setInteractionMode(thread.id, next);
      store.setToast(
        "mode-dial",
        next === "plan" ? "PLAN MODE ON" : "CODE MODE",
        next === "plan" ? "#C084FC" : "#10B981",
        1100
      );
    } catch (err) {
      streamDeck.logger.error(`interaction mode toggle failed: ${String(err)}`);
      await ev.action.showAlert();
    }
  }

  private async cycleRuntimeMode(dial: DialAction, step: number): Promise<void> {
    const thread = store.getFocusedThread();
    if (!thread) return;
    const entry = store.getThreadModelEntry(thread);
    const allowed: readonly RuntimeMode[] =
      entry?.supportedRuntimeModes && entry.supportedRuntimeModes.length > 0
        ? entry.supportedRuntimeModes
        : RUNTIME_MODE_ORDER;

    const idx = allowed.indexOf(thread.runtimeMode);
    const nextIdx = ((idx >= 0 ? idx : 0) + step + allowed.length * 4) % allowed.length;
    const nextMode = allowed[nextIdx] ?? "auto";
    try {
      await client.setRuntimeMode(thread.id, nextMode);
      store.setToast("mode-dial", `MODE: ${nextMode.toUpperCase()}`, "#10B981", 1100);
    } catch (err) {
      streamDeck.logger.error(`runtime mode update failed: ${String(err)}`);
      await dial.showAlert();
    }
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isDial()) void this.renderDial(a);
      else if (a.isKey()) void this.renderKey(a);
    });
  }

  private renderKey(key: KeyAction): Promise<void> {
    return renderKeySurface(key, () => {
      const thread = store.getFocusedThread();
      const entry = store.getThreadModelEntry(thread);
      return renderModeEffortKey(thread, entry, store.getToast("mode-dial"));
    });
  }

  private renderDial(dial: DialAction): Promise<void> {
    return renderDialSurface(dial, () => {
      const thread = store.getFocusedThread();
      const entry = store.getThreadModelEntry(thread);
      return renderModeEffortDialCanvas(thread, entry, store.getToast("mode-dial"));
    });
  }
}

@action({ UUID: `${PLUGIN_ID}.usage-dial` })
class UsageDialAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isDial()) return this.renderDial(ev.action);
    if (ev.action.isKey()) return this.renderKey(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    if (routeOverlayKeyDown(ev)) return;
    pressTracker.down(ev.action.id, async () => {
      await this.refreshUsage(ev.action);
    });
  }

  override onKeyUp(ev: KeyUpEvent): void {
    if (routeOverlayKeyUp(ev)) return;
    pressTracker.up(ev.action.id, () => {
      store.stepUsageCard(1);
    });
  }

  override onDialRotate(ev: DialRotateEvent): void {
    if (routeOverlayDialRotate(ev)) return;
    store.stepUsageCard(ev.payload.ticks);
  }

  override async onDialUp(ev: DialUpEvent): Promise<void> {
    if (routeOverlayDialTapOrPress(ev.action)) return;
    await this.refreshUsage(ev.action);
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    if (routeOverlayDialTapOrPress(ev.action)) return;
    await this.refreshUsage(ev.action);
  }

  private async refreshUsage(target: { showAlert(): Promise<void> }): Promise<void> {
    store.setToast("usage-dial", "REFRESHING...", "#38BDF8", 1200);
    try {
      await client.refreshProviders();
    } catch (err) {
      streamDeck.logger.error(`refreshProviders failed: ${String(err)}`);
      await target.showAlert();
    }
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isDial()) void this.renderDial(a);
      else if (a.isKey()) void this.renderKey(a);
    });
  }

  private renderKey(key: KeyAction): Promise<void> {
    return renderKeySurface(key, () => {
      const { card, index, total } = store.getCurrentUsageCard();
      return renderUsageKey(
        card,
        index,
        total,
        store.connectionState === "connected",
        store.getToast("usage-dial")
      );
    });
  }

  private renderDial(dial: DialAction): Promise<void> {
    return renderDialSurface(dial, () => {
      const { card, index, total } = store.getCurrentUsageCard();
      return renderUsageDialCanvas(
        card,
        index,
        total,
        store.connectionState === "connected",
        store.getToast("usage-dial")
      );
    });
  }
}

// ============================================================
// BOOTSTRAP & COALESCED RE-RENDERING
// ============================================================

const fleetAttention = new FleetAttentionAction();
const approveAction = new ApproveAction();
const stopDenyAction = new StopDenyAction();
const settlePinAction = new SettlePinAction();
const newThreadAction = new NewThreadAction();
const quickPromptAction = new QuickPromptAction();
const openThreadAction = new OpenThreadAction();
const snoozeSyncAction = new SnoozeSyncAction();
const threadSlotAction = new ThreadSlotAction();

const threadDialAction = new ThreadDialAction();
const modelDialAction = new ModelDialAction();
const modeDialAction = new ModeEffortDialAction();
const usageDialAction = new UsageDialAction();

const allRefreshers = [
  fleetAttention,
  approveAction,
  stopDenyAction,
  settlePinAction,
  newThreadAction,
  quickPromptAction,
  openThreadAction,
  snoozeSyncAction,
  threadSlotAction,
  threadDialAction,
  modelDialAction,
  modeDialAction,
  usageDialAction
];

let renderTimer: NodeJS.Timeout | null = null;
function scheduleRender(): void {
  syncBackgroundData();
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    for (const actionInstance of allRefreshers) {
      actionInstance.refreshAll();
    }
  }, 50);
}

store.subscribe(scheduleRender);

// Periodic refresh for relative countdowns (snooze expiry, usage reset timers)
const clockTimer = setInterval(scheduleRender, 30_000);
clockTimer.unref();

for (const actionInstance of allRefreshers) {
  streamDeck.actions.registerAction(actionInstance);
}

process.once("SIGTERM", () => {
  clearInterval(clockTimer);
  client.stop();
  process.exit(0);
});
process.once("SIGINT", () => {
  clearInterval(clockTimer);
  client.stop();
  process.exit(0);
});

client.start();
await streamDeck.connect();
