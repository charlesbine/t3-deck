import type {
  DeckOverlay,
  FleetStats,
  ModelCatalogEntry,
  ModelCatalogScope,
  ModelFavorite,
  ModelSelection,
  PeerLinkSummary,
  PendingApprovalItem,
  PendingQuestionItem,
  ProjectShell,
  PromptSuggestion,
  ProviderInteractionMode,
  ProviderModelPreference,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  PullRequestLink,
  ResolvedSnoozePreset,
  RuntimeMode,
  ServerConfigPayload,
  ServerProvider,
  ServerSettingsPayload,
  SnoozePresetSetting,
  ThreadCategory,
  ThreadFilterMode,
  ThreadProjectionPayload,
  ThreadShell,
  UsageCard,
  UsageLimitSourceSnapshot,
  UsageWindow
} from "./types.js";

const APPROVAL_KINDS = new Set([
  "command",
  "file-read",
  "file-change",
  "mcp-elicitation",
  "permission"
]);

const QUESTION_KINDS = new Set(["user_input", "auth_refresh", "dynamic_tool_call"]);

const LIVE_STATUSES = new Set(["running", "starting", "preparing", "queued"]);

export const FILTER_CYCLE: readonly ThreadFilterMode[] = [
  "active",
  "attention",
  "running",
  "pinned",
  "all"
];

export const RUNTIME_MODE_ORDER: readonly RuntimeMode[] = [
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access"
];

const DANGEROUS_PATTERNS: ReadonlyArray<{ re: RegExp; reason: string }> = [
  { re: /\brm\s+-[a-z]*[rf][a-z]*\b/i, reason: "RECURSIVE DELETE" },
  { re: /\bsudo\b/i, reason: "ELEVATED SUDO" },
  { re: /\bgit\s+push\b[^\n]*(--force|-f\b|--force-with-lease)/i, reason: "FORCE PUSH" },
  { re: /\bgit\s+reset\s+--hard\b/i, reason: "HARD RESET" },
  { re: /\bgit\s+clean\s+-[a-z]*f/i, reason: "GIT CLEAN" },
  { re: /\b(drop\s+(table|database|schema)|truncate\s+table)\b/i, reason: "DESTRUCTIVE SQL" },
  { re: /\b(migrate\s+reset|db\s+push\s+--force-reset|--force-reset)\b/i, reason: "DB RESET" },
  { re: /\b(mkfs|dd\s+if=|chmod\s+-R\s+777|killall|pkill\s+-9)\b/i, reason: "SYSTEM ACTION" },
  { re: /\bcurl\b[^\n]*\|\s*(sh|bash|zsh)\b/i, reason: "PIPE TO SHELL" }
];

export function classifyApprovalDanger(
  prompt?: string,
  fullAccessOverride?: string
): { dangerous: boolean; reason?: string } {
  if (fullAccessOverride === "unskippable_safety") {
    return { dangerous: true, reason: "SAFETY CHECK" };
  }
  if (prompt) {
    for (const rule of DANGEROUS_PATTERNS) {
      if (rule.re.test(prompt)) {
        return { dangerous: true, reason: rule.reason };
      }
    }
  }
  if (fullAccessOverride === "ask_rule") {
    return { dangerous: true, reason: "ASK RULE" };
  }
  return { dangerous: false };
}

export const DEFAULT_T3_SNOOZE_PRESETS: readonly SnoozePresetSetting[] = [
  { kind: "after", minutes: 60 },
  { kind: "after", minutes: 180 },
  { kind: "at", day: "today", time: "18:00" },
  { kind: "at", day: "tomorrow", time: "09:00" },
  { kind: "at", day: "monday", time: "09:00" }
];

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

function formatClock12h(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function resolveSnoozePresetSettings(
  settings: readonly SnoozePresetSetting[] | null | undefined,
  nowMs = Date.now()
): ResolvedSnoozePreset[] {
  const list = settings && settings.length > 0 ? settings : DEFAULT_T3_SNOOZE_PRESETS;
  const resolved: Array<{ wakeMs: number; preset: ResolvedSnoozePreset }> = [];
  const seenWake = new Set<number>();

  for (const raw of list.slice(0, 8)) {
    if (raw.kind === "after") {
      const mins = Math.max(1, Math.round(raw.minutes));
      const wakeMs = nowMs + mins * 60_000;
      const rounded = Math.round(wakeMs / 60_000) * 60_000;
      if (seenWake.has(rounded)) continue;
      seenWake.add(rounded);

      let label: string;
      let shortLabel: string;
      if (mins < 60) {
        label = `${mins} MIN`;
        shortLabel = `${mins}M`;
      } else if (mins % 1440 === 0) {
        const d = mins / 1440;
        label = d === 1 ? "1 DAY" : `${d} DAYS`;
        shortLabel = `${d}D`;
      } else if (mins % 60 === 0) {
        const h = mins / 60;
        label = h === 1 ? "1 HOUR" : `${h} HOURS`;
        shortLabel = `${h}H`;
      } else {
        const h = Math.floor(mins / 60);
        const rm = mins % 60;
        label = `${h}H ${rm}M`;
        shortLabel = `${h}H${rm}M`;
      }
      const wakeDate = new Date(wakeMs);
      resolved.push({
        wakeMs,
        preset: {
          id: `after:${mins}`,
          label,
          shortLabel,
          sublabel: formatClock12h(wakeDate),
          snoozedUntilIso: wakeDate.toISOString()
        }
      });
      continue;
    }

    // kind === "at"
    const [hhRaw, mmRaw] = raw.time.split(":");
    const hh = Number(hhRaw);
    const mm = Number(mmRaw);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;

    const target = new Date(nowMs);
    target.setSeconds(0, 0);
    target.setHours(hh, mm, 0, 0);

    const dayKey = raw.day.toLowerCase();
    let label = dayKey.toUpperCase();
    let shortLabel = dayKey.slice(0, 3).toUpperCase();

    if (dayKey === "today") {
      if (target.getTime() <= nowMs + 60_000) {
        target.setDate(target.getDate() + 1);
      }
      label = hh >= 17 ? "TONIGHT" : "TODAY";
      shortLabel = label;
    } else if (dayKey === "tomorrow") {
      target.setDate(target.getDate() + 1);
      label = "TOMORROW";
      shortLabel = "TMRW";
    } else if (dayKey in WEEKDAY_INDEX) {
      const wantedDow = WEEKDAY_INDEX[dayKey]!;
      const curDow = target.getDay();
      let delta = (wantedDow - curDow + 7) % 7;
      if (delta === 0) delta = 7; // T3 Code rule: weekdays mean the next one after today
      target.setDate(target.getDate() + delta);
      label = dayKey.toUpperCase();
      shortLabel = dayKey.slice(0, 3).toUpperCase();
    } else {
      continue;
    }

    const wakeMs = target.getTime();
    const rounded = Math.round(wakeMs / 60_000) * 60_000;
    if (seenWake.has(rounded)) continue;
    seenWake.add(rounded);

    resolved.push({
      wakeMs,
      preset: {
        id: `at:${dayKey}:${raw.time}`,
        label,
        shortLabel,
        sublabel: formatClock12h(target),
        snoozedUntilIso: target.toISOString()
      }
    });
  }

  return resolved.sort((a, b) => a.wakeMs - b.wakeMs).map((r) => r.preset);
}

export interface QuickPromptPreset {
  id: string;
  label: string;
  sublabel: string;
  prompt: string;
  accent: string;
}

export const QUICK_PROMPT_PRESETS: readonly QuickPromptPreset[] = [
  {
    id: "continue",
    label: "CONTINUE",
    sublabel: "KEEP GOING",
    prompt: "Continue",
    accent: "#22D3EE"
  },
  {
    id: "tests",
    label: "RUN TESTS",
    sublabel: "VERIFY & FIX",
    prompt: "Run the test suite and fix any failures.",
    accent: "#10B981"
  },
  {
    id: "commit",
    label: "COMMIT & PR",
    sublabel: "SHIP CHANGES",
    prompt: "Commit our changes cleanly and open or update the pull request.",
    accent: "#818CF8"
  },
  {
    id: "fix-ci",
    label: "FIX CI",
    sublabel: "CHECK LOGS",
    prompt: "Check the failing CI logs on this branch and fix the issues.",
    accent: "#F59E0B"
  },
  {
    id: "review",
    label: "REVIEW DIFF",
    sublabel: "SELF-AUDIT",
    prompt: "Review the current diff for bugs, edge cases, and missing tests.",
    accent: "#C084FC"
  }
];

export function isApprovalRequest(thread: ThreadShell): boolean {
  return Boolean(
    thread.pendingRuntimeRequest && APPROVAL_KINDS.has(thread.pendingRuntimeRequest.kind)
  );
}

export function isQuestionRequest(thread: ThreadShell): boolean {
  return Boolean(
    thread.pendingRuntimeRequest && QUESTION_KINDS.has(thread.pendingRuntimeRequest.kind)
  );
}

export function isThreadSettled(thread: ThreadShell): boolean {
  if (thread.settledOverride === "settled") return true;
  if (thread.settledOverride === "active") return false;
  return thread.settledAt !== null;
}

export function isThreadSnoozed(thread: ThreadShell, nowMs = Date.now()): boolean {
  if (!thread.snoozedUntil) return false;
  const ts = Date.parse(thread.snoozedUntil);
  return Number.isFinite(ts) && ts > nowMs;
}

export function isThreadRunning(thread: ThreadShell): boolean {
  return (
    LIVE_STATUSES.has(thread.status) ||
    thread.activityRunStatus === "running" ||
    thread.activityRunStatus === "starting" ||
    thread.activityRunStatus === "preparing" ||
    thread.activeRunId !== null
  );
}

export function classifyThread(thread: ThreadShell): ThreadCategory {
  if (isApprovalRequest(thread)) return "approval";
  if (isQuestionRequest(thread)) return "question";
  if (thread.status === "failed") return "failed";
  if (isThreadRunning(thread)) return "running";
  if (
    thread.status === "waiting" ||
    thread.activityRunStatus === "waiting" ||
    thread.blockedOnThreadWait ||
    thread.hasActionableProposedPlan
  ) {
    return "waiting";
  }
  if (thread.status === "completed" && !isThreadSettled(thread)) return "completed";
  return "idle";
}

const CATEGORY_RANK: Record<ThreadCategory, number> = {
  approval: 0,
  question: 1,
  failed: 2,
  running: 3,
  waiting: 4,
  completed: 5,
  idle: 6
};

export function threadOpenedTimestamp(thread: ThreadShell): number {
  return typeof thread.opens?.openedAt === "number" ? thread.opens.openedAt : 0;
}

export function threadVisitTimestamp(thread: ThreadShell): number {
  const openedAt = threadOpenedTimestamp(thread);
  const visitedAt = thread.lastVisitedAt ? Date.parse(thread.lastVisitedAt) || 0 : 0;
  return Math.max(openedAt, visitedAt);
}

export function compareThreads(a: ThreadShell, b: ThreadShell): number {
  const catA = classifyThread(a);
  const catB = classifyThread(b);
  // Approvals and questions always bubble to the top so they're never missed
  const urgentA = catA === "approval" ? 0 : catA === "question" ? 1 : 2;
  const urgentB = catB === "approval" ? 0 : catB === "question" ? 1 : 2;
  if (urgentA !== urgentB) return urgentA - urgentB;

  // Otherwise order by most recently visited/opened in T3 Code (Cmd+Tab feel), falling back to updatedAt
  const visitA = threadVisitTimestamp(a);
  const visitB = threadVisitTimestamp(b);
  if (visitA !== visitB) return visitB - visitA;

  const timeA = Date.parse(a.updatedAt) || 0;
  const timeB = Date.parse(b.updatedAt) || 0;
  if (timeA !== timeB) return timeB - timeA;

  return a.id.localeCompare(b.id);
}

export function compareThreadsByAttention(a: ThreadShell, b: ThreadShell): number {
  const catA = CATEGORY_RANK[classifyThread(a)];
  const catB = CATEGORY_RANK[classifyThread(b)];
  if (catA !== catB) return catA - catB;

  const pinA = a.pinnedAt ? 0 : 1;
  const pinB = b.pinnedAt ? 0 : 1;
  if (pinA !== pinB) return pinA - pinB;

  const visitA = threadVisitTimestamp(a);
  const visitB = threadVisitTimestamp(b);
  if (visitA !== visitB) return visitB - visitA;

  const timeA = Date.parse(a.updatedAt) || 0;
  const timeB = Date.parse(b.updatedAt) || 0;
  if (timeA !== timeB) return timeB - timeA;

  return a.id.localeCompare(b.id);
}

export function primaryPullRequest(thread: ThreadShell): PullRequestLink | null {
  const all = thread.pullRequests ?? [];
  const open = all.find((pr) => pr.state === "open");
  if (open) return open;
  if (all.length > 0) return all[0] ?? null;
  if (thread.linkedPullRequest) return thread.linkedPullRequest;
  if (thread.branchPullRequest) return thread.branchPullRequest;
  return null;
}

export function providerBrandInfo(
  provider: Pick<ServerProvider, "instanceId" | "driver" | "displayName" | "accentColor" | "badgeLabel">
): { label: string; color: string } {
  const driver = provider.driver.toLowerCase();
  const id = provider.instanceId.toLowerCase();
  if (provider.accentColor) {
    return {
      label: provider.displayName || provider.badgeLabel || prettyDriverName(driver, id),
      color: provider.accentColor
    };
  }
  if (driver.includes("claude")) return { label: provider.displayName || "Claude", color: "#E07A5F" };
  if (driver.includes("codex")) return { label: provider.displayName || "Codex", color: "#10B981" };
  if (driver.includes("antigravity") || id.includes("antigravity")) {
    return { label: provider.displayName || "Antigravity", color: "#38BDF8" };
  }
  if (driver.includes("opencode")) return { label: provider.displayName || "OpenCode", color: "#A78BFA" };
  if (driver.includes("cursor")) return { label: provider.displayName || "Cursor", color: "#60A5FA" };
  if (driver.includes("grok")) return { label: provider.displayName || "Grok", color: "#F59E0B" };
  return {
    label: provider.displayName || provider.badgeLabel || prettyDriverName(driver, id),
    color: "#94A3B8"
  };
}

function prettyDriverName(driver: string, id: string): string {
  if (id.includes("antigravity")) return "Antigravity";
  if (driver === "claudeagent") return "Claude";
  if (driver === "codex") return "Codex";
  if (driver === "opencode") return "OpenCode";
  return driver.slice(0, 1).toUpperCase() + driver.slice(1);
}

export function normalizeOptionSelections(
  options: ModelSelection["options"]
): ProviderOptionSelection[] {
  if (!options) return [];
  if (Array.isArray(options)) {
    return options.filter(
      (entry): entry is ProviderOptionSelection =>
        typeof entry?.id === "string" &&
        (typeof entry.value === "string" || typeof entry.value === "boolean")
    );
  }
  const out: ProviderOptionSelection[] = [];
  for (const [id, value] of Object.entries(options)) {
    if (typeof value === "string" || typeof value === "boolean") {
      out.push({ id, value });
    }
  }
  return out;
}

export function findReasoningDescriptor(
  descriptors?: ProviderOptionDescriptor[]
): ProviderOptionDescriptor | undefined {
  if (!descriptors || descriptors.length === 0) return undefined;
  const byRole = descriptors.find(
    (d) => d.type === "select" && d.role === "reasoning" && (d.options?.length ?? 0) > 0
  );
  if (byRole) return byRole;
  return descriptors.find(
    (d) =>
      d.type === "select" &&
      (d.options?.length ?? 0) > 0 &&
      /effort|reason|thought|think/i.test(`${d.id} ${d.label}`)
  );
}

export function resolveReasoningValue(
  selection: ModelSelection | undefined,
  descriptor: ProviderOptionDescriptor | undefined
): string | null {
  if (!descriptor || descriptor.type !== "select" || !descriptor.options?.length) return null;
  const opts = normalizeOptionSelections(selection?.options);
  const matched = opts.find((o) => o.id === descriptor.id);
  if (matched && typeof matched.value === "string") return matched.value;
  if (typeof descriptor.currentValue === "string") return descriptor.currentValue;
  const def = descriptor.options.find((o) => o.isDefault);
  return def?.id ?? descriptor.options[0]?.id ?? null;
}

export function formatResetCountdown(iso?: string, nowMs = Date.now()): string {
  if (!iso) return "";
  const diffMs = Date.parse(iso) - nowMs;
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "now";
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return remMins > 0 ? `${hours}h${remMins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d${remHours}h` : `${days}d`;
}

export function shortModelLabel(slug: string, name?: string, shortName?: string): string {
  if (shortName && shortName.trim().length > 0) return shortName.trim();
  if (name && name.trim().length > 0) return name.trim();
  return slug
    .replace(/^claude-/, "")
    .replace(/^openai\//, "")
    .replace(/-/g, " ");
}

export interface ToastNotice {
  target: string;
  label: string;
  accent: string;
  expiresAt: number;
}

export class T3Store {
  connectionState: "connecting" | "connected" | "offline" = "connecting";
  connectionDetail = "";
  environmentId: string | null = null;

  private projects = new Map<string, ProjectShell>();
  private threads = new Map<string, ThreadShell>();
  private projections = new Map<string, { requestKey: string; payload: ThreadProjectionPayload }>();
  private providers: ServerProvider[] = [];
  private favorites: ModelFavorite[] = [];
  private providerModelPreferences: Record<string, ProviderModelPreference> = {};
  private snoozePresetSettings: SnoozePresetSetting[] | null = null;
  private peerLinks: PeerLinkSummary[] = [];
  private usageLimitSources: UsageLimitSourceSnapshot[] = [];

  filterMode: ThreadFilterMode = "active";
  modelScope: ModelCatalogScope = "favorites";
  focusedThreadId: string | null = null;
  private lastAppOpenedThreadId: string | null = null;
  private lastManualScrubAt = 0;
  scrubIdleReturnMs = 20_000;
  private scrubReturnTimer: NodeJS.Timeout | null = null;
  usageIndex = 0;
  promptDialIndex = 0;
  snoozeDialIndex = 0;
  promptSuggestion: PromptSuggestion | null = null;
  private overlays = new Map<string, DeckOverlay>();

  get overlay(): DeckOverlay {
    return this.getOverlay("default");
  }

  set overlay(next: DeckOverlay) {
    if (next.kind === "none") {
      this.overlays.delete("default");
    } else {
      this.overlays.set("default", next);
    }
  }

  getOverlay(deviceId = "default"): DeckOverlay {
    return this.overlays.get(deviceId) ?? { kind: "none" };
  }

  private setOverlayFor(deviceId: string, next: DeckOverlay): void {
    if (next.kind === "none") {
      this.overlays.delete(deviceId);
    } else {
      this.overlays.set(deviceId, next);
    }
    if (this.isPeekingAway()) {
      this.scheduleScrubReturnTimer();
    }
  }

  stepPromptDial(ticks: number): number {
    const total = 2 + QUICK_PROMPT_PRESETS.length;
    this.promptDialIndex = (((this.promptDialIndex + ticks) % total) + total) % total;
    this.emit();
    return this.promptDialIndex;
  }

  stepSnoozeDial(ticks: number): number {
    const presets = this.getResolvedSnoozePresets();
    const total = Math.max(1, presets.length);
    this.snoozeDialIndex = (((this.snoozeDialIndex + ticks) % total) + total) % total;
    this.emit();
    return this.snoozeDialIndex;
  }

  /** While user is spinning the Model dial, holds the preview index before press-to-apply. */
  pendingModelIndex: number | null = null;
  private pendingModelTimer: NodeJS.Timeout | null = null;

  private toasts = new Map<string, ToastNotice>();
  private toastTimers = new Map<string, NodeJS.Timeout>();
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  setConnection(state: "connecting" | "connected" | "offline", detail = ""): void {
    this.connectionState = state;
    this.connectionDetail = detail;
    this.emit();
  }

  applyConfigSnapshot(config: ServerConfigPayload): void {
    if (config.environment?.environmentId) {
      this.environmentId = config.environment.environmentId;
    }
    if (Array.isArray(config.providers)) {
      this.providers = config.providers;
    }
    if (config.settings) {
      this.applySettingsUpdated(config.settings, false);
    }
    this.emit();
  }

  applySettingsUpdated(settings: ServerSettingsPayload, shouldEmit = true): void {
    if (Array.isArray(settings.favorites)) {
      this.favorites = settings.favorites;
    } else if (settings.favorites === null) {
      this.favorites = [];
    }
    if (settings.providerModelPreferences && typeof settings.providerModelPreferences === "object") {
      this.providerModelPreferences = settings.providerModelPreferences;
    } else if (settings.providerModelPreferences === null) {
      this.providerModelPreferences = {};
    }
    if (Array.isArray(settings.snoozePresets)) {
      this.snoozePresetSettings = settings.snoozePresets;
    } else if (settings.snoozePresets === null) {
      this.snoozePresetSettings = null;
    }
    if (shouldEmit) this.emit();
  }

  applyProvidersUpdated(providers: ServerProvider[]): void {
    this.providers = providers;
    this.emit();
  }

  applyUsageLimitSourcesUpdated(sources: UsageLimitSourceSnapshot[]): void {
    this.usageLimitSources = sources;
    this.emit();
  }

  applyPeerLinksUpdated(links: PeerLinkSummary[]): void {
    this.peerLinks = links;
    this.emit();
  }

  getPeerLinks(): PeerLinkSummary[] {
    return this.peerLinks;
  }

  applyShellSnapshot(
    projects: ProjectShell[],
    threads: ThreadShell[],
    isEnrichmentOnly: boolean
  ): void {
    if (isEnrichmentOnly) {
      for (const project of projects) {
        this.projects.set(project.id, project);
      }
      this.emit();
      return;
    }

    this.projects.clear();
    for (const project of projects) {
      if (!project.deletedAt) this.projects.set(project.id, project);
    }

    this.threads.clear();
    this.projections.clear();
    for (const thread of threads) {
      if (!thread.deletedAt && !thread.archivedAt) {
        this.threads.set(thread.id, thread);
      }
    }

    // Snap initial focus to the thread currently open / most recently visited in T3 Code
    const mostRecent = this.findMostRecentlyVisitedThread();
    if (mostRecent) {
      this.focusedThreadId = mostRecent.id;
      this.lastAppOpenedThreadId = mostRecent.id;
    } else {
      this.ensureValidFocus();
    }
    this.emit();
  }

  applyProjectUpdated(project: ProjectShell): void {
    if (project.deletedAt) {
      this.projects.delete(project.id);
    } else {
      this.projects.set(project.id, project);
    }
    this.emit();
  }

  applyProjectRemoved(projectId: string): void {
    this.projects.delete(projectId);
    this.emit();
  }

  applyThreadUpdated(thread: ThreadShell, location: "active" | "archive"): void {
    const prev = this.threads.get(thread.id);
    if (location === "archive" || thread.deletedAt || thread.archivedAt) {
      this.threads.delete(thread.id);
      this.projections.delete(thread.id);
    } else {
      this.threads.set(thread.id, thread);
      const prevReqId = prev?.pendingRuntimeRequest?.id ?? null;
      const nextReqId = thread.pendingRuntimeRequest?.id ?? null;
      if (prevReqId !== nextReqId) {
        this.projections.delete(thread.id);
      }

      // Auto-follow only when the user actually switches/opens a thread in T3 Code
      // (`opens.openedAt` advances), NOT on background `lastVisitedAt` read-watermark ticks
      // while streaming in an already-open thread (which would fight Dial 1 scrubbing).
      if (!thread.lineage?.parentThreadId) {
        const prevOpened = prev ? threadOpenedTimestamp(prev) : 0;
        const nextOpened = threadOpenedTimestamp(thread);
        const prevVisited = prev?.lastVisitedAt ? Date.parse(prev.lastVisitedAt) || 0 : 0;
        const nextVisited = thread.lastVisitedAt ? Date.parse(thread.lastVisitedAt) || 0 : 0;

        const switchedByOpen = nextOpened > prevOpened;
        const switchedByVisitOnDifferentThread =
          nextVisited > prevVisited &&
          thread.id !== this.lastAppOpenedThreadId &&
          Date.now() - this.lastManualScrubAt > 8_000;

        if (switchedByOpen || switchedByVisitOnDifferentThread) {
          this.lastAppOpenedThreadId = thread.id;
          this.clearScrubReturnTimer();
          if (this.focusedThreadId !== thread.id) {
            this.focusedThreadId = thread.id;
            this.clearPendingModel();
          }
        }
      }
    }
    this.ensureValidFocus();
    this.reconcileOverlayAfterUpdate();
    this.emit();
  }

  private findMostRecentlyVisitedThread(): ThreadShell | null {
    let best: ThreadShell | null = null;
    let bestTs = 0;
    for (const t of this.threads.values()) {
      if (t.deletedAt || t.archivedAt || t.lineage?.parentThreadId) continue;
      const ts = threadVisitTimestamp(t);
      if (ts > bestTs) {
        bestTs = ts;
        best = t;
      }
    }
    return best;
  }

  applyThreadRemoved(threadId: string): void {
    this.threads.delete(threadId);
    this.projections.delete(threadId);
    this.ensureValidFocus();
    this.reconcileOverlayAfterUpdate();
    this.emit();
  }

  setToast(target: string, label: string, accent = "#10B981", durationMs = 1500): void {
    const prev = this.toastTimers.get(target);
    if (prev) clearTimeout(prev);

    this.toasts.set(target, { target, label, accent, expiresAt: Date.now() + durationMs });
    this.toastTimers.set(
      target,
      setTimeout(() => {
        this.toasts.delete(target);
        this.toastTimers.delete(target);
        this.emit();
      }, durationMs)
    );
    this.emit();
  }

  getToast(target: string): ToastNotice | undefined {
    const toast = this.toasts.get(target);
    if (!toast) return undefined;
    if (toast.expiresAt <= Date.now()) {
      this.toasts.delete(target);
      return undefined;
    }
    return toast;
  }

  getProjectName(projectId: string): string {
    return this.projects.get(projectId)?.title ?? "T3";
  }

  getProjectById(projectId: string): ProjectShell | null {
    return this.projects.get(projectId) ?? null;
  }

  /** Projects ordered for the New Chat picker: pinned first, then most recently active thread, then title. */
  getLaunchProjects(): ProjectShell[] {
    const latestActivityByProject = new Map<string, number>();
    for (const t of this.getAllThreads()) {
      const ts = Math.max(threadVisitTimestamp(t), Date.parse(t.updatedAt) || 0);
      const prev = latestActivityByProject.get(t.projectId) ?? 0;
      if (ts > prev) latestActivityByProject.set(t.projectId, ts);
    }

    return [...this.projects.values()]
      .filter((p) => !p.deletedAt && !p.archivedAt)
      .sort((a, b) => {
        const pinA = a.pinnedAt ? 0 : 1;
        const pinB = b.pinnedAt ? 0 : 1;
        if (pinA !== pinB) return pinA - pinB;
        const actA = latestActivityByProject.get(a.id) ?? 0;
        const actB = latestActivityByProject.get(b.id) ?? 0;
        if (actA !== actB) return actB - actA;
        return a.title.localeCompare(b.title);
      });
  }

  getDefaultModelSelectionForProject(project: ProjectShell): ModelSelection | null {
    if (project.defaultModelSelection?.model) {
      return project.defaultModelSelection;
    }
    const focused = this.getFocusedThread();
    if (focused?.modelSelection?.model) {
      return focused.modelSelection;
    }
    const firstFav = this.getFavoriteModelCatalog()[0] ?? this.getFullModelCatalog()[0];
    if (firstFav) {
      return {
        instanceId: firstFav.instanceId,
        provider: firstFav.driver,
        model: firstFav.slug
      };
    }
    return null;
  }

  getResolvedSnoozePresets(nowMs = Date.now()): ResolvedSnoozePreset[] {
    return resolveSnoozePresetSettings(this.snoozePresetSettings, nowMs);
  }

  /** Preset #0 (soonest in T3 Code settings) — triggered by short tap on Snooze key. */
  getDefaultSnoozePreset(nowMs = Date.now()): ResolvedSnoozePreset {
    const all = this.getResolvedSnoozePresets(nowMs);
    return (
      all[0] ?? {
        id: "after:60",
        label: "1 HOUR",
        shortLabel: "1H",
        sublabel: formatClock12h(new Date(nowMs + 3_600_000)),
        snoozedUntilIso: new Date(nowMs + 3_600_000).toISOString()
      }
    );
  }

  /** Presets #1..#7 (up to 7 remaining T3 Code presets) — placed in Hold Snooze overlay alongside BACK. */
  getSecondarySnoozePresets(nowMs = Date.now()): ResolvedSnoozePreset[] {
    return this.getResolvedSnoozePresets(nowMs).slice(1, 8);
  }

  getAllThreads(): ThreadShell[] {
    return [...this.threads.values()].filter((t) => !t.deletedAt && !t.archivedAt);
  }

  getFleetStats(): FleetStats {
    let approvals = 0;
    let questions = 0;
    let failed = 0;
    let running = 0;
    let waiting = 0;
    let active = 0;

    const all = this.getAllThreads();
    for (const thread of all) {
      const cat = classifyThread(thread);
      const isTopLevel = !thread.lineage?.parentThreadId;
      if (cat === "approval") approvals++;
      else if (cat === "question") questions++;
      else if (cat === "failed" && isTopLevel && !isThreadSettled(thread)) failed++;
      else if (cat === "running") running++;
      else if (cat === "waiting" && isTopLevel) waiting++;

      if (isTopLevel && !isThreadSettled(thread) && !isThreadSnoozed(thread)) {
        active++;
      }
    }

    return { approvals, questions, failed, running, waiting, active, total: all.length };
  }

  getFilteredThreads(mode: ThreadFilterMode = this.filterMode): ThreadShell[] {
    const all = this.getAllThreads();
    const filtered = all.filter((thread) => {
      const cat = classifyThread(thread);
      const isSubagent = Boolean(thread.lineage?.parentThreadId);
      const needsHuman = cat === "approval" || cat === "question";

      // Subagents only surface when they actively need approval/input or are live under "running"
      if (isSubagent && !needsHuman && !(mode === "running" && cat === "running")) {
        return false;
      }

      switch (mode) {
        case "attention":
          return (
            cat === "approval" ||
            cat === "question" ||
            (cat === "failed" && !isThreadSettled(thread)) ||
            Boolean(thread.hasActionableProposedPlan)
          );
        case "running":
          return cat === "running" || cat === "waiting" || needsHuman;
        case "pinned":
          return Boolean(thread.pinnedAt);
        case "active":
          return needsHuman || (!isThreadSettled(thread) && !isThreadSnoozed(thread));
        case "all":
          return true;
      }
    });

    if (mode === "attention") {
      return filtered.sort(compareThreadsByAttention);
    }
    return filtered.sort(compareThreads);
  }

  getFocusedThread(): ThreadShell | null {
    if (this.focusedThreadId) {
      const found = this.threads.get(this.focusedThreadId);
      if (found && !found.deletedAt && !found.archivedAt) return found;
    }
    const list = this.getFilteredThreads();
    return list[0] ?? this.getFilteredThreads("all")[0] ?? null;
  }

  getFocusedIndex(): { index: number; total: number } {
    const list = this.getFilteredThreads();
    if (list.length === 0) return { index: -1, total: 0 };
    const focused = this.getFocusedThread();
    const idx = focused ? list.findIndex((t) => t.id === focused.id) : 0;
    return { index: idx >= 0 ? idx : 0, total: list.length };
  }

  /** Highest-priority thread needing approval, question, failure triage, or currently running. */
  getNextAttentionThread(): ThreadShell | null {
    const attention = this.getFilteredThreads("attention");
    if (attention.length > 0) return attention[0] ?? null;
    const running = this.getFilteredThreads("running");
    if (running.length > 0) return running[0] ?? null;
    return this.getFilteredThreads("active")[0] ?? null;
  }

  /** Returns the focused thread if it has an approval/question, otherwise the first pending thread globally. */
  getActionableApprovalThread(): ThreadShell | null {
    const focused = this.getFocusedThread();
    if (focused && (isApprovalRequest(focused) || isQuestionRequest(focused))) {
      return focused;
    }
    const attention = this.getFilteredThreads("attention");
    return attention.find((t) => isApprovalRequest(t) || isQuestionRequest(t)) ?? null;
  }

  getCurrentAppThread(): ThreadShell | null {
    if (this.lastAppOpenedThreadId) {
      const current = this.threads.get(this.lastAppOpenedThreadId);
      if (current && !current.deletedAt && !current.archivedAt) {
        return current;
      }
    }
    return this.findMostRecentlyVisitedThread();
  }

  isPeekingAway(): boolean {
    const current = this.getCurrentAppThread();
    const focused = this.getFocusedThread();
    return Boolean(current && focused && current.id !== focused.id);
  }

  clearScrubReturnTimer(): void {
    if (this.scrubReturnTimer) {
      clearTimeout(this.scrubReturnTimer);
      this.scrubReturnTimer = null;
    }
  }

  scheduleScrubReturnTimer(): void {
    this.clearScrubReturnTimer();
    if (this.scrubIdleReturnMs <= 0 || !this.isPeekingAway()) return;
    this.scrubReturnTimer = setTimeout(() => {
      this.scrubReturnTimer = null;
      // Never yank focus away while the user has an interactive overlay open.
      if (this.overlays.size > 0) {
        this.scheduleScrubReturnTimer();
        return;
      }
      this.returnToCurrentThread();
    }, this.scrubIdleReturnMs);
    this.scrubReturnTimer.unref?.();
  }

  markCurrentAppThread(threadId: string): void {
    if (this.threads.has(threadId)) {
      this.lastAppOpenedThreadId = threadId;
      this.focusedThreadId = threadId;
      this.clearScrubReturnTimer();
      this.clearPendingModel();
      this.emit();
    }
  }

  returnToCurrentThread(): ThreadShell | null {
    this.clearScrubReturnTimer();
    const current = this.getCurrentAppThread();
    if (!current) return null;
    if (this.focusedThreadId !== current.id) {
      this.focusedThreadId = current.id;
      this.clearPendingModel();
      this.emit();
    }
    return current;
  }

  focusThread(threadId: string): void {
    this.focusedThreadId = threadId;
    this.clearPendingModel();
    if (this.isPeekingAway()) {
      this.scheduleScrubReturnTimer();
    } else {
      this.clearScrubReturnTimer();
    }
    this.emit();
  }

  stepFocus(ticks: number): ThreadShell | null {
    const list = this.getFilteredThreads();
    if (list.length === 0) return null;
    const { index } = this.getFocusedIndex();
    const base = index >= 0 ? index : 0;
    const nextIdx = ((base + ticks) % list.length + list.length) % list.length;
    const next = list[nextIdx] ?? null;
    if (next) {
      this.focusedThreadId = next.id;
      this.lastManualScrubAt = Date.now();
      this.clearPendingModel();
      if (this.isPeekingAway()) {
        this.scheduleScrubReturnTimer();
      } else {
        this.clearScrubReturnTimer();
      }
      this.emit();
    }
    return next;
  }

  cycleFilterMode(): ThreadFilterMode {
    const idx = FILTER_CYCLE.indexOf(this.filterMode);
    this.filterMode = FILTER_CYCLE[(idx + 1) % FILTER_CYCLE.length] ?? "active";
    this.ensureValidFocus(true);
    this.emit();
    return this.filterMode;
  }

  private ensureValidFocus(preferFilteredFirst = false): void {
    const list = this.getFilteredThreads();
    if (preferFilteredFirst && list.length > 0) {
      if (!this.focusedThreadId || !list.some((t) => t.id === this.focusedThreadId)) {
        this.focusedThreadId = list[0]!.id;
      }
      return;
    }
    if (this.focusedThreadId && this.threads.has(this.focusedThreadId)) {
      return;
    }
    this.focusedThreadId = list[0]?.id ?? this.getFilteredThreads("all")[0]?.id ?? null;
  }

  // ---- Model & Provider Catalog ----

  getFullModelCatalog(): ModelCatalogEntry[] {
    const favKeys = new Set(this.favorites.map((f) => `${f.provider}::${f.model}`));
    const entries: ModelCatalogEntry[] = [];

    for (const provider of this.providers) {
      if (!provider.enabled || provider.status !== "ready") continue;
      if (!provider.models || provider.models.length === 0) continue;
      const brand = providerBrandInfo(provider);
      const supportedModes =
        provider.supportedRuntimeModes && provider.supportedRuntimeModes.length > 0
          ? provider.supportedRuntimeModes
          : [...RUNTIME_MODE_ORDER];
      const supportsPlanMode = provider.showInteractionModeToggle !== false;

      const pref = this.providerModelPreferences[provider.instanceId];
      const hidden = new Set(pref?.hiddenModels ?? []);
      const orderIndex = new Map((pref?.modelOrder ?? []).map((slug, idx) => [slug, idx]));

      // Preserve T3 Code's exact native order (honoring explicit providerModelPreferences.modelOrder)
      const visibleModels = provider.models
        .map((m, idx) => ({ m, idx }))
        .filter(({ m }) => !m.isLegacy && !hidden.has(m.slug))
        .sort((a, b) => {
          const ordA = orderIndex.get(a.m.slug);
          const ordB = orderIndex.get(b.m.slug);
          if (ordA !== undefined && ordB !== undefined) return ordA - ordB;
          if (ordA !== undefined) return -1;
          if (ordB !== undefined) return 1;
          return a.idx - b.idx;
        })
        .map(({ m }) => m);

      for (const m of visibleModels) {
        const isFav =
          favKeys.has(`${provider.instanceId}::${m.slug}`) ||
          favKeys.has(`${provider.driver}::${m.slug}`);
        entries.push({
          instanceId: provider.instanceId,
          driver: provider.driver,
          providerLabel: brand.label,
          accentColor: brand.color,
          slug: m.slug,
          name: m.name,
          shortName: shortModelLabel(m.slug, m.name, m.shortName),
          isLegacy: Boolean(m.isLegacy),
          isDefault: Boolean(m.isDefault),
          isFavorite: isFav,
          reasoningDescriptor: findReasoningDescriptor(m.capabilities?.optionDescriptors),
          supportedRuntimeModes: supportedModes,
          supportsPlanMode
        });
      }
    }
    return entries;
  }

  getFavoriteModelCatalog(): ModelCatalogEntry[] {
    if (this.favorites.length === 0) return [];
    const full = this.getFullModelCatalog();
    const byExact = new Map<string, ModelCatalogEntry>();
    for (const entry of full) {
      byExact.set(`${entry.instanceId}::${entry.slug}`, entry);
    }

    const ordered: ModelCatalogEntry[] = [];
    const seen = new Set<string>();
    for (const fav of this.favorites) {
      const exactKey = `${fav.provider}::${fav.model}`;
      const matched =
        byExact.get(exactKey) ??
        full.find((entry) => entry.driver === fav.provider && entry.slug === fav.model);
      if (!matched) continue;
      const dedupeKey = `${matched.instanceId}::${matched.slug}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      ordered.push({ ...matched, isFavorite: true });
    }
    return ordered;
  }

  getEffectiveModelScope(): ModelCatalogScope {
    if (this.modelScope === "favorites" && this.getFavoriteModelCatalog().length > 0) {
      return "favorites";
    }
    return "all";
  }

  toggleModelScope(): ModelCatalogScope {
    const hasFavs = this.getFavoriteModelCatalog().length > 0;
    if (!hasFavs) {
      this.modelScope = "all";
    } else {
      this.modelScope = this.modelScope === "favorites" ? "all" : "favorites";
    }
    this.clearPendingModel();
    this.emit();
    return this.getEffectiveModelScope();
  }

  getModelCatalog(scope: ModelCatalogScope = this.modelScope): ModelCatalogEntry[] {
    if (scope === "favorites") {
      const favs = this.getFavoriteModelCatalog();
      if (favs.length > 0) return favs;
    }
    return this.getFullModelCatalog();
  }

  /** Looks up the thread's actual model in the full catalog (even when picker is in favorites mode). */
  getThreadModelEntry(thread: ThreadShell | null): ModelCatalogEntry | null {
    if (!thread) return null;
    const full = this.getFullModelCatalog();
    const inst = thread.modelSelection?.instanceId || thread.providerInstanceId;
    const slug = thread.modelSelection?.model;
    return (
      full.find((c) => c.instanceId === inst && c.slug === slug) ??
      full.find((c) => c.slug === slug) ??
      null
    );
  }

  getActiveModelEntry(thread: ThreadShell | null): {
    catalog: ModelCatalogEntry[];
    activeIndex: number;
    entry: ModelCatalogEntry | null;
    scope: ModelCatalogScope;
    hasFavorites: boolean;
  } {
    const hasFavorites = this.getFavoriteModelCatalog().length > 0;
    const scope = this.getEffectiveModelScope();
    const catalog = this.getModelCatalog(scope);
    const threadEntry = this.getThreadModelEntry(thread);

    if (!thread || catalog.length === 0) {
      return { catalog, activeIndex: -1, entry: threadEntry, scope, hasFavorites };
    }
    const inst = thread.modelSelection?.instanceId || thread.providerInstanceId;
    const slug = thread.modelSelection?.model;
    let idx = catalog.findIndex((c) => c.instanceId === inst && c.slug === slug);
    if (idx < 0) {
      idx = catalog.findIndex((c) => c.slug === slug);
    }
    return {
      catalog,
      activeIndex: idx,
      entry: idx >= 0 ? (catalog[idx] ?? null) : threadEntry,
      scope,
      hasFavorites
    };
  }

  scrubModel(ticks: number): ModelCatalogEntry | null {
    const thread = this.getFocusedThread();
    const { catalog, activeIndex } = this.getActiveModelEntry(thread);
    if (catalog.length === 0) return null;

    let nextIdx: number;
    if (this.pendingModelIndex !== null) {
      nextIdx = (this.pendingModelIndex + ticks + catalog.length * 10) % catalog.length;
    } else if (activeIndex >= 0) {
      nextIdx = (activeIndex + ticks + catalog.length * 10) % catalog.length;
    } else {
      // Current thread model is not in favorites yet: first tick enters start/end of favorites cleanly
      nextIdx = ticks >= 0 ? 0 : catalog.length - 1;
    }
    this.pendingModelIndex = nextIdx;

    if (this.pendingModelTimer) clearTimeout(this.pendingModelTimer);
    this.pendingModelTimer = setTimeout(() => {
      this.pendingModelIndex = null;
      this.pendingModelTimer = null;
      this.emit();
    }, 6000);

    this.emit();
    return catalog[nextIdx] ?? null;
  }

  clearPendingModel(): void {
    if (this.pendingModelTimer) {
      clearTimeout(this.pendingModelTimer);
      this.pendingModelTimer = null;
    }
    this.pendingModelIndex = null;
  }

  // ---- Usage Cards ----

  getUsageCards(): UsageCard[] {
    const cards: UsageCard[] = [];
    const seen = new Set<string>();

    const makeCard = (
      id: string,
      label: string,
      driver: string,
      accentColor: string,
      windows: UsageWindow[],
      checkedAt?: string,
      unavailable?: { reason: string; message?: string }
    ): UsageCard | null => {
      if (windows.length === 0) {
        if (!unavailable || unavailable.reason === "unsupported") return null;
        return {
          id,
          label,
          driver,
          accentColor,
          checkedAt,
          unavailable
        };
      }
      const pickHighest = (kind: UsageWindow["kind"]): UsageWindow | undefined => {
        const matches = windows.filter((w) => w.kind === kind);
        if (matches.length === 0) return undefined;
        return matches.reduce((best, cur) => (cur.usedPercent > best.usedPercent ? cur : best));
      };
      const sessionWindow = pickHighest("session");
      const weeklyWindow = pickHighest("weekly");
      const extraWindow =
        pickHighest("monthly") ??
        windows.find((w) => w !== sessionWindow && w !== weeklyWindow);
      return {
        id,
        label,
        driver,
        accentColor,
        sessionWindow,
        weeklyWindow,
        extraWindow,
        checkedAt
      };
    };

    for (const provider of this.providers) {
      const windows = provider.usageLimits?.windows ?? [];
      const unavailable = provider.usageLimits?.unavailable;
      if (windows.length === 0 && (!unavailable || unavailable.reason === "unsupported")) continue;
      const brand = providerBrandInfo(provider);
      const card = makeCard(
        provider.instanceId,
        brand.label,
        provider.driver,
        brand.color,
        windows,
        provider.usageLimits?.checkedAt,
        unavailable
      );
      if (card) {
        seen.add(card.id);
        cards.push(card);
      }
    }

    for (const src of this.usageLimitSources) {
      for (const acct of src.accounts) {
        const key = `${src.id}:${acct.id}`;
        if (seen.has(key)) continue;
        const windows = acct.usageLimits?.windows ?? [];
        const unavailable = acct.usageLimits?.unavailable;
        if (windows.length === 0 && (!unavailable || unavailable.reason === "unsupported")) continue;
        const brand = providerBrandInfo({
          instanceId: acct.id,
          driver: acct.driver,
          displayName: acct.plan ? `${prettyDriverName(acct.driver, acct.id)} (${acct.plan})` : undefined
        });
        const card = makeCard(
          key,
          brand.label,
          acct.driver,
          brand.color,
          windows,
          acct.usageLimits?.checkedAt,
          unavailable
        );
        if (card) {
          seen.add(key);
          cards.push(card);
        }
      }
    }

    return cards;
  }

  stepUsageCard(ticks: number): UsageCard | null {
    const cards = this.getUsageCards();
    if (cards.length === 0) return null;
    this.usageIndex = (this.usageIndex + ticks + cards.length * 10) % cards.length;
    this.emit();
    return cards[this.usageIndex] ?? null;
  }

  getCurrentUsageCard(): { card: UsageCard | null; index: number; total: number } {
    const cards = this.getUsageCards();
    if (cards.length === 0) return { card: null, index: -1, total: 0 };
    const idx = ((this.usageIndex % cards.length) + cards.length) % cards.length;
    return { card: cards[idx] ?? null, index: idx, total: cards.length };
  }

  // ---- On-demand Thread Projections, Prompt Suggestions & Approval/Question Queues ----

  setPromptSuggestion(suggestion: PromptSuggestion | null): void {
    const prev = this.promptSuggestion;
    if (
      prev?.threadId === suggestion?.threadId &&
      prev?.runId === suggestion?.runId &&
      prev?.text === suggestion?.text
    ) {
      return;
    }
    this.promptSuggestion = suggestion;
    this.emit();
  }

  applyThreadProjection(threadId: string, payload: ThreadProjectionPayload): void {
    const thread = this.threads.get(threadId);
    const requestKey = thread?.pendingRuntimeRequest?.id ?? "none";
    this.projections.set(threadId, { requestKey, payload });
    this.reconcileOverlayAfterUpdate();
    this.emit();
  }

  /** Returns thread IDs that have a pending runtime request whose projection has not yet been fetched. */
  getThreadsNeedingProjectionFetch(): string[] {
    const ids: string[] = [];
    for (const thread of this.getAllThreads()) {
      const req = thread.pendingRuntimeRequest;
      if (!req) continue;
      const cached = this.projections.get(thread.id);
      if (!cached || cached.requestKey !== req.id) {
        ids.push(thread.id);
      }
    }
    return ids;
  }

  getThreadById(threadId: string): ThreadShell | null {
    return this.threads.get(threadId) ?? null;
  }

  private resolveParentTitle(thread: ThreadShell): string | undefined {
    const parentId = thread.lineage?.parentThreadId;
    if (!parentId) return undefined;
    return this.threads.get(parentId)?.title;
  }

  /**
   * Flattened queue of every pending approval across all threads & subagents
   * (including multiple simultaneous pending requests within one parent thread).
   */
  getPendingApprovalQueue(): PendingApprovalItem[] {
    const items: PendingApprovalItem[] = [];
    const seen = new Set<string>();

    for (const thread of this.getAllThreads()) {
      const cached = this.projections.get(thread.id)?.payload;
      const projectName = this.getProjectName(thread.projectId);
      const parentTitle = this.resolveParentTitle(thread);
      const isAppSubagent = Boolean(thread.lineage?.parentThreadId);

      if (cached?.runtimeRequests && cached.runtimeRequests.length > 0) {
        const subagentByNode = new Map(
          (cached.subagents ?? []).map((s) => [s.id, s])
        );
        for (const req of cached.runtimeRequests) {
          if (req.status !== "pending") continue;
          if (!APPROVAL_KINDS.has(req.kind)) continue;
          const key = `${thread.id}::${req.id}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const turnItem = [...(cached.turnItems ?? [])]
            .reverse()
            .find((it) => it.type === "approval_request" && it.requestId === req.id);
          const nativeSub = subagentByNode.get(req.nodeId);
          const subagentTitle =
            nativeSub?.title || (isAppSubagent ? thread.title : undefined);
          const danger = classifyApprovalDanger(
            turnItem?.prompt,
            turnItem?.fullAccessOverride
          );

          items.push({
            threadId: thread.id,
            requestId: req.id,
            nodeId: req.nodeId,
            requestKind: req.kind,
            createdAt: req.createdAt,
            threadTitle: thread.title || "Untitled",
            projectName,
            subagentTitle,
            parentThreadTitle: nativeSub
              ? thread.title
              : parentTitle,
            prompt: turnItem?.prompt,
            reason: turnItem?.reason,
            appName: turnItem?.appName,
            fullAccessOverride: turnItem?.fullAccessOverride,
            options: turnItem?.options,
            responseCapability:
              req.responseCapability?.type === "live" ? "live" : "not_resumable",
            dangerous: danger.dangerous,
            dangerReason: danger.reason,
            detailsLoaded: true
          });
        }
        continue;
      }

      // Fallback before projection loads: use shell summary so UI responds instantaneously
      if (isApprovalRequest(thread) && thread.pendingRuntimeRequest) {
        const req = thread.pendingRuntimeRequest;
        const key = `${thread.id}::${req.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          threadId: thread.id,
          requestId: req.id,
          requestKind: req.kind,
          createdAt: req.createdAt,
          threadTitle: thread.title || "Untitled",
          projectName,
          subagentTitle: isAppSubagent ? thread.title : undefined,
          parentThreadTitle: parentTitle,
          responseCapability: "live",
          dangerous: false,
          detailsLoaded: false
        });
      }
    }

    // Oldest waiting request first (FIFO triage), tie-break by id
    return items.sort((a, b) => {
      const ta = Date.parse(a.createdAt) || 0;
      const tb = Date.parse(b.createdAt) || 0;
      if (ta !== tb) return ta - tb;
      return a.requestId.localeCompare(b.requestId);
    });
  }

  /**
   * Flattened queue of every pending multiple-choice user_input question across all threads.
   */
  getPendingQuestionQueue(): PendingQuestionItem[] {
    const items: PendingQuestionItem[] = [];
    const seen = new Set<string>();

    for (const thread of this.getAllThreads()) {
      const cached = this.projections.get(thread.id)?.payload;
      const projectName = this.getProjectName(thread.projectId);
      const parentTitle = this.resolveParentTitle(thread);
      const isAppSubagent = Boolean(thread.lineage?.parentThreadId);

      if (cached?.runtimeRequests && cached.runtimeRequests.length > 0) {
        const subagentByNode = new Map(
          (cached.subagents ?? []).map((s) => [s.id, s])
        );
        for (const req of cached.runtimeRequests) {
          if (req.status !== "pending") continue;
          if (req.kind !== "user_input") continue;
          const key = `${thread.id}::${req.id}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const turnItem = [...(cached.turnItems ?? [])]
            .reverse()
            .find((it) => it.type === "user_input_request" && it.requestId === req.id);
          const nativeSub = subagentByNode.get(req.nodeId);

          items.push({
            threadId: thread.id,
            requestId: req.id,
            createdAt: req.createdAt,
            threadTitle: thread.title || "Untitled",
            projectName,
            subagentTitle: nativeSub?.title || (isAppSubagent ? thread.title : undefined),
            parentThreadTitle: nativeSub ? thread.title : parentTitle,
            questions: turnItem?.questions ?? [],
            dismissible:
              turnItem?.responseMode === "message" || req.responseCapability?.type === "message",
            detailsLoaded: Boolean(turnItem?.questions)
          });
        }
        continue;
      }

      if (isQuestionRequest(thread) && thread.pendingRuntimeRequest) {
        const req = thread.pendingRuntimeRequest;
        const key = `${thread.id}::${req.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          threadId: thread.id,
          requestId: req.id,
          createdAt: req.createdAt,
          threadTitle: thread.title || "Untitled",
          projectName,
          subagentTitle: isAppSubagent ? thread.title : undefined,
          parentThreadTitle: parentTitle,
          questions: [],
          dismissible: false,
          detailsLoaded: false
        });
      }
    }

    return items.sort((a, b) => {
      const ta = Date.parse(a.createdAt) || 0;
      const tb = Date.parse(b.createdAt) || 0;
      if (ta !== tb) return ta - tb;
      return a.requestId.localeCompare(b.requestId);
    });
  }

  // ---- Panoramic Overlay / Submenu State Machine (Per-Device) ----

  getActiveOverlayApproval(deviceId = "default"): {
    item: PendingApprovalItem | null;
    index: number;
    total: number;
  } {
    const queue = this.getPendingApprovalQueue();
    if (queue.length === 0) return { item: null, index: -1, total: 0 };
    const ov = this.getOverlay(deviceId);
    if (ov.kind === "approval" && ov.requestId) {
      const targetId = ov.requestId;
      const idx = queue.findIndex((q) => q.requestId === targetId);
      if (idx >= 0) return { item: queue[idx]!, index: idx, total: queue.length };
    }
    return { item: queue[0]!, index: 0, total: queue.length };
  }

  getActiveOverlayQuestion(deviceId = "default"): {
    item: PendingQuestionItem | null;
    index: number;
    total: number;
  } {
    const queue = this.getPendingQuestionQueue();
    if (queue.length === 0) return { item: null, index: -1, total: 0 };
    const ov = this.getOverlay(deviceId);
    if (ov.kind === "question" && ov.requestId) {
      const targetId = ov.requestId;
      const idx = queue.findIndex((q) => q.requestId === targetId);
      if (idx >= 0) return { item: queue[idx]!, index: idx, total: queue.length };
    }
    return { item: queue[0]!, index: 0, total: queue.length };
  }

  openApprovalOverlay(preferredThreadId?: string, originSlot = 1, deviceId = "default"): boolean {
    const queue = this.getPendingApprovalQueue();
    if (queue.length === 0) return false;
    const focusedId = preferredThreadId ?? this.getFocusedThread()?.id;
    const match = focusedId ? queue.find((q) => q.threadId === focusedId) : undefined;
    const target = match ?? queue[0]!;
    this.setOverlayFor(deviceId, {
      kind: "approval",
      requestId: target.requestId,
      scrollLine: 0,
      originSlot
    });
    this.focusedThreadId = target.threadId;
    this.emit();
    return true;
  }

  openQuestionOverlay(preferredThreadId?: string, originSlot = 1, deviceId = "default"): boolean {
    const queue = this.getPendingQuestionQueue();
    if (queue.length === 0) return false;
    const focusedId = preferredThreadId ?? this.getFocusedThread()?.id;
    const match = focusedId ? queue.find((q) => q.threadId === focusedId) : undefined;
    const target = match ?? queue[0]!;
    this.setOverlayFor(deviceId, {
      kind: "question",
      requestId: target.requestId,
      questionIndex: 0,
      optionPage: 0,
      selectedByQuestionId: {},
      originSlot
    });
    this.focusedThreadId = target.threadId;
    this.emit();
    return true;
  }

  openPromptsOverlay(originSlot = 5, deviceId = "default"): void {
    this.setOverlayFor(deviceId, { kind: "prompts", originSlot, selectedIndex: 0 });
    this.emit();
  }

  openSnoozeOverlay(originSlot = 7, deviceId = "default"): void {
    this.setOverlayFor(deviceId, { kind: "snooze", originSlot, customMinutes: null });
    this.emit();
  }

  openModelPickerOverlay(originSlot = 1, deviceId = "default"): void {
    this.setOverlayFor(deviceId, {
      kind: "model-picker",
      originSlot,
      page: 0,
      scope: this.getEffectiveModelScope()
    });
    this.emit();
  }

  toggleModelPickerScope(deviceId = "default"): void {
    const ov = this.getOverlay(deviceId);
    if (ov.kind !== "model-picker") return;
    const nextScope: ModelCatalogScope = ov.scope === "favorites" ? "all" : "favorites";
    this.setOverlayFor(deviceId, { ...ov, scope: nextScope, page: 0 });
    this.emit();
  }

  getModelPickerCatalog(deviceId = "default"): ModelCatalogEntry[] {
    const ov = this.getOverlay(deviceId);
    if (ov.kind !== "model-picker") return this.getModelCatalog();
    if (ov.scope === "favorites") {
      const favs = this.getFavoriteModelCatalog();
      return favs.length > 0 ? favs : this.getFullModelCatalog();
    }
    return this.getFullModelCatalog();
  }

  openModeEffortOverlay(originSlot = 2, deviceId = "default"): void {
    this.setOverlayFor(deviceId, { kind: "mode-effort", originSlot });
    this.emit();
  }

  openNewChatBuilderOverlay(
    originSlot = 4,
    keyMode: "project" | "environment" | "model" = "project",
    interactionMode: ProviderInteractionMode = "default",
    deviceId = "default"
  ): void {
    const projects = this.getLaunchProjects();
    const focused = this.getFocusedThread();
    const projIdx = focused
      ? Math.max(0, projects.findIndex((p) => p.id === focused.projectId))
      : 0;
    const scope = this.getEffectiveModelScope();
    const catalog =
      scope === "favorites"
        ? this.getFavoriteModelCatalog().length > 0
          ? this.getFavoriteModelCatalog()
          : this.getFullModelCatalog()
        : this.getFullModelCatalog();
    const defaultSel = projects[projIdx]
      ? this.getDefaultModelSelectionForProject(projects[projIdx]!)
      : focused?.modelSelection ?? null;
    const modelIdx = defaultSel?.model
      ? Math.max(0, catalog.findIndex((m) => m.slug === defaultSel.model))
      : 0;
    const wsMode = projects[projIdx]?.defaultThreadEnvMode === "worktree" ? "worktree" : "local";

    this.setOverlayFor(deviceId, {
      kind: "new-chat-builder",
      originSlot,
      projectIndex: projIdx,
      modelIndex: modelIdx,
      modelScope: scope,
      workspaceMode: wsMode,
      interactionMode,
      keyMode
    });
    this.emit();
  }

  getNewChatBuilderCatalog(deviceId = "default"): ModelCatalogEntry[] {
    const ov = this.getOverlay(deviceId);
    if (ov.kind !== "new-chat-builder") return this.getModelCatalog();
    if (ov.modelScope === "favorites") {
      const favs = this.getFavoriteModelCatalog();
      return favs.length > 0 ? favs : this.getFullModelCatalog();
    }
    return this.getFullModelCatalog();
  }

  stepNewChatBuilderDial(col: number, ticks: number, deviceId = "default"): void {
    const ov = this.getOverlay(deviceId);
    if (ov.kind !== "new-chat-builder") return;
    if (col === 0) {
      const projects = this.getLaunchProjects();
      if (projects.length === 0) return;
      const next = (((ov.projectIndex + ticks) % projects.length) + projects.length) % projects.length;
      const proj = projects[next]!;
      const wsMode = proj.defaultThreadEnvMode === "worktree" ? "worktree" : ov.workspaceMode;
      this.setOverlayFor(deviceId, { ...ov, projectIndex: next, workspaceMode: wsMode });
      this.emit();
      return;
    }
    if (col === 1) {
      const catalog = this.getNewChatBuilderCatalog(deviceId);
      if (catalog.length === 0) return;
      const next = (((ov.modelIndex + ticks) % catalog.length) + catalog.length) % catalog.length;
      this.setOverlayFor(deviceId, { ...ov, modelIndex: next });
      this.emit();
      return;
    }
    if (col === 2) {
      const modes: Array<"local" | "worktree" | "scratch"> = ["local", "worktree", "scratch"];
      const cur = modes.indexOf(ov.workspaceMode);
      const next = modes[(((cur + ticks) % modes.length) + modes.length) % modes.length] ?? "local";
      this.setOverlayFor(deviceId, { ...ov, workspaceMode: next });
      this.emit();
      return;
    }
    if (col === 3) {
      const nextMode: ProviderInteractionMode = ov.interactionMode === "plan" ? "default" : "plan";
      this.setOverlayFor(deviceId, { ...ov, interactionMode: nextMode });
      this.emit();
    }
  }

  toggleNewChatBuilderDial(col: number, deviceId = "default"): void {
    const ov = this.getOverlay(deviceId);
    if (ov.kind !== "new-chat-builder") return;
    if (col === 1) {
      const nextScope: ModelCatalogScope = ov.modelScope === "favorites" ? "all" : "favorites";
      this.setOverlayFor(deviceId, { ...ov, modelScope: nextScope, modelIndex: 0 });
      this.emit();
      return;
    }
    if (col === 2) {
      const nextMode: ProviderInteractionMode = ov.interactionMode === "plan" ? "default" : "plan";
      this.setOverlayFor(deviceId, { ...ov, interactionMode: nextMode });
      this.emit();
    }
  }

  setNewChatBuilderProject(projectIndex: number, deviceId = "default"): void {
    const ov = this.getOverlay(deviceId);
    if (ov.kind !== "new-chat-builder") return;
    this.setOverlayFor(deviceId, { ...ov, projectIndex });
    this.emit();
  }

  setNewChatBuilderModel(modelIndex: number, deviceId = "default"): void {
    const ov = this.getOverlay(deviceId);
    if (ov.kind !== "new-chat-builder") return;
    this.setOverlayFor(deviceId, { ...ov, modelIndex });
    this.emit();
  }

  setNewChatBuilderWorkspace(
    workspaceMode: "local" | "worktree" | "scratch",
    deviceId = "default"
  ): void {
    const ov = this.getOverlay(deviceId);
    if (ov.kind !== "new-chat-builder") return;
    this.setOverlayFor(deviceId, { ...ov, workspaceMode });
    this.emit();
  }

  stepSnoozeCustom(ticks: number, deviceId = "default"): void {
    const ov = this.getOverlay(deviceId);
    if (ov.kind !== "snooze") return;
    const steps = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440];
    const cur = ov.customMinutes;
    let idx = cur === null ? (ticks >= 0 ? 0 : steps.length - 1) : steps.indexOf(cur);
    if (idx < 0) idx = 0;
    else if (cur !== null) idx = (((idx + ticks) % steps.length) + steps.length) % steps.length;
    this.setOverlayFor(deviceId, { ...ov, customMinutes: steps[idx] ?? 60 });
    this.emit();
  }

  stepPromptSelection(ticks: number, deviceId = "default"): void {
    const ov = this.getOverlay(deviceId);
    if (ov.kind !== "prompts") return;
    const total = 2 + QUICK_PROMPT_PRESETS.length;
    const next = (((ov.selectedIndex + ticks) % total) + total) % total;
    this.setOverlayFor(deviceId, { ...ov, selectedIndex: next });
    this.emit();
  }

  openFleetOverlay(originSlot = 0, deviceId = "default"): void {
    this.setOverlayFor(deviceId, { kind: "fleet", page: 0, originSlot });
    this.emit();
  }

  openThreadToolsOverlay(originSlot = 3, deviceId = "default"): void {
    this.setOverlayFor(deviceId, { kind: "thread-tools", originSlot });
    this.emit();
  }

  openNewChatProjectOverlay(
    originSlot = 4,
    interactionMode: ProviderInteractionMode = "default",
    deviceId = "default"
  ): void {
    this.setOverlayFor(deviceId, { kind: "new-chat-project", page: 0, originSlot, interactionMode });
    this.emit();
  }

  openNewChatEnvOverlay(
    originSlot = 4,
    interactionMode: ProviderInteractionMode = "default",
    deviceId = "default"
  ): void {
    this.setOverlayFor(deviceId, { kind: "new-chat-env", page: 0, originSlot, interactionMode });
    this.emit();
  }

  openNewChatModelOverlay(
    projectId: string,
    opts: {
      originSlot?: number;
      parentKind?: "none" | "new-chat-project" | "new-chat-env";
      parentOriginSlot?: number;
      workspaceMode?: "local" | "worktree" | "scratch";
      interactionMode?: ProviderInteractionMode;
      deviceId?: string;
    } = {}
  ): void {
    const deviceId = opts.deviceId ?? "default";
    this.setOverlayFor(deviceId, {
      kind: "new-chat-model",
      projectId,
      workspaceMode: opts.workspaceMode ?? "local",
      page: 0,
      scope: this.getEffectiveModelScope(),
      interactionMode: opts.interactionMode ?? "default",
      originSlot: opts.originSlot ?? 4,
      parentKind: opts.parentKind ?? "new-chat-project",
      parentOriginSlot: opts.parentOriginSlot ?? 4
    });
    this.emit();
  }

  toggleNewChatModelScope(deviceId = "default"): void {
    const ov = this.getOverlay(deviceId);
    if (ov.kind !== "new-chat-model") return;
    const nextScope: ModelCatalogScope = ov.scope === "favorites" ? "all" : "favorites";
    this.setOverlayFor(deviceId, { ...ov, scope: nextScope, page: 0 });
    this.emit();
  }

  toggleNewChatInteractionMode(deviceId = "default"): void {
    const ov = this.getOverlay(deviceId);
    if (ov.kind !== "new-chat-model") return;
    const nextMode = ov.interactionMode === "plan" ? "default" : "plan";
    this.setOverlayFor(deviceId, { ...ov, interactionMode: nextMode });
    this.emit();
  }

  getNewChatModelCatalog(deviceId = "default"): ModelCatalogEntry[] {
    const ov = this.getOverlay(deviceId);
    if (ov.kind !== "new-chat-model") return this.getModelCatalog();
    if (ov.scope === "favorites") {
      const favs = this.getFavoriteModelCatalog();
      return favs.length > 0 ? favs : this.getFullModelCatalog();
    }
    return this.getFullModelCatalog();
  }

  closeOverlay(deviceId = "default"): void {
    if (this.getOverlay(deviceId).kind === "none") return;
    this.setOverlayFor(deviceId, { kind: "none" });
    this.emit();
  }

  stepOverlayQueue(ticks: number, deviceId = "default", pageSize = 7): void {
    const ov = this.getOverlay(deviceId);
    const safePage = Math.max(1, pageSize);

    if (ov.kind === "approval") {
      const queue = this.getPendingApprovalQueue();
      if (queue.length === 0) {
        this.closeOverlay(deviceId);
        return;
      }
      const { index } = this.getActiveOverlayApproval(deviceId);
      const base = index >= 0 ? index : 0;
      const nextIdx = (((base + ticks) % queue.length) + queue.length) % queue.length;
      const next = queue[nextIdx]!;
      this.setOverlayFor(deviceId, { ...ov, requestId: next.requestId, scrollLine: 0 });
      this.focusedThreadId = next.threadId;
      this.emit();
      return;
    }

    if (ov.kind === "question") {
      const queue = this.getPendingQuestionQueue();
      if (queue.length === 0) {
        this.closeOverlay(deviceId);
        return;
      }
      const { index } = this.getActiveOverlayQuestion(deviceId);
      const base = index >= 0 ? index : 0;
      const nextIdx = (((base + ticks) % queue.length) + queue.length) % queue.length;
      const next = queue[nextIdx]!;
      this.setOverlayFor(deviceId, {
        ...ov,
        requestId: next.requestId,
        questionIndex: 0,
        optionPage: 0,
        selectedByQuestionId: {}
      });
      this.focusedThreadId = next.threadId;
      this.emit();
      return;
    }

    if (ov.kind === "fleet") {
      const list = this.getFilteredThreads("active");
      const totalPages = Math.max(1, Math.ceil(list.length / safePage));
      const nextPage = (((ov.page + ticks) % totalPages) + totalPages) % totalPages;
      this.setOverlayFor(deviceId, { ...ov, page: nextPage });
      this.emit();
      return;
    }

    if (ov.kind === "model-picker") {
      const list = this.getModelPickerCatalog(deviceId);
      const itemsPerPage = Math.max(1, safePage - 1); // leaves 1 slot for FAVS/ALL toggle
      const totalPages = Math.max(1, Math.ceil(list.length / itemsPerPage));
      const nextPage = (((ov.page + ticks) % totalPages) + totalPages) % totalPages;
      this.setOverlayFor(deviceId, { ...ov, page: nextPage });
      this.emit();
      return;
    }

    if (ov.kind === "new-chat-project") {
      const list = this.getLaunchProjects();
      const totalPages = Math.max(1, Math.ceil(list.length / safePage));
      const nextPage = (((ov.page + ticks) % totalPages) + totalPages) % totalPages;
      this.setOverlayFor(deviceId, { ...ov, page: nextPage });
      this.emit();
      return;
    }

    if (ov.kind === "new-chat-env") {
      const totalItems = 4 + this.peerLinks.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / safePage));
      const nextPage = (((ov.page + ticks) % totalPages) + totalPages) % totalPages;
      this.setOverlayFor(deviceId, { ...ov, page: nextPage });
      this.emit();
      return;
    }

    if (ov.kind === "new-chat-model") {
      const list = this.getNewChatModelCatalog(deviceId);
      const totalPages = Math.max(1, Math.ceil(list.length / safePage));
      const nextPage = (((ov.page + ticks) % totalPages) + totalPages) % totalPages;
      this.setOverlayFor(deviceId, { ...ov, page: nextPage });
      this.emit();
    }
  }

  scrollOverlay(ticks: number, deviceId = "default", optionsPerPage = 4): void {
    const ov = this.getOverlay(deviceId);
    if (ov.kind === "approval") {
      const nextScroll = Math.max(0, ov.scrollLine + ticks);
      this.setOverlayFor(deviceId, { ...ov, scrollLine: nextScroll });
      this.emit();
      return;
    }

    if (ov.kind === "question") {
      const { item } = this.getActiveOverlayQuestion(deviceId);
      const q = item?.questions[ov.questionIndex];
      const perPage = Math.max(1, optionsPerPage);
      const totalPages = Math.max(1, Math.ceil((q?.options.length ?? 0) / perPage));
      const nextPage = (((ov.optionPage + ticks) % totalPages) + totalPages) % totalPages;
      this.setOverlayFor(deviceId, { ...ov, optionPage: nextPage });
      this.emit();
    }
  }

  /**
   * Selects an option on the active question overlay.
   * For single-select: advances to the next question or returns complete `answers` ready to submit.
   * For multi-select: toggles the option in-place (submit button finalizes).
   */
  selectQuestionOption(
    optionIndexInPage: number,
    deviceId = "default",
    optionsPerPage = 4
  ): {
    readyToSubmit: boolean;
    threadId?: string;
    requestId?: string;
    answers?: Record<string, string | string[]>;
  } {
    const ov = this.getOverlay(deviceId);
    if (ov.kind !== "question") return { readyToSubmit: false };
    const { item } = this.getActiveOverlayQuestion(deviceId);
    if (!item) return { readyToSubmit: false };
    const question = item.questions[ov.questionIndex];
    if (!question) return { readyToSubmit: false };

    const absIdx = ov.optionPage * Math.max(1, optionsPerPage) + optionIndexInPage;
    const opt = question.options[absIdx];
    if (!opt) return { readyToSubmit: false };

    const prevSelected = ov.selectedByQuestionId[question.id] ?? [];
    if (question.multiSelect) {
      const exists = prevSelected.includes(opt.label);
      const nextSelected = exists
        ? prevSelected.filter((l) => l !== opt.label)
        : [...prevSelected, opt.label];
      this.setOverlayFor(deviceId, {
        ...ov,
        selectedByQuestionId: {
          ...ov.selectedByQuestionId,
          [question.id]: nextSelected
        }
      });
      this.emit();
      return { readyToSubmit: false };
    }

    // Single-select: record answer & advance or submit
    const updatedMap: Record<string, string[]> = {
      ...ov.selectedByQuestionId,
      [question.id]: [opt.label]
    };

    if (ov.questionIndex + 1 < item.questions.length) {
      this.setOverlayFor(deviceId, {
        ...ov,
        questionIndex: ov.questionIndex + 1,
        optionPage: 0,
        selectedByQuestionId: updatedMap
      });
      this.emit();
      return { readyToSubmit: false };
    }

    const answers = this.buildAnswersPayload(item, updatedMap);
    return {
      readyToSubmit: true,
      threadId: item.threadId,
      requestId: item.requestId,
      answers
    };
  }

  submitCurrentMultiSelectQuestion(deviceId = "default"): {
    readyToSubmit: boolean;
    threadId?: string;
    requestId?: string;
    answers?: Record<string, string | string[]>;
  } {
    const ov = this.getOverlay(deviceId);
    if (ov.kind !== "question") return { readyToSubmit: false };
    const { item } = this.getActiveOverlayQuestion(deviceId);
    if (!item) return { readyToSubmit: false };
    const question = item.questions[ov.questionIndex];
    if (!question) return { readyToSubmit: false };

    if (ov.questionIndex + 1 < item.questions.length) {
      this.setOverlayFor(deviceId, {
        ...ov,
        questionIndex: ov.questionIndex + 1,
        optionPage: 0
      });
      this.emit();
      return { readyToSubmit: false };
    }

    return {
      readyToSubmit: true,
      threadId: item.threadId,
      requestId: item.requestId,
      answers: this.buildAnswersPayload(item, ov.selectedByQuestionId)
    };
  }

  private buildAnswersPayload(
    item: PendingQuestionItem,
    selectedMap: Record<string, string[]>
  ): Record<string, string | string[]> {
    const answers: Record<string, string | string[]> = {};
    for (const q of item.questions) {
      const picks = selectedMap[q.id] ?? [];
      if (q.multiSelect) {
        answers[q.id] = picks;
      } else if (picks[0]) {
        answers[q.id] = picks[0];
      }
    }
    return answers;
  }

  /**
   * Optimistically removes a just-answered request from local cache and advances
   * to the next waiting approval (or question), closing the overlay if empty.
   */
  markRequestResolvedLocally(threadId: string, requestId: string): void {
    const thread = this.threads.get(threadId);
    if (thread && thread.pendingRuntimeRequest?.id === requestId) {
      this.threads.set(threadId, { ...thread, pendingRuntimeRequest: null });
    }
    const cached = this.projections.get(threadId);
    if (cached?.payload.runtimeRequests) {
      const updatedReqs = cached.payload.runtimeRequests.map((r) =>
        r.id === requestId ? { ...r, status: "resolved" as const } : r
      );
      this.projections.set(threadId, {
        ...cached,
        payload: { ...cached.payload, runtimeRequests: updatedReqs }
      });
    }
    this.reconcileOverlayAfterUpdate();
    this.emit();
  }

  private reconcileOverlayAfterUpdate(): void {
    for (const [deviceId, ov] of Array.from(this.overlays.entries())) {
      if (ov.kind === "approval") {
        const targetId = ov.requestId;
        const originSlot = ov.originSlot;
        const approvals = this.getPendingApprovalQueue();
        if (approvals.length > 0) {
          const stillThere = approvals.find((a) => a.requestId === targetId);
          if (!stillThere) {
            const next = approvals[0]!;
            this.setOverlayFor(deviceId, {
              kind: "approval",
              requestId: next.requestId,
              scrollLine: 0,
              originSlot
            });
            this.focusedThreadId = next.threadId;
          }
          continue;
        }
        const questions = this.getPendingQuestionQueue();
        if (questions.length > 0) {
          const nextQ = questions[0]!;
          this.setOverlayFor(deviceId, {
            kind: "question",
            requestId: nextQ.requestId,
            questionIndex: 0,
            optionPage: 0,
            selectedByQuestionId: {},
            originSlot
          });
          this.focusedThreadId = nextQ.threadId;
          continue;
        }
        this.setOverlayFor(deviceId, { kind: "none" });
        continue;
      }

      if (ov.kind === "question") {
        const targetId = ov.requestId;
        const originSlot = ov.originSlot;
        const questions = this.getPendingQuestionQueue();
        if (questions.length > 0) {
          const stillThere = questions.find((q) => q.requestId === targetId);
          if (!stillThere) {
            const nextQ = questions[0]!;
            this.setOverlayFor(deviceId, {
              kind: "question",
              requestId: nextQ.requestId,
              questionIndex: 0,
              optionPage: 0,
              selectedByQuestionId: {},
              originSlot
            });
            this.focusedThreadId = nextQ.threadId;
          }
          continue;
        }
        const approvals = this.getPendingApprovalQueue();
        if (approvals.length > 0) {
          const next = approvals[0]!;
          this.setOverlayFor(deviceId, {
            kind: "approval",
            requestId: next.requestId,
            scrollLine: 0,
            originSlot
          });
          this.focusedThreadId = next.threadId;
          continue;
        }
        this.setOverlayFor(deviceId, { kind: "none" });
      }
    }
  }
}
