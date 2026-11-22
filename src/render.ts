import {
  classifyThread,
  formatResetCountdown,
  isApprovalRequest,
  isQuestionRequest,
  isThreadRunning,
  isThreadSettled,
  isThreadSnoozed,
  primaryPullRequest,
  providerBrandInfo,
  resolveReasoningValue,
  shortModelLabel,
  type ToastNotice
} from "./store.js";
import type {
  FleetStats,
  ModelCatalogEntry,
  ModelCatalogScope,
  PendingApprovalItem,
  PendingQuestionItem,
  PromptSuggestion,
  RuntimeMode,
  ThreadCategory,
  ThreadFilterMode,
  ThreadShell,
  UsageCard,
  UsageWindow
} from "./types.js";

const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif";
const MONO = "'SF Mono', Menlo, Monaco, monospace";

export const CATEGORY_THEME: Record<
  ThreadCategory,
  { accent: string; bgTop: string; bgBottom: string; badge: string }
> = {
  approval: { accent: "#F59E0B", bgTop: "#2E1C06", bgBottom: "#140D04", badge: "APPROVE" },
  question: { accent: "#C084FC", bgTop: "#281242", bgBottom: "#12091E", badge: "INPUT" },
  failed: { accent: "#FB7185", bgTop: "#360E18", bgBottom: "#16070B", badge: "FAILED" },
  running: { accent: "#38BDF8", bgTop: "#0B2542", bgBottom: "#071120", badge: "RUNNING" },
  waiting: { accent: "#818CF8", bgTop: "#1A1B4B", bgBottom: "#0B0C22", badge: "WAITING" },
  completed: { accent: "#10B981", bgTop: "#0A2B22", bgBottom: "#061410", badge: "READY" },
  idle: { accent: "#64748B", bgTop: "#141B29", bgBottom: "#0A0E17", badge: "IDLE" }
};

export function escXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function truncate(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(1, maxLen - 1))}…`;
}

export function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else if (!current) {
      lines.push(truncate(word, maxChars));
      if (lines.length === maxLines) return lines;
    } else {
      lines.push(current);
      if (lines.length === maxLines - 1) {
        current = word;
      } else if (lines.length === maxLines) {
        return lines;
      } else {
        current = word;
      }
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(truncate(current, maxChars));
  }
  return lines;
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function keyShell(
  accent: string,
  bgTop: string,
  bgBottom: string,
  inner: string,
  glowBorder = false
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${bgTop}"/>
      <stop offset="100%" stop-color="${bgBottom}"/>
    </linearGradient>
  </defs>
  <rect width="144" height="144" rx="22" fill="url(#bg)"/>
  <rect x="3" y="3" width="138" height="138" rx="20" fill="none" stroke="${accent}" stroke-opacity="${glowBorder ? "0.9" : "0.35"}" stroke-width="${glowBorder ? "3.5" : "2"}"/>
  <rect x="26" y="3" width="92" height="4" rx="2" fill="${accent}" opacity="${glowBorder ? "1" : "0.75"}"/>
  ${inner}
</svg>`;
}

function renderToastKey(toast: ToastNotice): string {
  return keyShell(
    toast.accent,
    "#101C2A",
    "#080E16",
    `
    <circle cx="72" cy="54" r="22" fill="${toast.accent}" opacity="0.18"/>
    <path d="M61 54l8 8 15-16" fill="none" stroke="${toast.accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="72" y="106" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="800" fill="#FFFFFF" letter-spacing="0.4">${escXml(truncate(toast.label, 12))}</text>
  `,
    true
  );
}

// ---- Key Renderers (144x144) ----

export function renderFleetAttentionKey(
  stats: FleetStats,
  connected: boolean,
  toast?: ToastNotice
): string {
  if (toast) return renderToastKey(toast);
  if (!connected) {
    return keyShell(
      "#64748B",
      "#131824",
      "#0A0D14",
      `
      <circle cx="72" cy="50" r="16" fill="none" stroke="#64748B" stroke-width="4" stroke-dasharray="6 5"/>
      <text x="72" y="96" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="800" fill="#94A3B8">T3 CODE</text>
      <text x="72" y="118" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="600" fill="#64748B">OFFLINE</text>
    `
    );
  }

  const urgentCount = stats.approvals + stats.questions;
  const hasUrgent = urgentCount > 0;
  const hasFailed = stats.failed > 0;
  const accent = hasUrgent
    ? stats.approvals > 0
      ? "#F59E0B"
      : "#C084FC"
    : hasFailed
      ? "#FB7185"
      : stats.running > 0
        ? "#38BDF8"
        : "#10B981";
  const bgTop = hasUrgent ? "#2D1A06" : hasFailed ? "#300D17" : stats.running > 0 ? "#0B223C" : "#0A231C";
  const bgBottom = "#090D16";

  const headline = hasUrgent
    ? `${urgentCount} NEED YOU`
    : hasFailed
      ? `${stats.failed} FAILED`
      : stats.running > 0
        ? `${stats.running} LIVE`
        : "ALL CLEAR";

  return keyShell(
    accent,
    bgTop,
    bgBottom,
    `
    <text x="72" y="29" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="${accent}" letter-spacing="1.2">T3 FLEET</text>
    <text x="72" y="72" text-anchor="middle" font-family="${FONT}" font-size="${hasUrgent || stats.running > 9 ? "34" : "38"}" font-weight="800" fill="#FFFFFF">${hasUrgent ? urgentCount : stats.running}</text>
    <text x="72" y="96" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="800" fill="${accent}">${escXml(headline)}</text>
    <g transform="translate(14, 110)">
      <rect width="36" height="20" rx="6" fill="#0F172A" stroke="#38BDF8" stroke-opacity="0.4"/>
      <text x="18" y="14" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="700" fill="#38BDF8">▶${stats.running}</text>
      <rect x="40" width="36" height="20" rx="6" fill="#0F172A" stroke="#F59E0B" stroke-opacity="0.4"/>
      <text x="58" y="14" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="700" fill="#F59E0B">!${urgentCount}</text>
      <rect x="80" width="36" height="20" rx="6" fill="#0F172A" stroke="#FB7185" stroke-opacity="0.4"/>
      <text x="98" y="14" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="700" fill="#FB7185">✕${stats.failed}</text>
    </g>
  `,
    hasUrgent
  );
}

export function renderApproveKey(
  approvalThread: ThreadShell | null,
  focusedThread: ThreadShell | null,
  toast?: ToastNotice,
  pendingCount = 0
): string {
  if (toast) return renderToastKey(toast);

  if (approvalThread && isApprovalRequest(approvalThread)) {
    const kind = approvalThread.pendingRuntimeRequest?.kind ?? "permission";
    const kindLabel =
      kind === "command"
        ? "SHELL CMD"
        : kind === "file-change"
          ? "FILE EDIT"
          : kind === "file-read"
            ? "FILE READ"
            : "APPROVAL";
    const topText = pendingCount > 1 ? `${kindLabel} · ${pendingCount}` : kindLabel;
    return keyShell(
      "#F59E0B",
      "#362105",
      "#140C03",
      `
      <text x="72" y="29" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="#FCD34D" letter-spacing="0.6">${escXml(truncate(topText, 16))}</text>
      <circle cx="72" cy="64" r="24" fill="#F59E0B" opacity="0.22" stroke="#FBBF24" stroke-width="2.5"/>
      <path d="M61 64l8 8 15-16" fill="none" stroke="#FDE68A" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="72" y="110" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="800" fill="#FFFFFF">APPROVE?</text>
      <text x="72" y="128" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="600" fill="#FCD34D">TAP: INSPECT</text>
    `,
      true
    );
  }

  if (approvalThread && isQuestionRequest(approvalThread)) {
    return keyShell(
      "#C084FC",
      "#2D1248",
      "#11081C",
      `
      <text x="72" y="29" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="#E9D5FF" letter-spacing="0.8">QUESTION</text>
      <circle cx="72" cy="64" r="24" fill="#C084FC" opacity="0.2" stroke="#C084FC" stroke-width="2.5"/>
      <text x="72" y="75" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="800" fill="#F3E8FF">?</text>
      <text x="72" y="110" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="800" fill="#FFFFFF">ANSWER</text>
      <text x="72" y="128" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="600" fill="#D8B4FE">${escXml(truncate(approvalThread.title, 15))}</text>
    `,
      true
    );
  }

  const label = focusedThread ? "NO PENDING" : "IDLE";
  return keyShell(
    "#334155",
    "#111827",
    "#090D16",
    `
    <circle cx="72" cy="56" r="20" fill="#1E293B" stroke="#475569" stroke-width="2.5"/>
    <path d="M63 56l6 6 13-13" fill="none" stroke="#64748B" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="72" y="102" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="800" fill="#94A3B8">APPROVE</text>
    <text x="72" y="122" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#475569">${escXml(label)}</text>
  `
  );
}

export function renderStopDenyKey(
  approvalThread: ThreadShell | null,
  focusedThread: ThreadShell | null,
  toast?: ToastNotice
): string {
  if (toast) return renderToastKey(toast);

  if (approvalThread && isApprovalRequest(approvalThread)) {
    return keyShell(
      "#FB7185",
      "#3B0D18",
      "#16060A",
      `
      <text x="72" y="29" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="#FDA4AF" letter-spacing="0.8">APPROVAL</text>
      <circle cx="72" cy="64" r="24" fill="#F43F5E" opacity="0.22" stroke="#FB7185" stroke-width="2.5"/>
      <path d="M62 54l20 20M82 54L62 74" stroke="#FB7185" stroke-width="5" stroke-linecap="round"/>
      <text x="72" y="110" text-anchor="middle" font-family="${FONT}" font-size="17" font-weight="800" fill="#FFFFFF">DENY</text>
      <text x="72" y="128" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="600" fill="#FDA4AF">DECLINE REQ</text>
    `,
      true
    );
  }

  const running = Boolean(focusedThread && isThreadRunning(focusedThread));
  if (running) {
    return keyShell(
      "#EF4444",
      "#3A0E14",
      "#140709",
      `
      <text x="72" y="29" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="#FCA5A5" letter-spacing="0.8">ACTIVE RUN</text>
      <rect x="52" y="44" width="40" height="40" rx="9" fill="#EF4444" opacity="0.9"/>
      <text x="72" y="110" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="800" fill="#FFFFFF">STOP</text>
      <text x="72" y="128" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="600" fill="#FCA5A5">HOLD: KILL</text>
    `,
      true
    );
  }

  return keyShell(
    "#334155",
    "#111827",
    "#090D16",
    `
    <rect x="55" y="42" width="34" height="34" rx="8" fill="#1E293B" stroke="#475569" stroke-width="2.5"/>
    <text x="72" y="102" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="800" fill="#64748B">STOP</text>
    <text x="72" y="122" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#475569">NOT RUNNING</text>
  `
  );
}

export function renderSettlePinKey(thread: ThreadShell | null, toast?: ToastNotice): string {
  if (toast) return renderToastKey(toast);
  if (!thread) {
    return keyShell(
      "#334155",
      "#111827",
      "#090D16",
      `
      <text x="72" y="78" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="700" fill="#64748B">SETTLE</text>
    `
    );
  }

  const settled = isThreadSettled(thread);
  const pinned = Boolean(thread.pinnedAt);
  const accent = settled ? "#10B981" : pinned ? "#F59E0B" : "#60A5FA";
  const bgTop = settled ? "#0A2B22" : pinned ? "#2B1D08" : "#111D33";

  return keyShell(
    accent,
    bgTop,
    "#090D16",
    `
    <text x="72" y="29" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="${accent}" letter-spacing="0.8">${pinned ? "★ PINNED" : "THREAD"}</text>
    ${
      settled
        ? `<rect x="50" y="42" width="44" height="44" rx="11" fill="${accent}" opacity="0.22" stroke="${accent}" stroke-width="2.5"/>
           <path d="M62 60a11 11 0 1 1 3 12M62 52v9h9" fill="none" stroke="${accent}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<rect x="50" y="42" width="44" height="44" rx="11" fill="${accent}" opacity="0.14" stroke="${accent}" stroke-width="2.5"/>
           <path d="M61 64l7 7 15-15" fill="none" stroke="${accent}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`
    }
    <text x="72" y="110" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="800" fill="#FFFFFF">${settled ? "UNSETTLE" : "SETTLE"}</text>
    <text x="72" y="128" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="600" fill="#94A3B8">HOLD: TOOLS</text>
  `
  );
}

export function renderNewThreadKey(
  projectName?: string,
  toast?: ToastNotice,
  holdHint = "HOLD: PROJECTS"
): string {
  if (toast) return renderToastKey(toast);
  return keyShell(
    "#38BDF8",
    "#0D213A",
    "#080F1C",
    `
    <text x="72" y="29" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="#7DD3FC" letter-spacing="0.9">${escXml(truncate((projectName || "T3 CODE").toUpperCase(), 14))}</text>
    <circle cx="72" cy="64" r="23" fill="#38BDF8" opacity="0.18" stroke="#38BDF8" stroke-width="2.5"/>
    <path d="M72 52v24M60 64h24" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/>
    <text x="72" y="110" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="800" fill="#FFFFFF">NEW CHAT</text>
    <text x="72" y="128" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="600" fill="#7DD3FC">${escXml(truncate(holdHint, 16))}</text>
  `
  );
}

export function renderQuickPromptKey(
  thread: ThreadShell | null,
  label: string,
  mode: "auto" | "steer" | "queue",
  toast?: ToastNotice
): string {
  if (toast) return renderToastKey(toast);
  const running = Boolean(thread && isThreadRunning(thread));
  const actionTag = running
    ? mode === "queue"
      ? "QUEUE"
      : "STEER"
    : "SEND";
  const accent = running ? "#A78BFA" : "#22D3EE";
  const bgTop = running ? "#22163E" : "#0B2430";

  return keyShell(
    thread ? accent : "#334155",
    thread ? bgTop : "#111827",
    "#090D16",
    `
    <text x="72" y="29" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="${thread ? accent : "#64748B"}" letter-spacing="0.9">${actionTag}</text>
    <path d="M46 66l48-18-18 46-8-20-22-8z" fill="${thread ? accent : "#475569"}" opacity="${thread ? "0.9" : "0.45"}"/>
    <text x="72" y="112" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="800" fill="${thread ? "#FFFFFF" : "#64748B"}">${escXml(truncate(label.toUpperCase(), 11))}</text>
    <text x="72" y="129" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="600" fill="#94A3B8">HOLD: PROMPTS</text>
  `
  );
}

export function renderOpenThreadKey(
  thread: ThreadShell | null,
  projectName: string,
  toast?: ToastNotice
): string {
  if (toast) return renderToastKey(toast);
  if (!thread) {
    return keyShell(
      "#334155",
      "#111827",
      "#090D16",
      `
      <text x="72" y="76" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="800" fill="#64748B">OPEN T3</text>
    `
    );
  }

  const cat = classifyThread(thread);
  const theme = CATEGORY_THEME[cat];
  const pr = primaryPullRequest(thread);
  const titleLines = wrapLines(thread.title || "Untitled", 13, 2);

  return keyShell(
    theme.accent,
    theme.bgTop,
    theme.bgBottom,
    `
    <text x="72" y="27" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="800" fill="${theme.accent}" letter-spacing="0.6">${escXml(truncate(projectName.toUpperCase(), 14))}</text>
    <text x="72" y="60" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="800" fill="#FFFFFF">${escXml(titleLines[0] ?? "")}</text>
    <text x="72" y="79" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="700" fill="#E2E8F0">${escXml(titleLines[1] ?? "")}</text>
    ${
      pr
        ? `<rect x="26" y="96" width="92" height="22" rx="7" fill="#064E3B" stroke="#34D399" stroke-width="1.5"/>
           <text x="72" y="111" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="800" fill="#6EE7B7">PR #${pr.number}</text>
           <text x="72" y="132" text-anchor="middle" font-family="${FONT}" font-size="9" font-weight="600" fill="#94A3B8">HOLD: OPEN PR</text>`
        : `<text x="72" y="116" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="800" fill="${theme.accent}">OPEN IN T3</text>`
    }
  `
  );
}

export function renderSnoozeSyncKey(
  thread: ThreadShell | null,
  connected: boolean,
  toast?: ToastNotice,
  defaultShortLabel = "1H"
): string {
  if (toast) return renderToastKey(toast);
  if (!connected) {
    return keyShell(
      "#F59E0B",
      "#2B1C06",
      "#120C04",
      `
      <text x="72" y="29" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="#FCD34D">DISCONNECTED</text>
      <circle cx="72" cy="65" r="20" fill="none" stroke="#F59E0B" stroke-width="4" stroke-dasharray="90 35"/>
      <text x="72" y="112" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="800" fill="#FFFFFF">RECONNECT</text>
    `
    );
  }

  const snoozed = Boolean(thread && isThreadSnoozed(thread));
  const eta = snoozed && thread?.snoozedUntil ? formatResetCountdown(thread.snoozedUntil) : "";
  const accent = snoozed ? "#F59E0B" : "#818CF8";
  const bgTop = snoozed ? "#2B1C06" : "#181B3A";

  return keyShell(
    accent,
    bgTop,
    "#090D16",
    `
    <text x="72" y="29" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="${accent}" letter-spacing="0.8">${snoozed ? (eta ? `SNOOZED · ${eta.toUpperCase()}` : "SNOOZED") : "TRIAGE"}</text>
    <path d="M84 52a20 20 0 1 1-22 28 16 16 0 0 0 22-28z" fill="${accent}" opacity="0.9"/>
    <text x="72" y="110" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="800" fill="#FFFFFF">${snoozed ? "UNSNOOZE" : `SNOOZE ${escXml(truncate(defaultShortLabel, 5))}`}</text>
    <text x="72" y="128" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="600" fill="#94A3B8">HOLD: ALL TIMES</text>
  `
  );
}

export function renderThreadSlotKey(
  slotNum: number,
  thread: ThreadShell | null,
  projectName: string,
  connected: boolean
): string {
  if (!thread) {
    return keyShell(
      "#334155",
      "#0F1522",
      "#080B12",
      `
      <text x="72" y="34" text-anchor="middle" font-family="${MONO}" font-size="13" font-weight="700" fill="#475569">#${slotNum}</text>
      <text x="72" y="80" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="700" fill="#64748B">${connected ? "EMPTY" : "OFFLINE"}</text>
    `
    );
  }

  const cat = classifyThread(thread);
  const theme = CATEGORY_THEME[cat];
  const lines = wrapLines(thread.title || "Untitled", 12, 3);

  return keyShell(
    theme.accent,
    theme.bgTop,
    theme.bgBottom,
    `
    <circle cx="22" cy="24" r="6" fill="${theme.accent}"/>
    <text x="34" y="29" font-family="${FONT}" font-size="11" font-weight="800" fill="${theme.accent}">${escXml(truncate(projectName, 11))}</text>
    <text x="128" y="29" text-anchor="end" font-family="${MONO}" font-size="11" font-weight="700" fill="#94A3B8">${slotNum}</text>
    <text x="72" y="60" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="800" fill="#FFFFFF">${escXml(lines[0] ?? "")}</text>
    <text x="72" y="80" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="700" fill="#E2E8F0">${escXml(lines[1] ?? "")}</text>
    <text x="72" y="100" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="600" fill="#CBD5E1">${escXml(lines[2] ?? "")}</text>
    <text x="72" y="128" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="${theme.accent}" letter-spacing="0.7">${theme.badge}</text>
  `,
    cat === "approval" || cat === "question"
  );
}

// ---- Full-Canvas Dial Touch Strip Renderers (400x200 @2x) ----

function dialShell(accent: string, bgTop: string, bgBottom: string, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
  <defs>
    <linearGradient id="dbg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${bgTop}"/>
      <stop offset="100%" stop-color="${bgBottom}"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="392" height="192" rx="16" fill="url(#dbg)" stroke="${accent}" stroke-opacity="0.45" stroke-width="3"/>
  <rect x="20" y="4" width="360" height="5" rx="2.5" fill="${accent}" opacity="0.9"/>
  ${inner}
</svg>`;
}

export function renderThreadDialCanvas(
  thread: ThreadShell | null,
  projectName: string,
  filterMode: ThreadFilterMode,
  index: number,
  total: number,
  connected: boolean,
  toast?: ToastNotice,
  isPeeking = false
): string {
  if (toast) {
    return dialShell(
      toast.accent,
      "#0F2027",
      "#080C14",
      `
      <text x="200" y="108" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="800" fill="${toast.accent}">${escXml(truncate(toast.label, 18))}</text>
    `
    );
  }

  const filterBadge = filterMode.toUpperCase();
  if (!connected || !thread) {
    return dialShell(
      "#64748B",
      "#131A26",
      "#090C12",
      `
      <text x="24" y="42" font-family="${FONT}" font-size="20" font-weight="800" fill="#94A3B8">THREADS</text>
      <rect x="274" y="18" width="104" height="30" rx="8" fill="#1E293B"/>
      <text x="326" y="39" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="800" fill="#CBD5E1">${filterBadge}</text>
      <text x="200" y="114" text-anchor="middle" font-family="${FONT}" font-size="24" font-weight="700" fill="#64748B">${connected ? "No matching threads" : "T3 Code Offline"}</text>
      <text x="200" y="168" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="600" fill="#475569">TAP TO CYCLE FILTER</text>
    `
    );
  }

  const cat = classifyThread(thread);
  const snoozed = isThreadSnoozed(thread);
  const settled = isThreadSettled(thread);
  const snoozeEta = snoozed && thread.snoozedUntil ? formatResetCountdown(thread.snoozedUntil) : "";
  const baseTheme = CATEGORY_THEME[cat];
  const theme =
    snoozed && cat !== "approval" && cat !== "question"
      ? {
          accent: "#818CF8",
          bgTop: "#1A1D3D",
          bgBottom: "#0A0C1B",
          badge: snoozeEta ? `SNOOZED · ${snoozeEta.toUpperCase()}` : "SNOOZED"
        }
      : settled && cat === "idle"
        ? { ...baseTheme, badge: "SETTLED" }
        : baseTheme;
  const pr = primaryPullRequest(thread);
  const modelShort = shortModelLabel(thread.modelSelection?.model ?? "");
  const posText = total > 0 ? `${index + 1}/${total}` : "0/0";
  const rightPill = snoozed ? "SNOOZED" : isPeeking ? "PEEKING" : filterBadge;
  const pillBorder = isPeeking && !snoozed ? "#FBBF24" : theme.accent;
  const pillText = isPeeking && !snoozed ? "#FDE68A" : "#E2E8F0";

  return dialShell(
    theme.accent,
    theme.bgTop,
    theme.bgBottom,
    `
    <circle cx="30" cy="36" r="9" fill="${theme.accent}"/>
    <text x="48" y="43" font-family="${FONT}" font-size="${theme.badge.length > 10 ? "16" : "19"}" font-weight="800" fill="${theme.accent}" letter-spacing="0.5">${escXml(theme.badge)}</text>
    <rect x="214" y="19" width="102" height="30" rx="8" fill="#0F172A" stroke="${pillBorder}" stroke-opacity="${isPeeking && !snoozed ? "0.85" : "0.45"}" stroke-width="1.5"/>
    <text x="265" y="40" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="800" fill="${pillText}">${escXml(rightPill)}</text>
    <text x="378" y="42" text-anchor="end" font-family="${MONO}" font-size="19" font-weight="800" fill="#CBD5E1">${posText}</text>

    <text x="24" y="96" font-family="${FONT}" font-size="26" font-weight="800" fill="#FFFFFF">${escXml(truncate(thread.title || "Untitled", 25))}</text>

    <rect x="24" y="116" width="${Math.min(180, Math.max(76, projectName.length * 12 + 24))}" height="28" rx="8" fill="#0F172A" stroke="#334155" stroke-width="1.5"/>
    <text x="36" y="136" font-family="${FONT}" font-size="16" font-weight="700" fill="#CBD5E1">${escXml(truncate(projectName, 13))}</text>

    ${
      pr
        ? `<rect x="278" y="116" width="100" height="28" rx="8" fill="#064E3B" stroke="#34D399" stroke-width="1.5"/>
           <text x="328" y="136" text-anchor="middle" font-family="${MONO}" font-size="15" font-weight="800" fill="#6EE7B7">PR #${pr.number}</text>`
        : ""
    }

    <text x="24" y="177" font-family="${FONT}" font-size="17" font-weight="600" fill="#94A3B8">${escXml(truncate(modelShort, isPeeking ? 18 : 24))}</text>
    <text x="378" y="177" text-anchor="end" font-family="${FONT}" font-size="14" font-weight="700" fill="${isPeeking ? "#FBBF24" : theme.accent}">${isPeeking ? "OPEN · HOLD: LIVE" : "PRESS: OPEN"}</text>
  `
  );
}

export function renderModelDialCanvas(
  thread: ThreadShell | null,
  catalog: ModelCatalogEntry[],
  activeIndex: number,
  pendingIndex: number | null,
  scope: ModelCatalogScope = "favorites",
  currentEntry: ModelCatalogEntry | null = null,
  toast?: ToastNotice
): string {
  if (toast) {
    return dialShell(
      toast.accent,
      "#0F2027",
      "#080C14",
      `
      <text x="200" y="108" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="800" fill="${toast.accent}">${escXml(truncate(toast.label, 20))}</text>
    `
    );
  }

  const displayIdx = pendingIndex !== null ? pendingIndex : activeIndex;
  const entry = displayIdx >= 0 ? catalog[displayIdx] : currentEntry ?? undefined;
  const isPending = pendingIndex !== null && pendingIndex !== activeIndex;
  const scopeLabel = scope === "favorites" ? "★ FAVS" : "ALL";
  const scopeColor = scope === "favorites" ? "#F59E0B" : "#94A3B8";

  if (!entry) {
    const fallbackModel = thread?.modelSelection?.model
      ? shortModelLabel(thread.modelSelection.model)
      : "No model";
    const fallbackProv = thread?.providerInstanceId
      ? providerBrandInfo({ instanceId: thread.providerInstanceId, driver: thread.providerInstanceId })
      : { label: "MODEL", color: "#64748B" };
    return dialShell(
      fallbackProv.color,
      "#131A26",
      "#090C12",
      `
      <text x="24" y="42" font-family="${FONT}" font-size="19" font-weight="800" fill="${fallbackProv.color}">${escXml(fallbackProv.label.toUpperCase())}</text>
      <rect x="292" y="18" width="86" height="30" rx="8" fill="#1E293B" stroke="${scopeColor}" stroke-opacity="0.6" stroke-width="1.5"/>
      <text x="335" y="39" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="800" fill="${scopeColor}">${scopeLabel}</text>
      <text x="24" y="108" font-family="${FONT}" font-size="26" font-weight="800" fill="#FFFFFF">${escXml(truncate(fallbackModel, 24))}</text>
      <text x="24" y="174" font-family="${FONT}" font-size="15" font-weight="700" fill="#64748B">ROTATE: PICK · TAP: ${scope === "favorites" ? "ALL" : "FAVS"}</text>
    `
    );
  }

  const accent = isPending ? "#F59E0B" : entry.accentColor;
  const dotCount = Math.min(catalog.length, 10);
  let dotsSvg = "";
  if (dotCount > 0) {
    const anchor = displayIdx >= 0 ? displayIdx : 0;
    const dotWindowStart = Math.max(
      0,
      Math.min(catalog.length - dotCount, anchor - Math.floor(dotCount / 2))
    );
    for (let i = 0; i < dotCount; i++) {
      const idx = dotWindowStart + i;
      const isSel = idx === displayIdx;
      const cx = 36 + i * 36;
      dotsSvg += `<circle cx="${cx}" cy="134" r="${isSel ? 7 : 4}" fill="${isSel ? accent : "#334155"}"/>`;
    }
  }

  const posText = displayIdx >= 0 ? `${displayIdx + 1}/${catalog.length}` : `—/${catalog.length}`;
  const modelTitle =
    scope === "all" && entry.isFavorite ? `★ ${entry.shortName}` : entry.shortName;
  const footerText = isPending
    ? "PRESS DIAL TO APPLY"
    : `TURN: ${scope === "favorites" ? "FAVS" : "ALL"} · HOLD/TAP: ${scope === "favorites" ? "ALL" : "FAVS"}`;

  return dialShell(
    accent,
    isPending ? "#2B1B05" : "#121A2A",
    "#080C14",
    `
    <rect x="22" y="18" width="${Math.min(176, Math.max(88, entry.providerLabel.length * 12 + 26))}" height="30" rx="8" fill="${entry.accentColor}" opacity="0.22" stroke="${entry.accentColor}" stroke-width="1.5"/>
    <text x="34" y="39" font-family="${FONT}" font-size="15" font-weight="800" fill="${entry.accentColor}">${escXml(truncate(entry.providerLabel.toUpperCase(), 13))}</text>

    <rect x="214" y="18" width="84" height="30" rx="8" fill="#0F172A" stroke="${scopeColor}" stroke-opacity="0.7" stroke-width="1.5"/>
    <text x="256" y="39" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="800" fill="${scopeColor}">${scopeLabel}</text>

    <text x="378" y="40" text-anchor="end" font-family="${MONO}" font-size="16" font-weight="700" fill="#94A3B8">${posText}</text>

    <text x="24" y="96" font-family="${FONT}" font-size="26" font-weight="800" fill="#FFFFFF">${escXml(truncate(modelTitle, 22))}</text>
    ${dotsSvg}
    <text x="24" y="176" font-family="${FONT}" font-size="15" font-weight="800" fill="${isPending ? "#FCD34D" : "#94A3B8"}">${escXml(footerText)}</text>
  `
  );
}

const RUNTIME_LABELS: Record<RuntimeMode, { short: string; color: string }> = {
  "approval-required": { short: "ASK", color: "#F59E0B" },
  "auto-accept-edits": { short: "EDITS", color: "#38BDF8" },
  auto: { short: "AUTO", color: "#10B981" },
  "full-access": { short: "FULL", color: "#F43F5E" }
};

export function renderModeEffortDialCanvas(
  thread: ThreadShell | null,
  modelEntry: ModelCatalogEntry | null,
  toast?: ToastNotice
): string {
  if (toast) {
    return dialShell(
      toast.accent,
      "#0F2027",
      "#080C14",
      `
      <text x="200" y="108" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="800" fill="${toast.accent}">${escXml(truncate(toast.label, 20))}</text>
    `
    );
  }

  if (!thread) {
    return dialShell(
      "#64748B",
      "#131A26",
      "#090C12",
      `
      <text x="200" y="108" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="700" fill="#64748B">MODE &amp; EFFORT</text>
    `
    );
  }

  const rt = RUNTIME_LABELS[thread.runtimeMode] ?? RUNTIME_LABELS.auto;
  const isPlan = thread.interactionMode === "plan";
  const descriptor = modelEntry?.reasoningDescriptor;
  const options = descriptor?.type === "select" ? (descriptor.options ?? []) : [];
  const currentEffort = resolveReasoningValue(thread.modelSelection, descriptor);
  const currentIdx = options.findIndex((o) => o.id === currentEffort);
  const currentLabel =
    options[currentIdx]?.label ?? (currentEffort ? currentEffort.toUpperCase() : "STANDARD");

  const accent = isPlan ? "#C084FC" : rt.color;

  // Render effort bar segments
  let segsSvg = "";
  if (options.length > 0) {
    const gap = 8;
    const totalW = 352;
    const segW = Math.floor((totalW - gap * (options.length - 1)) / options.length);
    for (let i = 0; i < options.length; i++) {
      const x = 24 + i * (segW + gap);
      const active = i <= (currentIdx >= 0 ? currentIdx : 0);
      segsSvg += `<rect x="${x}" y="126" width="${segW}" height="14" rx="7" fill="${active ? "#38BDF8" : "#1E293B"}"/>`;
    }
  } else {
    segsSvg = `<rect x="24" y="126" width="352" height="14" rx="7" fill="#1E293B"/>`;
  }

  return dialShell(
    accent,
    isPlan ? "#24113B" : "#111A2B",
    "#080C14",
    `
    <rect x="22" y="18" width="144" height="34" rx="9" fill="${rt.color}" opacity="0.22" stroke="${rt.color}" stroke-width="2"/>
    <text x="94" y="42" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="800" fill="${rt.color}">MODE: ${rt.short}</text>

    <rect x="180" y="18" width="198" height="34" rx="9" fill="${isPlan ? "#A855F7" : "#1E293B"}" opacity="${isPlan ? "0.28" : "0.9"}" stroke="${isPlan ? "#C084FC" : "#334155"}" stroke-width="2"/>
    <text x="279" y="42" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="800" fill="${isPlan ? "#E9D5FF" : "#94A3B8"}">${isPlan ? "✦ PLAN MODE" : "CODE MODE"}</text>

    <text x="24" y="102" font-family="${FONT}" font-size="18" font-weight="700" fill="#94A3B8">EFFORT</text>
    <text x="376" y="104" text-anchor="end" font-family="${FONT}" font-size="25" font-weight="800" fill="#FFFFFF">${escXml(truncate(currentLabel.toUpperCase(), 14))}</text>

    ${segsSvg}

    <text x="24" y="177" font-family="${FONT}" font-size="14" font-weight="700" fill="#64748B">TURN: EFFORT · PRESS: MODE · TAP: PLAN</text>
  `
  );
}

function gaugeColor(pct: number): string {
  if (pct >= 85) return "#FB7185";
  if (pct >= 60) return "#F59E0B";
  return "#10B981";
}

function renderUsageRow(y: number, label: string, win: UsageWindow | undefined): string {
  if (!win) {
    return `
      <text x="24" y="${y}" font-family="${FONT}" font-size="16" font-weight="700" fill="#475569">${escXml(label)}</text>
      <rect x="24" y="${y + 10}" width="352" height="14" rx="7" fill="#1E293B"/>
      <text x="376" y="${y}" text-anchor="end" font-family="${MONO}" font-size="16" font-weight="700" fill="#475569">—</text>
    `;
  }
  const pct = Math.max(0, Math.min(100, Math.round(win.usedPercent)));
  const fillW = Math.max(pct > 0 ? 12 : 0, Math.round((352 * pct) / 100));
  const color = gaugeColor(pct);
  const reset = formatResetCountdown(win.resetsAt);
  const rightText = reset ? `${pct}% · ${reset}` : `${pct}%`;

  return `
    <text x="24" y="${y}" font-family="${FONT}" font-size="16" font-weight="800" fill="#CBD5E1">${escXml(truncate(label, 14))}</text>
    <text x="376" y="${y}" text-anchor="end" font-family="${MONO}" font-size="17" font-weight="800" fill="${color}">${escXml(rightText)}</text>
    <rect x="24" y="${y + 10}" width="352" height="15" rx="7.5" fill="#1E293B"/>
    ${fillW > 0 ? `<rect x="24" y="${y + 10}" width="${fillW}" height="15" rx="7.5" fill="${color}"/>` : ""}
  `;
}

export function renderUsageDialCanvas(
  card: UsageCard | null,
  index: number,
  total: number,
  connected: boolean,
  toast?: ToastNotice
): string {
  if (toast) {
    return dialShell(
      toast.accent,
      "#0F2027",
      "#080C14",
      `
      <text x="200" y="108" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="800" fill="${toast.accent}">${escXml(truncate(toast.label, 20))}</text>
    `
    );
  }

  if (!connected || !card) {
    return dialShell(
      "#64748B",
      "#131A26",
      "#090C12",
      `
      <text x="24" y="42" font-family="${FONT}" font-size="19" font-weight="800" fill="#94A3B8">USAGE RADAR</text>
      <text x="200" y="114" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="700" fill="#64748B">${connected ? "No usage limits reported" : "T3 Code Offline"}</text>
      <text x="200" y="168" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="600" fill="#475569">PRESS TO REFRESH</text>
    `
    );
  }

  if (card.unavailable && !card.sessionWindow && !card.weeklyWindow && !card.extraWindow) {
    const headline = /expired|sign-in|auth/i.test(card.unavailable.message ?? "")
      ? "SIGN-IN EXPIRED"
      : "LIMITS UNAVAILABLE";
    const lines = wrapLines(card.unavailable.message ?? "Refresh limits to retry.", 34, 2);
    return dialShell(
      "#F59E0B",
      "#231807",
      "#0B0F17",
      `
      <circle cx="30" cy="34" r="8" fill="${card.accentColor}"/>
      <text x="48" y="41" font-family="${FONT}" font-size="20" font-weight="800" fill="#FFFFFF">${escXml(truncate(card.label.toUpperCase(), 16))}</text>
      <text x="376" y="41" text-anchor="end" font-family="${MONO}" font-size="18" font-weight="700" fill="#94A3B8">${index + 1}/${total}</text>

      <text x="24" y="84" font-family="${FONT}" font-size="18" font-weight="800" fill="#FBBF24">⚠ ${headline}</text>
      <text x="24" y="114" font-family="${FONT}" font-size="15" font-weight="600" fill="#CBD5E1">${escXml(lines[0] ?? "")}</text>
      ${lines[1] ? `<text x="24" y="136" font-family="${FONT}" font-size="15" font-weight="600" fill="#94A3B8">${escXml(lines[1])}</text>` : ""}
      <text x="24" y="176" font-family="${FONT}" font-size="14" font-weight="700" fill="#F59E0B">PRESS DIAL TO REFRESH</text>
    `
    );
  }

  const row1Win = card.sessionWindow ?? card.weeklyWindow;
  const row1Label = card.sessionWindow ? "SESSION" : (card.weeklyWindow?.label?.toUpperCase() ?? "WEEKLY");
  const row2Win = card.sessionWindow ? (card.weeklyWindow ?? card.extraWindow) : card.extraWindow;
  const row2Label = card.sessionWindow
    ? (card.weeklyWindow ? "WEEKLY" : (card.extraWindow?.label?.toUpperCase() ?? "LIMIT"))
    : (card.extraWindow?.label?.toUpperCase() ?? "SECONDARY");

  return dialShell(
    card.accentColor,
    "#101929",
    "#080C14",
    `
    <circle cx="30" cy="34" r="8" fill="${card.accentColor}"/>
    <text x="48" y="41" font-family="${FONT}" font-size="20" font-weight="800" fill="#FFFFFF">${escXml(truncate(card.label.toUpperCase(), 16))}</text>
    <text x="376" y="41" text-anchor="end" font-family="${MONO}" font-size="18" font-weight="700" fill="#94A3B8">${index + 1}/${total}</text>

    ${renderUsageRow(86, row1Label, row1Win)}
    ${renderUsageRow(148, row2Label, row2Win)}
  `
  );
}

// ============================================================
// PANORAMIC 1600x200 OVERLAY ENGINE & SUBMENU KEY RENDERERS
// ============================================================

export interface PanoramicFrame {
  accent: string;
  bgTop: string;
  bgBottom: string;
  inner: string;
}

/**
 * Slices a unified panoramic frame into a single 400x200 dial viewport (`col` = 0..stripCols-1).
 * On Stream Deck+ (`stripCols = 4`), slices 1600x200 cleanly.
 * On Stream Deck+ XL (`stripCols = 6`), extends seamlessly to 2400x200 with a right-hand companion panel.
 */
export function slicePanoramicFrame(
  frame: PanoramicFrame,
  col: number,
  stripCols = 4,
  extraRightInner?: string
): string {
  const safeCols = Math.max(4, stripCols);
  const totalW = safeCols * 400;
  const clamped = Math.max(0, Math.min(safeCols - 1, col));
  const vx = clamped * 400;
  const rightExtension =
    totalW > 1600
      ? `<line x1="1600" y1="22" x2="1600" y2="178" stroke="${frame.accent}" stroke-opacity="0.32" stroke-width="2"/>
         ${
           extraRightInner ??
           `<text x="1632" y="54" font-family="${FONT}" font-size="16" font-weight="800" fill="${frame.accent}" letter-spacing="0.8">STREAM DECK+ XL</text>
            <text x="1632" y="106" font-family="${FONT}" font-size="24" font-weight="800" fill="#FFFFFF">PANORAMIC VIEW ACTIVE</text>
            <text x="1632" y="150" font-family="${FONT}" font-size="15" font-weight="600" fill="#94A3B8">Use keys above or press BACK to return</text>`
         }`
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="${vx} 0 400 200">
  <defs>
    <linearGradient id="pbg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${frame.bgTop}"/>
      <stop offset="100%" stop-color="${frame.bgBottom}"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="${totalW - 8}" height="192" rx="16" fill="url(#pbg)" stroke="${frame.accent}" stroke-opacity="0.7" stroke-width="3"/>
  <rect x="24" y="4" width="${totalW - 48}" height="5" rx="2.5" fill="${frame.accent}" opacity="0.95"/>
  ${frame.inner}
  ${rightExtension}
</svg>`;
}

/** Renders the full 1600x200 panoramic frame as a single SVG (useful for mockups & tests). */
export function renderFullPanoramicSvg(frame: PanoramicFrame): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="200" viewBox="0 0 1600 200">
  <defs>
    <linearGradient id="pbg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${frame.bgTop}"/>
      <stop offset="100%" stop-color="${frame.bgBottom}"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="1592" height="192" rx="16" fill="url(#pbg)" stroke="${frame.accent}" stroke-opacity="0.7" stroke-width="3"/>
  <rect x="24" y="4" width="1552" height="5" rx="2.5" fill="${frame.accent}" opacity="0.95"/>
  ${frame.inner}
</svg>`;
}

function wrapCodeLines(text: string, maxChars: number): string[] {
  const rawLines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const raw of rawLines) {
    const trimmed = raw.trimEnd();
    if (trimmed.length === 0) continue;
    let remaining = trimmed;
    while (remaining.length > maxChars) {
      let splitAt = remaining.lastIndexOf(" ", maxChars);
      if (splitAt < Math.floor(maxChars * 0.45)) splitAt = maxChars;
      out.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    if (remaining.length > 0) out.push(remaining);
  }
  return out.length > 0 ? out : [""];
}

export function renderApprovalPanoramicFrame(
  item: PendingApprovalItem | null,
  index: number,
  total: number,
  scrollLine = 0
): PanoramicFrame {
  if (!item) {
    return {
      accent: "#10B981",
      bgTop: "#0B241D",
      bgBottom: "#070E0D",
      inner: `
        <text x="800" y="96" text-anchor="middle" font-family="${FONT}" font-size="32" font-weight="800" fill="#34D399">ALL APPROVALS CLEARED</text>
        <text x="800" y="138" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="600" fill="#94A3B8">Press any key to return to Mission Control</text>
      `
    };
  }

  const danger = item.dangerous;
  const accent = danger ? "#FB7185" : "#F59E0B";
  const bgTop = danger ? "#380D18" : "#2D1A05";
  const bgBottom = danger ? "#14060A" : "#110B04";

  const kindLabel =
    item.requestKind === "command"
      ? "SHELL CMD"
      : item.requestKind === "file-change"
        ? "FILE EDIT"
        : item.requestKind === "file-read"
          ? "FILE READ"
          : item.requestKind === "mcp-elicitation"
            ? item.appName
              ? `MCP · ${item.appName.toUpperCase()}`
              : "MCP ACCESS"
            : "PERMISSION";

  const actorTitle = item.subagentTitle || item.threadTitle;
  const isSubagent = Boolean(item.subagentTitle);
  const posText = `${Math.max(1, index + 1)}/${Math.max(1, total)}`;

  const commandPrefix =
    item.requestKind === "command"
      ? "$ "
      : item.requestKind === "file-change"
        ? "✎ "
        : item.requestKind === "file-read"
          ? "◉ "
          : "▸ ";

  const rawDetail = item.prompt?.trim()
    ? `${commandPrefix}${item.prompt.trim()}`
    : item.detailsLoaded
      ? `${commandPrefix}${kindLabel} request (press OPEN IN T3 for full context)`
      : "Loading command details from T3 Code…";

  const allLines = wrapCodeLines(rawDetail, 68);
  const visibleCount = 3;
  const maxScroll = Math.max(0, allLines.length - visibleCount);
  const start = Math.min(Math.max(0, scrollLine), maxScroll);
  const shown = allLines.slice(start, start + visibleCount);
  const hasMore = allLines.length > visibleCount;

  const lineY = [64, 96, 128];
  const codeLinesSvg = shown
    .map(
      (line, idx) =>
        `<text x="468" y="${lineY[idx]}" font-family="${MONO}" font-size="22" font-weight="700" fill="${danger ? "#FFE4E6" : "#F8FAFC"}">${escXml(line)}</text>`
    )
    .join("");

  const reasonText = item.reason?.trim()
    ? truncate(item.reason.trim(), 74)
    : item.responseCapability === "not_resumable"
      ? "Provider process stopped — press OPEN IN T3 to restart"
      : "Press CONFIRM above to approve · DENY to decline";

  return {
    accent,
    bgTop,
    bgBottom,
    inner: `
      <!-- Left identity panel (x=20..418) -->
      <circle cx="34" cy="36" r="8" fill="${accent}"/>
      <text x="50" y="43" font-family="${FONT}" font-size="18" font-weight="800" fill="${accent}" letter-spacing="0.6">${escXml(truncate(kindLabel, 18))}</text>
      <rect x="330" y="19" width="80" height="30" rx="8" fill="#0F172A" stroke="${accent}" stroke-opacity="0.55" stroke-width="1.5"/>
      <text x="370" y="40" text-anchor="middle" font-family="${MONO}" font-size="17" font-weight="800" fill="#FFFFFF">${posText}</text>

      ${
        danger && item.dangerReason
          ? `<rect x="24" y="58" width="214" height="24" rx="6" fill="#9F1239" stroke="#FB7185" stroke-width="1.2"/>
             <text x="36" y="75" font-family="${FONT}" font-size="13" font-weight="800" fill="#FFE4E6">⚠ ${escXml(item.dangerReason)}</text>`
          : isSubagent
            ? `<rect x="24" y="58" width="114" height="24" rx="6" fill="#1E1B4B" stroke="#818CF8" stroke-width="1.2"/>
               <text x="81" y="75" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="800" fill="#C7D2FE">SUBAGENT</text>`
            : ""
      }

      <text x="24" y="${danger || isSubagent ? "116" : "96"}" font-family="${FONT}" font-size="25" font-weight="800" fill="#FFFFFF">${escXml(truncate(actorTitle, 23))}</text>
      ${
        item.parentThreadTitle
          ? `<text x="24" y="144" font-family="${FONT}" font-size="15" font-weight="600" fill="#94A3B8">↳ ${escXml(truncate(item.parentThreadTitle, 32))}</text>`
          : ""
      }

      <rect x="24" y="156" width="${Math.min(180, Math.max(76, item.projectName.length * 11 + 26))}" height="26" rx="7" fill="#0F172A" stroke="#334155" stroke-width="1.2"/>
      <text x="36" y="174" font-family="${FONT}" font-size="14" font-weight="700" fill="#CBD5E1">${escXml(truncate(item.projectName, 14))}</text>

      <!-- Divider -->
      <line x1="428" y1="22" x2="428" y2="178" stroke="${accent}" stroke-opacity="0.3" stroke-width="2"/>

      <!-- Right panoramic command box (x=448..1574) -->
      <rect x="448" y="22" width="1126" height="124" rx="12" fill="#070A10" stroke="${accent}" stroke-opacity="${danger ? "0.75" : "0.4"}" stroke-width="2"/>
      ${codeLinesSvg}
      ${
        hasMore
          ? `<rect x="1484" y="114" width="76" height="24" rx="6" fill="#1E293B"/>
             <text x="1522" y="131" text-anchor="middle" font-family="${MONO}" font-size="13" font-weight="700" fill="${accent}">↕ ${start + 1}-${Math.min(allLines.length, start + visibleCount)}/${allLines.length}</text>`
          : ""
      }

      <!-- Bottom context / legend strip -->
      <text x="452" y="176" font-family="${FONT}" font-size="15" font-weight="600" fill="${danger ? "#FDA4AF" : "#CBD5E1"}">${escXml(reasonText)}</text>
      <text x="1572" y="176" text-anchor="end" font-family="${FONT}" font-size="13" font-weight="700" fill="${accent}">${total > 1 ? "TURN DIAL 1: NEXT REQ · " : ""}${hasMore ? "DIAL 2: SCROLL · " : ""}PRESS CONFIRM ABOVE</text>
    `
  };
}

export function renderQuestionPanoramicFrame(
  item: PendingQuestionItem | null,
  questionIndex: number,
  optionPage: number,
  selectedLabels: string[],
  queueIndex: number,
  queueTotal: number
): PanoramicFrame {
  if (!item) {
    return {
      accent: "#10B981",
      bgTop: "#0B241D",
      bgBottom: "#070E0D",
      inner: `<text x="800" y="108" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="800" fill="#34D399">NO PENDING QUESTIONS</text>`
    };
  }

  const question = item.questions[questionIndex];
  const actorTitle = item.subagentTitle || item.threadTitle;
  const qBadge =
    item.questions.length > 1
      ? `Q${questionIndex + 1}/${item.questions.length}`
      : queueTotal > 1
        ? `${queueIndex + 1}/${queueTotal}`
        : "QUESTION";
  const questionText = question?.question || (item.detailsLoaded ? "Open in T3 Code to answer" : "Loading question…");
  const options = question?.options ?? [];
  const pageOptions = options.slice(optionPage * 4, optionPage * 4 + 4);

  const cardsSvg = [0, 1, 2, 3]
    .map((slot) => {
      const opt = pageOptions[slot];
      const x = 14 + slot * 400;
      const w = 372;
      if (!opt) {
        return `<rect x="${x}" y="94" width="${w}" height="88" rx="12" fill="#0B0E17" stroke="#1E293B" stroke-width="1.5"/>`;
      }
      const selected = selectedLabels.includes(opt.label);
      const border = selected ? "#34D399" : "#A855F7";
      const fill = selected ? "#0A2B22" : "#160D29";
      const num = optionPage * 4 + slot + 1;
      return `
        <rect x="${x}" y="94" width="${w}" height="88" rx="12" fill="${fill}" stroke="${border}" stroke-opacity="${selected ? "0.95" : "0.55"}" stroke-width="${selected ? "2.5" : "1.8"}"/>
        <rect x="${x + 14}" y="108" width="28" height="28" rx="7" fill="${selected ? "#10B981" : "#7E22CE"}"/>
        <text x="${x + 28}" y="128" text-anchor="middle" font-family="${MONO}" font-size="16" font-weight="800" fill="#FFFFFF">${selected ? "✓" : num}</text>
        <text x="${x + 52}" y="129" font-family="${FONT}" font-size="20" font-weight="800" fill="#FFFFFF">${escXml(truncate(opt.label, 24))}</text>
        <text x="${x + 16}" y="164" font-family="${FONT}" font-size="15" font-weight="600" fill="#CBD5E1">${escXml(truncate(opt.description || "Tap strip or key above to choose", 39))}</text>
      `;
    })
    .join("");

  return {
    accent: "#C084FC",
    bgTop: "#271040",
    bgBottom: "#0E0718",
    inner: `
      <circle cx="30" cy="36" r="8" fill="#C084FC"/>
      <text x="48" y="43" font-family="${FONT}" font-size="17" font-weight="800" fill="#E9D5FF">${escXml(qBadge)}</text>
      <rect x="${qBadge.length > 5 ? 160 : 120}" y="19" width="${Math.min(280, Math.max(120, actorTitle.length * 11 + 28))}" height="28" rx="8" fill="#0F172A" stroke="#C084FC" stroke-opacity="0.45"/>
      <text x="${(qBadge.length > 5 ? 160 : 120) + 14}" y="38" font-family="${FONT}" font-size="15" font-weight="700" fill="#E2E8F0">${escXml(truncate(actorTitle, 22))}</text>
      ${
        question?.multiSelect
          ? `<rect x="1430" y="19" width="146" height="28" rx="8" fill="#064E3B" stroke="#34D399"/>
             <text x="1503" y="38" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="800" fill="#6EE7B7">MULTI-SELECT</text>`
          : `<text x="1574" y="39" text-anchor="end" font-family="${FONT}" font-size="14" font-weight="700" fill="#D8B4FE">TAP OPTION ON STRIP OR KEY ABOVE</text>`
      }

      <text x="24" y="79" font-family="${FONT}" font-size="24" font-weight="800" fill="#FFFFFF">${escXml(truncate(questionText, 96))}</text>

      ${cardsSvg}
    `
  };
}

export function renderSnoozePanoramicFrame(
  thread: ThreadShell | null,
  projectName: string,
  defaultShortLabel = "1H",
  secondaryCount = 4,
  customMinutes: number | null = null
): PanoramicFrame {
  const title = thread?.title || "No focused thread";
  const snoozed = Boolean(thread && isThreadSnoozed(thread));
  const eta = snoozed && thread?.snoozedUntil ? formatResetCountdown(thread.snoozedUntil) : "";

  const customLabel =
    customMinutes !== null
      ? customMinutes < 60
        ? `${customMinutes} MIN`
        : customMinutes % 60 === 0
          ? `${customMinutes / 60} ${customMinutes === 60 ? "HOUR" : "HOURS"}`
          : `${Math.floor(customMinutes / 60)}H ${customMinutes % 60}M`
      : null;

  return {
    accent: customLabel ? "#38BDF8" : "#818CF8",
    bgTop: customLabel ? "#0B243E" : "#1A1D42",
    bgBottom: "#090B1A",
    inner: `
      <circle cx="32" cy="40" r="9" fill="${customLabel ? "#38BDF8" : "#818CF8"}"/>
      <text x="52" y="48" font-family="${FONT}" font-size="21" font-weight="800" fill="${customLabel ? "#7DD3FC" : "#A5B4FC"}" letter-spacing="0.8">${customLabel ? `CUSTOM SNOOZE · ${customLabel}` : `SNOOZE PRESETS (${secondaryCount} MORE)`}</text>
      <text x="1574" y="46" text-anchor="end" font-family="${FONT}" font-size="16" font-weight="700" fill="#94A3B8">${customLabel ? "PRESS DIAL 1 TO APPLY CUSTOM TIME" : `SHORT TAP = ${escXml(defaultShortLabel)} · TURN DIAL 1: CUSTOM`}</text>

      <text x="28" y="114" font-family="${FONT}" font-size="30" font-weight="800" fill="#FFFFFF">${escXml(truncate(title, 50))}</text>
      <rect x="28" y="138" width="${Math.min(220, Math.max(90, projectName.length * 12 + 28))}" height="30" rx="8" fill="#0F172A" stroke="#475569"/>
      <text x="42" y="159" font-family="${FONT}" font-size="16" font-weight="700" fill="#CBD5E1">${escXml(truncate(projectName, 16))}</text>

      ${
        customLabel
          ? `<rect x="1220" y="124" width="354" height="46" rx="11" fill="#0B3B59" stroke="#38BDF8" stroke-width="2"/>
             <text x="1397" y="154" text-anchor="middle" font-family="${FONT}" font-size="19" font-weight="800" fill="#FFFFFF">PRESS DIAL 1 · SNOOZE ${escXml(customLabel)}</text>`
          : snoozed
            ? `<rect x="1260" y="132" width="314" height="38" rx="10" fill="#362105" stroke="#F59E0B" stroke-width="1.8"/>
               <text x="1417" y="157" text-anchor="middle" font-family="${FONT}" font-size="17" font-weight="800" fill="#FCD34D">CURRENTLY SNOOZED · ${escXml(eta.toUpperCase())}</text>`
            : `<text x="1574" y="160" text-anchor="end" font-family="${FONT}" font-size="16" font-weight="700" fill="#818CF8">TAP KEY ABOVE · OR TURN DIAL 1 FOR CUSTOM DURATION</text>`
      }
    `
  };
}

export function renderNewChatBuilderPanoramicFrame(opts: {
  projectName: string;
  projectIdx: number;
  projectTotal: number;
  modelName: string;
  providerLabel: string;
  providerColor: string;
  modelScope: ModelCatalogScope;
  workspaceMode: "local" | "worktree" | "scratch";
  interactionMode: "default" | "plan";
}): PanoramicFrame {
  const wsColor =
    opts.workspaceMode === "worktree"
      ? "#10B981"
      : opts.workspaceMode === "scratch"
        ? "#F59E0B"
        : "#38BDF8";
  const wsLabel = opts.workspaceMode.toUpperCase();
  const isPlan = opts.interactionMode === "plan";

  return {
    accent: "#38BDF8",
    bgTop: "#0B1E34",
    bgBottom: "#070C15",
    inner: `
      <!-- Col 0 (x=0..400): DIAL 1 PROJECT -->
      <text x="24" y="38" font-family="${FONT}" font-size="15" font-weight="800" fill="#7DD3FC" letter-spacing="0.8">1 · PROJECT</text>
      <text x="376" y="38" text-anchor="end" font-family="${MONO}" font-size="16" font-weight="800" fill="#94A3B8">${opts.projectTotal > 0 ? `${opts.projectIdx + 1}/${opts.projectTotal}` : "0/0"}</text>
      <text x="24" y="106" font-family="${FONT}" font-size="30" font-weight="800" fill="#FFFFFF">${escXml(truncate(opts.projectName, 17))}</text>
      <text x="24" y="172" font-family="${FONT}" font-size="14" font-weight="700" fill="#64748B">TURN DIAL 1: PICK REPO</text>
      <line x1="400" y1="22" x2="400" y2="178" stroke="#38BDF8" stroke-opacity="0.28" stroke-width="2"/>

      <!-- Col 1 (x=400..800): DIAL 2 MODEL -->
      <text x="424" y="38" font-family="${FONT}" font-size="15" font-weight="800" fill="${opts.providerColor}" letter-spacing="0.8">2 · ${escXml(truncate(opts.providerLabel.toUpperCase(), 12))}</text>
      <rect x="688" y="18" width="90" height="26" rx="7" fill="#0F172A" stroke="${opts.modelScope === "favorites" ? "#F59E0B" : "#475569"}" stroke-width="1.5"/>
      <text x="733" y="36" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="800" fill="${opts.modelScope === "favorites" ? "#FCD34D" : "#CBD5E1"}">${opts.modelScope === "favorites" ? "★ FAVS" : "ALL"}</text>
      <text x="424" y="106" font-family="${FONT}" font-size="28" font-weight="800" fill="#FFFFFF">${escXml(truncate(opts.modelName, 18))}</text>
      <text x="424" y="172" font-family="${FONT}" font-size="14" font-weight="700" fill="#64748B">TURN: MODEL · TAP: FAVS/ALL</text>
      <line x1="800" y1="22" x2="800" y2="178" stroke="#38BDF8" stroke-opacity="0.28" stroke-width="2"/>

      <!-- Col 2 (x=800..1200): DIAL 3 WORKSPACE / MODE -->
      <text x="824" y="38" font-family="${FONT}" font-size="15" font-weight="800" fill="${wsColor}" letter-spacing="0.8">3 · WORKSPACE</text>
      <rect x="1064" y="18" width="114" height="26" rx="7" fill="${isPlan ? "#581C87" : "#1E293B"}" stroke="${isPlan ? "#C084FC" : "#475569"}" stroke-width="1.5"/>
      <text x="1121" y="36" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="800" fill="${isPlan ? "#F3E8FF" : "#CBD5E1"}">${isPlan ? "✦ PLAN" : "CODE"}</text>
      <text x="824" y="106" font-family="${FONT}" font-size="30" font-weight="800" fill="${wsColor}">${wsLabel}</text>
      <text x="824" y="172" font-family="${FONT}" font-size="14" font-weight="700" fill="#64748B">TURN: WS · TAP: CODE/PLAN</text>
      <line x1="1200" y1="22" x2="1200" y2="178" stroke="#38BDF8" stroke-opacity="0.28" stroke-width="2"/>

      <!-- Col 3 (x=1200..1600): DIAL 4 LAUNCH -->
      <rect x="1222" y="26" width="354" height="148" rx="14" fill="#0A2E22" stroke="#10B981" stroke-width="2.5"/>
      <text x="1399" y="76" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="800" fill="#6EE7B7" letter-spacing="1.0">4 · READY TO CREATE</text>
      <text x="1399" y="118" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="800" fill="#FFFFFF">▶ LAUNCH CHAT</text>
      <text x="1399" y="152" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="700" fill="#34D399">PRESS / TAP DIAL 4</text>
    `
  };
}

export function renderNewChatProjectPanoramicFrame(
  page: number,
  totalPages: number,
  projectCount: number
): PanoramicFrame {
  return {
    accent: "#38BDF8",
    bgTop: "#0B243E",
    bgBottom: "#070E18",
    inner: `
      <circle cx="32" cy="40" r="9" fill="#38BDF8"/>
      <text x="52" y="48" font-family="${FONT}" font-size="21" font-weight="800" fill="#7DD3FC" letter-spacing="0.8">NEW CHAT · PICK PROJECT</text>
      <text x="1574" y="46" text-anchor="end" font-family="${MONO}" font-size="18" font-weight="800" fill="#CBD5E1">${projectCount} PROJECTS · PAGE ${page + 1}/${Math.max(1, totalPages)}</text>

      <text x="28" y="114" font-family="${FONT}" font-size="28" font-weight="800" fill="#FFFFFF">Tap a project to launch with its default model</text>
      <text x="28" y="158" font-family="${FONT}" font-size="19" font-weight="700" fill="#38BDF8">Hold any project key to pick a specific model first</text>
      <text x="1574" y="158" text-anchor="end" font-family="${FONT}" font-size="16" font-weight="700" fill="#94A3B8">${totalPages > 1 ? "TURN DIAL 1: MORE PROJECTS · " : ""}PRESS BACK TO CANCEL</text>
    `
  };
}

export function renderNewChatEnvPanoramicFrame(
  projectName: string,
  page: number,
  totalPages: number,
  linkedCount: number
): PanoramicFrame {
  return {
    accent: "#38BDF8",
    bgTop: "#0B243E",
    bgBottom: "#070E18",
    inner: `
      <circle cx="32" cy="40" r="9" fill="#38BDF8"/>
      <text x="52" y="48" font-family="${FONT}" font-size="21" font-weight="800" fill="#7DD3FC" letter-spacing="0.8">NEW CHAT · PICK ENVIRONMENT</text>
      <text x="1574" y="46" text-anchor="end" font-family="${MONO}" font-size="18" font-weight="800" fill="#CBD5E1">${linkedCount > 0 ? `${linkedCount} LINKED · ` : ""}PAGE ${page + 1}/${Math.max(1, totalPages)}</text>

      <text x="28" y="114" font-family="${FONT}" font-size="28" font-weight="800" fill="#FFFFFF">Launch in ${escXml(truncate(projectName, 26))} (Local, Worktree, Scratch, or Linked)</text>
      <text x="28" y="158" font-family="${FONT}" font-size="19" font-weight="700" fill="#38BDF8">Hold any workspace key to pick a specific model first</text>
      <text x="1574" y="158" text-anchor="end" font-family="${FONT}" font-size="16" font-weight="700" fill="#94A3B8">TAP BACK UNDER YOUR FINGER TO CANCEL</text>
    `
  };
}

export function renderNewChatModelPanoramicFrame(
  projectName: string,
  scope: ModelCatalogScope,
  interactionMode: "default" | "plan",
  page: number,
  totalPages: number
): PanoramicFrame {
  const isPlan = interactionMode === "plan";
  const scopeLabel = scope === "favorites" ? "★ FAVORITES" : "ALL MODELS";
  return {
    accent: isPlan ? "#C084FC" : "#10B981",
    bgTop: isPlan ? "#271040" : "#0A2B22",
    bgBottom: "#070E12",
    inner: `
      <circle cx="32" cy="40" r="9" fill="${isPlan ? "#C084FC" : "#10B981"}"/>
      <text x="52" y="48" font-family="${FONT}" font-size="21" font-weight="800" fill="${isPlan ? "#E9D5FF" : "#6EE7B7"}" letter-spacing="0.8">NEW CHAT · PICK MODEL</text>

      <rect x="420" y="21" width="${Math.min(260, Math.max(110, projectName.length * 13 + 32))}" height="34" rx="9" fill="#0F172A" stroke="#38BDF8" stroke-width="1.5"/>
      <text x="436" y="44" font-family="${FONT}" font-size="17" font-weight="800" fill="#FFFFFF">${escXml(truncate(projectName, 18))}</text>

      <rect x="1156" y="21" width="160" height="34" rx="9" fill="#1E293B" stroke="${scope === "favorites" ? "#F59E0B" : "#64748B"}" stroke-width="1.5"/>
      <text x="1236" y="44" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="800" fill="${scope === "favorites" ? "#FCD34D" : "#CBD5E1"}">${scopeLabel}</text>

      <rect x="1332" y="21" width="144" height="34" rx="9" fill="${isPlan ? "#581C87" : "#1E293B"}" stroke="${isPlan ? "#C084FC" : "#475569"}" stroke-width="1.5"/>
      <text x="1404" y="44" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="800" fill="${isPlan ? "#F3E8FF" : "#CBD5E1"}">${isPlan ? "✦ PLAN" : "CODE"}</text>

      <text x="1574" y="45" text-anchor="end" font-family="${MONO}" font-size="18" font-weight="800" fill="#CBD5E1">${page + 1}/${Math.max(1, totalPages)}</text>

      <text x="28" y="118" font-family="${FONT}" font-size="28" font-weight="800" fill="#FFFFFF">Tap any model above to create &amp; open in ${escXml(truncate(projectName, 24))}</text>
      <text x="28" y="160" font-family="${FONT}" font-size="16" font-weight="700" fill="#94A3B8">TURN DIAL 1: PAGE MODELS · TAP DIAL 2: FAVS/ALL · TAP DIAL 3: CODE/PLAN · BACK: PROJECTS</text>
    `
  };
}

export function renderPromptsPanoramicFrame(
  thread: ThreadShell | null,
  projectName: string,
  suggestion: PromptSuggestion | null,
  selectedLabel?: string,
  selectedPromptText?: string
): PanoramicFrame {
  const title = thread?.title || "No focused thread";
  const running = Boolean(thread && isThreadRunning(thread));
  const modeLabel = running ? "STEER ACTIVE RUN" : "SEND FOLLOW-UP";
  const hasSuggestion = Boolean(suggestion && thread && suggestion.threadId === thread.id);
  const headerTag = selectedLabel
    ? `SELECTED · ${selectedLabel} (PRESS DIAL 1 TO SEND)`
    : hasSuggestion
      ? "✨ PREDICTED NEXT PROMPT"
      : "PROMPT DRAWER";
  const bodyText =
    selectedPromptText ??
    (hasSuggestion
      ? suggestion!.text
      : thread?.hasActionableProposedPlan
        ? "Proposed plan is ready — tap IMPLEMENT above to execute it."
        : "Pick any quick prompt on the keys above, or turn Dial 1 to preview.");

  return {
    accent: "#A78BFA",
    bgTop: "#22143E",
    bgBottom: "#0A0817",
    inner: `
      <circle cx="32" cy="38" r="8" fill="#A78BFA"/>
      <text x="50" y="45" font-family="${FONT}" font-size="19" font-weight="800" fill="#C4B5FD" letter-spacing="0.6">${modeLabel}</text>
      <text x="360" y="45" font-family="${FONT}" font-size="18" font-weight="700" fill="#94A3B8">${escXml(truncate(title, 36))} · ${escXml(truncate(projectName, 14))}</text>
      <text x="1574" y="45" text-anchor="end" font-family="${FONT}" font-size="15" font-weight="700" fill="#22D3EE">TURN DIAL 1: PREVIEW · PRESS: SEND</text>

      <rect x="24" y="64" width="1552" height="106" rx="12" fill="#080B14" stroke="${hasSuggestion || selectedLabel ? "#22D3EE" : "#4C1D95"}" stroke-opacity="0.7" stroke-width="2"/>
      <text x="44" y="96" font-family="${FONT}" font-size="14" font-weight="800" fill="${hasSuggestion || selectedLabel ? "#22D3EE" : "#A78BFA"}" letter-spacing="0.8">${escXml(truncate(headerTag, 64))}</text>
      <text x="44" y="138" font-family="${FONT}" font-size="25" font-weight="700" fill="#FFFFFF">${escXml(truncate(bodyText, 88))}</text>
    `
  };
}

export function renderFleetPanoramicFrame(
  stats: FleetStats,
  page: number,
  totalPages: number
): PanoramicFrame {
  return {
    accent: "#38BDF8",
    bgTop: "#0B223C",
    bgBottom: "#070D17",
    inner: `
      <circle cx="32" cy="40" r="9" fill="#38BDF8"/>
      <text x="52" y="48" font-family="${FONT}" font-size="21" font-weight="800" fill="#7DD3FC" letter-spacing="0.8">FLEET SWITCHBOARD</text>
      <text x="1574" y="46" text-anchor="end" font-family="${MONO}" font-size="19" font-weight="800" fill="#CBD5E1">PAGE ${page + 1}/${Math.max(1, totalPages)} · TURN DIAL 1 TO PAGE</text>

      <g transform="translate(28, 86)">
        <rect width="260" height="72" rx="12" fill="#0F172A" stroke="#38BDF8" stroke-width="2"/>
        <text x="24" y="47" font-family="${MONO}" font-size="30" font-weight="800" fill="#38BDF8">▶ ${stats.running}</text>
        <text x="122" y="44" font-family="${FONT}" font-size="17" font-weight="800" fill="#E2E8F0">RUNNING</text>

        <rect x="284" width="260" height="72" rx="12" fill="#2D1A05" stroke="#F59E0B" stroke-width="2"/>
        <text x="308" y="47" font-family="${MONO}" font-size="30" font-weight="800" fill="#F59E0B">! ${stats.approvals}</text>
        <text x="406" y="44" font-family="${FONT}" font-size="17" font-weight="800" fill="#FDE68A">APPROVE</text>

        <rect x="568" width="260" height="72" rx="12" fill="#271040" stroke="#C084FC" stroke-width="2"/>
        <text x="592" y="47" font-family="${MONO}" font-size="30" font-weight="800" fill="#C084FC">? ${stats.questions}</text>
        <text x="690" y="44" font-family="${FONT}" font-size="17" font-weight="800" fill="#E9D5FF">INPUT</text>

        <rect x="852" width="260" height="72" rx="12" fill="#300D17" stroke="#FB7185" stroke-width="2"/>
        <text x="876" y="47" font-family="${MONO}" font-size="30" font-weight="800" fill="#FB7185">✕ ${stats.failed}</text>
        <text x="974" y="44" font-family="${FONT}" font-size="17" font-weight="800" fill="#FFE4E6">FAILED</text>

        <text x="1144" y="34" font-family="${FONT}" font-size="18" font-weight="800" fill="#FFFFFF">TAP ANY TILE ABOVE</text>
        <text x="1144" y="60" font-family="${FONT}" font-size="15" font-weight="600" fill="#94A3B8">Focuses thread or opens its approval</text>
      </g>
    `
  };
}

export function renderThreadToolsPanoramicFrame(
  thread: ThreadShell | null,
  projectName: string
): PanoramicFrame {
  if (!thread) {
    return {
      accent: "#60A5FA",
      bgTop: "#111D33",
      bgBottom: "#080C15",
      inner: `<text x="800" y="108" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="800" fill="#94A3B8">NO THREAD FOCUSED</text>`
    };
  }
  const pr = primaryPullRequest(thread);
  const snoozed = isThreadSnoozed(thread);
  const eta = snoozed && thread.snoozedUntil ? formatResetCountdown(thread.snoozedUntil) : "";
  const modelShort = shortModelLabel(thread.modelSelection?.model ?? "");

  return {
    accent: "#60A5FA",
    bgTop: "#111D33",
    bgBottom: "#080C15",
    inner: `
      <circle cx="32" cy="38" r="8" fill="#60A5FA"/>
      <text x="50" y="45" font-family="${FONT}" font-size="19" font-weight="800" fill="#93C5FD" letter-spacing="0.8">THREAD TOOLS</text>
      <text x="1574" y="45" text-anchor="end" font-family="${FONT}" font-size="15" font-weight="700" fill="#94A3B8">${escXml(modelShort.toUpperCase())}${thread.branch ? ` · ${escXml(truncate(thread.branch, 32))}` : ""}</text>

      <text x="28" y="110" font-family="${FONT}" font-size="30" font-weight="800" fill="#FFFFFF">${escXml(truncate(thread.title || "Untitled", 56))}</text>

      <rect x="28" y="134" width="${Math.min(220, Math.max(90, projectName.length * 12 + 28))}" height="32" rx="8" fill="#0F172A" stroke="#334155"/>
      <text x="42" y="156" font-family="${FONT}" font-size="16" font-weight="700" fill="#CBD5E1">${escXml(truncate(projectName, 16))}</text>
      ${
        pr
          ? `<rect x="268" y="134" width="128" height="32" rx="8" fill="#064E3B" stroke="#34D399"/>
             <text x="332" y="156" text-anchor="middle" font-family="${MONO}" font-size="16" font-weight="800" fill="#6EE7B7">PR #${pr.number}</text>`
          : ""
      }
      ${
        snoozed
          ? `<rect x="1310" y="134" width="264" height="32" rx="8" fill="#1A1D42" stroke="#818CF8"/>
             <text x="1442" y="156" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="800" fill="#C7D2FE">SNOOZED · ${escXml(eta.toUpperCase())}</text>`
          : ""
      }
    `
  };
}

export type OverlayKeyGlyph =
  | "check"
  | "checkbox"
  | "cross"
  | "back"
  | "prev"
  | "next"
  | "open"
  | "clock"
  | "spark"
  | "send"
  | "pin"
  | "stop"
  | "sync"
  | "folder"
  | "branch"
  | "server"
  | "model"
  | "mic"
  | "number";

export function renderOverlayActionKey(opts: {
  topLabel: string;
  mainLabel: string;
  subLabel?: string;
  accent: string;
  bgTop: string;
  bgBottom?: string;
  glyph: OverlayKeyGlyph;
  glyphText?: string;
  glow?: boolean;
  disabled?: boolean;
}): string {
  const accent = opts.disabled ? "#334155" : opts.accent;
  const bgTop = opts.disabled ? "#0F1420" : opts.bgTop;
  const bgBottom = opts.bgBottom ?? "#080C14";
  const textMain = opts.disabled ? "#64748B" : "#FFFFFF";
  const textSub = opts.disabled ? "#475569" : accent;

  let iconSvg = "";
  switch (opts.glyph) {
    case "check":
      iconSvg = `<circle cx="72" cy="63" r="23" fill="${accent}" opacity="0.22" stroke="${accent}" stroke-width="2.5"/>
        <path d="M61 63l8 8 15-16" fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    case "checkbox":
      iconSvg = `<rect x="50" y="42" width="44" height="44" rx="11" fill="${accent}" opacity="0.16" stroke="${accent}" stroke-width="2.5"/>
        <path d="M61 64l7 7 15-15" fill="none" stroke="${accent}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    case "cross":
      iconSvg = `<circle cx="72" cy="63" r="23" fill="${accent}" opacity="0.22" stroke="${accent}" stroke-width="2.5"/>
        <path d="M62 53l20 20M82 53L62 73" stroke="${accent}" stroke-width="5" stroke-linecap="round"/>`;
      break;
    case "back":
      iconSvg = `<circle cx="72" cy="63" r="22" fill="${accent}" opacity="0.16" stroke="${accent}" stroke-width="2"/>
        <path d="M78 53L64 63l14 10" fill="none" stroke="${accent}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    case "prev":
      iconSvg = `<path d="M80 48L58 63l22 15z" fill="${accent}" opacity="0.9"/>`;
      break;
    case "next":
      iconSvg = `<path d="M64 48l22 15-22 15z" fill="${accent}" opacity="0.9"/>`;
      break;
    case "open":
      iconSvg = `<rect x="52" y="45" width="38" height="36" rx="7" fill="none" stroke="${accent}" stroke-width="3.2"/>
        <path d="M72 63l18-18M78 45h12v12" fill="none" stroke="${accent}" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    case "clock":
      iconSvg = `<circle cx="72" cy="62" r="22" fill="${accent}" opacity="0.16" stroke="${accent}" stroke-width="2.8"/>
        <path d="M72 50v13l9 6" fill="none" stroke="${accent}" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    case "spark":
      iconSvg = `<path d="M72 39l6 17 17 6-17 6-6 17-6-17-17-6 17-6z" fill="${accent}" opacity="0.95"/>`;
      break;
    case "send":
      iconSvg = `<path d="M48 64l46-18-17 44-8-19-21-7z" fill="${accent}" opacity="0.9"/>`;
      break;
    case "pin":
      iconSvg = `<circle cx="72" cy="62" r="22" fill="${accent}" opacity="0.18" stroke="${accent}" stroke-width="2.5"/>
        <text x="72" y="71" text-anchor="middle" font-family="${FONT}" font-size="26" font-weight="800" fill="${accent}">★</text>`;
      break;
    case "stop":
      iconSvg = `<rect x="53" y="44" width="38" height="38" rx="8" fill="${accent}" opacity="0.9"/>`;
      break;
    case "sync":
      iconSvg = `<circle cx="72" cy="63" r="20" fill="none" stroke="${accent}" stroke-width="4" stroke-dasharray="88 34"/>`;
      break;
    case "folder":
      iconSvg = `<path d="M46 50a6 6 0 0 1 6-6h13l6 6h21a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6H52a6 6 0 0 1-6-6V50z" fill="${accent}" opacity="0.22" stroke="${accent}" stroke-width="2.8" stroke-linejoin="round"/>`;
      break;
    case "branch":
      iconSvg = `<circle cx="58" cy="48" r="6" fill="none" stroke="${accent}" stroke-width="3"/>
        <circle cx="58" cy="78" r="6" fill="none" stroke="${accent}" stroke-width="3"/>
        <circle cx="86" cy="54" r="6" fill="none" stroke="${accent}" stroke-width="3"/>
        <path d="M58 54v18M86 60c0 12-28 6-28 18" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>`;
      break;
    case "server":
      iconSvg = `<rect x="48" y="44" width="48" height="16" rx="5" fill="${accent}" opacity="0.2" stroke="${accent}" stroke-width="2.4"/>
        <rect x="48" y="65" width="48" height="16" rx="5" fill="${accent}" opacity="0.2" stroke="${accent}" stroke-width="2.4"/>
        <circle cx="58" cy="52" r="2.5" fill="${accent}"/>
        <circle cx="58" cy="73" r="2.5" fill="${accent}"/>`;
      break;
    case "model":
      iconSvg = `<rect x="50" y="43" width="44" height="38" rx="9" fill="${accent}" opacity="0.2" stroke="${accent}" stroke-width="2.5"/>
        <circle cx="72" cy="62" r="8" fill="${accent}"/>`;
      break;
    case "mic":
      iconSvg = `<rect x="63" y="40" width="18" height="29" rx="9" fill="${accent}" opacity="0.28" stroke="${accent}" stroke-width="3"/>
        <path d="M55 61a17 17 0 0 0 34 0" fill="none" stroke="${accent}" stroke-width="3.2" stroke-linecap="round"/>
        <path d="M72 78v8M63 86h18" fill="none" stroke="${accent}" stroke-width="3.2" stroke-linecap="round"/>`;
      break;
    case "number":
      iconSvg = `<circle cx="72" cy="62" r="23" fill="${accent}" opacity="0.22" stroke="${accent}" stroke-width="2.5"/>
        <text x="72" y="72" text-anchor="middle" font-family="${MONO}" font-size="26" font-weight="800" fill="#FFFFFF">${escXml(opts.glyphText ?? "1")}</text>`;
      break;
  }

  return keyShell(
    accent,
    bgTop,
    bgBottom,
    `
    <text x="72" y="28" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="${textSub}" letter-spacing="0.7">${escXml(truncate(opts.topLabel, 15))}</text>
    ${iconSvg}
    <text x="72" y="109" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="800" fill="${textMain}">${escXml(truncate(opts.mainLabel, 12))}</text>
    ${opts.subLabel ? `<text x="72" y="128" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="600" fill="#94A3B8">${escXml(truncate(opts.subLabel, 16))}</text>` : ""}
  `,
    Boolean(opts.glow && !opts.disabled)
  );
}

// ============================================================
// MULTI-DEVICE RENDERERS: KEYPAD CARDS, INFO ROW & +XL DIALS
// ============================================================

export interface InfoCardKeyOpts {
  accent: string;
  bgTop: string;
  bgBottom?: string;
  topLabel: string;
  lines: string[];
  footer?: string;
  mono?: boolean;
  glow?: boolean;
  center?: boolean;
}

/**
 * Renders a self-contained, bezel-safe 144x144 info card for keypad-only devices
 * (MK.2, XL, Neo, Mini) where physical key bezels make sliced panoramic text unreadable.
 */
export function renderInfoCardKey(opts: InfoCardKeyOpts): string {
  const bgBottom = opts.bgBottom ?? "#080C14";
  const font = opts.mono ? MONO : FONT;
  const maxLines = opts.lines.slice(0, 4);
  const lineCount = maxLines.length;
  const fontSize = opts.mono
    ? lineCount >= 4
      ? 12
      : 13
    : lineCount <= 2
      ? 16
      : lineCount === 3
        ? 14
        : 12;
  const lineHeight = opts.mono ? (lineCount >= 4 ? 19 : 21) : lineCount <= 2 ? 24 : 20;
  const startY =
    lineCount === 1
      ? 78
      : lineCount === 2
        ? 64
        : lineCount === 3
          ? 56
          : 50;
  const xPos = opts.center ? 72 : 16;
  const anchor = opts.center ? ' text-anchor="middle"' : "";
  const maxChars = opts.mono ? 15 : opts.center ? 13 : 14;

  const bodySvg = maxLines
    .map(
      (line, idx) =>
        `<text x="${xPos}" y="${startY + idx * lineHeight}"${anchor} font-family="${font}" font-size="${fontSize}" font-weight="${idx === 0 && !opts.mono ? 800 : 700}" fill="${idx === 0 ? "#FFFFFF" : "#E2E8F0"}">${escXml(truncate(line, maxChars))}</text>`
    )
    .join("\n");

  return keyShell(
    opts.accent,
    opts.bgTop,
    bgBottom,
    `
    <text x="72" y="26" text-anchor="middle" font-family="${FONT}" font-size="10.5" font-weight="800" fill="${opts.accent}" letter-spacing="0.7">${escXml(truncate(opts.topLabel, 16))}</text>
    ${bodySvg}
    ${
      opts.footer
        ? `<text x="72" y="130" text-anchor="middle" font-family="${FONT}" font-size="9.5" font-weight="700" fill="#94A3B8">${escXml(truncate(opts.footer, 18))}</text>`
        : ""
    }
  `,
    Boolean(opts.glow)
  );
}

/**
 * Splits a command/question/prompt cleanly across `maxCards` keycaps on word/path boundaries
 * so no character is ever sliced in half by a physical Stream Deck key bezel.
 */
export function chunkTextForKeyCards(
  text: string,
  charsPerLine: number,
  linesPerCard: number,
  maxCards: number
): string[][] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const allLines: string[] = [];
  let rem = cleaned;
  while (rem.length > 0 && allLines.length < linesPerCard * maxCards) {
    if (rem.length <= charsPerLine) {
      allLines.push(rem);
      rem = "";
      break;
    }
    let split = rem.lastIndexOf(" ", charsPerLine);
    if (split < Math.floor(charsPerLine * 0.35)) {
      const slash = rem.lastIndexOf("/", charsPerLine);
      if (slash > 0) split = slash + 1;
      else split = charsPerLine;
    }
    allLines.push(rem.slice(0, split).trimEnd());
    rem = rem.slice(split).trimStart();
  }
  if (rem.length > 0 && allLines.length > 0) {
    const last = allLines[allLines.length - 1]!;
    allLines[allLines.length - 1] =
      last.length >= charsPerLine ? `${last.slice(0, charsPerLine - 1)}…` : `${last}…`;
  }
  const cards: string[][] = [];
  for (let i = 0; i < allLines.length; i += linesPerCard) {
    cards.push(allLines.slice(i, i + linesPerCard));
  }
  return cards.slice(0, maxCards);
}

export function renderModelPickerPanoramicFrame(
  scope: ModelCatalogScope,
  page: number,
  totalPages: number,
  modelCount: number
): PanoramicFrame {
  return {
    accent: "#38BDF8",
    bgTop: "#0D1E34",
    bgBottom: "#080C15",
    inner: `
      <circle cx="32" cy="40" r="8" fill="#38BDF8"/>
      <text x="50" y="47" font-family="${FONT}" font-size="19" font-weight="800" fill="#7DD3FC" letter-spacing="0.8">MODEL PICKER · ${scope === "favorites" ? "★ FAVORITES" : "ALL MODELS"}</text>
      <text x="1574" y="47" text-anchor="end" font-family="${MONO}" font-size="17" font-weight="700" fill="#94A3B8">${modelCount} READY · PAGE ${page + 1}/${Math.max(1, totalPages)}</text>
      <text x="28" y="114" font-family="${FONT}" font-size="30" font-weight="800" fill="#FFFFFF">Tap any model key to apply immediately</text>
      <text x="28" y="160" font-family="${FONT}" font-size="17" font-weight="600" fill="#94A3B8">Toggle ★ FAVS / ALL to switch catalog scope · Tap BACK to cancel</text>
    `
  };
}

export function renderModeEffortPanoramicFrame(
  thread: ThreadShell | null,
  entry: ModelCatalogEntry | null
): PanoramicFrame {
  const modeLabel = thread ? thread.runtimeMode.toUpperCase() : "NO THREAD";
  const isPlan = thread?.interactionMode === "plan";
  const effort =
    thread && entry?.reasoningDescriptor
      ? resolveReasoningValue(thread.modelSelection, entry.reasoningDescriptor) || "DEFAULT"
      : "N/A";
  return {
    accent: isPlan ? "#C084FC" : "#10B981",
    bgTop: isPlan ? "#26103C" : "#0A251D",
    bgBottom: "#080C15",
    inner: `
      <circle cx="32" cy="40" r="8" fill="${isPlan ? "#C084FC" : "#10B981"}"/>
      <text x="50" y="47" font-family="${FONT}" font-size="19" font-weight="800" fill="${isPlan ? "#E9D5FF" : "#6EE7B7"}" letter-spacing="0.8">MODE &amp; REASONING EFFORT</text>
      <text x="1574" y="47" text-anchor="end" font-family="${MONO}" font-size="18" font-weight="800" fill="#FFFFFF">${escXml(modeLabel)} · ${isPlan ? "PLAN" : "CODE"} · ${escXml(effort.toUpperCase())}</text>
      <text x="28" y="114" font-family="${FONT}" font-size="28" font-weight="800" fill="#FFFFFF">Tap any runtime mode, Plan toggle, or effort level above</text>
      <text x="28" y="160" font-family="${FONT}" font-size="17" font-weight="600" fill="#94A3B8">${escXml(truncate(thread?.title ?? "No thread focused", 64))}</text>
    `
  };
}

/** 144x144 Keypad card for Thread Navigator (MK.2 / XL / Neo / Mini / Mobile / Virtual). */
export function renderThreadKey(
  thread: ThreadShell | null,
  projectName: string,
  filterMode: ThreadFilterMode,
  index: number,
  total: number,
  connected: boolean,
  toast?: ToastNotice
): string {
  if (toast) {
    return keyShell(
      toast.accent,
      "#10253A",
      "#090D16",
      `<text x="72" y="76" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="800" fill="${toast.accent}">${escXml(truncate(toast.label, 12))}</text>`,
      true
    );
  }
  if (!connected || !thread) {
    return keyShell(
      "#475569",
      "#121826",
      "#090C12",
      `
      <text x="72" y="28" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="#64748B">THREADS</text>
      <text x="72" y="78" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="800" fill="#94A3B8">${connected ? "NO THREADS" : "OFFLINE"}</text>
      <text x="72" y="126" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="700" fill="#475569">${escXml(filterMode.toUpperCase())}</text>
    `
    );
  }

  const snoozed = isThreadSnoozed(thread);
  const eta = snoozed && thread.snoozedUntil ? formatResetCountdown(thread.snoozedUntil) : "";
  const status = classifyThread(thread);
  const theme = CATEGORY_THEME[status];
  const color = snoozed ? "#818CF8" : theme.accent;
  const badge = snoozed ? `ZZZ ${eta.toUpperCase()}` : theme.badge;
  const lines = wrapLines(thread.title || "Untitled", 14, 2);

  return keyShell(
    color,
    status === "approval" ? "#2E1C06" : status === "question" ? "#26103D" : "#0E1C2E",
    "#080C14",
    `
    <circle cx="20" cy="24" r="4.5" fill="${color}"/>
    <text x="30" y="28" font-family="${FONT}" font-size="10" font-weight="800" fill="${color}">${escXml(truncate(badge, 10))}</text>
    <text x="128" y="28" text-anchor="end" font-family="${MONO}" font-size="10" font-weight="700" fill="#94A3B8">${index + 1}/${total}</text>

    <text x="72" y="60" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="800" fill="#FFFFFF">${escXml(lines[0] ?? "")}</text>
    ${lines[1] ? `<text x="72" y="78" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="800" fill="#E2E8F0">${escXml(lines[1])}</text>` : ""}

    <rect x="20" y="92" width="104" height="19" rx="5" fill="#0F172A" stroke="#334155"/>
    <text x="72" y="105" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="700" fill="#CBD5E1">${escXml(truncate(projectName, 13))}</text>
    <text x="72" y="129" text-anchor="middle" font-family="${FONT}" font-size="9" font-weight="700" fill="#64748B">TAP: NEXT · HOLD: LIST</text>
  `,
    status === "approval" || status === "question"
  );
}

/** 144x144 Keypad card for Model & Provider (MK.2 / XL / Neo / Mini). */
export function renderModelKey(
  thread: ThreadShell | null,
  entry: ModelCatalogEntry | null,
  scope: ModelCatalogScope,
  toast?: ToastNotice
): string {
  if (toast) {
    return keyShell(
      toast.accent,
      "#10253A",
      "#090D16",
      `<text x="72" y="76" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="800" fill="${toast.accent}">${escXml(truncate(toast.label, 12))}</text>`,
      true
    );
  }
  const accent = entry?.accentColor ?? "#38BDF8";
  const providerLabel = entry?.providerLabel ?? "MODEL";
  const modelName = entry?.shortName ?? shortModelLabel(thread?.modelSelection?.model ?? "Default");
  const lines = wrapLines(modelName, 11, 2);

  return keyShell(
    accent,
    "#121A2C",
    "#080C14",
    `
    <text x="72" y="26" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="${accent}" letter-spacing="0.6">${escXml(truncate(providerLabel.toUpperCase(), 13))}</text>
    <text x="72" y="${lines[1] ? 64 : 74}" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="800" fill="#FFFFFF">${escXml(lines[0] ?? "MODEL")}</text>
    ${lines[1] ? `<text x="72" y="86" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="800" fill="#E2E8F0">${escXml(lines[1])}</text>` : ""}
    <rect x="34" y="96" width="76" height="18" rx="6" fill="#0F172A" stroke="${scope === "favorites" ? "#F59E0B" : "#475569"}"/>
    <text x="72" y="109" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="800" fill="${scope === "favorites" ? "#FCD34D" : "#CBD5E1"}">${scope === "favorites" ? "★ FAVS" : "ALL"}</text>
    <text x="72" y="130" text-anchor="middle" font-family="${FONT}" font-size="9" font-weight="700" fill="#64748B">TAP: PICK MODEL</text>
  `
  );
}

/** 144x144 Keypad card for Mode & Effort (MK.2 / XL / Neo / Mini). */
export function renderModeEffortKey(
  thread: ThreadShell | null,
  entry: ModelCatalogEntry | null,
  toast?: ToastNotice
): string {
  if (toast) {
    return keyShell(
      toast.accent,
      "#10253A",
      "#090D16",
      `<text x="72" y="76" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="800" fill="${toast.accent}">${escXml(truncate(toast.label, 12))}</text>`,
      true
    );
  }
  if (!thread) {
    return keyShell(
      "#475569",
      "#121826",
      "#090C12",
      `<text x="72" y="78" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="800" fill="#64748B">NO THREAD</text>`
    );
  }

  const isPlan = thread.interactionMode === "plan";
  const accent = isPlan ? "#C084FC" : "#10B981";
  const modeShort =
    thread.runtimeMode === "approval-required"
      ? "ASK"
      : thread.runtimeMode === "auto-accept-edits"
        ? "EDITS"
        : thread.runtimeMode === "full-access"
          ? "FULL"
          : "AUTO";

  const desc = entry?.reasoningDescriptor;
  const effortVal = desc ? resolveReasoningValue(thread.modelSelection, desc) : undefined;
  const effortOpt = desc?.options?.find((o) => o.id === effortVal);
  const effortLabel = (effortOpt?.label ?? effortVal ?? "STD").toUpperCase();

  return keyShell(
    accent,
    isPlan ? "#25103B" : "#0A251D",
    "#080C14",
    `
    <text x="72" y="26" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="${accent}" letter-spacing="0.7">${isPlan ? "✦ PLAN MODE" : "CODE MODE"}</text>
    <text x="72" y="66" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="800" fill="#FFFFFF">${escXml(modeShort)}</text>
    <rect x="26" y="79" width="92" height="24" rx="7" fill="#0F172A" stroke="#38BDF8" stroke-opacity="0.6"/>
    <text x="72" y="95" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="800" fill="#7DD3FC">${escXml(truncate(effortLabel, 10))}</text>
    <text x="72" y="128" text-anchor="middle" font-family="${FONT}" font-size="9" font-weight="700" fill="#64748B">TAP: EDIT · HOLD: PLAN</text>
  `,
    isPlan
  );
}

/** 144x144 Keypad card for Usage Radar (MK.2 / XL / Neo / Mini). */
export function renderUsageKey(
  card: UsageCard | null,
  index: number,
  total: number,
  connected: boolean,
  toast?: ToastNotice
): string {
  if (toast) {
    return keyShell(
      toast.accent,
      "#10253A",
      "#090D16",
      `<text x="72" y="76" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="800" fill="${toast.accent}">${escXml(truncate(toast.label, 12))}</text>`,
      true
    );
  }
  if (!connected || !card) {
    return keyShell(
      "#475569",
      "#121826",
      "#090C12",
      `
      <text x="72" y="28" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="#64748B">USAGE</text>
      <text x="72" y="78" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="800" fill="#94A3B8">${connected ? "NO LIMITS" : "OFFLINE"}</text>
      <text x="72" y="126" text-anchor="middle" font-family="${FONT}" font-size="9" font-weight="700" fill="#475569">HOLD: REFRESH</text>
    `
    );
  }

  if (card.unavailable && !card.sessionWindow && !card.weeklyWindow && !card.extraWindow) {
    return keyShell(
      "#F59E0B",
      "#241807",
      "#090C12",
      `
      <text x="72" y="26" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="${card.accentColor}">${escXml(truncate(card.label.toUpperCase(), 11))} ${index + 1}/${total}</text>
      <text x="72" y="70" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="800" fill="#FBBF24">⚠ EXPIRED</text>
      <text x="72" y="96" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="700" fill="#CBD5E1">RENEW SIGN-IN</text>
      <text x="72" y="128" text-anchor="middle" font-family="${FONT}" font-size="9" font-weight="700" fill="#F59E0B">HOLD: REFRESH</text>
    `
    );
  }

  const w1 = card.sessionWindow ?? card.weeklyWindow;
  const w2 = card.sessionWindow ? (card.weeklyWindow ?? card.extraWindow) : card.extraWindow;
  const pct1 = Math.max(0, Math.min(100, Math.round(w1?.usedPercent ?? 0)));
  const pct2 = Math.max(0, Math.min(100, Math.round(w2?.usedPercent ?? 0)));
  const c1 = pct1 >= 85 ? "#EF4444" : pct1 >= 65 ? "#F59E0B" : "#10B981";
  const c2 = pct2 >= 85 ? "#EF4444" : pct2 >= 65 ? "#F59E0B" : "#10B981";

  return keyShell(
    card.accentColor,
    "#101929",
    "#080C14",
    `
    <text x="18" y="27" font-family="${FONT}" font-size="11" font-weight="800" fill="#FFFFFF">${escXml(truncate(card.label.toUpperCase(), 9))}</text>
    <text x="128" y="27" text-anchor="end" font-family="${MONO}" font-size="10" font-weight="700" fill="#94A3B8">${index + 1}/${total}</text>

    <text x="18" y="54" font-family="${FONT}" font-size="10" font-weight="700" fill="#94A3B8">${card.sessionWindow ? "SESS" : "WEEK"}</text>
    <text x="128" y="54" text-anchor="end" font-family="${MONO}" font-size="12" font-weight="800" fill="${c1}">${pct1}%</text>
    <rect x="18" y="60" width="110" height="10" rx="5" fill="#1E293B"/>
    <rect x="18" y="60" width="${Math.max(6, Math.round(1.1 * pct1))}" height="10" rx="5" fill="${c1}"/>

    ${
      w2
        ? `<text x="18" y="92" font-family="${FONT}" font-size="10" font-weight="700" fill="#94A3B8">WEEK</text>
           <text x="128" y="92" text-anchor="end" font-family="${MONO}" font-size="12" font-weight="800" fill="${c2}">${pct2}%</text>
           <rect x="18" y="98" width="110" height="10" rx="5" fill="#1E293B"/>
           <rect x="18" y="98" width="${Math.max(6, Math.round(1.1 * pct2))}" height="10" rx="5" fill="${c2}"/>`
        : ""
    }
    <text x="72" y="130" text-anchor="middle" font-family="${FONT}" font-size="9" font-weight="700" fill="#64748B">TAP: NEXT · HOLD: SYNC</text>
  `
  );
}

/** 400x200 Encoder canvas for Stream Deck+ XL Dial 5 (Quick Prompt Scrubber). */
export function renderQuickPromptDialCanvas(
  thread: ThreadShell | null,
  label: string,
  previewText: string,
  index: number,
  total: number,
  isAiNext: boolean,
  toast?: ToastNotice
): string {
  if (toast) {
    return dialShell(
      toast.accent,
      "#0F2027",
      "#080C14",
      `<text x="200" y="108" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="800" fill="${toast.accent}">${escXml(truncate(toast.label, 20))}</text>`
    );
  }
  const accent = isAiNext ? "#22D3EE" : thread && isThreadRunning(thread) ? "#A78BFA" : "#38BDF8";
  const lines = wrapLines(previewText, 30, 2);
  return dialShell(
    accent,
    isAiNext ? "#082936" : "#12172B",
    "#080C14",
    `
    <text x="24" y="38" font-family="${FONT}" font-size="16" font-weight="800" fill="${accent}" letter-spacing="0.8">${isAiNext ? "✨ AI NEXT" : thread && isThreadRunning(thread) ? "STEER PROMPT" : "QUICK PROMPT"}</text>
    <text x="376" y="38" text-anchor="end" font-family="${MONO}" font-size="16" font-weight="700" fill="#94A3B8">${index + 1}/${total}</text>
    <text x="24" y="80" font-family="${FONT}" font-size="24" font-weight="800" fill="#FFFFFF">${escXml(truncate(label, 20))}</text>
    <text x="24" y="114" font-family="${FONT}" font-size="15" font-weight="600" fill="#CBD5E1">${escXml(lines[0] ?? "")}</text>
    ${lines[1] ? `<text x="24" y="136" font-family="${FONT}" font-size="15" font-weight="600" fill="#94A3B8">${escXml(lines[1])}</text>` : ""}
    <text x="24" y="176" font-family="${FONT}" font-size="13" font-weight="700" fill="#64748B">TURN: PICK · PRESS/TAP: SEND</text>
  `
  );
}

/** 400x200 Encoder canvas for Stream Deck+ XL Dial 6 (Snooze Presets Scrubber). */
export function renderSnoozeDialCanvas(
  thread: ThreadShell | null,
  presetLabel: string,
  presetDetail: string,
  index: number,
  total: number,
  connected: boolean,
  toast?: ToastNotice
): string {
  if (toast) {
    return dialShell(
      toast.accent,
      "#17193B",
      "#080C14",
      `<text x="200" y="108" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="800" fill="${toast.accent}">${escXml(truncate(toast.label, 20))}</text>`
    );
  }
  const snoozed = Boolean(thread && isThreadSnoozed(thread));
  const eta = snoozed && thread?.snoozedUntil ? formatResetCountdown(thread.snoozedUntil) : "";
  const accent = !connected ? "#FB7185" : snoozed ? "#10B981" : "#818CF8";
  return dialShell(
    accent,
    snoozed ? "#0A2820" : "#171A3C",
    "#080C14",
    `
    <text x="24" y="38" font-family="${FONT}" font-size="16" font-weight="800" fill="${accent}" letter-spacing="0.8">${snoozed ? `SNOOZED · ${escXml(eta.toUpperCase())}` : "SNOOZE PRESET"}</text>
    <text x="376" y="38" text-anchor="end" font-family="${MONO}" font-size="16" font-weight="700" fill="#94A3B8">${index + 1}/${total}</text>
    <text x="24" y="96" font-family="${FONT}" font-size="32" font-weight="800" fill="#FFFFFF">${snoozed ? "UNSNOOZE" : escXml(truncate(presetLabel, 14))}</text>
    <text x="24" y="132" font-family="${FONT}" font-size="16" font-weight="600" fill="#CBD5E1">${snoozed ? "Press or tap to wake thread now" : escXml(truncate(presetDetail, 28))}</text>
    <text x="24" y="176" font-family="${FONT}" font-size="13" font-weight="700" fill="#64748B">TURN: PRESET · PRESS/TAP: APPLY</text>
  `
  );
}

// ============================================================
// T3 NATIVE VOICE STT RENDERERS (KEY, DIAL & 1600x200 STRIP)
// ============================================================

function formatVoiceTimer(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

export function renderVoiceKey(
  thread: ThreadShell | null,
  connected: boolean,
  triggerMode: "toggle" | "ptt" = "toggle",
  toast?: ToastNotice
): string {
  if (toast) {
    return keyShell(
      toast.accent,
      "#1F0D1B",
      "#0A0710",
      `<text x="72" y="76" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="800" fill="${toast.accent}">${escXml(truncate(toast.label, 12))}</text>`
    );
  }
  const enabled = connected && Boolean(thread);
  const accent = enabled ? "#F43F5E" : "#475569";
  const sub = !connected
    ? "OFFLINE"
    : !thread
      ? "NO THREAD"
      : triggerMode === "ptt"
        ? "HOLD TO TALK"
        : "TAP OR HOLD";
  return renderOverlayActionKey({
    topLabel: "T3 VOICE",
    mainLabel: "SPEAK",
    subLabel: sub,
    accent,
    bgTop: enabled ? "#2E0F1E" : "#111622",
    glyph: "mic",
    glow: enabled,
    disabled: !enabled
  });
}

export function renderVoiceDialCanvas(
  thread: ThreadShell | null,
  projectName: string,
  connected: boolean,
  autoSend: boolean,
  toast?: ToastNotice
): string {
  if (toast) {
    return dialShell(
      toast.accent,
      "#290F1E",
      "#080C14",
      `<text x="200" y="108" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="800" fill="${toast.accent}">${escXml(truncate(toast.label, 20))}</text>`
    );
  }
  const accent = connected && thread ? "#F43F5E" : "#64748B";
  return dialShell(
    accent,
    connected && thread ? "#2B0F1E" : "#121824",
    "#080C14",
    `
    <text x="24" y="38" font-family="${FONT}" font-size="16" font-weight="800" fill="${accent}" letter-spacing="0.8">T3 NATIVE VOICE</text>
    <text x="376" y="38" text-anchor="end" font-family="${FONT}" font-size="14" font-weight="700" fill="#FDA4AF">${autoSend ? "AUTO-SEND" : "DRAFT"}</text>
    <text x="24" y="96" font-family="${FONT}" font-size="30" font-weight="800" fill="#FFFFFF">${connected && thread ? "PRESS TO SPEAK" : "OFFLINE"}</text>
    <text x="24" y="134" font-family="${FONT}" font-size="16" font-weight="600" fill="#CBD5E1">${thread ? escXml(truncate(`${projectName}: ${thread.title}`, 30)) : "Focus a thread to dictate"}</text>
    <text x="24" y="176" font-family="${FONT}" font-size="13" font-weight="700" fill="#94A3B8">PRESS OR TAP: START T3 STT</text>
  `
  );
}

export function renderVoicePanoramicFrame(
  ov: Extract<import("./types.js").DeckOverlay, { kind: "voice" }>,
  thread: ThreadShell | null,
  projectName: string
): PanoramicFrame {
  const threadTitle = thread?.title || "Focused Thread";
  const timerStr = formatVoiceTimer(ov.durationSec);

  if (ov.phase === "missing-model") {
    const modelLabel = ov.modelName || ov.modelId || "Parakeet Unified English 0.6B";
    return {
      accent: "#F59E0B",
      bgTop: "#2A1E08",
      bgBottom: "#0B0A08",
      inner: `
        <circle cx="44" cy="40" r="10" fill="#F59E0B"/>
        <text x="68" y="48" font-family="${FONT}" font-size="22" font-weight="800" fill="#FBBF24" letter-spacing="0.8">T3 VOICE MODEL NOT DOWNLOADED</text>
        <text x="1558" y="46" text-anchor="end" font-family="${MONO}" font-size="18" font-weight="700" fill="#94A3B8">T3 BUILT-IN STT</text>
        <text x="36" y="106" font-family="${FONT}" font-size="28" font-weight="800" fill="#FFFFFF">${escXml(truncate(modelLabel, 48))}</text>
        <text x="36" y="150" font-family="${FONT}" font-size="18" font-weight="600" fill="#CBD5E1">Tap DOWNLOAD MODEL above to install it directly in T3 Code (~700 MB, local Metal GPU).</text>
      `
    };
  }

  if (ov.phase === "downloading") {
    const modelLabel = ov.modelName || ov.modelId || "T3 Voice Model";
    return {
      accent: "#38BDF8",
      bgTop: "#0B2438",
      bgBottom: "#070D14",
      inner: `
        <circle cx="44" cy="40" r="10" fill="#38BDF8"/>
        <text x="68" y="48" font-family="${FONT}" font-size="22" font-weight="800" fill="#7DD3FC" letter-spacing="0.8">DOWNLOADING T3 VOICE MODEL…</text>
        <text x="36" y="106" font-family="${FONT}" font-size="28" font-weight="800" fill="#FFFFFF">${escXml(truncate(modelLabel, 48))}</text>
        <text x="36" y="150" font-family="${FONT}" font-size="18" font-weight="600" fill="#94A3B8">T3 Code is downloading the local STT model. Recording unlocks automatically when ready.</text>
      `
    };
  }

  if (ov.phase === "error") {
    return {
      accent: "#FB7185",
      bgTop: "#2E0E17",
      bgBottom: "#0B070B",
      inner: `
        <circle cx="44" cy="40" r="10" fill="#FB7185"/>
        <text x="68" y="48" font-family="${FONT}" font-size="22" font-weight="800" fill="#FDA4AF" letter-spacing="0.8">VOICE ERROR</text>
        <text x="36" y="108" font-family="${FONT}" font-size="24" font-weight="700" fill="#FFFFFF">${escXml(truncate(ov.errorMessage || "Unable to transcribe audio.", 80))}</text>
        <text x="36" y="154" font-family="${FONT}" font-size="17" font-weight="600" fill="#94A3B8">Tap RETRY to try again or BACK to return to Mission Control.</text>
      `
    };
  }

  if (ov.phase === "listening") {
    // 16-bar live VU waveform meter driven by real mic RMS level
    const bars: string[] = [];
    const barCount = 16;
    const baseLevel = Math.max(0.08, Math.min(1, ov.level));
    for (let i = 0; i < barCount; i++) {
      const wave = 0.45 + 0.55 * Math.abs(Math.sin(i * 0.72 + ov.durationSec * 6.5));
      const h = Math.max(10, Math.round(baseLevel * wave * 74));
      const x = 36 + i * 21;
      const y = 136 - Math.round(h / 2);
      const fill = i % 3 === 0 ? "#FB7185" : "#F43F5E";
      bars.push(`<rect x="${x}" y="${y}" width="13" height="${h}" rx="6" fill="${fill}" opacity="0.92"/>`);
    }

    const liveText = [ov.committed, ov.tentative].filter(Boolean).join(" ").trim();
    const captionLines = liveText
      ? wrapCodeLines(liveText, 54).slice(-3)
      : ["Listening via T3 Code built-in STT…", "Speak naturally — tap STOP when done."];

    const captionSvg = captionLines
      .map((line, i) => {
        const isLast = i === captionLines.length - 1;
        const fill = !liveText ? "#94A3B8" : isLast && ov.tentative ? "#7DD3FC" : "#FFFFFF";
        return `<text x="424" y="${66 + i * 34}" font-family="${FONT}" font-size="23" font-weight="${isLast ? 700 : 800}" fill="${fill}">${escXml(truncate(line, 56))}</text>`;
      })
      .join("\n");

    return {
      accent: "#F43F5E",
      bgTop: "#2E0C1A",
      bgBottom: "#0A0710",
      inner: `
        <circle cx="44" cy="36" r="10" fill="#F43F5E"/>
        <text x="64" y="44" font-family="${FONT}" font-size="20" font-weight="800" fill="#FDA4AF" letter-spacing="0.8">LIVE VOICE · ${timerStr}</text>
        <text x="36" y="76" font-family="${FONT}" font-size="16" font-weight="700" fill="#CBD5E1">${escXml(truncate(`${projectName}: ${threadTitle}`, 28))}</text>
        ${bars.join("\n")}
        <rect x="404" y="20" width="1172" height="160" rx="12" fill="#0B0F1A" stroke="#F43F5E" stroke-opacity="0.45" stroke-width="1.5"/>
        ${captionSvg}
        <text x="1556" y="168" text-anchor="end" font-family="${FONT}" font-size="14" font-weight="800" fill="#FDA4AF">${ov.autoSend ? "STOP → AUTO-SEND" : "STOP → REVIEW DRAFT"}</text>
      `
    };
  }

  if (ov.phase === "transcribing" || ov.phase === "sending") {
    const label = ov.phase === "sending" ? "DISPATCHING PROMPT TO T3…" : "TRANSCRIBING WITH T3 STT…";
    const preview = (ov.draftText || ov.committed || ov.tentative).trim();
    return {
      accent: "#22D3EE",
      bgTop: "#0B2433",
      bgBottom: "#070C14",
      inner: `
        <circle cx="44" cy="40" r="10" fill="#22D3EE"/>
        <text x="68" y="48" font-family="${FONT}" font-size="22" font-weight="800" fill="#67E8F9" letter-spacing="0.8">${label}</text>
        <text x="1558" y="46" text-anchor="end" font-family="${MONO}" font-size="18" font-weight="700" fill="#94A3B8">${timerStr} AUDIO</text>
        <text x="36" y="114" font-family="${FONT}" font-size="26" font-weight="700" fill="#FFFFFF">${escXml(truncate(preview || `Target: ${projectName} / ${threadTitle}`, 72))}</text>
        <text x="36" y="156" font-family="${FONT}" font-size="16" font-weight="600" fill="#94A3B8">Using T3 Code's native speech engine</text>
      `
    };
  }

  // phase === "draft"
  const draft = ov.draftText.trim();
  const words = draft ? draft.split(/\s+/).length : 0;
  const wrapped = wrapCodeLines(draft || "(No speech detected — tap RE-RECORD)", 58);
  const maxOffset = Math.max(0, wrapped.length - 3);
  const offset = Math.min(ov.scrollLine, maxOffset);
  const visible = wrapped.slice(offset, offset + 3);
  const isRunning = Boolean(thread && isThreadRunning(thread));
  const actionHint = isRunning ? "TAP STEER OR QUEUE ABOVE" : "TAP SEND ABOVE";

  return {
    accent: "#10B981",
    bgTop: "#09261E",
    bgBottom: "#070E0D",
    inner: `
      <circle cx="44" cy="36" r="10" fill="#10B981"/>
      <text x="64" y="44" font-family="${FONT}" font-size="20" font-weight="800" fill="#6EE7B7" letter-spacing="0.8">VOICE DRAFT READY</text>
      <text x="36" y="88" font-family="${FONT}" font-size="22" font-weight="800" fill="#FFFFFF">${escXml(truncate(threadTitle, 22))}</text>
      <text x="36" y="122" font-family="${FONT}" font-size="16" font-weight="700" fill="#94A3B8">${escXml(truncate(projectName, 24))}</text>
      <text x="36" y="164" font-family="${MONO}" font-size="15" font-weight="700" fill="#34D399">${words} WORDS · ${timerStr}</text>
      <rect x="404" y="20" width="1172" height="160" rx="12" fill="#0B1318" stroke="#10B981" stroke-opacity="0.45" stroke-width="1.5"/>
      ${visible
        .map(
          (line, i) =>
            `<text x="424" y="${64 + i * 36}" font-family="${FONT}" font-size="24" font-weight="700" fill="#FFFFFF">${escXml(truncate(line, 58))}</text>`
        )
        .join("\n")}
      <text x="1556" y="168" text-anchor="end" font-family="${FONT}" font-size="14" font-weight="800" fill="#6EE7B7">${wrapped.length > 3 ? `TURN DIAL TO SCROLL · ${actionHint}` : actionHint}</text>
    `
  };
}
