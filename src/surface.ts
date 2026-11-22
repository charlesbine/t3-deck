import {
  chunkTextForKeyCards,
  renderApprovalPanoramicFrame,
  renderApproveKey,
  renderFleetAttentionKey,
  renderFleetPanoramicFrame,
  renderInfoCardKey,
  renderModeEffortDialCanvas,
  renderModeEffortKey,
  renderModeEffortPanoramicFrame,
  renderModelDialCanvas,
  renderModelKey,
  renderModelPickerPanoramicFrame,
  renderNewChatBuilderPanoramicFrame,
  renderNewChatEnvPanoramicFrame,
  renderNewChatModelPanoramicFrame,
  renderNewChatProjectPanoramicFrame,
  renderNewThreadKey,
  renderOpenThreadKey,
  renderOverlayActionKey,
  renderPromptsPanoramicFrame,
  renderQuestionPanoramicFrame,
  renderQuickPromptDialCanvas,
  renderQuickPromptKey,
  renderSettlePinKey,
  renderSnoozeDialCanvas,
  renderSnoozePanoramicFrame,
  renderSnoozeSyncKey,
  renderStopDenyKey,
  renderThreadDialCanvas,
  renderThreadKey,
  renderThreadSlotKey,
  renderThreadToolsPanoramicFrame,
  renderUsageDialCanvas,
  renderUsageKey,
  renderVoicePanoramicFrame,
  slicePanoramicFrame,
  wrapLines,
  type PanoramicFrame
} from "./render.js";
import {
  isThreadRunning,
  isThreadSettled,
  isThreadSnoozed,
  normalizeOptionSelections,
  primaryPullRequest,
  QUICK_PROMPT_PRESETS,
  resolveReasoningValue,
  RUNTIME_MODE_ORDER,
  shortModelLabel,
  type T3Store
} from "./store.js";
import type {
  DeckOverlay,
  ModelSelection,
  NewThreadSettings,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  QuickPromptSettings,
  RuntimeMode,
  SurfaceGeometry
} from "./types.js";

export const DEFAULT_PLUS_GEOMETRY: SurfaceGeometry = {
  deviceId: "default",
  deviceType: 7,
  cols: 4,
  rows: 2,
  stripCols: 4
};

export function geometryFromDevice(device?: {
  id?: string;
  type?: number;
  size?: { columns?: number; rows?: number };
}): SurfaceGeometry {
  if (!device) return DEFAULT_PLUS_GEOMETRY;
  const deviceType = typeof device.type === "number" ? device.type : 7;
  const cols = Math.max(1, device.size?.columns || defaultColsForType(deviceType));
  const rows = Math.max(1, device.size?.rows || defaultRowsForType(deviceType));
  const stripCols = deviceType === 13 ? 6 : deviceType === 7 ? 4 : 0;
  return {
    deviceId: device.id || "default",
    deviceType,
    cols,
    rows,
    stripCols
  };
}

function defaultColsForType(deviceType: number): number {
  switch (deviceType) {
    case 0:
      return 5; // Stream Deck / MK.2
    case 1:
      return 3; // Stream Deck Mini
    case 2:
      return 8; // Stream Deck XL
    case 7:
    case 9:
      return 4; // Stream Deck+ / Neo
    case 10:
      return 16; // Stream Deck Studio
    case 12:
      return 3; // Galleon 100 SD
    case 13:
      return 9; // Stream Deck+ XL
    default:
      return 4;
  }
}

function defaultRowsForType(deviceType: number): number {
  switch (deviceType) {
    case 0:
      return 3; // Stream Deck / MK.2
    case 1:
    case 7:
    case 9:
    case 10:
      return 2; // Mini / Plus / Neo / Studio
    case 2:
    case 12:
    case 13:
      return 4; // XL / Galleon / Plus XL
    default:
      return 2;
  }
}

export function keySlotForCoords(
  col: number,
  row: number,
  geom: SurfaceGeometry = DEFAULT_PLUS_GEOMETRY
): number {
  return row * geom.cols + col;
}

export interface SurfaceDispatchCallbacks {
  approveRequest: (
    threadId: string,
    requestId: string,
    decision: ProviderApprovalDecision
  ) => Promise<void>;
  respondToUserInput: (
    threadId: string,
    requestId: string,
    answers: Record<string, string | string[]>
  ) => Promise<void>;
  dismissUserInput: (threadId: string, requestId: string) => Promise<void>;
  sendPrompt: (threadId: string, text: string, mode: "auto" | "steer" | "queue") => Promise<void>;
  snoozeThreadUntil: (threadId: string, iso: string) => Promise<void>;
  unsnoozeThread: (threadId: string) => Promise<void>;
  settleToggle: (threadId: string) => Promise<void>;
  pinToggle: (threadId: string) => Promise<void>;
  markThreadUnread: (threadId: string) => Promise<void>;
  interruptOrStop: (threadId: string) => Promise<void>;
  setModelSelection?: (threadId: string, modelSelection: ModelSelection) => Promise<void>;
  setRuntimeMode?: (threadId: string, runtimeMode: RuntimeMode) => Promise<void>;
  setInteractionMode?: (threadId: string, interactionMode: ProviderInteractionMode) => Promise<void>;
  createAndOpenThread: (input: {
    projectId: string;
    modelSelection: ModelSelection;
    interactionMode?: ProviderInteractionMode;
    workspaceMode?: "local" | "worktree" | "scratch";
  }) => Promise<void>;
  openThread: (threadId: string) => void;
  openUrl: (url: string) => void;
  resync: () => Promise<void>;
  startVoice?: (
    deviceId: string,
    originSlot: number,
    opts?: {
      append?: boolean;
      autoSend?: boolean;
      sendMode?: "auto" | "steer" | "queue";
      usePostProcess?: boolean;
    }
  ) => Promise<void>;
  stopVoice?: (deviceId: string) => Promise<void>;
  cancelVoice?: (deviceId: string) => void;
  downloadVoiceModel?: (deviceId: string, modelId: string) => Promise<void>;
}

/**
 * Maps a physical key slot (`0..keyCount-1`) to an item index (`0..keyCount-2`), reserving
 * `originSlot` strictly for BACK (returns `-1` when `slot === safeOrigin`).
 */
export function itemIndexForSlot(slot: number, originSlot: number, keyCount = 8): number {
  const maxSlot = Math.max(0, keyCount - 1);
  const safeOrigin = Math.max(0, Math.min(maxSlot, originSlot));
  if (slot === safeOrigin) return -1;
  return slot < safeOrigin ? slot : slot - 1;
}

/**
 * Returns true when this device has no physical LCD touch strip (`stripCols === 0`)
 * AND enough rows/columns (`rows >= 3 && cols >= 4`, e.g. MK.2 5x3 or XL 8x4)
 * to turn Row 0 into a bezel-safe structured info row of self-contained keycap cards.
 */
export function usesVirtualTopBanner(geom: SurfaceGeometry, kind: DeckOverlay["kind"]): boolean {
  if (geom.stripCols > 0) return false;
  if (geom.rows < 3 || geom.cols < 4) return false;
  return (
    kind === "approval" ||
    kind === "question" ||
    kind === "prompts" ||
    kind === "new-chat-builder" ||
    kind === "voice"
  );
}

type EnvChoice =
  | {
      kind: "workspace";
      mode: "local" | "worktree" | "scratch";
      label: string;
      sublabel: string;
      accent: string;
      glyph: "folder" | "branch" | "spark";
    }
  | { kind: "projects"; label: string; sublabel: string; accent: string; glyph: "folder" }
  | {
      kind: "linked";
      environmentId: string;
      label: string;
      sublabel: string;
      accent: string;
      glyph: "server";
    };

function buildEnvChoices(store: T3Store): EnvChoice[] {
  const focused = store.getFocusedThread();
  const projName = focused
    ? store.getProjectName(focused.projectId)
    : store.getLaunchProjects()[0]?.title ?? "DEFAULT";
  const choices: EnvChoice[] = [
    {
      kind: "workspace",
      mode: "local",
      label: "LOCAL",
      sublabel: projName.toUpperCase(),
      accent: "#38BDF8",
      glyph: "folder"
    },
    {
      kind: "workspace",
      mode: "worktree",
      label: "WORKTREE",
      sublabel: "NEW BRANCH",
      accent: "#10B981",
      glyph: "branch"
    },
    {
      kind: "workspace",
      mode: "scratch",
      label: "SCRATCH",
      sublabel: "SANDBOX DIR",
      accent: "#F59E0B",
      glyph: "spark"
    },
    {
      kind: "projects",
      label: "PROJECTS",
      sublabel: `${store.getLaunchProjects().length} REPOS`,
      accent: "#818CF8",
      glyph: "folder"
    }
  ];

  for (const link of store.getPeerLinks()) {
    choices.push({
      kind: "linked",
      environmentId: link.environmentId,
      label: link.label.toUpperCase(),
      sublabel: "LINKED HOST",
      accent: "#C084FC",
      glyph: "server"
    });
  }
  return choices;
}

/**
 * Renders one bezel-safe, self-contained 144x144 card in Row 0 on keypad-only devices
 * with >= 3 rows (MK.2 5x3, XL 8x4). Never splits characters across physical keycap bezels!
 */
function renderTopInfoRowKey(
  store: T3Store,
  ov: DeckOverlay,
  col: number,
  cols: number,
  deviceId: string
): string | null {
  switch (ov.kind) {
    case "approval": {
      const { item, index, total } = store.getActiveOverlayApproval(deviceId);
      if (!item) {
        return col === 0
          ? renderInfoCardKey({
              accent: "#10B981",
              bgTop: "#0B241A",
              topLabel: "APPROVALS",
              lines: ["All clear"],
              center: true
            })
          : emptyOverlayTile();
      }
      const accent = item.dangerous ? "#F43F5E" : "#F59E0B";
      const bgTop = item.dangerous ? "#3A0A16" : "#2B1B05";

      // Col 0: Danger / Kind Alert Card
      if (col === 0) {
        const badgeLines = item.dangerous
          ? wrapLines(item.dangerReason ?? "DESTRUCTIVE CMD", 12, 2)
          : wrapLines(item.requestKind === "file-change" ? "FILE CHANGE" : "SHELL CMD", 12, 2);
        return renderInfoCardKey({
          accent,
          bgTop,
          topLabel: item.dangerous ? "⚠ DANGER" : `REQ ${index + 1}/${total}`,
          lines: badgeLines,
          footer: item.dangerous ? `REQ ${index + 1}/${total} · ${item.projectName}` : item.projectName,
          glow: item.dangerous,
          center: true
        });
      }

      // Col 1: Who / Subagent Card
      if (col === 1) {
        const who = item.subagentTitle || item.threadTitle;
        return renderInfoCardKey({
          accent,
          bgTop: "#141926",
          topLabel: item.subagentTitle ? "SUBAGENT" : "THREAD",
          lines: wrapLines(who, 13, 3),
          footer: item.parentThreadTitle ? `via ${item.parentThreadTitle}` : item.projectName
        });
      }

      // Last col (col === cols - 1): Reason / Project context card (when >= 5 cols)
      const cmdSlots = Math.max(1, cols >= 5 ? cols - 3 : cols - 2);
      const cmdStartCol = 2;
      if (cols >= 5 && col === cols - 1) {
        const reasonText = item.reason ?? "Tap any card to open in T3 Code";
        return renderInfoCardKey({
          accent: "#38BDF8",
          bgTop: "#0E1D30",
          topLabel: `${index + 1}/${total} · ${item.projectName.toUpperCase()}`,
          lines: wrapLines(reasonText, 14, 3),
          footer: "TAP: OPEN T3"
        });
      }

      // Middle cols (2 .. cmdStartCol + cmdSlots - 1): word-wrapped mono command chunks
      const cmdIdx = col - cmdStartCol;
      const cmdText = item.prompt ? `$ ${item.prompt}` : item.reason ?? "Inspect in T3";
      const chunks = chunkTextForKeyCards(cmdText, 14, 4, cmdSlots);
      const lines = chunks[cmdIdx];
      if (!lines || lines.length === 0) {
        return emptyOverlayTile();
      }
      return renderInfoCardKey({
        accent,
        bgTop: "#111622",
        topLabel: cmdIdx === 0 ? "COMMAND" : `CMD (${cmdIdx + 1}/${chunks.length})`,
        lines,
        mono: true
      });
    }

    case "question": {
      const { item, index, total } = store.getActiveOverlayQuestion(deviceId);
      const q = item?.questions[ov.questionIndex];
      if (!item || !q) return col === 0 ? emptyOverlayTile("QUESTION") : emptyOverlayTile();

      if (col === 0) {
        return renderInfoCardKey({
          accent: "#C084FC",
          bgTop: "#271040",
          topLabel: `QUESTION ${index + 1}/${total}`,
          lines: wrapLines(q.header || item.projectName, 12, 2),
          footer: item.projectName.toUpperCase(),
          glow: true,
          center: true
        });
      }
      if (col === 1) {
        return renderInfoCardKey({
          accent: "#C084FC",
          bgTop: "#171429",
          topLabel: item.subagentTitle ? "SUBAGENT" : "THREAD",
          lines: wrapLines(item.subagentTitle ?? item.threadTitle, 13, 3),
          footer: q.multiSelect ? "MULTI-SELECT" : "PICK BELOW"
        });
      }
      const qSlots = Math.max(1, cols - 2);
      const chunks = chunkTextForKeyCards(q.question, 14, 3, qSlots);
      const lines = chunks[col - 2];
      if (!lines || lines.length === 0) return emptyOverlayTile();
      return renderInfoCardKey({
        accent: "#C084FC",
        bgTop: "#1B1230",
        topLabel: col === 2 ? "ASKING" : `Q (${col - 1}/${chunks.length})`,
        lines
      });
    }

    case "prompts": {
      const thread = store.getFocusedThread();
      const hasAi = Boolean(
        store.promptSuggestion && thread && store.promptSuggestion.threadId === thread.id
      );
      const accent = hasAi ? "#22D3EE" : "#A78BFA";
      if (col === 0) {
        return renderInfoCardKey({
          accent,
          bgTop: hasAi ? "#082936" : "#1D1338",
          topLabel: hasAi ? "✨ AI NEXT" : "PROMPTS",
          lines: wrapLines(thread?.title ?? "No thread", 13, 3),
          footer: thread && isThreadRunning(thread) ? "STEER ACTIVE" : "SEND",
          glow: hasAi
        });
      }
      if (hasAi) {
        const chunks = chunkTextForKeyCards(store.promptSuggestion!.text, 14, 3, Math.max(1, cols - 1));
        const lines = chunks[col - 1];
        if (!lines || lines.length === 0) return emptyOverlayTile();
        return renderInfoCardKey({
          accent: "#22D3EE",
          bgTop: "#0B2230",
          topLabel: col === 1 ? "SUGGESTED" : `HINT (${col}/${chunks.length})`,
          lines
        });
      }
      return emptyOverlayTile();
    }

    case "voice": {
      const thread = store.getAllThreads().find((t) => t.id === ov.threadId) ?? store.getFocusedThread();
      const proj = thread ? store.getProjectName(thread.projectId) : "T3";
      const accent =
        ov.phase === "listening"
          ? "#F43F5E"
          : ov.phase === "draft"
            ? "#10B981"
            : ov.phase === "missing-model"
              ? "#F59E0B"
              : ov.phase === "error"
                ? "#FB7185"
                : "#38BDF8";
      const bgTop =
        ov.phase === "listening"
          ? "#2E0C1A"
          : ov.phase === "draft"
            ? "#0A281F"
            : ov.phase === "missing-model"
              ? "#2A1E08"
              : "#0B2438";
      const sec = Math.max(0, Math.floor(ov.durationSec));
      const timer = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
      if (col === 0) {
        const topLabel =
          ov.phase === "listening"
            ? `● REC ${timer}`
            : ov.phase === "draft"
              ? "VOICE DRAFT"
              : ov.phase === "missing-model"
                ? "NO MODEL"
                : ov.phase === "downloading"
                  ? "DOWNLOADING"
                  : ov.phase === "error"
                    ? "VOICE ERROR"
                    : "T3 STT";
        return renderInfoCardKey({
          accent,
          bgTop,
          topLabel,
          lines: wrapLines(thread?.title ?? "Focused Thread", 13, 3),
          footer: proj.toUpperCase(),
          glow: ov.phase === "listening" || ov.phase === "draft"
        });
      }
      const bodyText =
        ov.phase === "missing-model"
          ? `${ov.modelName || "Parakeet 0.6B"} not downloaded yet. Tap DOWNLOAD below.`
          : ov.phase === "downloading"
            ? "Downloading T3 Code voice model…"
            : ov.phase === "error"
              ? ov.errorMessage || "Voice transcription failed."
              : ov.phase === "draft"
                ? ov.draftText || "(No speech detected — tap RE-RECORD)"
                : [ov.committed, ov.tentative].filter(Boolean).join(" ").trim() ||
                  "Listening via T3 Code built-in STT…";
      const chunks = chunkTextForKeyCards(bodyText, 14, 3, Math.max(1, cols - 1));
      const lines = chunks[col - 1];
      if (!lines || lines.length === 0) return emptyOverlayTile();
      return renderInfoCardKey({
        accent,
        bgTop,
        topLabel: col === 1 ? (ov.phase === "draft" ? "TRANSCRIPT" : "CAPTIONS") : `(${col}/${chunks.length})`,
        lines
      });
    }

    case "new-chat-builder": {
      const projects = store.getLaunchProjects();
      const proj = projects[ov.projectIndex] ?? projects[0];
      const catalog = store.getNewChatBuilderCatalog(deviceId);
      const model = catalog[ov.modelIndex] ?? catalog[0];
      const wsColor =
        ov.workspaceMode === "worktree"
          ? "#10B981"
          : ov.workspaceMode === "scratch"
            ? "#F59E0B"
            : "#38BDF8";
      const isPlan = ov.interactionMode === "plan";

      switch (col) {
        case 0:
          return renderInfoCardKey({
            accent: "#38BDF8",
            bgTop: "#0B1E34",
            topLabel: `1 · REPO (${ov.projectIndex + 1}/${Math.max(1, projects.length)})`,
            lines: wrapLines(proj?.title ?? "Default", 12, 2),
            footer: "TAP: NEXT REPO",
            center: true
          });
        case 1:
          return renderInfoCardKey({
            accent: model?.accentColor ?? "#E07A5F",
            bgTop: "#141A2C",
            topLabel: `2 · ${ov.modelScope === "favorites" ? "★ FAVS" : "ALL"}`,
            lines: wrapLines(model?.shortName ?? "Default", 12, 2),
            footer: "TAP: NEXT MODEL",
            center: true
          });
        case 2:
          return renderInfoCardKey({
            accent: wsColor,
            bgTop: "#0D2026",
            topLabel: "3 · WORKSPACE",
            lines: [ov.workspaceMode.toUpperCase()],
            footer: "TAP: CYCLE",
            center: true
          });
        case 3:
          return renderInfoCardKey({
            accent: isPlan ? "#C084FC" : "#10B981",
            bgTop: isPlan ? "#271040" : "#0A2B22",
            topLabel: "4 · MODE",
            lines: [isPlan ? "✦ PLAN" : "CODE"],
            footer: "TAP: TOGGLE",
            glow: isPlan,
            center: true
          });
        case 4:
          return renderOverlayActionKey({
            topLabel: "READY",
            mainLabel: "LAUNCH",
            subLabel: "OPEN CHAT",
            accent: "#10B981",
            bgTop: "#0A2E22",
            glyph: "check",
            glow: true
          });
        default:
          return emptyOverlayTile();
      }
    }

    default:
      return null;
  }
}

/** Returns the active panoramic 1600x200 frame when an overlay is open, or null on Base Layer. */
export function getActivePanoramicFrame(
  store: T3Store,
  geom: SurfaceGeometry = DEFAULT_PLUS_GEOMETRY
): PanoramicFrame | null {
  const ov = store.getOverlay(geom.deviceId);
  if (ov.kind === "none") return null;
  const pageSize = Math.max(1, geom.cols * geom.rows - 1);

  switch (ov.kind) {
    case "approval": {
      const { item, index, total } = store.getActiveOverlayApproval(geom.deviceId);
      return renderApprovalPanoramicFrame(item, index, total, ov.scrollLine);
    }
    case "question": {
      const { item, index, total } = store.getActiveOverlayQuestion(geom.deviceId);
      const q = item?.questions[ov.questionIndex];
      const selected = q ? (ov.selectedByQuestionId[q.id] ?? []) : [];
      return renderQuestionPanoramicFrame(
        item,
        ov.questionIndex,
        ov.optionPage,
        selected,
        index,
        total
      );
    }
    case "snooze": {
      const thread = store.getFocusedThread();
      const projectName = thread ? store.getProjectName(thread.projectId) : "T3";
      const def = store.getDefaultSnoozePreset();
      const secondary = store.getSecondarySnoozePresets();
      return renderSnoozePanoramicFrame(
        thread,
        projectName,
        def.shortLabel,
        secondary.length,
        ov.customMinutes
      );
    }
    case "prompts": {
      const thread = store.getFocusedThread();
      const projectName = thread ? store.getProjectName(thread.projectId) : "T3";
      let selLabel: string | undefined;
      let selText: string | undefined;
      if (ov.selectedIndex === 0) {
        if (store.promptSuggestion && thread && store.promptSuggestion.threadId === thread.id) {
          selLabel = "✨ AI NEXT";
          selText = store.promptSuggestion.text;
        }
      } else if (ov.selectedIndex === 1) {
        selLabel = "IMPLEMENT PLAN";
        selText = "Implement the proposed plan.";
      } else {
        const preset = QUICK_PROMPT_PRESETS[ov.selectedIndex - 2];
        if (preset) {
          selLabel = preset.label;
          selText = preset.prompt;
        }
      }
      return renderPromptsPanoramicFrame(
        thread,
        projectName,
        store.promptSuggestion,
        selLabel,
        selText
      );
    }
    case "new-chat-builder": {
      const projects = store.getLaunchProjects();
      const proj = projects[ov.projectIndex] ?? projects[0] ?? null;
      const catalog = store.getNewChatBuilderCatalog(geom.deviceId);
      const model = catalog[ov.modelIndex] ?? catalog[0] ?? null;
      return renderNewChatBuilderPanoramicFrame({
        projectName: proj?.title ?? "Default",
        projectIdx: ov.projectIndex,
        projectTotal: projects.length,
        modelName: model?.shortName ?? "Default",
        providerLabel: model?.providerLabel ?? "Model",
        providerColor: model?.accentColor ?? "#38BDF8",
        modelScope: ov.modelScope,
        workspaceMode: ov.workspaceMode,
        interactionMode: ov.interactionMode
      });
    }
    case "fleet": {
      const list = store.getFilteredThreads("active");
      const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
      return renderFleetPanoramicFrame(store.getFleetStats(), ov.page, totalPages);
    }
    case "thread-tools": {
      const thread = store.getFocusedThread();
      const projectName = thread ? store.getProjectName(thread.projectId) : "T3";
      return renderThreadToolsPanoramicFrame(thread, projectName);
    }
    case "new-chat-project": {
      const projects = store.getLaunchProjects();
      const totalPages = Math.max(1, Math.ceil(projects.length / pageSize));
      return renderNewChatProjectPanoramicFrame(ov.page, totalPages, projects.length);
    }
    case "new-chat-env": {
      const focused = store.getFocusedThread();
      const projName = focused
        ? store.getProjectName(focused.projectId)
        : store.getLaunchProjects()[0]?.title ?? "T3 Code";
      const choices = buildEnvChoices(store);
      const totalPages = Math.max(1, Math.ceil(choices.length / pageSize));
      return renderNewChatEnvPanoramicFrame(
        projName,
        ov.page,
        totalPages,
        store.getPeerLinks().length
      );
    }
    case "new-chat-model": {
      const projectName =
        ov.workspaceMode === "scratch"
          ? "Scratch"
          : `${store.getProjectName(ov.projectId)}${ov.workspaceMode === "worktree" ? " (wt)" : ""}`;
      const models = store.getNewChatModelCatalog(geom.deviceId);
      const totalPages = Math.max(1, Math.ceil(models.length / pageSize));
      return renderNewChatModelPanoramicFrame(
        projectName,
        ov.scope,
        ov.interactionMode,
        ov.page,
        totalPages
      );
    }
    case "model-picker": {
      const models = store.getModelPickerCatalog(geom.deviceId);
      const perPage = Math.max(1, pageSize - 1);
      const totalPages = Math.max(1, Math.ceil(models.length / perPage));
      return renderModelPickerPanoramicFrame(ov.scope, ov.page, totalPages, models.length);
    }
    case "mode-effort": {
      const thread = store.getFocusedThread();
      const entry = thread ? store.getThreadModelEntry(thread) : null;
      return renderModeEffortPanoramicFrame(thread, entry);
    }
    case "voice": {
      const thread = store.getAllThreads().find((t) => t.id === ov.threadId) ?? store.getFocusedThread();
      const proj = thread ? store.getProjectName(thread.projectId) : "T3";
      return renderVoicePanoramicFrame(ov, thread, proj);
    }
  }
}

export function isFullGridPickerOverlay(kind: DeckOverlay["kind"]): boolean {
  return kind === "fleet" || kind === "new-chat-project" || kind === "model-picker";
}

/**
 * Computes which key slots belong to an overlay on `geom`:
 * - On big decks (XL 8x4, Plus XL 9x4), scopes focused overlays to the left control cluster
 *   (`cols 0..3`, rows `0..1` on Plus XL or `0..2` on XL) so the right-hand Live Fleet Wall stays live!
 */
export function resolveDefaultZoneSlots(
  geom: SurfaceGeometry,
  kind: DeckOverlay["kind"]
): number[] | undefined {
  if (geom.activeKeySlots && geom.activeKeySlots.length > 0) return geom.activeKeySlots;
  if (isFullGridPickerOverlay(kind)) return undefined;
  if (geom.cols >= 8 && geom.rows >= 4) {
    // Plus XL (has touch strip): left 4x2 control zone (8 keys) — matches Stream Deck+ muscle memory!
    // XL (no touch strip): left 4x3 control zone (12 keys: Row 0 = 4 info cards, Rows 1-2 = 8 controls)!
    const zoneRows = geom.stripCols > 0 ? 2 : 3;
    const slots: number[] = [];
    for (let r = 0; r < zoneRows; r++) {
      for (let c = 0; c < 4; c++) {
        slots.push(r * geom.cols + c);
      }
    }
    return slots;
  }
  return undefined;
}

interface SubRect {
  minCol: number;
  minRow: number;
  cols: number;
  rows: number;
}

/** Checks if `slots` form a complete contiguous rectangle of at least 4x2 keys. */
function detectContiguousRect(slots: number[], fullCols: number): SubRect | null {
  if (slots.length < 8) return null;
  let minCol = Infinity;
  let maxCol = -Infinity;
  let minRow = Infinity;
  let maxRow = -Infinity;
  const set = new Set(slots);
  for (const s of slots) {
    const c = s % fullCols;
    const r = Math.floor(s / fullCols);
    if (c < minCol) minCol = c;
    if (c > maxCol) maxCol = c;
    if (r < minRow) minRow = r;
    if (r > maxRow) maxRow = r;
  }
  const cols = maxCol - minCol + 1;
  const rows = maxRow - minRow + 1;
  if (cols < 4 || rows < 2) return null;
  if (set.size !== cols * rows) return null;
  return { minCol, minRow, cols, rows };
}

function renderCompactApprovalInfoCard(
  store: T3Store,
  deviceId: string
): string {
  const { item, index, total } = store.getActiveOverlayApproval(deviceId);
  if (!item) {
    return renderInfoCardKey({
      accent: "#38BDF8",
      bgTop: "#0B243E",
      topLabel: "INSPECT",
      lines: ["No pending"],
      center: true
    });
  }
  const accent = item.dangerous ? "#F43F5E" : "#38BDF8";
  const bgTop = item.dangerous ? "#3B0A17" : "#0B243E";
  const cmd = item.prompt ? `$ ${item.prompt}` : item.reason ?? item.threadTitle;
  const lines = chunkTextForKeyCards(cmd, 14, 3, 1)[0] ?? [item.threadTitle];
  return renderInfoCardKey({
    accent,
    bgTop,
    topLabel: item.dangerous
      ? `⚠ DANGER ${index + 1}/${total}`
      : `${index + 1}/${total} · ${(item.subagentTitle ?? item.projectName).toUpperCase()}`,
    lines,
    footer: "TAP: OPEN T3",
    mono: Boolean(item.prompt),
    glow: item.dangerous
  });
}

function buildPlusXlRightStripPanel(store: T3Store, accent: string): string {
  const stats = store.getFleetStats();
  const focused = store.getFocusedThread();
  const proj = focused ? store.getProjectName(focused.projectId) : "T3 CODE";
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif";
  const MONO = "'SF Mono', Menlo, Monaco, monospace";
  return `
    <text x="1632" y="42" font-family="${FONT}" font-size="16" font-weight="800" fill="${accent}" letter-spacing="0.8">FLEET QUEUE · ${esc(trunc(proj.toUpperCase(), 20))}</text>
    <text x="2370" y="42" text-anchor="end" font-family="${MONO}" font-size="15" font-weight="700" fill="#94A3B8">LIVE WALL ACTIVE</text>

    <rect x="1632" y="64" width="170" height="62" rx="10" fill="#0E223A" stroke="#38BDF8" stroke-width="1.8"/>
    <text x="1717" y="102" text-anchor="middle" font-family="${MONO}" font-size="24" font-weight="800" fill="#38BDF8">▶ ${stats.running}</text>

    <rect x="1818" y="64" width="170" height="62" rx="10" fill="#2E1C06" stroke="#F59E0B" stroke-width="1.8"/>
    <text x="1903" y="102" text-anchor="middle" font-family="${MONO}" font-size="24" font-weight="800" fill="#F59E0B">! ${stats.approvals}</text>

    <rect x="2004" y="64" width="170" height="62" rx="10" fill="#271040" stroke="#C084FC" stroke-width="1.8"/>
    <text x="2089" y="102" text-anchor="middle" font-family="${MONO}" font-size="24" font-weight="800" fill="#C084FC">? ${stats.questions}</text>

    <rect x="2190" y="64" width="178" height="62" rx="10" fill="#300D17" stroke="#FB7185" stroke-width="1.8"/>
    <text x="2279" y="102" text-anchor="middle" font-family="${MONO}" font-size="24" font-weight="800" fill="#FB7185">✕ ${stats.failed}</text>

    <text x="1632" y="166" font-family="${FONT}" font-size="15" font-weight="700" fill="#CBD5E1">${esc(trunc(focused?.title ?? "Tap any live Fleet Wall tile to jump", 54))}</text>
  `;
}

/** Renders the sliced 400x200 dial SVG for column `col` (`0..stripCols-1`) when an overlay is active. */
export function renderOverlayDialSvg(
  store: T3Store,
  col: number,
  geom: SurfaceGeometry = DEFAULT_PLUS_GEOMETRY
): string | null {
  const frame = getActivePanoramicFrame(store, geom);
  if (!frame) return null;
  const extraRight =
    geom.stripCols > 4 ? buildPlusXlRightStripPanel(store, frame.accent) : undefined;
  return slicePanoramicFrame(frame, col, Math.max(4, geom.stripCols), extraRight);
}

function emptyOverlayTile(label = ""): string {
  return renderOverlayActionKey({
    topLabel: label,
    mainLabel: "",
    accent: "#1E293B",
    bgTop: "#0B0F18",
    glyph: "number",
    glyphText: "·",
    disabled: true
  });
}

function renderApprovalActionSlot(store: T3Store, actionSlot: number, deviceId: string): string {
  const { item, index, total } = store.getActiveOverlayApproval(deviceId);
  const canRespond = Boolean(item && item.responseCapability === "live");
  const hasAlways = Boolean(item?.options?.some((o) => o.decision === "acceptAlways"));

  switch (actionSlot) {
    case 0:
      return renderOverlayActionKey({
        topLabel: total > 0 ? `${total} PENDING` : "DONE",
        mainLabel: "BACK",
        subLabel: "CLOSE VIEW",
        accent: "#94A3B8",
        bgTop: "#151C2B",
        glyph: "back"
      });
    case 1:
      return renderOverlayActionKey({
        topLabel: item?.dangerous ? "⚠ CAREFUL" : "CONFIRM",
        mainLabel: "APPROVE",
        subLabel: "HOLD: SESSION",
        accent: item?.dangerous ? "#F59E0B" : "#10B981",
        bgTop: item?.dangerous ? "#331D06" : "#0A2D20",
        glyph: "check",
        glow: canRespond,
        disabled: !canRespond
      });
    case 2:
      return renderOverlayActionKey({
        topLabel: "DECLINE",
        mainLabel: "DENY",
        subLabel: "REJECT REQ",
        accent: "#FB7185",
        bgTop: "#3B0D18",
        glyph: "cross",
        glow: canRespond,
        disabled: !canRespond
      });
    case 3:
      return renderOverlayActionKey({
        topLabel: "INSPECT",
        mainLabel: "OPEN T3",
        subLabel: "SHOW FULL",
        accent: "#38BDF8",
        bgTop: "#0B243E",
        glyph: "open",
        disabled: !item
      });
    case 4:
      return renderOverlayActionKey({
        topLabel: total > 1 ? `QUEUE ${index + 1}/${total}` : "QUEUE",
        mainLabel: "PREV",
        subLabel: "EARLIER REQ",
        accent: "#F59E0B",
        bgTop: "#241706",
        glyph: "prev",
        disabled: total <= 1
      });
    case 5:
      return renderOverlayActionKey({
        topLabel: total > 1 ? `QUEUE ${index + 1}/${total}` : "QUEUE",
        mainLabel: "NEXT",
        subLabel: "NEXT REQ",
        accent: "#F59E0B",
        bgTop: "#241706",
        glyph: "next",
        disabled: total <= 1
      });
    case 6:
      return hasAlways
        ? renderOverlayActionKey({
            topLabel: "PERSIST",
            mainLabel: "ALWAYS",
            subLabel: "ALLOW RULE",
            accent: "#34D399",
            bgTop: "#09271F",
            glyph: "check",
            disabled: !canRespond
          })
        : renderOverlayActionKey({
            topLabel: "SESSION",
            mainLabel: "ALLOW ALL",
            subLabel: "THIS SESSION",
            accent: "#34D399",
            bgTop: "#09271F",
            glyph: "check",
            disabled: !canRespond
          });
    case 7:
      return renderOverlayActionKey({
        topLabel: "EXIT",
        mainLabel: "DISMISS",
        subLabel: "LEAVE PENDING",
        accent: "#64748B",
        bgTop: "#131824",
        glyph: "back"
      });
    default:
      return emptyOverlayTile();
  }
}

function renderCompactVoiceInfoCard(
  ov: Extract<DeckOverlay, { kind: "voice" }>
): string {
  const sec = Math.max(0, Math.floor(ov.durationSec));
  const timer = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  const accent =
    ov.phase === "listening"
      ? "#F43F5E"
      : ov.phase === "draft"
        ? "#10B981"
        : ov.phase === "missing-model"
          ? "#F59E0B"
          : ov.phase === "error"
            ? "#FB7185"
            : "#38BDF8";
  const bgTop =
    ov.phase === "listening"
      ? "#2E0C1A"
      : ov.phase === "draft"
        ? "#0A281F"
        : ov.phase === "missing-model"
          ? "#2A1E08"
          : "#0B2438";
  const topLabel =
    ov.phase === "listening"
      ? `● REC ${timer}`
      : ov.phase === "draft"
        ? "VOICE DRAFT"
        : ov.phase === "missing-model"
          ? "NO MODEL"
          : ov.phase === "downloading"
            ? "DOWNLOADING"
            : ov.phase === "error"
              ? "ERROR"
              : "T3 STT";
  const text =
    ov.phase === "missing-model"
      ? `${ov.modelName || "Parakeet 0.6B"} missing`
      : ov.phase === "downloading"
        ? "Downloading model…"
        : ov.phase === "error"
          ? ov.errorMessage || "Voice failed"
          : ov.phase === "draft"
            ? ov.draftText || "(No speech)"
            : [ov.committed, ov.tentative].filter(Boolean).join(" ").trim() || "Speak now…";
  const lines = chunkTextForKeyCards(text, 14, 3, 1)[0] ?? [text];
  return renderInfoCardKey({
    accent,
    bgTop,
    topLabel,
    lines,
    footer: ov.phase === "draft" ? "TAP: OPEN T3" : undefined,
    glow: ov.phase === "listening" || ov.phase === "draft"
  });
}

function renderVoiceActionSlot(
  store: T3Store,
  ov: Extract<DeckOverlay, { kind: "voice" }>,
  actionSlot: number
): string {
  const thread = store.getAllThreads().find((t) => t.id === ov.threadId) ?? store.getFocusedThread();
  const isRunning = Boolean(thread && isThreadRunning(thread));
  const hasDraft = ov.draftText.trim().length > 0;
  const sec = Math.max(0, Math.floor(ov.durationSec));
  const timer = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

  switch (actionSlot) {
    case 0:
      return renderOverlayActionKey({
        topLabel: ov.phase === "listening" ? "ABORT" : "VOICE",
        mainLabel: ov.phase === "listening" ? "CANCEL" : "BACK",
        subLabel: ov.phase === "draft" ? "DISCARD" : "CLOSE",
        accent: "#94A3B8",
        bgTop: "#151C2B",
        glyph: ov.phase === "listening" ? "cross" : "back"
      });
    case 1:
      if (ov.phase === "listening") {
        return renderOverlayActionKey({
          topLabel: `● ${timer}`,
          mainLabel: ov.autoSend ? "STOP & SEND" : "STOP",
          subLabel: ov.autoSend ? "DISPATCH NOW" : "REVIEW DRAFT",
          accent: "#F43F5E",
          bgTop: "#3B0D18",
          glyph: "stop",
          glow: true
        });
      }
      if (ov.phase === "draft") {
        return renderOverlayActionKey({
          topLabel: isRunning ? "STEER ACTIVE" : "DISPATCH",
          mainLabel: isRunning ? "STEER" : "SEND",
          subLabel: hasDraft ? "TO THREAD" : "EMPTY DRAFT",
          accent: "#10B981",
          bgTop: "#0A2D20",
          glyph: "send",
          glow: hasDraft,
          disabled: !hasDraft
        });
      }
      if (ov.phase === "missing-model") {
        return renderOverlayActionKey({
          topLabel: "T3 STT",
          mainLabel: "DOWNLOAD",
          subLabel: "INSTALL MODEL",
          accent: "#F59E0B",
          bgTop: "#331D06",
          glyph: "sync",
          glow: true
        });
      }
      if (ov.phase === "error") {
        return renderOverlayActionKey({
          topLabel: "VOICE",
          mainLabel: "RETRY",
          subLabel: "SPEAK AGAIN",
          accent: "#F43F5E",
          bgTop: "#2E0F1E",
          glyph: "mic",
          glow: true
        });
      }
      return renderOverlayActionKey({
        topLabel: "T3 STT",
        mainLabel: ov.phase === "downloading" ? "DOWNLOADING" : "WORKING…",
        subLabel: "PLEASE WAIT",
        accent: "#38BDF8",
        bgTop: "#0B243E",
        glyph: "sync",
        disabled: true
      });
    case 2:
      if (ov.phase === "listening") {
        return renderOverlayActionKey({
          topLabel: "VOICE",
          mainLabel: "RESTART",
          subLabel: "CLEAR & REC",
          accent: "#F59E0B",
          bgTop: "#241706",
          glyph: "mic"
        });
      }
      if (ov.phase === "draft") {
        return isRunning
          ? renderOverlayActionKey({
              topLabel: "AFTER RUN",
              mainLabel: "QUEUE",
              subLabel: "NEXT TURN",
              accent: "#818CF8",
              bgTop: "#1A193B",
              glyph: "clock",
              disabled: !hasDraft
            })
          : renderOverlayActionKey({
              topLabel: "DICTATE MORE",
              mainLabel: "APPEND",
              subLabel: "ADD TO DRAFT",
              accent: "#22D3EE",
              bgTop: "#082936",
              glyph: "mic"
            });
      }
      return renderOverlayActionKey({
        topLabel: "INSPECT",
        mainLabel: "OPEN T3",
        subLabel: "VOICE SETTINGS",
        accent: "#38BDF8",
        bgTop: "#0B243E",
        glyph: "open"
      });
    case 3:
      if (ov.phase === "draft") {
        return renderOverlayActionKey({
          topLabel: "REDO",
          mainLabel: "RE-RECORD",
          subLabel: "START FRESH",
          accent: "#F43F5E",
          bgTop: "#2E0F1E",
          glyph: "mic"
        });
      }
      return renderOverlayActionKey({
        topLabel: "ON STOP",
        mainLabel: ov.autoSend ? "AUTO-SEND" : "REVIEW",
        subLabel: "TAP TO TOGGLE",
        accent: ov.autoSend ? "#10B981" : "#38BDF8",
        bgTop: ov.autoSend ? "#0A281F" : "#0B243E",
        glyph: "spark"
      });
    case 4:
      return renderOverlayActionKey({
        topLabel: "T3 CLEANUP",
        mainLabel: ov.usePostProcess ? "POLISH ON" : "RAW STT",
        subLabel: "POST-PROCESS",
        accent: ov.usePostProcess ? "#C084FC" : "#94A3B8",
        bgTop: ov.usePostProcess ? "#271040" : "#151C2B",
        glyph: "spark"
      });
    case 5:
      if (ov.phase === "draft" && isRunning) {
        return renderOverlayActionKey({
          topLabel: "DICTATE MORE",
          mainLabel: "APPEND",
          subLabel: "ADD TO DRAFT",
          accent: "#22D3EE",
          bgTop: "#082936",
          glyph: "mic"
        });
      }
      return emptyOverlayTile();
    case 6:
      return emptyOverlayTile();
    case 7:
      return renderOverlayActionKey({
        topLabel: "THREAD",
        mainLabel: "OPEN T3",
        subLabel: "SHOW IN APP",
        accent: "#38BDF8",
        bgTop: "#0B243E",
        glyph: "open",
        disabled: !thread
      });
    default:
      return emptyOverlayTile();
  }
}

/** Renders the 144x144 key SVG for `(col, row)` when an overlay is active on `geom`. */
export function renderOverlayKeySvg(
  store: T3Store,
  col: number,
  row: number,
  geom: SurfaceGeometry = DEFAULT_PLUS_GEOMETRY
): string | null {
  const ov = store.getOverlay(geom.deviceId);
  if (ov.kind === "none") return null;

  const fullSlot = row * geom.cols + col;
  const zoneSlots = resolveDefaultZoneSlots(geom, ov.kind);
  if (zoneSlots) {
    const localIdx = zoneSlots.indexOf(fullSlot);
    if (localIdx === -1) {
      // Key sits outside the active overlay zone (e.g. Live Fleet Wall on XL / Plus XL) — keep base key!
      return null;
    }
    const rect = detectContiguousRect(zoneSlots, geom.cols);
    if (rect) {
      // Contiguous sub-grid (e.g. Plus XL left 4x2 or XL left 4x3): render natively in local rect coordinates!
      const localOriginCol = (ov.originSlot % geom.cols) - rect.minCol;
      const localOriginRow = Math.floor(ov.originSlot / geom.cols) - rect.minRow;
      const localOriginSlot =
        localOriginCol >= 0 &&
        localOriginCol < rect.cols &&
        localOriginRow >= 0 &&
        localOriginRow < rect.rows
          ? localOriginRow * rect.cols + localOriginCol
          : 0;
      const localGeom: SurfaceGeometry = {
        deviceId: geom.deviceId,
        deviceType: geom.deviceType,
        cols: rect.cols,
        rows: rect.rows,
        stripCols: geom.stripCols
      };
      return renderOverlayKeySvgInternal(
        store,
        ov,
        col - rect.minCol,
        row - rect.minRow,
        localGeom,
        localOriginSlot
      );
    }

    // Sparse / mixed page (1..7 T3 keys scattered alongside Spotify/OBS/Zoom!):
    return renderSparseMixedOverlayKey(store, ov, localIdx, zoneSlots, geom.deviceId);
  }

  return renderOverlayKeySvgInternal(store, ov, col, row, geom, ov.originSlot);
}

/**
 * Renders overlays onto arbitrary sparse T3 Deck keys on a mixed page (e.g. 1..7 T3 buttons
 * next to Spotify/OBS/Zoom) so BACK, APPROVE, DENY, and options ALWAYS fit on the visible T3 keys.
 */
function renderSparseMixedOverlayKey(
  store: T3Store,
  ov: Exclude<DeckOverlay, { kind: "none" }>,
  localIdx: number,
  zoneSlots: number[],
  deviceId: string
): string | null {
  const localCount = zoneSlots.length;
  const originLocalIdx = Math.max(0, zoneSlots.indexOf(ov.originSlot));

  if (ov.kind === "approval") {
    const { item, index, total } = store.getActiveOverlayApproval(deviceId);
    const canRespond = Boolean(item && item.responseCapability === "live");
    if (localCount === 1) {
      return renderOverlayActionKey({
        topLabel: item?.dangerous ? "⚠ TAP: APPROVE" : "TAP: CONFIRM",
        mainLabel: item?.dangerous ? "DANGER OK?" : "APPROVE",
        subLabel: "HOLD: CANCEL",
        accent: item?.dangerous ? "#F43F5E" : "#10B981",
        bgTop: item?.dangerous ? "#3B0A17" : "#0A2D20",
        glyph: "check",
        glow: canRespond,
        disabled: !canRespond
      });
    }
    if (localCount === 2) {
      if (localIdx === 0) {
        return renderOverlayActionKey({
          topLabel: item?.dangerous ? "⚠ CAREFUL" : "CONFIRM",
          mainLabel: "APPROVE",
          subLabel: "HOLD: SESSION",
          accent: item?.dangerous ? "#F59E0B" : "#10B981",
          bgTop: item?.dangerous ? "#331D06" : "#0A2D20",
          glyph: "check",
          glow: canRespond,
          disabled: !canRespond
        });
      }
      return renderOverlayActionKey({
        topLabel: "HOLD: BACK",
        mainLabel: "DENY",
        subLabel: "REJECT REQ",
        accent: "#FB7185",
        bgTop: "#3B0D18",
        glyph: "cross",
        glow: canRespond,
        disabled: !canRespond
      });
    }
    // 3..7 keys: 0=BACK, 1=APPROVE, 2=DENY, 3=4-line Info Card, 4=NEXT, 5=ALLOW ALL, 6=PREV
    if (localIdx === 3) return renderCompactApprovalInfoCard(store, deviceId);
    if (localIdx === 4) {
      return renderOverlayActionKey({
        topLabel: total > 1 ? `${index + 1}/${total}` : "QUEUE",
        mainLabel: "NEXT",
        subLabel: "CYCLE REQ",
        accent: "#F59E0B",
        bgTop: "#241706",
        glyph: "next",
        disabled: total <= 1
      });
    }
    if (localIdx === 5) return renderApprovalActionSlot(store, 6, deviceId);
    if (localIdx === 6) return renderApprovalActionSlot(store, 4, deviceId);
    return renderApprovalActionSlot(store, localIdx, deviceId);
  }

  if (ov.kind === "question") {
    const { item } = store.getActiveOverlayQuestion(deviceId);
    const question = item?.questions[ov.questionIndex];
    const options = question?.options ?? [];
    const selected = question ? (ov.selectedByQuestionId[question.id] ?? []) : [];
    if (localCount === 1) {
      return renderOverlayActionKey({
        topLabel: "QUESTION",
        mainLabel: "OPEN T3",
        subLabel: "HOLD: CLOSE",
        accent: "#C084FC",
        bgTop: "#271040",
        glyph: "open",
        glow: true
      });
    }
    if (localIdx === 0) {
      return renderOverlayActionKey({
        topLabel: "QUESTION",
        mainLabel: "BACK",
        subLabel: "CLOSE",
        accent: "#94A3B8",
        bgTop: "#151C2B",
        glyph: "back"
      });
    }
    if (localCount === 2 || localIdx === 1) {
      return question?.multiSelect
        ? renderOverlayActionKey({
            topLabel: `${selected.length} PICKED`,
            mainLabel: "SUBMIT",
            subLabel: "SEND ANSWER",
            accent: "#10B981",
            bgTop: "#0A2B22",
            glyph: "check",
            glow: selected.length > 0,
            disabled: selected.length === 0
          })
        : renderOverlayActionKey({
            topLabel: "CUSTOM",
            mainLabel: "OPEN T3",
            subLabel: question?.header?.toUpperCase() ?? "VIEW FULL",
            accent: "#38BDF8",
            bgTop: "#0B243E",
            glyph: "open",
            disabled: !item
          });
    }
    const optIdx = localIdx - 2;
    const opt = options[ov.optionPage * Math.max(1, localCount - 2) + optIdx];
    if (!opt) return emptyOverlayTile(`OPT ${optIdx + 1}`);
    const isSelected = selected.includes(opt.label);
    return renderOverlayActionKey({
      topLabel: isSelected ? "SELECTED" : `OPT ${optIdx + 1}`,
      mainLabel: opt.label.toUpperCase(),
      subLabel: question?.multiSelect ? "TOGGLE" : "ANSWER",
      accent: isSelected ? "#34D399" : "#C084FC",
      bgTop: isSelected ? "#0A2B22" : "#271040",
      glyph: isSelected ? "check" : "number",
      glyphText: String(optIdx + 1),
      glow: true
    });
  }

  if (ov.kind === "voice") {
    if (localCount === 1) {
      return renderVoiceActionSlot(store, ov, 1);
    }
    if (localCount === 2) {
      return renderVoiceActionSlot(store, ov, localIdx === 0 ? 1 : 0);
    }
    if (localIdx === 3) return renderCompactVoiceInfoCard(ov);
    if (localIdx === 4) return renderVoiceActionSlot(store, ov, 3);
    if (localIdx === 5) return renderVoiceActionSlot(store, ov, 4);
    if (localIdx === 6) return renderVoiceActionSlot(store, ov, 7);
    return renderVoiceActionSlot(store, ov, localIdx);
  }

  // Dynamic submenus on mixed pages: treat the visible T3 keys as a virtual 1xN strip!
  const virtualGeom: SurfaceGeometry = {
    deviceId,
    deviceType: 9,
    cols: localCount,
    rows: 1,
    stripCols: 0
  };
  return renderOverlayKeySvgInternal(store, ov, localIdx, 0, virtualGeom, originLocalIdx);
}

function renderOverlayKeySvgInternal(
  store: T3Store,
  ov: DeckOverlay,
  col: number,
  row: number,
  geom: SurfaceGeometry,
  effectiveOriginSlot: number
): string | null {
  const keyCount = geom.cols * geom.rows;
  const slot = row * geom.cols + col;
  const useBanner = usesVirtualTopBanner(geom, ov.kind);

  // Row 0 on MK.2 / XL keypad-only overlays renders bezel-safe structured info cards (no split letters!)
  if (useBanner && row === 0) {
    const cardSvg = renderTopInfoRowKey(store, ov, col, geom.cols, geom.deviceId);
    if (cardSvg) return cardSvg;
  }

  // Remap body coordinates when Row 0 is a structured info row
  const bodySlot = useBanner ? (row - 1) * geom.cols + col : slot;
  const bodyCount = useBanner ? (geom.rows - 1) * geom.cols : keyCount;
  const bodyOriginSlot = useBanner
    ? effectiveOriginSlot >= geom.cols
      ? Math.min(bodyCount - 1, effectiveOriginSlot - geom.cols)
      : 0
    : Math.min(keyCount - 1, effectiveOriginSlot);

  // ---- Native T3 Voice STT Overlay ----
  if (ov.kind === "voice") {
    if (geom.stripCols === 0 && !useBanner && slot === 3) {
      return renderCompactVoiceInfoCard(ov);
    }
    return renderVoiceActionSlot(store, ov, bodySlot);
  }

  // ---- Approval Inspector ----
  if (ov.kind === "approval") {
    // Compact 2-row keypad-only layout (Neo 4x2, Mini 3x2): put 4-line bezel-safe command card in Slot 3!
    if (geom.stripCols === 0 && !useBanner) {
      const { item, index, total } = store.getActiveOverlayApproval(geom.deviceId);
      const canRespond = Boolean(item && item.responseCapability === "live");
      if (slot === 3) {
        return renderCompactApprovalInfoCard(store, geom.deviceId);
      }
      if (keyCount <= 6) {
        // 3x2 Mini: 0=BACK, 1=APPROVE, 2=DENY, 3=INSPECT, 4=NEXT, 5=SESSION/ALWAYS
        if (slot === 4) {
          return renderOverlayActionKey({
            topLabel: total > 1 ? `${index + 1}/${total}` : "QUEUE",
            mainLabel: "NEXT",
            subLabel: "CYCLE REQ",
            accent: "#F59E0B",
            bgTop: "#241706",
            glyph: "next",
            disabled: total <= 1
          });
        }
        if (slot === 5) {
          const hasAlways = Boolean(item?.options?.some((o) => o.decision === "acceptAlways"));
          return renderOverlayActionKey({
            topLabel: hasAlways ? "PERSIST" : "SESSION",
            mainLabel: hasAlways ? "ALWAYS" : "ALLOW ALL",
            subLabel: "APPROVE",
            accent: "#34D399",
            bgTop: "#09271F",
            glyph: "check",
            disabled: !canRespond
          });
        }
      }
    }
    return renderApprovalActionSlot(store, bodySlot, geom.deviceId);
  }

  // ---- Question Responder ----
  if (ov.kind === "question") {
    const { item } = store.getActiveOverlayQuestion(geom.deviceId);
    const question = item?.questions[ov.questionIndex];
    const options = question?.options ?? [];
    const optionsPerPage = useBanner
      ? geom.cols
      : geom.stripCols === 0 && keyCount <= 6
        ? 4
        : 4;
    const pageOptions = options.slice(
      ov.optionPage * optionsPerPage,
      ov.optionPage * optionsPerPage + optionsPerPage
    );
    const selected = question ? (ov.selectedByQuestionId[question.id] ?? []) : [];

    // Compact 3x2 Mini question layout: 0=BACK, 1=SUBMIT/OPEN, 2..5=Options 1..4
    if (geom.stripCols === 0 && !useBanner && keyCount <= 6) {
      if (slot === 0) {
        return renderOverlayActionKey({
          topLabel: "QUESTION",
          mainLabel: "BACK",
          subLabel: "CLOSE",
          accent: "#94A3B8",
          bgTop: "#151C2B",
          glyph: "back"
        });
      }
      if (slot === 1) {
        return question?.multiSelect
          ? renderOverlayActionKey({
              topLabel: `${selected.length} PICKED`,
              mainLabel: "SUBMIT",
              subLabel: "SEND ANSWER",
              accent: "#10B981",
              bgTop: "#0A2B22",
              glyph: "check",
              glow: selected.length > 0,
              disabled: selected.length === 0
            })
          : renderOverlayActionKey({
              topLabel: "CUSTOM",
              mainLabel: "OPEN T3",
              subLabel: question?.header?.toUpperCase() ?? "VIEW FULL",
              accent: "#38BDF8",
              bgTop: "#0B243E",
              glyph: "open",
              disabled: !item
            });
      }
      const optSlot = slot - 2;
      const opt = pageOptions[optSlot];
      if (!opt) return emptyOverlayTile(`OPT ${optSlot + 1}`);
      const isSelected = selected.includes(opt.label);
      return renderOverlayActionKey({
        topLabel: isSelected ? "SELECTED" : `OPT ${ov.optionPage * optionsPerPage + optSlot + 1}`,
        mainLabel: opt.label.toUpperCase(),
        subLabel: question?.multiSelect ? "TOGGLE" : "ANSWER",
        accent: isSelected ? "#34D399" : "#C084FC",
        bgTop: isSelected ? "#0A2B22" : "#271040",
        glyph: isSelected ? "check" : "number",
        glyphText: String(ov.optionPage * optionsPerPage + optSlot + 1),
        glow: true
      });
    }

    // Standard Plus (4x2), Plus XL (9x4), Neo (4x2), MK.2 (5x3 with Row 0 banner), XL (8x4 with Row 0 banner)
    const controlsRow = useBanner ? 1 : 0;
    const optionsRow = useBanner ? 2 : 1;

    if (row === controlsRow) {
      switch (col) {
        case 0:
          return renderOverlayActionKey({
            topLabel: "QUESTION",
            mainLabel: "BACK",
            subLabel: "CLOSE VIEW",
            accent: "#94A3B8",
            bgTop: "#151C2B",
            glyph: "back"
          });
        case 1:
          return question?.multiSelect
            ? renderOverlayActionKey({
                topLabel: `${selected.length} PICKED`,
                mainLabel: "SUBMIT",
                subLabel: "SEND ANSWER",
                accent: "#10B981",
                bgTop: "#0A2B22",
                glyph: "check",
                glow: selected.length > 0,
                disabled: selected.length === 0
              })
            : renderOverlayActionKey({
                topLabel: "PAGES",
                mainLabel: "MORE OPTS",
                subLabel: options.length > optionsPerPage ? `PAGE ${ov.optionPage + 1}` : "ALL SHOWN",
                accent: "#C084FC",
                bgTop: "#24113B",
                glyph: "next",
                disabled: options.length <= optionsPerPage
              });
        case 2:
          return renderOverlayActionKey({
            topLabel: "SKIP",
            mainLabel: "DISMISS",
            subLabel: item?.dismissible ? "CANCEL Q" : "NOT DISMISS",
            accent: "#FB7185",
            bgTop: "#360E18",
            glyph: "cross",
            disabled: !item?.dismissible
          });
        case 3:
          return renderOverlayActionKey({
            topLabel: "CUSTOM",
            mainLabel: "TYPE IN T3",
            subLabel: "OPEN APP",
            accent: "#38BDF8",
            bgTop: "#0B243E",
            glyph: "open",
            disabled: !item
          });
        default:
          return emptyOverlayTile();
      }
    }

    if (row === optionsRow) {
      const optSlot = col;
      if (optSlot >= optionsPerPage) return emptyOverlayTile();
      const opt = pageOptions[optSlot];
      if (!opt) {
        return renderOverlayActionKey({
          topLabel: `OPT ${ov.optionPage * optionsPerPage + optSlot + 1}`,
          mainLabel: "—",
          accent: "#334155",
          bgTop: "#0D111C",
          glyph: "number",
          glyphText: String(ov.optionPage * optionsPerPage + optSlot + 1),
          disabled: true
        });
      }
      const isSelected = selected.includes(opt.label);
      return renderOverlayActionKey({
        topLabel: isSelected ? "SELECTED" : `OPTION ${ov.optionPage * optionsPerPage + optSlot + 1}`,
        mainLabel: opt.label.toUpperCase(),
        subLabel: question?.multiSelect ? "TAP TO TOGGLE" : "TAP TO ANSWER",
        accent: isSelected ? "#34D399" : "#C084FC",
        bgTop: isSelected ? "#0A2B22" : "#271040",
        glyph: isSelected ? "check" : "number",
        glyphText: String(ov.optionPage * optionsPerPage + optSlot + 1),
        glow: true
      });
    }

    return emptyOverlayTile();
  }

  // ---- Dynamic Grid Submenus: BACK is ALWAYS at `originSlot` (right under your finger!) ----
  const idx = itemIndexForSlot(bodySlot, bodyOriginSlot, bodyCount);
  const pageSize = Math.max(1, bodyCount - 1);

  if (ov.kind === "snooze") {
    if (idx === -1) {
      return renderOverlayActionKey({
        topLabel: "SNOOZE",
        mainLabel: "BACK",
        subLabel: "CANCEL",
        accent: "#94A3B8",
        bgTop: "#151C2B",
        glyph: "back"
      });
    }
    const thread = store.getFocusedThread();
    const snoozed = Boolean(thread && isThreadSnoozed(thread));
    const secondary = store.getSecondarySnoozePresets();
    const preset = secondary[idx];
    if (preset) {
      return renderOverlayActionKey({
        topLabel: "SNOOZE",
        mainLabel: preset.label,
        subLabel: preset.sublabel,
        accent: "#818CF8",
        bgTop: "#1A1D42",
        glyph: "clock",
        disabled: !thread
      });
    }
    if (idx === secondary.length) {
      return snoozed
        ? renderOverlayActionKey({
            topLabel: "ACTIVE",
            mainLabel: "UNSNOOZE",
            subLabel: "WAKE NOW",
            accent: "#F59E0B",
            bgTop: "#331D06",
            glyph: "check",
            glow: true
          })
        : renderOverlayActionKey({
            topLabel: "SERVER",
            mainLabel: "RESYNC",
            subLabel: "REFRESH T3",
            accent: "#38BDF8",
            bgTop: "#0B243E",
            glyph: "sync"
          });
    }
    return emptyOverlayTile("PRESET");
  }

  if (ov.kind === "new-chat-builder") {
    if (idx === -1) {
      return renderOverlayActionKey({
        topLabel: "NEW CHAT",
        mainLabel: "BACK",
        subLabel: "CANCEL",
        accent: "#94A3B8",
        bgTop: "#151C2B",
        glyph: "back"
      });
    }
    if (idx === 0) {
      const projects = store.getLaunchProjects();
      const proj = projects[ov.projectIndex] ?? projects[0];
      return renderOverlayActionKey({
        topLabel: ov.workspaceMode.toUpperCase(),
        mainLabel: "LAUNCH",
        subLabel: proj ? proj.title.toUpperCase() : "CREATE",
        accent: "#10B981",
        bgTop: "#0A2E22",
        glyph: "check",
        glow: true
      });
    }

    const pickIdx = idx - 1;
    if (ov.keyMode === "model") {
      const catalog = store.getNewChatBuilderCatalog(geom.deviceId);
      const entry = catalog[pickIdx];
      if (!entry) return emptyOverlayTile("MODEL");
      const isSelected = pickIdx === ov.modelIndex;
      return renderOverlayActionKey({
        topLabel: entry.providerLabel.toUpperCase(),
        mainLabel: entry.shortName.toUpperCase(),
        subLabel: isSelected ? "SELECTED" : "TAP: SELECT",
        accent: entry.accentColor,
        bgTop: isSelected ? "#1D283E" : "#111726",
        glyph: "model",
        glow: isSelected
      });
    }

    if (ov.keyMode === "environment") {
      const choices = buildEnvChoices(store);
      const choice = choices[pickIdx];
      if (!choice) return emptyOverlayTile("ENV");
      const isSelected = choice.kind === "workspace" && choice.mode === ov.workspaceMode;
      return renderOverlayActionKey({
        topLabel: choice.kind === "workspace" ? "WORKSPACE" : "ENV",
        mainLabel: choice.label,
        subLabel: isSelected ? "ACTIVE" : choice.sublabel,
        accent: choice.accent,
        bgTop: isSelected ? "#102C2A" : "#101B2E",
        glyph: choice.glyph,
        glow: isSelected
      });
    }

    const projects = store.getLaunchProjects();
    const proj = projects[pickIdx];
    if (!proj) return emptyOverlayTile("PROJECT");
    const isSelected = pickIdx === ov.projectIndex;
    return renderOverlayActionKey({
      topLabel: proj.pinnedAt ? "★ PROJECT" : "PROJECT",
      mainLabel: proj.title.toUpperCase(),
      subLabel: isSelected ? "TAP AGAIN: GO" : "TAP: SELECT",
      accent: isSelected ? "#38BDF8" : proj.pinnedAt ? "#F59E0B" : "#60A5FA",
      bgTop: isSelected ? "#0B2C4D" : "#0F1929",
      glyph: "folder",
      glow: isSelected
    });
  }

  if (ov.kind === "new-chat-project") {
    if (idx === -1) {
      return renderOverlayActionKey({
        topLabel: "NEW CHAT",
        mainLabel: "BACK",
        subLabel: "CANCEL",
        accent: "#94A3B8",
        bgTop: "#151C2B",
        glyph: "back"
      });
    }
    const projects = store.getLaunchProjects();
    const proj = projects[ov.page * pageSize + idx];
    if (!proj) return emptyOverlayTile("PROJECT");
    const defModel = store.getDefaultModelSelectionForProject(proj);
    const modelShort = defModel?.model ? shortModelLabel(defModel.model) : "DEFAULT";
    return renderOverlayActionKey({
      topLabel: proj.pinnedAt ? "★ PROJECT" : "PROJECT",
      mainLabel: proj.title.toUpperCase(),
      subLabel: modelShort.toUpperCase(),
      accent: proj.pinnedAt ? "#F59E0B" : "#38BDF8",
      bgTop: proj.pinnedAt ? "#2B1C06" : "#0B243E",
      glyph: "folder",
      glow: Boolean(proj.pinnedAt)
    });
  }

  if (ov.kind === "new-chat-env") {
    if (idx === -1) {
      return renderOverlayActionKey({
        topLabel: "NEW CHAT",
        mainLabel: "BACK",
        subLabel: "CANCEL",
        accent: "#94A3B8",
        bgTop: "#151C2B",
        glyph: "back"
      });
    }
    const choices = buildEnvChoices(store);
    const choice = choices[ov.page * pageSize + idx];
    if (!choice) return emptyOverlayTile("ENV");
    return renderOverlayActionKey({
      topLabel:
        choice.kind === "workspace"
          ? "HOLD: MODEL"
          : choice.kind === "projects"
            ? "SWITCH"
            : "REMOTE",
      mainLabel: choice.label,
      subLabel: choice.sublabel,
      accent: choice.accent,
      bgTop: "#101B2E",
      glyph: choice.glyph,
      glow: choice.kind === "workspace" && choice.mode === "worktree"
    });
  }

  if (ov.kind === "new-chat-model") {
    if (idx === -1) {
      return renderOverlayActionKey({
        topLabel: "MODELS",
        mainLabel: "BACK",
        subLabel:
          ov.parentKind === "new-chat-project"
            ? "PROJECTS"
            : ov.parentKind === "new-chat-env"
              ? "ENVIRONMENTS"
              : "CANCEL",
        accent: "#94A3B8",
        bgTop: "#151C2B",
        glyph: "back"
      });
    }
    const models = store.getNewChatModelCatalog(geom.deviceId);
    const entry = models[ov.page * pageSize + idx];
    if (!entry) return emptyOverlayTile("MODEL");
    return renderOverlayActionKey({
      topLabel: entry.providerLabel.toUpperCase(),
      mainLabel: entry.shortName.toUpperCase(),
      subLabel: entry.isFavorite ? "★ LAUNCH" : "TAP: LAUNCH",
      accent: entry.accentColor,
      bgTop: "#12192A",
      glyph: "model",
      glow: entry.isFavorite
    });
  }

  if (ov.kind === "model-picker") {
    if (idx === -1) {
      return renderOverlayActionKey({
        topLabel: "MODELS",
        mainLabel: "BACK",
        subLabel: "CLOSE",
        accent: "#94A3B8",
        bgTop: "#151C2B",
        glyph: "back"
      });
    }
    if (idx === 0) {
      const isFav = ov.scope === "favorites";
      return renderOverlayActionKey({
        topLabel: "SCOPE",
        mainLabel: isFav ? "★ FAVS" : "ALL MODELS",
        subLabel: isFav ? "TAP: SHOW ALL" : "TAP: FAVS ONLY",
        accent: isFav ? "#F59E0B" : "#38BDF8",
        bgTop: isFav ? "#2C1D06" : "#0B243E",
        glyph: "pin",
        glow: isFav
      });
    }
    const models = store.getModelPickerCatalog(geom.deviceId);
    const hasNextPage = models.length > Math.max(1, pageSize - 1);
    const itemsPerPage = hasNextPage ? Math.max(1, pageSize - 2) : Math.max(1, pageSize - 1);
    if (hasNextPage && idx === pageSize - 1) {
      const totalPages = Math.max(1, Math.ceil(models.length / itemsPerPage));
      return renderOverlayActionKey({
        topLabel: `PAGE ${ov.page + 1}/${totalPages}`,
        mainLabel: "MORE",
        subLabel: "NEXT PAGE",
        accent: "#38BDF8",
        bgTop: "#0B243E",
        glyph: "next"
      });
    }
    const entry = models[ov.page * itemsPerPage + (idx - 1)];
    if (!entry) return emptyOverlayTile("MODEL");
    const focused = store.getFocusedThread();
    const isCurrent =
      focused?.modelSelection?.model === entry.slug &&
      (!focused.modelSelection.instanceId || focused.modelSelection.instanceId === entry.instanceId);
    return renderOverlayActionKey({
      topLabel: entry.providerLabel.toUpperCase(),
      mainLabel: entry.shortName.toUpperCase(),
      subLabel: isCurrent ? "ACTIVE" : entry.isFavorite ? "★ APPLY" : "TAP: APPLY",
      accent: entry.accentColor,
      bgTop: isCurrent ? "#1B2A42" : "#12192A",
      glyph: isCurrent ? "check" : "model",
      glow: isCurrent || entry.isFavorite
    });
  }

  if (ov.kind === "mode-effort") {
    if (idx === -1) {
      return renderOverlayActionKey({
        topLabel: "MODE",
        mainLabel: "BACK",
        subLabel: "CLOSE",
        accent: "#94A3B8",
        bgTop: "#151C2B",
        glyph: "back"
      });
    }
    const thread = store.getFocusedThread();
    const entry = thread ? store.getThreadModelEntry(thread) : null;
    const isPlan = thread?.interactionMode === "plan";

    if (idx === 0) {
      return renderOverlayActionKey({
        topLabel: "INTERACTION",
        mainLabel: isPlan ? "PLAN MODE" : "CODE MODE",
        subLabel: "TAP: TOGGLE",
        accent: isPlan ? "#C084FC" : "#10B981",
        bgTop: isPlan ? "#271040" : "#0A2B22",
        glyph: "spark",
        glow: isPlan,
        disabled: !thread
      });
    }

    const allowedModes: readonly RuntimeMode[] =
      entry?.supportedRuntimeModes && entry.supportedRuntimeModes.length > 0
        ? entry.supportedRuntimeModes
        : RUNTIME_MODE_ORDER;
    const modeIdx = idx - 1;
    if (modeIdx < allowedModes.length) {
      const m = allowedModes[modeIdx]!;
      const active = thread?.runtimeMode === m;
      const modeLabel =
        m === "approval-required"
          ? "ASK"
          : m === "auto-accept-edits"
            ? "EDITS"
            : m === "full-access"
              ? "FULL"
              : "AUTO";
      return renderOverlayActionKey({
        topLabel: "PERMISSION",
        mainLabel: modeLabel,
        subLabel: active ? "ACTIVE" : "TAP: SET",
        accent: active ? "#10B981" : "#60A5FA",
        bgTop: active ? "#0A2E22" : "#101B2E",
        glyph: active ? "check" : "server",
        glow: active,
        disabled: !thread
      });
    }

    const desc = entry?.reasoningDescriptor;
    const effortOptions = desc?.type === "select" ? (desc.options ?? []) : [];
    const effIdx = modeIdx - allowedModes.length;
    const eff = effortOptions[effIdx];
    if (eff) {
      const currentEff = thread && desc ? resolveReasoningValue(thread.modelSelection, desc) : undefined;
      const active = currentEff === eff.id;
      return renderOverlayActionKey({
        topLabel: "EFFORT",
        mainLabel: eff.label.toUpperCase(),
        subLabel: active ? "ACTIVE" : "TAP: SET",
        accent: active ? "#38BDF8" : "#94A3B8",
        bgTop: active ? "#0B2C4D" : "#12192A",
        glyph: active ? "check" : "spark",
        glow: active,
        disabled: !thread
      });
    }
    return emptyOverlayTile();
  }

  if (ov.kind === "prompts") {
    if (idx === -1) {
      return renderOverlayActionKey({
        topLabel: "PROMPTS",
        mainLabel: "BACK",
        subLabel: "CLOSE",
        accent: "#94A3B8",
        bgTop: "#151C2B",
        glyph: "back"
      });
    }
    const thread = store.getFocusedThread();
    const hasSuggestion = Boolean(
      store.promptSuggestion && thread && store.promptSuggestion.threadId === thread.id
    );
    const hasPlan = Boolean(thread?.hasActionableProposedPlan);

    if (idx === 0) {
      return renderOverlayActionKey({
        topLabel: "AI PREDICTED",
        mainLabel: hasSuggestion ? "AI NEXT" : "NO HINT",
        subLabel: hasSuggestion ? "SEND HINT" : "WAITING…",
        accent: "#22D3EE",
        bgTop: "#082936",
        glyph: "spark",
        glow: hasSuggestion,
        disabled: !hasSuggestion || !thread
      });
    }
    if (idx === 1) {
      return renderOverlayActionKey({
        topLabel: hasPlan ? "PLAN READY" : "PLAN",
        mainLabel: "IMPLEMENT",
        subLabel: hasPlan ? "RUN PLAN" : "GO AHEAD",
        accent: "#10B981",
        bgTop: "#0A2B22",
        glyph: "check",
        glow: hasPlan,
        disabled: !thread
      });
    }
    if (idx === 2) {
      return renderOverlayActionKey({
        topLabel: "T3 STT",
        mainLabel: "VOICE",
        subLabel: "SPEAK PROMPT",
        accent: "#F43F5E",
        bgTop: "#2E0F1E",
        glyph: "mic",
        glow: Boolean(thread),
        disabled: !thread
      });
    }
    const preset = QUICK_PROMPT_PRESETS[idx - 2];
    if (preset) {
      return renderOverlayActionKey({
        topLabel: thread && isThreadRunning(thread) ? "STEER" : "SEND",
        mainLabel: preset.label,
        subLabel: preset.sublabel,
        accent: preset.accent,
        bgTop: "#191533",
        glyph: "send",
        disabled: !thread
      });
    }
    return emptyOverlayTile();
  }

  if (ov.kind === "fleet") {
    if (idx === -1) {
      return renderOverlayActionKey({
        topLabel: "FLEET",
        mainLabel: "BACK",
        subLabel: "CLOSE",
        accent: "#94A3B8",
        bgTop: "#151C2B",
        glyph: "back"
      });
    }
    const list = store.getFilteredThreads("active");
    const hasPages = list.length > pageSize;
    const perPage = hasPages ? Math.max(1, pageSize - 1) : pageSize;
    if (hasPages && idx === pageSize - 1) {
      const totalPages = Math.max(1, Math.ceil(list.length / perPage));
      return renderOverlayActionKey({
        topLabel: `PAGE ${ov.page + 1}/${totalPages}`,
        mainLabel: "NEXT PAGE",
        subLabel: `${list.length} ACTIVE`,
        accent: "#38BDF8",
        bgTop: "#0B243E",
        glyph: "next"
      });
    }
    const absIdx = ov.page * perPage + idx;
    const thread = list[absIdx] ?? null;
    const projectName = thread ? store.getProjectName(thread.projectId) : "";
    return renderThreadSlotKey(
      absIdx + 1,
      thread,
      projectName,
      store.connectionState === "connected"
    );
  }

  if (ov.kind === "thread-tools") {
    if (idx === -1) {
      return renderOverlayActionKey({
        topLabel: "TOOLS",
        mainLabel: "BACK",
        subLabel: "CLOSE",
        accent: "#94A3B8",
        bgTop: "#151C2B",
        glyph: "back"
      });
    }
    const thread = store.getFocusedThread();
    const settled = Boolean(thread && isThreadSettled(thread));
    const pinned = Boolean(thread?.pinnedAt);
    const pr = thread ? primaryPullRequest(thread) : null;
    const running = Boolean(thread && isThreadRunning(thread));

    switch (idx) {
      case 0:
        return renderOverlayActionKey({
          topLabel: "STATUS",
          mainLabel: settled ? "UNSETTLE" : "SETTLE",
          subLabel: "TOGGLE",
          accent: "#10B981",
          bgTop: "#0A2B22",
          glyph: "checkbox",
          disabled: !thread
        });
      case 1:
        return renderOverlayActionKey({
          topLabel: pinned ? "PINNED" : "PRIORITY",
          mainLabel: pinned ? "UNPIN" : "PIN",
          subLabel: "SIDEBAR",
          accent: "#F59E0B",
          bgTop: "#2E1C06",
          glyph: "pin",
          glow: pinned,
          disabled: !thread
        });
      case 2:
        return renderOverlayActionKey({
          topLabel: "INBOX",
          mainLabel: "UNREAD",
          subLabel: thread?.latestRunId ? "MARK NEW" : "NO RUNS",
          accent: "#38BDF8",
          bgTop: "#0B243E",
          glyph: "spark",
          disabled: !thread || !thread.latestRunId
        });
      case 3:
        return renderOverlayActionKey({
          topLabel: pr ? `PR #${pr.number}` : "PULL REQ",
          mainLabel: "OPEN PR",
          subLabel: pr ? "BROWSER" : "NO PR",
          accent: "#34D399",
          bgTop: "#09271F",
          glyph: "open",
          disabled: !pr?.url
        });
      case 4:
        return renderOverlayActionKey({
          topLabel: running ? "ACTIVE" : "IDLE",
          mainLabel: "STOP RUN",
          subLabel: "INTERRUPT",
          accent: "#FB7185",
          bgTop: "#360E18",
          glyph: "stop",
          disabled: !running
        });
      case 5:
        return renderOverlayActionKey({
          topLabel: "SNOOZE",
          mainLabel: "PRESETS",
          subLabel: "PICK TIME",
          accent: "#818CF8",
          bgTop: "#1A1D42",
          glyph: "clock",
          disabled: !thread
        });
      case 6:
        return renderOverlayActionKey({
          topLabel: "SERVER",
          mainLabel: "RESYNC",
          subLabel: "REFRESH T3",
          accent: "#60A5FA",
          bgTop: "#111D33",
          glyph: "sync"
        });
      default:
        return emptyOverlayTile();
    }
  }

  return null;
}

/**
 * Handles a short or long key press when an overlay is active on `geom`.
 * Returns `true` if handled by the overlay, or `false` if this key sits outside the active overlay zone.
 */
export async function handleOverlayKeyPress(
  store: T3Store,
  col: number,
  row: number,
  isLongPress: boolean,
  cb: SurfaceDispatchCallbacks,
  geom: SurfaceGeometry = DEFAULT_PLUS_GEOMETRY
): Promise<boolean> {
  const ov = store.getOverlay(geom.deviceId);
  if (ov.kind === "none") return false;

  const fullSlot = row * geom.cols + col;
  const zoneSlots = resolveDefaultZoneSlots(geom, ov.kind);
  if (zoneSlots) {
    const localIdx = zoneSlots.indexOf(fullSlot);
    if (localIdx === -1) {
      // Outside the overlay zone (e.g. Live Fleet Wall on XL / Plus XL) -> let base action handle it!
      return false;
    }
    const rect = detectContiguousRect(zoneSlots, geom.cols);
    if (rect) {
      const localOriginCol = (ov.originSlot % geom.cols) - rect.minCol;
      const localOriginRow = Math.floor(ov.originSlot / geom.cols) - rect.minRow;
      const localOriginSlot =
        localOriginCol >= 0 &&
        localOriginCol < rect.cols &&
        localOriginRow >= 0 &&
        localOriginRow < rect.rows
          ? localOriginRow * rect.cols + localOriginCol
          : 0;
      const localGeom: SurfaceGeometry = {
        deviceId: geom.deviceId,
        deviceType: geom.deviceType,
        cols: rect.cols,
        rows: rect.rows,
        stripCols: geom.stripCols
      };
      return handleOverlayKeyPressInternal(
        store,
        ov,
        col - rect.minCol,
        row - rect.minRow,
        isLongPress,
        cb,
        localGeom,
        localOriginSlot
      );
    }

    return handleSparseMixedOverlayKeyPress(store, ov, localIdx, zoneSlots, isLongPress, cb, geom.deviceId);
  }

  return handleOverlayKeyPressInternal(store, ov, col, row, isLongPress, cb, geom, ov.originSlot);
}

async function handleSparseMixedOverlayKeyPress(
  store: T3Store,
  ov: Exclude<DeckOverlay, { kind: "none" }>,
  localIdx: number,
  zoneSlots: number[],
  isLongPress: boolean,
  cb: SurfaceDispatchCallbacks,
  deviceId: string
): Promise<boolean> {
  const localCount = zoneSlots.length;
  const originLocalIdx = Math.max(0, zoneSlots.indexOf(ov.originSlot));

  if (ov.kind === "approval") {
    const { item } = store.getActiveOverlayApproval(deviceId);
    if (localCount === 1) {
      if (isLongPress) {
        store.closeOverlay(deviceId);
        return true;
      }
      if (item && item.responseCapability === "live") {
        await cb.approveRequest(item.threadId, item.requestId, "accept");
        store.markRequestResolvedLocally(item.threadId, item.requestId);
        store.setToast("approve", "APPROVED", "#10B981", 1100);
      } else {
        store.closeOverlay(deviceId);
      }
      return true;
    }
    if (localCount === 2) {
      if (localIdx === 0) {
        if (item && item.responseCapability === "live") {
          await cb.approveRequest(
            item.threadId,
            item.requestId,
            isLongPress ? "acceptForSession" : "accept"
          );
          store.markRequestResolvedLocally(item.threadId, item.requestId);
          store.setToast("approve", isLongPress ? "SESSION OK" : "APPROVED", "#10B981", 1100);
        }
        return true;
      }
      if (isLongPress) {
        store.closeOverlay(deviceId);
        return true;
      }
      if (item && item.responseCapability === "live") {
        await cb.approveRequest(item.threadId, item.requestId, "decline");
        store.markRequestResolvedLocally(item.threadId, item.requestId);
        store.setToast("stop", "DENIED", "#FB7185", 1100);
      } else {
        store.closeOverlay(deviceId);
      }
      return true;
    }
    // 3..7 keys: 0=BACK, 1=APPROVE, 2=DENY, 3=OPEN T3, 4=NEXT, 5=ALLOW ALL, 6=PREV
    if (localIdx === 0) {
      store.closeOverlay(deviceId);
      return true;
    }
    if (localIdx === 1) {
      if (item && item.responseCapability === "live") {
        await cb.approveRequest(
          item.threadId,
          item.requestId,
          isLongPress ? "acceptForSession" : "accept"
        );
        store.markRequestResolvedLocally(item.threadId, item.requestId);
        store.setToast("approve", isLongPress ? "SESSION OK" : "APPROVED", "#10B981", 1100);
      }
      return true;
    }
    if (localIdx === 2) {
      if (item && item.responseCapability === "live") {
        await cb.approveRequest(item.threadId, item.requestId, "decline");
        store.markRequestResolvedLocally(item.threadId, item.requestId);
        store.setToast("stop", "DENIED", "#FB7185", 1100);
      }
      return true;
    }
    if (localIdx === 3) {
      if (item) cb.openThread(item.threadId);
      return true;
    }
    if (localIdx === 4) {
      store.stepOverlayQueue(1, deviceId);
      return true;
    }
    if (localIdx === 5) {
      if (item && item.responseCapability === "live") {
        const hasAlways = Boolean(item.options?.some((o) => o.decision === "acceptAlways"));
        await cb.approveRequest(
          item.threadId,
          item.requestId,
          hasAlways ? "acceptAlways" : "acceptForSession"
        );
        store.markRequestResolvedLocally(item.threadId, item.requestId);
        store.setToast("approve", hasAlways ? "ALWAYS OK" : "SESSION OK", "#10B981", 1100);
      }
      return true;
    }
    if (localIdx === 6) {
      store.stepOverlayQueue(-1, deviceId);
      return true;
    }
    return true;
  }

  if (ov.kind === "question") {
    const { item } = store.getActiveOverlayQuestion(deviceId);
    if (localCount === 1) {
      if (isLongPress) store.closeOverlay(deviceId);
      else if (item) cb.openThread(item.threadId);
      return true;
    }
    if (localIdx === 0) {
      store.closeOverlay(deviceId);
      return true;
    }
    if (localCount === 2 || localIdx === 1) {
      const q = item?.questions[ov.questionIndex];
      if (q?.multiSelect) {
        const res = store.submitCurrentMultiSelectQuestion(deviceId);
        if (res.readyToSubmit && res.threadId && res.requestId && res.answers) {
          await cb.respondToUserInput(res.threadId, res.requestId, res.answers);
          store.markRequestResolvedLocally(res.threadId, res.requestId);
          store.setToast("approve", "ANSWERED", "#C084FC", 1100);
        }
      } else if (item) {
        cb.openThread(item.threadId);
      }
      return true;
    }
    const optIdx = localIdx - 2;
    const perPage = Math.max(1, localCount - 2);
    const res = store.selectQuestionOption(optIdx, deviceId, perPage);
    if (res.readyToSubmit && res.threadId && res.requestId && res.answers) {
      await cb.respondToUserInput(res.threadId, res.requestId, res.answers);
      store.markRequestResolvedLocally(res.threadId, res.requestId);
      store.setToast("approve", "ANSWERED", "#C084FC", 1100);
    }
    return true;
  }

  if (ov.kind === "voice") {
    if (localCount === 1) {
      if (isLongPress) {
        cb.cancelVoice?.(deviceId);
        store.closeOverlay(deviceId);
      } else {
        await handleVoiceActionSlot(store, ov, 1, cb, deviceId);
      }
      return true;
    }
    if (localCount === 2) {
      if (localIdx === 0) {
        await handleVoiceActionSlot(store, ov, 1, cb, deviceId);
      } else if (isLongPress && ov.phase === "draft") {
        await handleVoiceActionSlot(store, ov, 3, cb, deviceId);
      } else {
        await handleVoiceActionSlot(store, ov, 0, cb, deviceId);
      }
      return true;
    }
    if (localIdx === 3) {
      if (ov.threadId) cb.openThread(ov.threadId);
      return true;
    }
    if (localIdx === 4) {
      await handleVoiceActionSlot(store, ov, 3, cb, deviceId);
      return true;
    }
    if (localIdx === 5) {
      await handleVoiceActionSlot(store, ov, 4, cb, deviceId);
      return true;
    }
    if (localIdx === 6) {
      await handleVoiceActionSlot(store, ov, 7, cb, deviceId);
      return true;
    }
    await handleVoiceActionSlot(store, ov, localIdx, cb, deviceId);
    return true;
  }

  const virtualGeom: SurfaceGeometry = {
    deviceId,
    deviceType: 9,
    cols: localCount,
    rows: 1,
    stripCols: 0
  };
  return handleOverlayKeyPressInternal(
    store,
    ov,
    localIdx,
    0,
    isLongPress,
    cb,
    virtualGeom,
    originLocalIdx
  );
}

async function handleVoiceActionSlot(
  store: T3Store,
  ov: Extract<DeckOverlay, { kind: "voice" }>,
  actionSlot: number,
  cb: SurfaceDispatchCallbacks,
  deviceId: string
): Promise<boolean> {
  const thread = store.getAllThreads().find((t) => t.id === ov.threadId) ?? store.getFocusedThread();
  const isRunning = Boolean(thread && isThreadRunning(thread));
  const draft = ov.draftText.trim();

  switch (actionSlot) {
    case 0:
      cb.cancelVoice?.(deviceId);
      store.closeOverlay(deviceId);
      return true;
    case 1:
      if (ov.phase === "listening") {
        await cb.stopVoice?.(deviceId);
        return true;
      }
      if (ov.phase === "draft") {
        if (!draft || !thread) return true;
        store.updateVoiceOverlay(deviceId, { phase: "sending" });
        await cb.sendPrompt(thread.id, draft, ov.sendMode);
        store.setToast("voice", isRunning ? "STEERED" : "VOICE SENT", "#10B981", 1200);
        store.closeOverlay(deviceId);
        return true;
      }
      if (ov.phase === "missing-model") {
        const modelId = ov.modelId || "handy-computer/parakeet-unified-en-0.6b-gguf";
        await cb.downloadVoiceModel?.(deviceId, modelId);
        return true;
      }
      if (ov.phase === "error") {
        await cb.startVoice?.(deviceId, ov.originSlot, {
          autoSend: ov.autoSend,
          sendMode: ov.sendMode,
          usePostProcess: ov.usePostProcess
        });
        return true;
      }
      return true;
    case 2:
      if (ov.phase === "listening") {
        cb.cancelVoice?.(deviceId);
        await cb.startVoice?.(deviceId, ov.originSlot, {
          autoSend: ov.autoSend,
          sendMode: ov.sendMode,
          usePostProcess: ov.usePostProcess
        });
        return true;
      }
      if (ov.phase === "draft") {
        if (isRunning) {
          if (!draft || !thread) return true;
          store.updateVoiceOverlay(deviceId, { phase: "sending" });
          await cb.sendPrompt(thread.id, draft, "queue");
          store.setToast("voice", "QUEUED", "#818CF8", 1200);
          store.closeOverlay(deviceId);
          return true;
        }
        await cb.startVoice?.(deviceId, ov.originSlot, {
          append: true,
          autoSend: ov.autoSend,
          sendMode: ov.sendMode,
          usePostProcess: ov.usePostProcess
        });
        return true;
      }
      if (thread) cb.openThread(thread.id);
      return true;
    case 3:
      if (ov.phase === "draft") {
        await cb.startVoice?.(deviceId, ov.originSlot, {
          append: false,
          autoSend: ov.autoSend,
          sendMode: ov.sendMode,
          usePostProcess: ov.usePostProcess
        });
        return true;
      }
      store.updateVoiceOverlay(deviceId, { autoSend: !ov.autoSend });
      return true;
    case 4:
      store.updateVoiceOverlay(deviceId, { usePostProcess: !ov.usePostProcess });
      return true;
    case 5:
      if (ov.phase === "draft" && isRunning) {
        await cb.startVoice?.(deviceId, ov.originSlot, {
          append: true,
          autoSend: ov.autoSend,
          sendMode: ov.sendMode,
          usePostProcess: ov.usePostProcess
        });
      }
      return true;
    case 7:
      if (thread) cb.openThread(thread.id);
      return true;
    default:
      return true;
  }
}

async function handleOverlayKeyPressInternal(
  store: T3Store,
  ov: DeckOverlay,
  col: number,
  row: number,
  isLongPress: boolean,
  cb: SurfaceDispatchCallbacks,
  geom: SurfaceGeometry,
  effectiveOriginSlot: number
): Promise<boolean> {
  const keyCount = geom.cols * geom.rows;
  const slot = row * geom.cols + col;
  const useBanner = usesVirtualTopBanner(geom, ov.kind);

  // Tapping Row 0 structured info cards
  if (useBanner && row === 0) {
    if (ov.kind === "approval") {
      const { item } = store.getActiveOverlayApproval(geom.deviceId);
      if (item) cb.openThread(item.threadId);
    } else if (ov.kind === "question") {
      const { item } = store.getActiveOverlayQuestion(geom.deviceId);
      if (item) cb.openThread(item.threadId);
    } else if (ov.kind === "voice") {
      if (ov.threadId) cb.openThread(ov.threadId);
    } else if (ov.kind === "new-chat-builder") {
      if (col === 0) {
        store.stepNewChatBuilderDial(0, 1, geom.deviceId);
      } else if (col === 1) {
        if (isLongPress) store.toggleNewChatBuilderDial(1, geom.deviceId);
        else store.stepNewChatBuilderDial(1, 1, geom.deviceId);
      } else if (col === 2) {
        store.stepNewChatBuilderDial(2, 1, geom.deviceId);
      } else if (col === 3) {
        store.toggleNewChatBuilderDial(2, geom.deviceId);
      } else if (col === 4) {
        const projects = store.getLaunchProjects();
        const proj = projects[ov.projectIndex] ?? projects[0];
        if (proj) {
          const catalog = store.getNewChatBuilderCatalog(geom.deviceId);
          const chosen = catalog[ov.modelIndex] ?? catalog[0];
          const modelSelection: ModelSelection = chosen
            ? { instanceId: chosen.instanceId, provider: chosen.driver, model: chosen.slug }
            : (store.getDefaultModelSelectionForProject(proj) ?? { model: "claude-opus-5-5" });
          await cb.createAndOpenThread({
            projectId: proj.id,
            modelSelection,
            interactionMode: ov.interactionMode,
            workspaceMode: ov.workspaceMode
          });
          store.setToast("new", proj.title.toUpperCase(), "#10B981", 1200);
        }
        store.closeOverlay(geom.deviceId);
      }
    } else {
      store.closeOverlay(geom.deviceId);
    }
    return true;
  }

  const bodySlot = useBanner ? (row - 1) * geom.cols + col : slot;
  const bodyCount = useBanner ? (geom.rows - 1) * geom.cols : keyCount;
  const bodyOriginSlot = useBanner
    ? effectiveOriginSlot >= geom.cols
      ? Math.min(bodyCount - 1, effectiveOriginSlot - geom.cols)
      : 0
    : Math.min(keyCount - 1, effectiveOriginSlot);

  if (ov.kind === "voice") {
    if (geom.stripCols === 0 && !useBanner && slot === 3) {
      if (ov.threadId) cb.openThread(ov.threadId);
      return true;
    }
    return handleVoiceActionSlot(store, ov, bodySlot, cb, geom.deviceId);
  }

  if (ov.kind === "approval") {
    const { item } = store.getActiveOverlayApproval(geom.deviceId);

    // Compact 3x2 Mini approval slots: 4=NEXT, 5=SESSION/ALWAYS
    if (geom.stripCols === 0 && !useBanner && keyCount <= 6) {
      if (slot === 4) {
        store.stepOverlayQueue(1, geom.deviceId);
        return true;
      }
      if (slot === 5) {
        if (!item || item.responseCapability !== "live") return true;
        const hasAlways = Boolean(item.options?.some((o) => o.decision === "acceptAlways"));
        const decision: ProviderApprovalDecision = hasAlways ? "acceptAlways" : "acceptForSession";
        await cb.approveRequest(item.threadId, item.requestId, decision);
        store.markRequestResolvedLocally(item.threadId, item.requestId);
        store.setToast("approve", hasAlways ? "ALWAYS OK" : "SESSION OK", "#10B981", 1100);
        return true;
      }
    }

    switch (bodySlot) {
      case 0:
      case 7:
        store.closeOverlay(geom.deviceId);
        return true;
      case 1:
        if (!item || item.responseCapability !== "live") return true;
        await cb.approveRequest(
          item.threadId,
          item.requestId,
          isLongPress ? "acceptForSession" : "accept"
        );
        store.markRequestResolvedLocally(item.threadId, item.requestId);
        store.setToast("approve", isLongPress ? "SESSION OK" : "APPROVED", "#10B981", 1100);
        return true;
      case 2:
        if (!item || item.responseCapability !== "live") return true;
        await cb.approveRequest(item.threadId, item.requestId, "decline");
        store.markRequestResolvedLocally(item.threadId, item.requestId);
        store.setToast("stop", "DENIED", "#FB7185", 1100);
        return true;
      case 3:
        if (item) cb.openThread(item.threadId);
        return true;
      case 4:
        store.stepOverlayQueue(-1, geom.deviceId);
        return true;
      case 5:
        store.stepOverlayQueue(1, geom.deviceId);
        return true;
      case 6:
        if (!item || item.responseCapability !== "live") return true;
        {
          const hasAlways = Boolean(item.options?.some((o) => o.decision === "acceptAlways"));
          const decision: ProviderApprovalDecision = hasAlways ? "acceptAlways" : "acceptForSession";
          await cb.approveRequest(item.threadId, item.requestId, decision);
          store.markRequestResolvedLocally(item.threadId, item.requestId);
          store.setToast("approve", hasAlways ? "ALWAYS OK" : "SESSION OK", "#10B981", 1100);
        }
        return true;
    }
    return true;
  }

  if (ov.kind === "question") {
    const { item } = store.getActiveOverlayQuestion(geom.deviceId);
    const optionsPerPage = useBanner ? geom.cols : 4;

    if (geom.stripCols === 0 && !useBanner && keyCount <= 6) {
      if (slot === 0) {
        store.closeOverlay(geom.deviceId);
        return true;
      }
      if (slot === 1) {
        const q = item?.questions[ov.questionIndex];
        if (q?.multiSelect) {
          const res = store.submitCurrentMultiSelectQuestion(geom.deviceId);
          if (res.readyToSubmit && res.threadId && res.requestId && res.answers) {
            await cb.respondToUserInput(res.threadId, res.requestId, res.answers);
            store.markRequestResolvedLocally(res.threadId, res.requestId);
            store.setToast("approve", "ANSWERED", "#C084FC", 1100);
          }
        } else if (item) {
          cb.openThread(item.threadId);
        }
        return true;
      }
      if (slot >= 2 && slot <= 5) {
        const res = store.selectQuestionOption(slot - 2, geom.deviceId, 4);
        if (res.readyToSubmit && res.threadId && res.requestId && res.answers) {
          await cb.respondToUserInput(res.threadId, res.requestId, res.answers);
          store.markRequestResolvedLocally(res.threadId, res.requestId);
          store.setToast("approve", "ANSWERED", "#C084FC", 1100);
        }
        return true;
      }
      return true;
    }

    const controlsRow = useBanner ? 1 : 0;
    const optionsRow = useBanner ? 2 : 1;

    if (row === controlsRow) {
      if (col === 0) {
        store.closeOverlay(geom.deviceId);
        return true;
      }
      if (col === 1) {
        const q = item?.questions[ov.questionIndex];
        if (q?.multiSelect) {
          const res = store.submitCurrentMultiSelectQuestion(geom.deviceId);
          if (res.readyToSubmit && res.threadId && res.requestId && res.answers) {
            await cb.respondToUserInput(res.threadId, res.requestId, res.answers);
            store.markRequestResolvedLocally(res.threadId, res.requestId);
            store.setToast("approve", "ANSWERED", "#C084FC", 1100);
          }
        } else {
          store.scrollOverlay(1, geom.deviceId, optionsPerPage);
        }
        return true;
      }
      if (col === 2) {
        if (item && item.dismissible) {
          await cb.dismissUserInput(item.threadId, item.requestId);
          store.markRequestResolvedLocally(item.threadId, item.requestId);
        }
        return true;
      }
      if (col === 3) {
        if (item) cb.openThread(item.threadId);
        return true;
      }
      return true;
    }

    if (row === optionsRow && col < optionsPerPage) {
      const res = store.selectQuestionOption(col, geom.deviceId, optionsPerPage);
      if (res.readyToSubmit && res.threadId && res.requestId && res.answers) {
        await cb.respondToUserInput(res.threadId, res.requestId, res.answers);
        store.markRequestResolvedLocally(res.threadId, res.requestId);
        store.setToast("approve", "ANSWERED", "#C084FC", 1100);
      }
      return true;
    }
    return true;
  }

  const idx = itemIndexForSlot(bodySlot, bodyOriginSlot, bodyCount);
  const pageSize = Math.max(1, bodyCount - 1);

  if (ov.kind === "snooze") {
    if (idx === -1) {
      store.closeOverlay(geom.deviceId);
      return true;
    }
    const thread = store.getFocusedThread();
    const secondary = store.getSecondarySnoozePresets();
    const preset = secondary[idx];
    if (preset && thread) {
      await cb.snoozeThreadUntil(thread.id, preset.snoozedUntilIso);
      store.setToast("snooze", `SNOOZED ${preset.shortLabel}`, "#818CF8", 1200);
      store.closeOverlay(geom.deviceId);
      return true;
    }
    if (idx === secondary.length) {
      if (thread && isThreadSnoozed(thread)) {
        await cb.unsnoozeThread(thread.id);
        store.setToast("snooze", "UNSNOOZED", "#10B981", 1100);
      } else {
        await cb.resync();
        store.setToast("snooze", "RESYNCED", "#38BDF8", 1100);
      }
      store.closeOverlay(geom.deviceId);
    }
    return true;
  }

  if (ov.kind === "new-chat-builder") {
    if (idx === -1) {
      store.closeOverlay(geom.deviceId);
      return true;
    }
    const launchCurrent = async () => {
      const projects = store.getLaunchProjects();
      const proj = projects[ov.projectIndex] ?? projects[0];
      if (!proj) {
        store.closeOverlay(geom.deviceId);
        return;
      }
      const catalog = store.getNewChatBuilderCatalog(geom.deviceId);
      const chosen = catalog[ov.modelIndex] ?? catalog[0];
      const modelSelection: ModelSelection = chosen
        ? { instanceId: chosen.instanceId, provider: chosen.driver, model: chosen.slug }
        : (store.getDefaultModelSelectionForProject(proj) ?? { model: "claude-opus-5-5" });
      await cb.createAndOpenThread({
        projectId: proj.id,
        modelSelection,
        interactionMode: ov.interactionMode,
        workspaceMode: ov.workspaceMode
      });
      store.setToast("new", proj.title.toUpperCase(), "#10B981", 1200);
      store.closeOverlay(geom.deviceId);
    };

    if (idx === 0) {
      await launchCurrent();
      return true;
    }

    const pickIdx = idx - 1;
    if (ov.keyMode === "model") {
      const catalog = store.getNewChatBuilderCatalog(geom.deviceId);
      if (catalog[pickIdx]) {
        if (pickIdx === ov.modelIndex) {
          await launchCurrent();
        } else {
          store.setNewChatBuilderModel(pickIdx, geom.deviceId);
        }
      }
      return true;
    }

    if (ov.keyMode === "environment") {
      const choices = buildEnvChoices(store);
      const choice = choices[pickIdx];
      if (!choice) return true;
      if (choice.kind === "workspace") {
        if (choice.mode === ov.workspaceMode) {
          await launchCurrent();
        } else {
          store.setNewChatBuilderWorkspace(choice.mode, geom.deviceId);
        }
      } else if (choice.kind === "projects") {
        store.openNewChatProjectOverlay(ov.originSlot, ov.interactionMode, geom.deviceId);
      }
      return true;
    }

    const projects = store.getLaunchProjects();
    if (projects[pickIdx]) {
      if (pickIdx === ov.projectIndex) {
        await launchCurrent();
      } else {
        store.setNewChatBuilderProject(pickIdx, geom.deviceId);
      }
    }
    return true;
  }

  if (ov.kind === "new-chat-project") {
    if (idx === -1) {
      store.closeOverlay(geom.deviceId);
      return true;
    }
    const projects = store.getLaunchProjects();
    const proj = projects[ov.page * pageSize + idx];
    if (!proj) return true;
    if (isLongPress) {
      store.openNewChatModelOverlay(proj.id, {
        originSlot: slot,
        parentKind: "new-chat-project",
        parentOriginSlot: ov.originSlot,
        workspaceMode: "local",
        interactionMode: ov.interactionMode,
        deviceId: geom.deviceId
      });
      return true;
    }
    const modelSelection = store.getDefaultModelSelectionForProject(proj);
    if (!modelSelection) {
      cb.openUrl("t3code://app/");
      store.closeOverlay(geom.deviceId);
      return true;
    }
    await cb.createAndOpenThread({
      projectId: proj.id,
      modelSelection,
      interactionMode: ov.interactionMode,
      workspaceMode: "local"
    });
    store.setToast("new", proj.title.toUpperCase(), "#38BDF8", 1200);
    store.closeOverlay(geom.deviceId);
    return true;
  }

  if (ov.kind === "new-chat-env") {
    if (idx === -1) {
      store.closeOverlay(geom.deviceId);
      return true;
    }
    const choices = buildEnvChoices(store);
    const choice = choices[ov.page * pageSize + idx];
    if (!choice) return true;

    if (choice.kind === "projects") {
      store.openNewChatProjectOverlay(slot, ov.interactionMode, geom.deviceId);
      return true;
    }
    if (choice.kind === "linked") {
      cb.openUrl("t3code://app/");
      store.setToast("new", choice.label, "#C084FC", 1100);
      store.closeOverlay(geom.deviceId);
      return true;
    }
    const focused = store.getFocusedThread();
    const targetProject =
      (focused ? store.getProjectById(focused.projectId) : null) ?? store.getLaunchProjects()[0];
    if (!targetProject) {
      cb.openUrl("t3code://app/");
      store.closeOverlay(geom.deviceId);
      return true;
    }
    if (isLongPress) {
      store.openNewChatModelOverlay(targetProject.id, {
        originSlot: slot,
        parentKind: "new-chat-env",
        parentOriginSlot: ov.originSlot,
        workspaceMode: choice.mode,
        interactionMode: ov.interactionMode,
        deviceId: geom.deviceId
      });
      return true;
    }
    const modelSelection = store.getDefaultModelSelectionForProject(targetProject);
    if (!modelSelection) {
      cb.openUrl("t3code://app/");
      store.closeOverlay(geom.deviceId);
      return true;
    }
    await cb.createAndOpenThread({
      projectId: targetProject.id,
      modelSelection,
      interactionMode: ov.interactionMode,
      workspaceMode: choice.mode
    });
    store.setToast("new", choice.label, choice.accent, 1200);
    store.closeOverlay(geom.deviceId);
    return true;
  }

  if (ov.kind === "new-chat-model") {
    if (idx === -1) {
      if (ov.parentKind === "new-chat-project") {
        store.openNewChatProjectOverlay(ov.parentOriginSlot, ov.interactionMode, geom.deviceId);
      } else if (ov.parentKind === "new-chat-env") {
        store.openNewChatEnvOverlay(ov.parentOriginSlot, ov.interactionMode, geom.deviceId);
      } else {
        store.closeOverlay(geom.deviceId);
      }
      return true;
    }
    const models = store.getNewChatModelCatalog(geom.deviceId);
    const entry = models[ov.page * pageSize + idx];
    if (!entry) return true;
    await cb.createAndOpenThread({
      projectId: ov.projectId,
      modelSelection: {
        instanceId: entry.instanceId,
        provider: entry.driver,
        model: entry.slug
      },
      interactionMode: ov.interactionMode,
      workspaceMode: ov.workspaceMode
    });
    store.setToast("new", entry.shortName.toUpperCase(), entry.accentColor, 1200);
    store.closeOverlay(geom.deviceId);
    return true;
  }

  if (ov.kind === "model-picker") {
    if (idx === -1) {
      store.closeOverlay(geom.deviceId);
      return true;
    }
    if (idx === 0) {
      store.toggleModelPickerScope(geom.deviceId);
      return true;
    }
    const models = store.getModelPickerCatalog(geom.deviceId);
    const hasNextPage = models.length > Math.max(1, pageSize - 1);
    const itemsPerPage = hasNextPage ? Math.max(1, pageSize - 2) : Math.max(1, pageSize - 1);
    if (hasNextPage && idx === pageSize - 1) {
      store.stepOverlayQueue(1, geom.deviceId, itemsPerPage + 1);
      return true;
    }
    const entry = models[ov.page * itemsPerPage + (idx - 1)];
    const thread = store.getFocusedThread();
    if (entry && thread && cb.setModelSelection) {
      await cb.setModelSelection(thread.id, {
        instanceId: entry.instanceId,
        model: entry.slug
      });
      store.setToast("model-dial", `SET: ${entry.shortName}`, entry.accentColor, 1200);
      store.closeOverlay(geom.deviceId);
    }
    return true;
  }

  if (ov.kind === "mode-effort") {
    if (idx === -1) {
      store.closeOverlay(geom.deviceId);
      return true;
    }
    const thread = store.getFocusedThread();
    if (!thread) {
      store.closeOverlay(geom.deviceId);
      return true;
    }
    if (idx === 0 && cb.setInteractionMode) {
      const next: ProviderInteractionMode = thread.interactionMode === "plan" ? "default" : "plan";
      await cb.setInteractionMode(thread.id, next);
      store.setToast(
        "mode-dial",
        next === "plan" ? "PLAN MODE ON" : "CODE MODE",
        next === "plan" ? "#C084FC" : "#10B981",
        1100
      );
      store.closeOverlay(geom.deviceId);
      return true;
    }
    const entry = store.getThreadModelEntry(thread);
    const allowedModes: readonly RuntimeMode[] =
      entry?.supportedRuntimeModes && entry.supportedRuntimeModes.length > 0
        ? entry.supportedRuntimeModes
        : RUNTIME_MODE_ORDER;
    const modeIdx = idx - 1;
    if (modeIdx < allowedModes.length && cb.setRuntimeMode) {
      const m = allowedModes[modeIdx]!;
      await cb.setRuntimeMode(thread.id, m);
      store.setToast("mode-dial", `MODE: ${m.toUpperCase()}`, "#10B981", 1100);
      store.closeOverlay(geom.deviceId);
      return true;
    }
    const desc = entry?.reasoningDescriptor;
    const effortOptions = desc?.type === "select" ? (desc.options ?? []) : [];
    const eff = effortOptions[modeIdx - allowedModes.length];
    if (eff && desc && cb.setModelSelection) {
      const existing = normalizeOptionSelections(thread.modelSelection?.options).filter(
        (o) => o.id !== desc.id
      );
      existing.push({ id: desc.id, value: eff.id });
      await cb.setModelSelection(thread.id, {
        instanceId: thread.modelSelection?.instanceId || thread.providerInstanceId,
        model: thread.modelSelection.model,
        options: existing
      });
      store.setToast("mode-dial", `EFFORT: ${eff.label.toUpperCase()}`, "#38BDF8", 1100);
      store.closeOverlay(geom.deviceId);
    }
    return true;
  }

  if (ov.kind === "prompts") {
    if (idx === -1) {
      store.closeOverlay(geom.deviceId);
      return true;
    }
    const thread = store.getFocusedThread();
    if (!thread) {
      store.closeOverlay(geom.deviceId);
      return true;
    }
    if (idx === 0) {
      if (store.promptSuggestion && store.promptSuggestion.threadId === thread.id) {
        await cb.sendPrompt(thread.id, store.promptSuggestion.text, "auto");
        store.setToast("prompt", "SENT AI NEXT", "#22D3EE", 1200);
        store.closeOverlay(geom.deviceId);
      }
      return true;
    }
    if (idx === 1) {
      await cb.sendPrompt(thread.id, "Implement the proposed plan.", "auto");
      store.setToast("prompt", "IMPLEMENTING", "#10B981", 1200);
      store.closeOverlay(geom.deviceId);
      return true;
    }
    if (idx === 2) {
      await cb.startVoice?.(geom.deviceId, slot);
      return true;
    }
    const preset = QUICK_PROMPT_PRESETS[idx - 2];
    if (preset) {
      await cb.sendPrompt(thread.id, preset.prompt, "auto");
      store.setToast("prompt", preset.label, preset.accent, 1200);
      store.closeOverlay(geom.deviceId);
    }
    return true;
  }

  if (ov.kind === "fleet") {
    if (idx === -1) {
      store.closeOverlay(geom.deviceId);
      return true;
    }
    const list = store.getFilteredThreads("active");
    const hasPages = list.length > pageSize;
    const perPage = hasPages ? Math.max(1, pageSize - 1) : pageSize;
    if (hasPages && idx === pageSize - 1) {
      store.stepOverlayQueue(1, geom.deviceId, perPage);
      return true;
    }
    const target = list[ov.page * perPage + idx];
    if (!target) return true;
    store.focusThread(target.id);
    if (store.openApprovalOverlay(target.id, slot, geom.deviceId)) return true;
    if (store.openQuestionOverlay(target.id, slot, geom.deviceId)) return true;
    store.closeOverlay(geom.deviceId);
    if (isLongPress) cb.openThread(target.id);
    return true;
  }

  if (ov.kind === "thread-tools") {
    if (idx === -1) {
      store.closeOverlay(geom.deviceId);
      return true;
    }
    const thread = store.getFocusedThread();
    switch (idx) {
      case 0:
        if (thread) await cb.settleToggle(thread.id);
        store.closeOverlay(geom.deviceId);
        return true;
      case 1:
        if (thread) await cb.pinToggle(thread.id);
        store.closeOverlay(geom.deviceId);
        return true;
      case 2:
        if (thread?.latestRunId) {
          await cb.markThreadUnread(thread.id);
          store.setToast("settle", "MARKED UNREAD", "#38BDF8", 1100);
        }
        store.closeOverlay(geom.deviceId);
        return true;
      case 3:
        if (thread) {
          const pr = primaryPullRequest(thread);
          if (pr?.url) cb.openUrl(pr.url);
        }
        store.closeOverlay(geom.deviceId);
        return true;
      case 4:
        if (thread) await cb.interruptOrStop(thread.id);
        store.closeOverlay(geom.deviceId);
        return true;
      case 5:
        store.openSnoozeOverlay(slot, geom.deviceId);
        return true;
      case 6:
        await cb.resync();
        store.setToast("snooze", "RESYNCED", "#38BDF8", 1100);
        store.closeOverlay(geom.deviceId);
        return true;
    }
    return true;
  }

  return false;
}

/** Handles a dial twist when an overlay is active on `geom`. */
export function handleOverlayDialRotate(
  store: T3Store,
  col: number,
  ticks: number,
  geom: SurfaceGeometry = DEFAULT_PLUS_GEOMETRY
): boolean {
  const ov = store.getOverlay(geom.deviceId);
  if (ov.kind === "none") return false;
  const pageSize = Math.max(1, geom.cols * geom.rows - 1);

  if (ov.kind === "new-chat-builder") {
    store.stepNewChatBuilderDial(col, ticks, geom.deviceId);
    return true;
  }
  if (ov.kind === "snooze") {
    store.stepSnoozeCustom(ticks, geom.deviceId);
    return true;
  }
  if (ov.kind === "prompts") {
    store.stepPromptSelection(ticks, geom.deviceId);
    return true;
  }
  if (col === 0) {
    store.stepOverlayQueue(ticks, geom.deviceId, pageSize);
  } else {
    store.scrollOverlay(ticks, geom.deviceId, 4);
  }
  return true;
}

/** Handles a dial press or touch-strip tap when an overlay is active on `geom`. */
export async function handleOverlayDialTapOrPress(
  store: T3Store,
  col: number,
  cb: SurfaceDispatchCallbacks,
  geom: SurfaceGeometry = DEFAULT_PLUS_GEOMETRY
): Promise<boolean> {
  const ov = store.getOverlay(geom.deviceId);
  if (ov.kind === "none") return false;

  if (ov.kind === "new-chat-builder") {
    if (col === 1 || col === 2) {
      store.toggleNewChatBuilderDial(col, geom.deviceId);
      return true;
    }
    if (col === 3) {
      const projects = store.getLaunchProjects();
      const proj = projects[ov.projectIndex] ?? projects[0];
      if (!proj) {
        store.closeOverlay(geom.deviceId);
        return true;
      }
      const catalog = store.getNewChatBuilderCatalog(geom.deviceId);
      const chosen = catalog[ov.modelIndex] ?? catalog[0];
      const modelSelection: ModelSelection = chosen
        ? { instanceId: chosen.instanceId, provider: chosen.driver, model: chosen.slug }
        : (store.getDefaultModelSelectionForProject(proj) ?? { model: "claude-opus-5-5" });
      await cb.createAndOpenThread({
        projectId: proj.id,
        modelSelection,
        interactionMode: ov.interactionMode,
        workspaceMode: ov.workspaceMode
      });
      store.setToast("new", proj.title.toUpperCase(), "#10B981", 1200);
      store.closeOverlay(geom.deviceId);
      return true;
    }
    return true;
  }

  if (ov.kind === "snooze" && ov.customMinutes !== null) {
    const thread = store.getFocusedThread();
    if (thread) {
      const untilIso = new Date(Date.now() + ov.customMinutes * 60_000).toISOString();
      await cb.snoozeThreadUntil(thread.id, untilIso);
      const lbl =
        ov.customMinutes < 60 ? `${ov.customMinutes}M` : `${Math.round(ov.customMinutes / 60)}H`;
      store.setToast("snooze", `SNOOZED ${lbl}`, "#38BDF8", 1200);
    }
    store.closeOverlay(geom.deviceId);
    return true;
  }

  if (ov.kind === "prompts") {
    const thread = store.getFocusedThread();
    if (thread) {
      if (ov.selectedIndex === 0) {
        if (store.promptSuggestion && store.promptSuggestion.threadId === thread.id) {
          await cb.sendPrompt(thread.id, store.promptSuggestion.text, "auto");
          store.setToast("prompt", "SENT AI NEXT", "#22D3EE", 1200);
        }
      } else if (ov.selectedIndex === 1) {
        await cb.sendPrompt(thread.id, "Implement the proposed plan.", "auto");
        store.setToast("prompt", "IMPLEMENTING", "#10B981", 1200);
      } else {
        const preset = QUICK_PROMPT_PRESETS[ov.selectedIndex - 2];
        if (preset) {
          await cb.sendPrompt(thread.id, preset.prompt, "auto");
          store.setToast("prompt", preset.label, preset.accent, 1200);
        }
      }
    }
    store.closeOverlay(geom.deviceId);
    return true;
  }

  if (ov.kind === "voice") {
    if (ov.phase === "listening" || ov.phase === "draft" || ov.phase === "missing-model" || ov.phase === "error") {
      await handleVoiceActionSlot(store, ov, 1, cb, geom.deviceId);
    }
    return true;
  }

  if (ov.kind === "question") {
    const res = store.selectQuestionOption(col, geom.deviceId, 4);
    if (res.readyToSubmit && res.threadId && res.requestId && res.answers) {
      await cb.respondToUserInput(res.threadId, res.requestId, res.answers);
      store.markRequestResolvedLocally(res.threadId, res.requestId);
      store.setToast("approve", "ANSWERED", "#C084FC", 1100);
    }
    return true;
  }

  if (ov.kind === "approval") {
    const { item } = store.getActiveOverlayApproval(geom.deviceId);
    if (col === 0 && item) {
      cb.openThread(item.threadId);
    } else {
      store.closeOverlay(geom.deviceId);
    }
    return true;
  }

  if (ov.kind === "new-chat-model") {
    if (col === 1) {
      store.toggleNewChatModelScope(geom.deviceId);
      return true;
    }
    if (col === 2) {
      store.toggleNewChatInteractionMode(geom.deviceId);
      return true;
    }
    if (ov.parentKind === "new-chat-project") {
      store.openNewChatProjectOverlay(ov.parentOriginSlot, ov.interactionMode, geom.deviceId);
    } else if (ov.parentKind === "new-chat-env") {
      store.openNewChatEnvOverlay(ov.parentOriginSlot, ov.interactionMode, geom.deviceId);
    } else {
      store.closeOverlay(geom.deviceId);
    }
    return true;
  }

  if (ov.kind === "model-picker") {
    if (col === 1) {
      store.toggleModelPickerScope(geom.deviceId);
      return true;
    }
    store.closeOverlay(geom.deviceId);
    return true;
  }

  store.closeOverlay(geom.deviceId);
  return true;
}

/**
 * Renders the complete keys + dials for the current store state on `geom`
 * (Base Layer OR active Overlay). Supports Plus (4x2+4), Plus XL (9x4+6), MK.2 (5x3),
 * XL (8x4), Neo (4x2), and Mini (3x2).
 */
export function renderCompleteDeckSvgs(
  store: T3Store,
  promptSettings: QuickPromptSettings = { label: "CONTINUE", prompt: "Continue", mode: "auto" },
  newThreadSettings: NewThreadSettings = { firstPicker: "project", defaultInteractionMode: "default" },
  geom: SurfaceGeometry = DEFAULT_PLUS_GEOMETRY
): { keys: string[]; dials: string[] } {
  const keys: string[] = [];
  const dials: string[] = [];

  const connected = store.connectionState === "connected";
  const focused = store.getFocusedThread();
  const approval = store.getActionableApprovalThread();
  const pendingCount = store.getPendingApprovalQueue().length;
  const projectName = focused ? store.getProjectName(focused.projectId) : "T3";
  const { index, total } = store.getFocusedIndex();
  const { catalog, activeIndex, entry, scope } = store.getActiveModelEntry(focused);
  const { card, index: usageIdx, total: usageTotal } = store.getCurrentUsageCard();
  const newChatHint =
    newThreadSettings.firstPicker === "environment"
      ? "HOLD: PICK ENV"
      : newThreadSettings.firstPicker === "model"
        ? "HOLD: MODELS"
        : "HOLD: PROJECTS";

  const core8 = [
    renderFleetAttentionKey(store.getFleetStats(), connected, store.getToast("fleet")),
    renderApproveKey(approval, focused, store.getToast("approve"), pendingCount),
    renderStopDenyKey(approval, focused, store.getToast("stop")),
    renderSettlePinKey(focused, store.getToast("settle")),
    renderNewThreadKey(projectName, store.getToast("new"), newChatHint),
    renderQuickPromptKey(
      focused,
      promptSettings.label || "CONTINUE",
      promptSettings.mode || "auto",
      store.getToast("prompt")
    ),
    renderOpenThreadKey(focused, projectName, store.getToast("open")),
    renderSnoozeSyncKey(
      focused,
      connected,
      store.getToast("snooze"),
      store.getDefaultSnoozePreset().shortLabel
    )
  ];

  const cockpit4Keys = [
    renderThreadKey(focused, projectName, store.filterMode, index, total, connected, store.getToast("thread-dial")),
    renderModelKey(focused, entry, scope, store.getToast("model-dial")),
    renderModeEffortKey(focused, entry, store.getToast("mode-dial")),
    renderUsageKey(card, usageIdx, usageTotal, connected, store.getToast("usage-dial"))
  ];

  const baseKeys: string[] = [];
  if (geom.cols === 4 && geom.rows === 2) {
    baseKeys.push(...core8);
  } else if (geom.cols === 3 && geom.rows === 2) {
    baseKeys.push(core8[0]!, core8[1]!, core8[2]!, cockpit4Keys[0]!, cockpit4Keys[1]!, cockpit4Keys[2]!);
  } else {
    const threads = store.getFilteredThreads();
    let slotCounter = 0;
    for (let row = 0; row < geom.rows; row++) {
      for (let col = 0; col < geom.cols; col++) {
        if (col < 4 && row < 2) {
          baseKeys.push(core8[row * 4 + col]!);
        } else if (col < 4 && row === 2) {
          baseKeys.push(cockpit4Keys[col]!);
        } else {
          const t = threads[slotCounter] ?? null;
          baseKeys.push(
            renderThreadSlotKey(
              slotCounter + 1,
              t,
              t ? store.getProjectName(t.projectId) : "",
              connected
            )
          );
          slotCounter++;
        }
      }
    }
  }

  if (store.getOverlay(geom.deviceId).kind !== "none") {
    for (let row = 0; row < geom.rows; row++) {
      for (let col = 0; col < geom.cols; col++) {
        const ovSvg = renderOverlayKeySvg(store, col, row, geom);
        keys.push(ovSvg ?? baseKeys[row * geom.cols + col] ?? "");
      }
    }
    for (let col = 0; col < geom.stripCols; col++) {
      dials.push(renderOverlayDialSvg(store, col, geom) ?? "");
    }
    return { keys, dials };
  }

  keys.push(...baseKeys);

  if (geom.stripCols > 0) {
    const defSnooze = store.getDefaultSnoozePreset();
    const hasAi = Boolean(
      store.promptSuggestion && focused && store.promptSuggestion.threadId === focused.id
    );
    const baseDials = [
      renderThreadDialCanvas(
        focused,
        projectName,
        store.filterMode,
        index,
        total,
        connected,
        store.getToast("thread-dial")
      ),
      renderModelDialCanvas(
        focused,
        catalog,
        activeIndex,
        store.pendingModelIndex,
        scope,
        entry,
        store.getToast("model-dial")
      ),
      renderModeEffortDialCanvas(focused, entry, store.getToast("mode-dial")),
      renderUsageDialCanvas(card, usageIdx, usageTotal, connected, store.getToast("usage-dial")),
      renderQuickPromptDialCanvas(
        focused,
        hasAi ? "AI NEXT" : "CONTINUE",
        hasAi ? store.promptSuggestion!.text : "Continue",
        0,
        2 + QUICK_PROMPT_PRESETS.length,
        hasAi,
        store.getToast("prompt-dial")
      ),
      renderSnoozeDialCanvas(
        focused,
        defSnooze.label,
        defSnooze.sublabel,
        0,
        Math.max(1, store.getResolvedSnoozePresets().length),
        connected,
        store.getToast("snooze-dial")
      )
    ];
    for (let c = 0; c < geom.stripCols; c++) {
      dials.push(baseDials[c] ?? baseDials[c % baseDials.length]!);
    }
  }

  return { keys, dials };
}
