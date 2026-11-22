import {
  renderApprovalPanoramicFrame,
  renderApproveKey,
  renderFleetAttentionKey,
  renderFleetPanoramicFrame,
  renderModeEffortDialCanvas,
  renderModelDialCanvas,
  renderNewChatBuilderPanoramicFrame,
  renderNewChatEnvPanoramicFrame,
  renderNewChatModelPanoramicFrame,
  renderNewChatProjectPanoramicFrame,
  renderNewThreadKey,
  renderOpenThreadKey,
  renderOverlayActionKey,
  renderPromptsPanoramicFrame,
  renderQuestionPanoramicFrame,
  renderQuickPromptKey,
  renderSettlePinKey,
  renderSnoozePanoramicFrame,
  renderSnoozeSyncKey,
  renderStopDenyKey,
  renderThreadDialCanvas,
  renderThreadSlotKey,
  renderThreadToolsPanoramicFrame,
  renderUsageDialCanvas,
  slicePanoramicFrame,
  type PanoramicFrame
} from "./render.js";
import {
  isThreadRunning,
  isThreadSettled,
  isThreadSnoozed,
  primaryPullRequest,
  QUICK_PROMPT_PRESETS,
  shortModelLabel,
  type T3Store
} from "./store.js";
import type {
  ModelSelection,
  NewThreadSettings,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  QuickPromptSettings
} from "./types.js";

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
  createAndOpenThread: (input: {
    projectId: string;
    modelSelection: ModelSelection;
    interactionMode?: ProviderInteractionMode;
    workspaceMode?: "local" | "worktree" | "scratch";
  }) => Promise<void>;
  openThread: (threadId: string) => void;
  openUrl: (url: string) => void;
  resync: () => Promise<void>;
}

/**
 * Maps a physical 4x2 key slot (0..7) to an item index (0..6), reserving `originSlot`
 * strictly for BACK (returns -1 when `slot === originSlot`).
 */
export function itemIndexForSlot(slot: number, originSlot: number): number {
  const safeOrigin = Math.max(0, Math.min(7, originSlot));
  if (slot === safeOrigin) return -1;
  return slot < safeOrigin ? slot : slot - 1;
}

type EnvChoice =
  | { kind: "workspace"; mode: "local" | "worktree" | "scratch"; label: string; sublabel: string; accent: string; glyph: "folder" | "branch" | "spark" }
  | { kind: "projects"; label: string; sublabel: string; accent: string; glyph: "folder" }
  | { kind: "linked"; environmentId: string; label: string; sublabel: string; accent: string; glyph: "server" };

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

/** Returns the active panoramic 1600x200 frame when an overlay is open, or null on Base Layer. */
export function getActivePanoramicFrame(store: T3Store): PanoramicFrame | null {
  const ov = store.overlay;
  if (ov.kind === "none") return null;

  switch (ov.kind) {
    case "approval": {
      const { item, index, total } = store.getActiveOverlayApproval();
      return renderApprovalPanoramicFrame(item, index, total, ov.scrollLine);
    }
    case "question": {
      const { item, index, total } = store.getActiveOverlayQuestion();
      const q = item?.questions[ov.questionIndex];
      const selected = q ? (ov.selectedByQuestionId[q.id] ?? []) : [];
      return renderQuestionPanoramicFrame(item, ov.questionIndex, ov.optionPage, selected, index, total);
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
      return renderPromptsPanoramicFrame(thread, projectName, store.promptSuggestion, selLabel, selText);
    }
    case "new-chat-builder": {
      const projects = store.getLaunchProjects();
      const proj = projects[ov.projectIndex] ?? projects[0] ?? null;
      const catalog = store.getNewChatBuilderCatalog();
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
      const totalPages = Math.max(1, Math.ceil(list.length / 7));
      return renderFleetPanoramicFrame(store.getFleetStats(), ov.page, totalPages);
    }
    case "thread-tools": {
      const thread = store.getFocusedThread();
      const projectName = thread ? store.getProjectName(thread.projectId) : "T3";
      return renderThreadToolsPanoramicFrame(thread, projectName);
    }
    case "new-chat-project": {
      const projects = store.getLaunchProjects();
      const totalPages = Math.max(1, Math.ceil(projects.length / 7));
      return renderNewChatProjectPanoramicFrame(ov.page, totalPages, projects.length);
    }
    case "new-chat-env": {
      const focused = store.getFocusedThread();
      const projName = focused
        ? store.getProjectName(focused.projectId)
        : store.getLaunchProjects()[0]?.title ?? "T3 Code";
      const choices = buildEnvChoices(store);
      const totalPages = Math.max(1, Math.ceil(choices.length / 7));
      return renderNewChatEnvPanoramicFrame(projName, ov.page, totalPages, store.getPeerLinks().length);
    }
    case "new-chat-model": {
      const projectName =
        ov.workspaceMode === "scratch"
          ? "Scratch"
          : `${store.getProjectName(ov.projectId)}${ov.workspaceMode === "worktree" ? " (wt)" : ""}`;
      const models = store.getNewChatModelCatalog();
      const totalPages = Math.max(1, Math.ceil(models.length / 7));
      return renderNewChatModelPanoramicFrame(
        projectName,
        ov.scope,
        ov.interactionMode,
        ov.page,
        totalPages
      );
    }
  }
}

/** Renders the sliced 400x200 dial SVG for column `col` (0..3) when an overlay is active. */
export function renderOverlayDialSvg(store: T3Store, col: number): string | null {
  const frame = getActivePanoramicFrame(store);
  if (!frame) return null;
  return slicePanoramicFrame(frame, col);
}

/** Renders the 144x144 key SVG for `(col, row)` (col 0..3, row 0..1) when an overlay is active. */
export function renderOverlayKeySvg(store: T3Store, col: number, row: number): string | null {
  const ov = store.overlay;
  if (ov.kind === "none") return null;
  const slot = row * 4 + col; // 0..7

  // ---- Approval Inspector (keeps CONFIRM at slot 1 so tap-tap confirms with zero finger move) ----
  if (ov.kind === "approval") {
    const { item, index, total } = store.getActiveOverlayApproval();
    const canRespond = Boolean(item && item.responseCapability === "live");
    const hasAlways = Boolean(item?.options?.some((o) => o.decision === "acceptAlways"));
    switch (slot) {
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
          subLabel: "OR DIAL 1",
          accent: "#F59E0B",
          bgTop: "#241706",
          glyph: "prev",
          disabled: total <= 1
        });
      case 5:
        return renderOverlayActionKey({
          topLabel: total > 1 ? `QUEUE ${index + 1}/${total}` : "QUEUE",
          mainLabel: "NEXT",
          subLabel: "OR DIAL 1",
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
      default:
        return renderOverlayActionKey({
          topLabel: "EXIT",
          mainLabel: "DISMISS",
          subLabel: "LEAVE PENDING",
          accent: "#64748B",
          bgTop: "#131824",
          glyph: "back"
        });
    }
  }

  // ---- Question Responder (bottom row 4..7 mirrors the 4 touch-strip option cards!) ----
  if (ov.kind === "question") {
    const { item } = store.getActiveOverlayQuestion();
    const question = item?.questions[ov.questionIndex];
    const options = question?.options ?? [];
    const pageOptions = options.slice(ov.optionPage * 4, ov.optionPage * 4 + 4);
    const selected = question ? (ov.selectedByQuestionId[question.id] ?? []) : [];

    if (slot < 4) {
      switch (slot) {
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
                subLabel: options.length > 4 ? `PAGE ${ov.optionPage + 1}` : "ALL SHOWN",
                accent: "#C084FC",
                bgTop: "#24113B",
                glyph: "next",
                disabled: options.length <= 4
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
        default:
          return renderOverlayActionKey({
            topLabel: "CUSTOM",
            mainLabel: "TYPE IN T3",
            subLabel: "OPEN APP",
            accent: "#38BDF8",
            bgTop: "#0B243E",
            glyph: "open",
            disabled: !item
          });
      }
    }

    const optSlot = slot - 4;
    const opt = pageOptions[optSlot];
    if (!opt) {
      return renderOverlayActionKey({
        topLabel: `OPT ${ov.optionPage * 4 + optSlot + 1}`,
        mainLabel: "—",
        accent: "#334155",
        bgTop: "#0D111C",
        glyph: "number",
        glyphText: String(ov.optionPage * 4 + optSlot + 1),
        disabled: true
      });
    }
    const isSelected = selected.includes(opt.label);
    return renderOverlayActionKey({
      topLabel: isSelected ? "SELECTED" : `OPTION ${ov.optionPage * 4 + optSlot + 1}`,
      mainLabel: opt.label.toUpperCase(),
      subLabel: question?.multiSelect ? "TAP TO TOGGLE" : "TAP TO ANSWER",
      accent: isSelected ? "#34D399" : "#C084FC",
      bgTop: isSelected ? "#0A2B22" : "#271040",
      glyph: isSelected ? "check" : "number",
      glyphText: String(ov.optionPage * 4 + optSlot + 1),
      glow: true
    });
  }

  // ---- Dynamic Submenus: BACK is ALWAYS at `ov.originSlot` (right under your finger!) ----
  const idx = itemIndexForSlot(slot, ov.originSlot);

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
    return renderOverlayActionKey({
      topLabel: "PRESET",
      mainLabel: "—",
      accent: "#334155",
      bgTop: "#0D111C",
      glyph: "clock",
      disabled: true
    });
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

    const pickIdx = idx - 1; // 0..5 (6 quick-pick keys!)
    if (ov.keyMode === "model") {
      const catalog = store.getNewChatBuilderCatalog();
      const entry = catalog[pickIdx];
      if (!entry) {
        return renderOverlayActionKey({
          topLabel: "MODEL",
          mainLabel: "—",
          accent: "#334155",
          bgTop: "#0D111C",
          glyph: "model",
          disabled: true
        });
      }
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
      if (!choice) {
        return renderOverlayActionKey({
          topLabel: "ENV",
          mainLabel: "—",
          accent: "#334155",
          bgTop: "#0D111C",
          glyph: "server",
          disabled: true
        });
      }
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

    // Default keyMode === "project": top 6 projects as 1-tap quick-select keys
    const projects = store.getLaunchProjects();
    const proj = projects[pickIdx];
    if (!proj) {
      return renderOverlayActionKey({
        topLabel: "PROJECT",
        mainLabel: "—",
        accent: "#334155",
        bgTop: "#0D111C",
        glyph: "folder",
        disabled: true
      });
    }
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
    const proj = projects[ov.page * 7 + idx];
    if (!proj) {
      return renderOverlayActionKey({
        topLabel: "PROJECT",
        mainLabel: "—",
        accent: "#334155",
        bgTop: "#0D111C",
        glyph: "folder",
        disabled: true
      });
    }
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
    const choice = choices[ov.page * 7 + idx];
    if (!choice) {
      return renderOverlayActionKey({
        topLabel: "ENV",
        mainLabel: "—",
        accent: "#334155",
        bgTop: "#0D111C",
        glyph: "server",
        disabled: true
      });
    }
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
    const models = store.getNewChatModelCatalog();
    const entry = models[ov.page * 7 + idx];
    if (!entry) {
      return renderOverlayActionKey({
        topLabel: "MODEL",
        mainLabel: "—",
        accent: "#334155",
        bgTop: "#0D111C",
        glyph: "model",
        disabled: true
      });
    }
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
        subLabel: hasSuggestion ? "SEE STRIP" : "WAITING…",
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
    return null;
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
    const absIdx = ov.page * 7 + idx;
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
      default:
        return renderOverlayActionKey({
          topLabel: "SERVER",
          mainLabel: "RESYNC",
          subLabel: "REFRESH T3",
          accent: "#60A5FA",
          bgTop: "#111D33",
          glyph: "sync"
        });
    }
  }

  return null;
}

/**
 * Handles a short or long key press when an overlay is active.
 * Returns `true` if handled by the overlay.
 */
export async function handleOverlayKeyPress(
  store: T3Store,
  col: number,
  row: number,
  isLongPress: boolean,
  cb: SurfaceDispatchCallbacks
): Promise<boolean> {
  const ov = store.overlay;
  if (ov.kind === "none") return false;
  const slot = row * 4 + col;

  if (ov.kind === "approval") {
    const { item } = store.getActiveOverlayApproval();
    switch (slot) {
      case 0:
      case 7:
        store.closeOverlay();
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
        store.stepOverlayQueue(-1);
        return true;
      case 5:
        store.stepOverlayQueue(1);
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
    const { item } = store.getActiveOverlayQuestion();
    if (slot === 0) {
      store.closeOverlay();
      return true;
    }
    if (slot === 1) {
      const q = item?.questions[ov.questionIndex];
      if (q?.multiSelect) {
        const res = store.submitCurrentMultiSelectQuestion();
        if (res.readyToSubmit && res.threadId && res.requestId && res.answers) {
          await cb.respondToUserInput(res.threadId, res.requestId, res.answers);
          store.markRequestResolvedLocally(res.threadId, res.requestId);
          store.setToast("approve", "ANSWERED", "#C084FC", 1100);
        }
      } else {
        store.scrollOverlay(1);
      }
      return true;
    }
    if (slot === 2) {
      if (item && item.dismissible) {
        await cb.dismissUserInput(item.threadId, item.requestId);
        store.markRequestResolvedLocally(item.threadId, item.requestId);
      }
      return true;
    }
    if (slot === 3) {
      if (item) cb.openThread(item.threadId);
      return true;
    }
    if (slot >= 4 && slot <= 7) {
      const res = store.selectQuestionOption(slot - 4);
      if (res.readyToSubmit && res.threadId && res.requestId && res.answers) {
        await cb.respondToUserInput(res.threadId, res.requestId, res.answers);
        store.markRequestResolvedLocally(res.threadId, res.requestId);
        store.setToast("approve", "ANSWERED", "#C084FC", 1100);
      }
      return true;
    }
    return true;
  }

  const idx = itemIndexForSlot(slot, ov.originSlot);

  if (ov.kind === "snooze") {
    if (idx === -1) {
      store.closeOverlay();
      return true;
    }
    const thread = store.getFocusedThread();
    const secondary = store.getSecondarySnoozePresets();
    const preset = secondary[idx];
    if (preset && thread) {
      await cb.snoozeThreadUntil(thread.id, preset.snoozedUntilIso);
      store.setToast("snooze", `SNOOZED ${preset.shortLabel}`, "#818CF8", 1200);
      store.closeOverlay();
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
      store.closeOverlay();
    }
    return true;
  }

  if (ov.kind === "new-chat-builder") {
    if (idx === -1) {
      store.closeOverlay();
      return true;
    }
    const launchCurrent = async () => {
      const projects = store.getLaunchProjects();
      const proj = projects[ov.projectIndex] ?? projects[0];
      if (!proj) {
        store.closeOverlay();
        return;
      }
      const catalog = store.getNewChatBuilderCatalog();
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
      store.closeOverlay();
    };

    if (idx === 0) {
      await launchCurrent();
      return true;
    }

    const pickIdx = idx - 1;
    if (ov.keyMode === "model") {
      const catalog = store.getNewChatBuilderCatalog();
      if (catalog[pickIdx]) {
        if (pickIdx === ov.modelIndex) {
          await launchCurrent();
        } else {
          store.setNewChatBuilderModel(pickIdx);
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
          store.setNewChatBuilderWorkspace(choice.mode);
        }
      } else if (choice.kind === "projects") {
        store.openNewChatProjectOverlay(ov.originSlot, ov.interactionMode);
      }
      return true;
    }

    // keyMode === "project"
    const projects = store.getLaunchProjects();
    if (projects[pickIdx]) {
      if (pickIdx === ov.projectIndex) {
        await launchCurrent();
      } else {
        store.setNewChatBuilderProject(pickIdx);
      }
    }
    return true;
  }

  if (ov.kind === "new-chat-project") {
    if (idx === -1) {
      store.closeOverlay();
      return true;
    }
    const projects = store.getLaunchProjects();
    const proj = projects[ov.page * 7 + idx];
    if (!proj) return true;
    if (isLongPress) {
      store.openNewChatModelOverlay(proj.id, {
        originSlot: slot,
        parentKind: "new-chat-project",
        parentOriginSlot: ov.originSlot,
        workspaceMode: "local",
        interactionMode: ov.interactionMode
      });
      return true;
    }
    const modelSelection = store.getDefaultModelSelectionForProject(proj);
    if (!modelSelection) {
      cb.openUrl("t3code://app/");
      store.closeOverlay();
      return true;
    }
    await cb.createAndOpenThread({
      projectId: proj.id,
      modelSelection,
      interactionMode: ov.interactionMode,
      workspaceMode: "local"
    });
    store.setToast("new", proj.title.toUpperCase(), "#38BDF8", 1200);
    store.closeOverlay();
    return true;
  }

  if (ov.kind === "new-chat-env") {
    if (idx === -1) {
      store.closeOverlay();
      return true;
    }
    const choices = buildEnvChoices(store);
    const choice = choices[ov.page * 7 + idx];
    if (!choice) return true;

    if (choice.kind === "projects") {
      store.openNewChatProjectOverlay(slot, ov.interactionMode);
      return true;
    }
    if (choice.kind === "linked") {
      cb.openUrl("t3code://app/");
      store.setToast("new", choice.label, "#C084FC", 1100);
      store.closeOverlay();
      return true;
    }
    // workspace choice ("local" | "worktree" | "scratch")
    const focused = store.getFocusedThread();
    const targetProject =
      (focused ? store.getProjectById(focused.projectId) : null) ?? store.getLaunchProjects()[0];
    if (!targetProject) {
      cb.openUrl("t3code://app/");
      store.closeOverlay();
      return true;
    }
    if (isLongPress) {
      store.openNewChatModelOverlay(targetProject.id, {
        originSlot: slot,
        parentKind: "new-chat-env",
        parentOriginSlot: ov.originSlot,
        workspaceMode: choice.mode,
        interactionMode: ov.interactionMode
      });
      return true;
    }
    const modelSelection = store.getDefaultModelSelectionForProject(targetProject);
    if (!modelSelection) {
      cb.openUrl("t3code://app/");
      store.closeOverlay();
      return true;
    }
    await cb.createAndOpenThread({
      projectId: targetProject.id,
      modelSelection,
      interactionMode: ov.interactionMode,
      workspaceMode: choice.mode
    });
    store.setToast("new", choice.label, choice.accent, 1200);
    store.closeOverlay();
    return true;
  }

  if (ov.kind === "new-chat-model") {
    if (idx === -1) {
      if (ov.parentKind === "new-chat-project") {
        store.openNewChatProjectOverlay(ov.parentOriginSlot, ov.interactionMode);
      } else if (ov.parentKind === "new-chat-env") {
        store.openNewChatEnvOverlay(ov.parentOriginSlot, ov.interactionMode);
      } else {
        store.closeOverlay();
      }
      return true;
    }
    const models = store.getNewChatModelCatalog();
    const entry = models[ov.page * 7 + idx];
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
    store.closeOverlay();
    return true;
  }

  if (ov.kind === "prompts") {
    if (idx === -1) {
      store.closeOverlay();
      return true;
    }
    const thread = store.getFocusedThread();
    if (!thread) {
      store.closeOverlay();
      return true;
    }
    if (idx === 0) {
      if (store.promptSuggestion && store.promptSuggestion.threadId === thread.id) {
        await cb.sendPrompt(thread.id, store.promptSuggestion.text, "auto");
        store.setToast("prompt", "SENT AI NEXT", "#22D3EE", 1200);
        store.closeOverlay();
      }
      return true;
    }
    if (idx === 1) {
      await cb.sendPrompt(thread.id, "Implement the proposed plan.", "auto");
      store.setToast("prompt", "IMPLEMENTING", "#10B981", 1200);
      store.closeOverlay();
      return true;
    }
    const preset = QUICK_PROMPT_PRESETS[idx - 2];
    if (preset) {
      await cb.sendPrompt(thread.id, preset.prompt, "auto");
      store.setToast("prompt", preset.label, preset.accent, 1200);
      store.closeOverlay();
    }
    return true;
  }

  if (ov.kind === "fleet") {
    if (idx === -1) {
      store.closeOverlay();
      return true;
    }
    const list = store.getFilteredThreads("active");
    const target = list[ov.page * 7 + idx];
    if (!target) return true;
    store.focusThread(target.id);
    if (store.openApprovalOverlay(target.id, slot)) return true;
    if (store.openQuestionOverlay(target.id, slot)) return true;
    store.closeOverlay();
    if (isLongPress) cb.openThread(target.id);
    return true;
  }

  if (ov.kind === "thread-tools") {
    if (idx === -1) {
      store.closeOverlay();
      return true;
    }
    const thread = store.getFocusedThread();
    switch (idx) {
      case 0:
        if (thread) await cb.settleToggle(thread.id);
        store.closeOverlay();
        return true;
      case 1:
        if (thread) await cb.pinToggle(thread.id);
        store.closeOverlay();
        return true;
      case 2:
        if (thread?.latestRunId) {
          await cb.markThreadUnread(thread.id);
          store.setToast("settle", "MARKED UNREAD", "#38BDF8", 1100);
        }
        store.closeOverlay();
        return true;
      case 3:
        if (thread) {
          const pr = primaryPullRequest(thread);
          if (pr?.url) cb.openUrl(pr.url);
        }
        store.closeOverlay();
        return true;
      case 4:
        if (thread) await cb.interruptOrStop(thread.id);
        store.closeOverlay();
        return true;
      case 5:
        store.openSnoozeOverlay(slot);
        return true;
      case 6:
        await cb.resync();
        store.setToast("snooze", "RESYNCED", "#38BDF8", 1100);
        store.closeOverlay();
        return true;
    }
    return true;
  }

  return false;
}

/** Handles a dial twist when an overlay is active. */
export function handleOverlayDialRotate(store: T3Store, col: number, ticks: number): boolean {
  const ov = store.overlay;
  if (ov.kind === "none") return false;
  if (ov.kind === "new-chat-builder") {
    store.stepNewChatBuilderDial(col, ticks);
    return true;
  }
  if (ov.kind === "snooze") {
    store.stepSnoozeCustom(ticks);
    return true;
  }
  if (ov.kind === "prompts") {
    store.stepPromptSelection(ticks);
    return true;
  }
  if (col === 0) {
    store.stepOverlayQueue(ticks);
  } else {
    store.scrollOverlay(ticks);
  }
  return true;
}

/** Handles a dial press or touch-strip tap when an overlay is active. */
export async function handleOverlayDialTapOrPress(
  store: T3Store,
  col: number,
  cb: SurfaceDispatchCallbacks
): Promise<boolean> {
  const ov = store.overlay;
  if (ov.kind === "none") return false;

  if (ov.kind === "new-chat-builder") {
    if (col === 1 || col === 2) {
      store.toggleNewChatBuilderDial(col);
      return true;
    }
    if (col === 3) {
      const projects = store.getLaunchProjects();
      const proj = projects[ov.projectIndex] ?? projects[0];
      if (!proj) {
        store.closeOverlay();
        return true;
      }
      const catalog = store.getNewChatBuilderCatalog();
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
      store.closeOverlay();
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
    store.closeOverlay();
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
    store.closeOverlay();
    return true;
  }

  if (ov.kind === "question") {
    const res = store.selectQuestionOption(col);
    if (res.readyToSubmit && res.threadId && res.requestId && res.answers) {
      await cb.respondToUserInput(res.threadId, res.requestId, res.answers);
      store.markRequestResolvedLocally(res.threadId, res.requestId);
      store.setToast("approve", "ANSWERED", "#C084FC", 1100);
    }
    return true;
  }

  if (ov.kind === "approval") {
    const { item } = store.getActiveOverlayApproval();
    if (col === 0 && item) {
      cb.openThread(item.threadId);
    } else {
      store.closeOverlay();
    }
    return true;
  }

  if (ov.kind === "new-chat-model") {
    if (col === 1) {
      store.toggleNewChatModelScope();
      return true;
    }
    if (col === 2) {
      store.toggleNewChatInteractionMode();
      return true;
    }
    if (ov.parentKind === "new-chat-project") {
      store.openNewChatProjectOverlay(ov.parentOriginSlot, ov.interactionMode);
    } else if (ov.parentKind === "new-chat-env") {
      store.openNewChatEnvOverlay(ov.parentOriginSlot, ov.interactionMode);
    } else {
      store.closeOverlay();
    }
    return true;
  }

  store.closeOverlay();
  return true;
}

/**
 * Renders the complete 8 keys + 4 dials for the current store state (Base Layer OR active Overlay).
 */
export function renderCompleteDeckSvgs(
  store: T3Store,
  promptSettings: QuickPromptSettings = { label: "CONTINUE", prompt: "Continue", mode: "auto" },
  newThreadSettings: NewThreadSettings = { firstPicker: "project", defaultInteractionMode: "default" }
): { keys: string[]; dials: string[] } {
  const keys: string[] = [];
  const dials: string[] = [];

  if (store.overlay.kind !== "none") {
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 4; col++) {
        keys.push(renderOverlayKeySvg(store, col, row) ?? "");
      }
    }
    for (let col = 0; col < 4; col++) {
      dials.push(renderOverlayDialSvg(store, col) ?? "");
    }
    return { keys, dials };
  }

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

  keys.push(
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
  );

  dials.push(
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
    renderUsageDialCanvas(card, usageIdx, usageTotal, connected, store.getToast("usage-dial"))
  );

  return { keys, dials };
}
