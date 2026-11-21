import type {
  FleetStats,
  ModelCatalogEntry,
  ModelCatalogScope,
  ModelFavorite,
  ModelSelection,
  ProjectShell,
  ProviderModelPreference,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  PullRequestLink,
  RuntimeMode,
  ServerConfigPayload,
  ServerProvider,
  ServerSettingsPayload,
  ThreadCategory,
  ThreadFilterMode,
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

export function threadVisitTimestamp(thread: ThreadShell): number {
  const openedAt = typeof thread.opens?.openedAt === "number" ? thread.opens.openedAt : 0;
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
  private providers: ServerProvider[] = [];
  private favorites: ModelFavorite[] = [];
  private providerModelPreferences: Record<string, ProviderModelPreference> = {};
  private usageLimitSources: UsageLimitSourceSnapshot[] = [];

  filterMode: ThreadFilterMode = "active";
  modelScope: ModelCatalogScope = "favorites";
  focusedThreadId: string | null = null;
  usageIndex = 0;

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
    for (const thread of threads) {
      if (!thread.deletedAt && !thread.archivedAt) {
        this.threads.set(thread.id, thread);
      }
    }

    // Snap initial focus to the thread currently open / most recently visited in T3 Code
    const mostRecent = this.findMostRecentlyVisitedThread();
    if (mostRecent) {
      this.focusedThreadId = mostRecent.id;
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
    } else {
      this.threads.set(thread.id, thread);

      // Follow the user's live focus whenever they open/visit a thread in T3 Code
      const prevVisit = prev ? threadVisitTimestamp(prev) : 0;
      const nextVisit = threadVisitTimestamp(thread);
      const currentFocused = this.focusedThreadId ? this.threads.get(this.focusedThreadId) : null;
      const currentVisit = currentFocused ? threadVisitTimestamp(currentFocused) : 0;
      if (nextVisit > prevVisit && nextVisit >= currentVisit && !thread.lineage?.parentThreadId) {
        if (this.focusedThreadId !== thread.id) {
          this.focusedThreadId = thread.id;
          this.clearPendingModel();
        }
      }
    }
    this.ensureValidFocus();
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
    this.ensureValidFocus();
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

  focusThread(threadId: string): void {
    this.focusedThreadId = threadId;
    this.clearPendingModel();
    this.emit();
  }

  stepFocus(ticks: number): ThreadShell | null {
    const list = this.getFilteredThreads();
    if (list.length === 0) return null;
    const { index } = this.getFocusedIndex();
    const nextIdx = Math.max(0, Math.min(list.length - 1, (index >= 0 ? index : 0) + ticks));
    const next = list[nextIdx] ?? null;
    if (next) {
      this.focusedThreadId = next.id;
      this.clearPendingModel();
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
      checkedAt?: string
    ): UsageCard | null => {
      if (windows.length === 0) return null;
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
      if (windows.length === 0) continue;
      const brand = providerBrandInfo(provider);
      const card = makeCard(
        provider.instanceId,
        brand.label,
        provider.driver,
        brand.color,
        windows,
        provider.usageLimits?.checkedAt
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
        if (windows.length === 0) continue;
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
          acct.usageLimits?.checkedAt
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
}
