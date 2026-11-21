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
  toast?: ToastNotice
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
    return keyShell(
      "#F59E0B",
      "#362105",
      "#140C03",
      `
      <text x="72" y="29" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="#FCD34D" letter-spacing="0.8">${escXml(kindLabel)}</text>
      <circle cx="72" cy="64" r="24" fill="#10B981" opacity="0.22" stroke="#34D399" stroke-width="2.5"/>
      <path d="M61 64l8 8 15-16" fill="none" stroke="#34D399" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="72" y="110" text-anchor="middle" font-family="${FONT}" font-size="17" font-weight="800" fill="#FFFFFF">APPROVE</text>
      <text x="72" y="128" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="600" fill="#FCD34D">HOLD: SESSION</text>
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
    <circle cx="72" cy="63" r="22" fill="${accent}" opacity="0.16" stroke="${accent}" stroke-width="2.5"/>
    ${
      settled
        ? `<path d="M62 63l7 7 14-14" fill="none" stroke="${accent}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<path d="M62 63h20M72 53v20" fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round"/>`
    }
    <text x="72" y="110" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="800" fill="#FFFFFF">${settled ? "UNSETTLE" : "SETTLE"}</text>
    <text x="72" y="128" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="600" fill="#94A3B8">HOLD: ${pinned ? "UNPIN" : "PIN"}</text>
  `
  );
}

export function renderNewThreadKey(projectName?: string, toast?: ToastNotice): string {
  if (toast) return renderToastKey(toast);
  return keyShell(
    "#38BDF8",
    "#0D213A",
    "#080F1C",
    `
    <text x="72" y="29" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="#7DD3FC" letter-spacing="0.9">T3 CODE</text>
    <circle cx="72" cy="64" r="23" fill="#38BDF8" opacity="0.18" stroke="#38BDF8" stroke-width="2.5"/>
    <path d="M72 52v24M60 64h24" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/>
    <text x="72" y="110" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="800" fill="#FFFFFF">NEW CHAT</text>
    <text x="72" y="128" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="600" fill="#7DD3FC">${escXml(truncate(projectName || "COMPOSER", 14))}</text>
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
    <text x="72" y="129" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="600" fill="#94A3B8">HOLD: OPEN</text>
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
  toast?: ToastNotice
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
  const accent = snoozed ? "#F59E0B" : "#818CF8";
  const bgTop = snoozed ? "#2B1C06" : "#181B3A";

  return keyShell(
    accent,
    bgTop,
    "#090D16",
    `
    <text x="72" y="29" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="${accent}" letter-spacing="0.8">${snoozed ? "SNOOZED" : "TRIAGE"}</text>
    <path d="M84 52a20 20 0 1 1-22 28 16 16 0 0 0 22-28z" fill="${accent}" opacity="0.9"/>
    <text x="72" y="110" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="800" fill="#FFFFFF">${snoozed ? "UNSNOOZE" : "SNOOZE 1H"}</text>
    <text x="72" y="128" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="600" fill="#94A3B8">HOLD: RESYNC</text>
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
  <rect width="400" height="200" fill="url(#dbg)"/>
  <rect x="4" y="4" width="392" height="192" rx="16" fill="none" stroke="${accent}" stroke-opacity="0.45" stroke-width="3"/>
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
  toast?: ToastNotice
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
  const theme = CATEGORY_THEME[cat];
  const pr = primaryPullRequest(thread);
  const modelShort = shortModelLabel(thread.modelSelection?.model ?? "");
  const posText = total > 0 ? `${index + 1}/${total}` : "0/0";

  return dialShell(
    theme.accent,
    theme.bgTop,
    theme.bgBottom,
    `
    <circle cx="30" cy="36" r="9" fill="${theme.accent}"/>
    <text x="48" y="43" font-family="${FONT}" font-size="19" font-weight="800" fill="${theme.accent}" letter-spacing="0.6">${theme.badge}</text>
    <rect x="210" y="19" width="106" height="30" rx="8" fill="#0F172A" stroke="${theme.accent}" stroke-opacity="0.45" stroke-width="1.5"/>
    <text x="263" y="40" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="800" fill="#E2E8F0">${filterBadge}</text>
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

    <text x="24" y="177" font-family="${FONT}" font-size="17" font-weight="600" fill="#94A3B8">${escXml(truncate(modelShort, 24))}</text>
    <text x="378" y="177" text-anchor="end" font-family="${FONT}" font-size="14" font-weight="700" fill="${theme.accent}">PRESS: OPEN</text>
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
