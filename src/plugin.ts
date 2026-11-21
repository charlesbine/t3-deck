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
  renderModelDialCanvas,
  renderNewThreadKey,
  renderOpenThreadKey,
  renderQuickPromptKey,
  renderSettlePinKey,
  renderSnoozeSyncKey,
  renderStopDenyKey,
  renderThreadDialCanvas,
  renderThreadSlotKey,
  renderUsageDialCanvas,
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
  resolveReasoningValue,
  RUNTIME_MODE_ORDER,
  T3Store
} from "./store.js";
import { T3Client } from "./t3-client.js";
import type { QuickPromptSettings, RuntimeMode } from "./types.js";

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
    openUrl("t3code://new");
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

  up(actionId: string, onShort: () => void | Promise<void>): void {
    const timer = this.timers.get(actionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(actionId);
    }
    if (this.firedLong.has(actionId)) {
      this.firedLong.delete(actionId);
      return;
    }
    void onShort();
  }

  private clear(actionId: string): void {
    const timer = this.timers.get(actionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(actionId);
    }
  }
}

const store = new T3Store();
const pressTracker = new LongPressTracker();

const client = new T3Client(
  {
    onConnectionChange: (state, detail) => store.setConnection(state, detail),
    onConfigSnapshot: (cfg) => store.applyConfigSnapshot(cfg),
    onProvidersUpdated: (providers) => store.applyProvidersUpdated(providers),
    onSettingsUpdated: (settings) => store.applySettingsUpdated(settings),
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

function setKeySvg(key: KeyAction, svg: string): Promise<void> {
  return key.setImage(svgDataUri(svg));
}

function setDialSvg(dial: DialAction, svg: string): Promise<void> {
  return dial.setFeedback({ canvas: svgDataUri(svg) });
}

// ============================================================
// KEY ACTIONS (4x2 Mission Control + Bonus Thread Slot)
// ============================================================

@action({ UUID: `${PLUGIN_ID}.fleet-attention` })
class FleetAttentionAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isKey()) return this.render(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    if (store.connectionState !== "connected") {
      void client.reconnectNow();
      store.setToast("fleet", "RECONNECTING", "#38BDF8");
      return;
    }
    const target = store.getNextAttentionThread();
    if (!target) {
      void ev.action.showAlert();
      return;
    }
    store.focusThread(target.id);
    openThreadInApp(store.environmentId, target.id);
    store.setToast("fleet", "FOCUSED", "#38BDF8", 900);
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isKey()) void this.render(a);
    });
  }

  private render(key: KeyAction): Promise<void> {
    const svg = renderFleetAttentionKey(
      store.getFleetStats(),
      store.connectionState === "connected",
      store.getToast("fleet")
    );
    return setKeySvg(key, svg);
  }
}

@action({ UUID: `${PLUGIN_ID}.approve` })
class ApproveAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isKey()) return this.render(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    pressTracker.down(ev.action.id, async () => {
      const target = store.getActionableApprovalThread();
      if (!target || !isApprovalRequest(target) || !target.pendingRuntimeRequest) {
        await ev.action.showAlert();
        return;
      }
      try {
        await client.approveRequest(target.id, target.pendingRuntimeRequest.id, "acceptForSession");
        store.setToast("approve", "SESSION OK", "#10B981");
      } catch (err) {
        streamDeck.logger.error(`acceptForSession failed: ${String(err)}`);
        await ev.action.showAlert();
      }
    });
  }

  override onKeyUp(ev: KeyUpEvent): void {
    pressTracker.up(ev.action.id, async () => {
      const target = store.getActionableApprovalThread();
      if (!target || !target.pendingRuntimeRequest) {
        const focused = store.getFocusedThread();
        if (focused) openThreadInApp(store.environmentId, focused.id);
        else await ev.action.showAlert();
        return;
      }

      if (isQuestionRequest(target)) {
        store.focusThread(target.id);
        openThreadInApp(store.environmentId, target.id);
        store.setToast("approve", "OPENED", "#C084FC", 900);
        return;
      }

      try {
        await client.approveRequest(target.id, target.pendingRuntimeRequest.id, "accept");
        store.setToast("approve", "APPROVED", "#10B981");
      } catch (err) {
        streamDeck.logger.error(`approve failed: ${String(err)}`);
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
    const svg = renderApproveKey(
      store.getActionableApprovalThread(),
      store.getFocusedThread(),
      store.getToast("approve")
    );
    return setKeySvg(key, svg);
  }
}

@action({ UUID: `${PLUGIN_ID}.stop-deny` })
class StopDenyAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isKey()) return this.render(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent): void {
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
    pressTracker.up(ev.action.id, async () => {
      const approval = store.getActionableApprovalThread();
      if (approval && isApprovalRequest(approval) && approval.pendingRuntimeRequest) {
        try {
          await client.approveRequest(approval.id, approval.pendingRuntimeRequest.id, "decline");
          store.setToast("stop", "DECLINED", "#FB7185");
        } catch (err) {
          streamDeck.logger.error(`decline failed: ${String(err)}`);
          await ev.action.showAlert();
        }
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
    const svg = renderStopDenyKey(
      store.getActionableApprovalThread(),
      store.getFocusedThread(),
      store.getToast("stop")
    );
    return setKeySvg(key, svg);
  }
}

@action({ UUID: `${PLUGIN_ID}.settle-pin` })
class SettlePinAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isKey()) return this.render(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    pressTracker.down(ev.action.id, async () => {
      const thread = store.getFocusedThread();
      if (!thread) {
        await ev.action.showAlert();
        return;
      }
      try {
        if (thread.pinnedAt) {
          await client.unpinThread(thread.id);
          store.setToast("settle", "UNPINNED", "#94A3B8");
        } else {
          await client.pinThread(thread.id);
          store.setToast("settle", "PINNED ★", "#F59E0B");
        }
      } catch (err) {
        streamDeck.logger.error(`pin toggle failed: ${String(err)}`);
        await ev.action.showAlert();
      }
    });
  }

  override onKeyUp(ev: KeyUpEvent): void {
    pressTracker.up(ev.action.id, async () => {
      const thread = store.getFocusedThread();
      if (!thread) {
        await ev.action.showAlert();
        return;
      }
      try {
        if (isThreadSettled(thread)) {
          await client.unsettleThread(thread.id);
          store.setToast("settle", "UNSETTLED", "#38BDF8");
        } else {
          await client.settleThread(thread.id);
          store.setToast("settle", "SETTLED", "#10B981");
        }
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
    return setKeySvg(key, renderSettlePinKey(store.getFocusedThread(), store.getToast("settle")));
  }
}

@action({ UUID: `${PLUGIN_ID}.new-thread` })
class NewThreadAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isKey()) return this.render(ev.action);
  }

  override onKeyDown(): void {
    openUrl("t3code://new");
    store.setToast("new", "OPENED", "#38BDF8", 900);
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isKey()) void this.render(a);
    });
  }

  private render(key: KeyAction): Promise<void> {
    const focused = store.getFocusedThread();
    const proj = focused ? store.getProjectName(focused.projectId) : undefined;
    return setKeySvg(key, renderNewThreadKey(proj, store.getToast("new")));
  }
}

@action({ UUID: `${PLUGIN_ID}.quick-prompt` })
class QuickPromptAction extends SingletonAction<QuickPromptSettings> {
  private settingsByAction = new Map<string, QuickPromptSettings>();

  override onWillAppear(ev: WillAppearEvent<QuickPromptSettings>): void | Promise<void> {
    this.settingsByAction.set(ev.action.id, ev.payload.settings ?? {});
    if (ev.action.isKey()) return this.render(ev.action);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<QuickPromptSettings>): void {
    this.settingsByAction.set(ev.action.id, ev.payload.settings ?? {});
    if (ev.action.isKey()) void this.render(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent<QuickPromptSettings>): void {
    this.settingsByAction.set(ev.action.id, ev.payload.settings ?? {});
    pressTracker.down(ev.action.id, () => {
      const thread = store.getFocusedThread();
      if (thread) {
        openThreadInApp(store.environmentId, thread.id);
        store.setToast(`prompt:${ev.action.id}`, "OPENED", "#38BDF8", 900);
      }
    });
  }

  override onKeyUp(ev: KeyUpEvent<QuickPromptSettings>): void {
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

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isKey()) void this.render(a);
    });
  }

  private render(key: KeyAction): Promise<void> {
    const cfg = this.settingsByAction.get(key.id) ?? {};
    const label = (cfg.label || "CONTINUE").trim();
    const mode = cfg.mode === "steer" || cfg.mode === "queue" ? cfg.mode : "auto";
    return setKeySvg(
      key,
      renderQuickPromptKey(
        store.getFocusedThread(),
        label,
        mode,
        store.getToast(`prompt:${key.id}`)
      )
    );
  }
}

@action({ UUID: `${PLUGIN_ID}.open-thread` })
class OpenThreadAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isKey()) return this.render(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent): void {
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
    const thread = store.getFocusedThread();
    const projectName = thread ? store.getProjectName(thread.projectId) : "T3";
    return setKeySvg(key, renderOpenThreadKey(thread, projectName, store.getToast("open")));
  }
}

@action({ UUID: `${PLUGIN_ID}.snooze-sync` })
class SnoozeSyncAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isKey()) return this.render(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    pressTracker.down(ev.action.id, async () => {
      store.setToast("snooze", "SYNCING", "#38BDF8", 1200);
      try {
        await client.reconnectNow();
      } catch (err) {
        streamDeck.logger.error(`reconnect failed: ${String(err)}`);
        await ev.action.showAlert();
      }
    });
  }

  override onKeyUp(ev: KeyUpEvent): void {
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
          await client.snoozeThread(thread.id, 1);
          store.setToast("snooze", "SNOOZED 1H", "#818CF8");
        }
      } catch (err) {
        streamDeck.logger.error(`snooze toggle failed: ${String(err)}`);
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
    return setKeySvg(
      key,
      renderSnoozeSyncKey(
        store.getFocusedThread(),
        store.connectionState === "connected",
        store.getToast("snooze")
      )
    );
  }
}

@action({ UUID: `${PLUGIN_ID}.thread-slot` })
class ThreadSlotAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isKey()) return this.render(ev.action);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    if (!ev.action.isKey()) return;
    const idx = this.slotIndex(ev.action);
    const thread = store.getFilteredThreads()[idx];
    if (!thread) {
      void ev.action.showAlert();
      return;
    }
    store.focusThread(thread.id);
    openThreadInApp(store.environmentId, thread.id);
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isKey()) void this.render(a);
    });
  }

  private slotIndex(key: KeyAction): number {
    const coords = key.coordinates;
    return coords ? coords.row * 4 + coords.column : 0;
  }

  private render(key: KeyAction): Promise<void> {
    const idx = this.slotIndex(key);
    const thread = store.getFilteredThreads()[idx] ?? null;
    const projectName = thread ? store.getProjectName(thread.projectId) : "";
    return setKeySvg(
      key,
      renderThreadSlotKey(idx + 1, thread, projectName, store.connectionState === "connected")
    );
  }
}

// ============================================================
// FULL-CANVAS DIAL ACTIONS (Stream Deck+ LCD Touch Strip)
// ============================================================

@action({ UUID: `${PLUGIN_ID}.thread-dial` })
class ThreadDialAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isDial()) return this.render(ev.action);
  }

  override onDialRotate(ev: DialRotateEvent): void {
    store.stepFocus(ev.payload.ticks);
  }

  override onDialUp(ev: DialUpEvent): void {
    const thread = store.getFocusedThread();
    if (!thread) {
      void ev.action.showAlert();
      return;
    }
    openThreadInApp(store.environmentId, thread.id);
    store.setToast("thread-dial", "OPENED IN T3", "#38BDF8", 900);
  }

  override onTouchTap(): void {
    const next = store.cycleFilterMode();
    store.setToast("thread-dial", `FILTER: ${next.toUpperCase()}`, "#38BDF8", 900);
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isDial()) void this.render(a);
    });
  }

  private render(dial: DialAction): Promise<void> {
    const thread = store.getFocusedThread();
    const { index, total } = store.getFocusedIndex();
    const projectName = thread ? store.getProjectName(thread.projectId) : "";
    const svg = renderThreadDialCanvas(
      thread,
      projectName,
      store.filterMode,
      index,
      total,
      store.connectionState === "connected",
      store.getToast("thread-dial")
    );
    return setDialSvg(dial, svg);
  }
}

@action({ UUID: `${PLUGIN_ID}.model-dial` })
class ModelDialAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isDial()) return this.render(ev.action);
  }

  override onDialRotate(ev: DialRotateEvent): void {
    store.scrubModel(ev.payload.ticks);
  }

  override onDialDown(ev: DialDownEvent): void {
    pressTracker.down(ev.action.id, () => {
      this.toggleScope();
    });
  }

  override onDialUp(ev: DialUpEvent): void {
    pressTracker.up(ev.action.id, async () => {
      if (store.pendingModelIndex !== null) {
        await this.commitPending(ev.action);
      } else {
        this.toggleScope();
      }
    });
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
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
      if (a.isDial()) void this.render(a);
    });
  }

  private render(dial: DialAction): Promise<void> {
    const thread = store.getFocusedThread();
    const { catalog, activeIndex, entry, scope } = store.getActiveModelEntry(thread);
    const svg = renderModelDialCanvas(
      thread,
      catalog,
      activeIndex,
      store.pendingModelIndex,
      scope,
      entry,
      store.getToast("model-dial")
    );
    return setDialSvg(dial, svg);
  }
}

@action({ UUID: `${PLUGIN_ID}.mode-dial` })
class ModeEffortDialAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isDial()) return this.render(ev.action);
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
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

    // Fallback when model has no effort selector: rotate cycles runtime mode
    await this.cycleRuntimeMode(ev.action, ev.payload.ticks >= 0 ? 1 : -1);
  }

  override async onDialUp(ev: DialUpEvent): Promise<void> {
    await this.cycleRuntimeMode(ev.action, 1);
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
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
      if (a.isDial()) void this.render(a);
    });
  }

  private render(dial: DialAction): Promise<void> {
    const thread = store.getFocusedThread();
    const entry = store.getThreadModelEntry(thread);
    return setDialSvg(
      dial,
      renderModeEffortDialCanvas(thread, entry, store.getToast("mode-dial"))
    );
  }
}

@action({ UUID: `${PLUGIN_ID}.usage-dial` })
class UsageDialAction extends SingletonAction {
  override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
    if (ev.action.isDial()) return this.render(ev.action);
  }

  override onDialRotate(ev: DialRotateEvent): void {
    store.stepUsageCard(ev.payload.ticks);
  }

  override async onDialUp(ev: DialUpEvent): Promise<void> {
    await this.refreshUsage(ev.action);
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    await this.refreshUsage(ev.action);
  }

  private async refreshUsage(dial: DialAction): Promise<void> {
    store.setToast("usage-dial", "REFRESHING...", "#38BDF8", 1200);
    try {
      await client.refreshProviders();
    } catch (err) {
      streamDeck.logger.error(`refreshProviders failed: ${String(err)}`);
      await dial.showAlert();
    }
  }

  refreshAll(): void {
    this.actions.forEach((a) => {
      if (a.isDial()) void this.render(a);
    });
  }

  private render(dial: DialAction): Promise<void> {
    const { card, index, total } = store.getCurrentUsageCard();
    return setDialSvg(
      dial,
      renderUsageDialCanvas(
        card,
        index,
        total,
        store.connectionState === "connected",
        store.getToast("usage-dial")
      )
    );
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
