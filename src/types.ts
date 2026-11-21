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
  pinnedAt?: string | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
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

export interface ServerSettingsPayload {
  favorites?: ModelFavorite[] | null;
  providerModelPreferences?: Record<string, ProviderModelPreference> | null;
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
