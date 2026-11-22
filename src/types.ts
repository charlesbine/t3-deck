export type RuntimeMode = "approval-required" | "auto-accept-edits" | "auto" | "full-access";
export type ProviderInteractionMode = "default" | "plan";
export type ProviderApprovalDecision = "accept" | "acceptForSession" | "acceptAlways" | "decline" | "cancel";

export type ProviderRequestKind =
  | "command"
  | "file-read"
  | "file-change"
  | "mcp-elicitation"
  | "permission"
  | "dynamic_tool_call"
  | "user_input"
  | "auth_refresh";

export interface PendingRuntimeRequestSummary {
  id: string;
  kind: ProviderRequestKind;
  createdAt: string;
  blocking?: boolean;
  userOnly?: boolean;
}

export interface PullRequestLink {
  host?: string;
  repository?: string;
  number: number;
  url: string;
  state?: "open" | "closed" | "merged" | string;
}

export interface ProviderOptionSelection {
  id: string;
  value: string | boolean;
}

export interface ModelSelection {
  instanceId?: string;
  provider?: string;
  model: string;
  options?: ProviderOptionSelection[] | Record<string, string | boolean>;
}

export interface ThreadShell {
  id: string;
  projectId: string;
  title: string;
  providerInstanceId: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  branch: string | null;
  worktreePath: string | null;
  linkedPullRequest?: PullRequestLink | null;
  pullRequests?: PullRequestLink[];
  branchPullRequest?: PullRequestLink | null;
  lineage?: {
    parentThreadId?: string | null;
    relationshipToParent?: string | null;
  };
  latestRunId: string | null;
  activeRunId: string | null;
  activityRunStatus?: "preparing" | "starting" | "running" | "waiting" | null;
  blockedOnThreadWait?: boolean;
  status: string;
  lastError?: string | null;
  pendingRuntimeRequest: PendingRuntimeRequestSummary | null;
  latestVisibleMessage?: {
    id: string;
    role: string;
    text: string;
    updatedAt: string;
  } | null;
  hasActionableProposedPlan?: boolean;
  pendingBackgroundTasks?: unknown[];
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  settledOverride: "settled" | "active" | null;
  settledAt: string | null;
  snoozedUntil?: string | null;
  pinnedAt?: string | null;
  lastVisitedAt?: string | null;
  opens?: {
    openedAt?: number;
    score?: number;
  } | null;
  deletedAt: string | null;
}

export interface ProjectShell {
  id: string;
  title: string;
  workspaceRoot: string;
  defaultModelSelection?: ModelSelection | null;
  defaultThreadEnvMode?: "local" | "worktree" | null;
  pinnedAt?: string | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProviderOptionChoice {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
}

export interface ProviderOptionDescriptor {
  id: string;
  label: string;
  description?: string;
  type: "select" | "boolean";
  options?: ProviderOptionChoice[];
  currentValue?: string | boolean;
  role?: "reasoning";
}

export interface ServerProviderModel {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  isCustom?: boolean;
  isDefault?: boolean;
  isLegacy?: boolean;
  capabilities: {
    optionDescriptors?: ProviderOptionDescriptor[];
  } | null;
}

export interface UsageWindow {
  id: string;
  kind: "session" | "weekly" | "monthly" | "other";
  label: string;
  usedPercent: number;
  resetsAt?: string;
  windowDurationMins?: number;
}

export interface ServerProviderUsageLimits {
  checkedAt: string;
  windows: UsageWindow[];
  zeroSpendCap?: boolean;
  unavailable?: {
    reason: string;
    message?: string;
  };
}

export interface ServerProvider {
  instanceId: string;
  driver: string;
  displayName?: string;
  accentColor?: string;
  badgeLabel?: string;
  showInteractionModeToggle?: boolean;
  supportedRuntimeModes?: RuntimeMode[];
  enabled: boolean;
  installed: boolean;
  status: string;
  models: ServerProviderModel[];
  usageLimits?: ServerProviderUsageLimits;
}

export interface UsageLimitSourceSnapshot {
  id: string;
  kind: string;
  label: string;
  checkedAt: string;
  accounts: Array<{
    id: string;
    driver: string;
    email?: string;
    plan?: string;
    usageLimits: ServerProviderUsageLimits;
  }>;
  error?: string;
}

export interface ModelFavorite {
  provider: string;
  model: string;
}

export interface ProviderModelPreference {
  modelOrder?: string[];
  hiddenModels?: string[];
}

export type SnoozePresetSetting =
  | { kind: "after"; minutes: number }
  | { kind: "at"; day: string; time: string };

export interface ResolvedSnoozePreset {
  id: string;
  label: string;
  shortLabel: string;
  sublabel: string;
  snoozedUntilIso: string;
}

export interface ServerSettingsPayload {
  favorites?: ModelFavorite[] | null;
  providerModelPreferences?: Record<string, ProviderModelPreference> | null;
  snoozePresets?: SnoozePresetSetting[] | null;
}

export interface ServerConfigPayload {
  environment?: {
    environmentId: string;
    label?: string;
  };
  providers?: ServerProvider[];
  settings?: ServerSettingsPayload;
}

export type ModelCatalogScope = "favorites" | "all";

export type ThreadCategory =
  | "approval"
  | "question"
  | "failed"
  | "running"
  | "waiting"
  | "completed"
  | "idle";

export type ThreadFilterMode = "active" | "attention" | "running" | "pinned" | "all";

export interface ModelCatalogEntry {
  instanceId: string;
  driver: string;
  providerLabel: string;
  accentColor: string;
  slug: string;
  name: string;
  shortName: string;
  isLegacy: boolean;
  isDefault: boolean;
  isFavorite: boolean;
  reasoningDescriptor?: ProviderOptionDescriptor;
  supportedRuntimeModes: RuntimeMode[];
  supportsPlanMode: boolean;
}

export interface UsageCard {
  id: string;
  label: string;
  driver: string;
  accentColor: string;
  sessionWindow?: UsageWindow;
  weeklyWindow?: UsageWindow;
  extraWindow?: UsageWindow;
  checkedAt?: string;
  unavailable?: {
    reason: string;
    message?: string;
  };
}

export interface FleetStats {
  approvals: number;
  questions: number;
  failed: number;
  running: number;
  waiting: number;
  active: number;
  total: number;
}

export interface QuickPromptSettings {
  label?: string;
  prompt?: string;
  mode?: "auto" | "steer" | "queue";
  [key: string]: string | number | boolean | undefined;
}

export type NewThreadFirstPicker = "project" | "environment" | "model";

export interface NewThreadSettings {
  firstPicker?: NewThreadFirstPicker;
  defaultInteractionMode?: ProviderInteractionMode;
  [key: string]: string | number | boolean | undefined;
}

export interface PeerLinkSummary {
  environmentId: string;
  label: string;
}

// ---- Thread projection & overlay types ----

export interface ProviderApprovalOption {
  id?: string;
  decision?: ProviderApprovalDecision;
  label?: string;
  description?: string;
}

export interface ProjectionRuntimeRequest {
  id: string;
  nodeId: string;
  kind: ProviderRequestKind;
  status: "pending" | "resolved" | "expired" | "cancelled";
  responseCapability:
    | { type: "live"; providerSessionId?: string; supportsFeedback?: boolean }
    | { type: "message" }
    | { type: "not_resumable"; reason?: string };
  createdAt: string;
  resolvedAt?: string | null;
}

export interface ProjectionQuestionOption {
  label: string;
  description?: string;
}

export interface ProjectionUserInputQuestion {
  id: string;
  header: string;
  question: string;
  options: ProjectionQuestionOption[];
  multiSelect?: boolean;
  allowCustomAnswer?: boolean;
}

export interface ProjectionTurnItem {
  id: string;
  nodeId?: string;
  type: string;
  requestId?: string;
  requestKind?: ProviderRequestKind;
  prompt?: string;
  reason?: string;
  fullAccessOverride?: string;
  appName?: string;
  options?: ProviderApprovalOption[];
  questions?: ProjectionUserInputQuestion[];
  responseMode?: "message";
}

export interface ProjectionSubagent {
  id: string;
  title?: string | null;
  prompt?: string;
  model?: string | null;
  status?: string;
  childThreadId?: string | null;
  progress?: string;
}

export interface ThreadProjectionPayload {
  runtimeRequests?: ProjectionRuntimeRequest[];
  turnItems?: ProjectionTurnItem[];
  subagents?: ProjectionSubagent[];
}

export interface PendingApprovalItem {
  threadId: string;
  requestId: string;
  nodeId?: string;
  requestKind: ProviderRequestKind;
  createdAt: string;
  threadTitle: string;
  projectName: string;
  subagentTitle?: string;
  parentThreadTitle?: string;
  prompt?: string;
  reason?: string;
  appName?: string;
  fullAccessOverride?: string;
  options?: ProviderApprovalOption[];
  responseCapability: "live" | "not_resumable";
  dangerous: boolean;
  dangerReason?: string;
  detailsLoaded: boolean;
}

export interface PendingQuestionItem {
  threadId: string;
  requestId: string;
  createdAt: string;
  threadTitle: string;
  projectName: string;
  subagentTitle?: string;
  parentThreadTitle?: string;
  questions: ProjectionUserInputQuestion[];
  dismissible: boolean;
  detailsLoaded: boolean;
}

export interface PromptSuggestion {
  threadId: string;
  runId: string;
  text: string;
}

export type DeckOverlay =
  | { kind: "none" }
  | { kind: "approval"; requestId: string | null; scrollLine: number; originSlot: number }
  | {
      kind: "question";
      requestId: string | null;
      questionIndex: number;
      optionPage: number;
      selectedByQuestionId: Record<string, string[]>;
      originSlot: number;
    }
  | { kind: "prompts"; originSlot: number; selectedIndex: number }
  | { kind: "snooze"; originSlot: number; customMinutes: number | null }
  | { kind: "fleet"; page: number; originSlot: number }
  | { kind: "thread-tools"; originSlot: number }
  | {
      kind: "new-chat-builder";
      originSlot: number;
      projectIndex: number;
      modelIndex: number;
      modelScope: ModelCatalogScope;
      workspaceMode: "local" | "worktree" | "scratch";
      interactionMode: ProviderInteractionMode;
      keyMode: "project" | "environment" | "model";
    }
  | { kind: "new-chat-project"; page: number; originSlot: number; interactionMode: ProviderInteractionMode }
  | {
      kind: "new-chat-env";
      page: number;
      originSlot: number;
      interactionMode: ProviderInteractionMode;
    }
  | {
      kind: "new-chat-model";
      projectId: string;
      workspaceMode: "local" | "worktree" | "scratch";
      page: number;
      scope: ModelCatalogScope;
      interactionMode: ProviderInteractionMode;
      originSlot: number;
      parentKind: "none" | "new-chat-project" | "new-chat-env";
      parentOriginSlot: number;
    }
  | {
      kind: "model-picker";
      originSlot: number;
      page: number;
      scope: ModelCatalogScope;
    }
  | {
      kind: "mode-effort";
      originSlot: number;
    };

export interface SurfaceGeometry {
  deviceId: string;
  deviceType: number;
  cols: number;
  rows: number;
  stripCols: number;
  /**
   * Optional sorted list of physical key slots (`row * cols + col`) currently owned by T3 Deck
   * overlay controls on this page. Enables mix-and-match pages (e.g. 3 T3 buttons next to Spotify)
   * and zone-scoped overlays on XL / Plus XL (leaving the right-hand Fleet Wall live).
   */
  activeKeySlots?: number[];
}
