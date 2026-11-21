import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ModelSelection,
  ProjectShell,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  RuntimeMode,
  ServerConfigPayload,
  ServerProvider,
  ServerSettingsPayload,
  ThreadShell,
  UsageLimitSourceSnapshot
} from "./types.js";

const execFileAsync = promisify(execFile);

const ORCHESTRATION_PROTOCOL_VERSION = 2;
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 10000];
const PING_INTERVAL_MS = 25_000;
const RPC_TIMEOUT_MS = 15_000;

interface ServerRuntimeState {
  version: number;
  pid: number;
  port: number;
  origin: string;
  serverVersion?: string;
}

interface StoredSession {
  sessionId: string;
  token: string;
  createdAt: string;
}

interface RpcPendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

type StreamHandler = (values: unknown[]) => void;

export interface T3ClientCallbacks {
  onConnectionChange: (state: "connecting" | "connected" | "offline", detail?: string) => void;
  onConfigSnapshot: (config: ServerConfigPayload) => void;
  onProvidersUpdated: (providers: ServerProvider[]) => void;
  onSettingsUpdated?: (settings: ServerSettingsPayload) => void;
  onUsageLimitSourcesUpdated: (sources: UsageLimitSourceSnapshot[]) => void;
  onShellSnapshot: (
    projects: ProjectShell[],
    threads: ThreadShell[],
    isEnrichmentOnly: boolean
  ) => void;
  onProjectUpdated: (project: ProjectShell) => void;
  onProjectRemoved: (projectId: string) => void;
  onThreadUpdated: (thread: ThreadShell, location: "active" | "archive") => void;
  onThreadRemoved: (threadId: string, location: "active" | "archive") => void;
}

export interface T3ClientOptions {
  t3Home?: string;
  t3Bin?: string;
  sessionFilePath?: string;
  logger?: (level: "info" | "warn" | "error", msg: string) => void;
}

function defaultT3Home(): string {
  return process.env.T3CODE_HOME || path.join(os.homedir(), ".t3");
}

function defaultT3Bin(t3Home: string): string {
  return process.env.T3CODE_CLI_PATH || path.join(t3Home, "bin", "t3");
}

function defaultSessionFilePath(): string {
  return path.join(os.homedir(), ".config", "t3-deck", "session.json");
}

function newId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

export class T3Client {
  private readonly t3Home: string;
  private readonly t3Bin: string;
  private readonly sessionFilePath: string;
  private readonly log: (level: "info" | "warn" | "error", msg: string) => void;
  private readonly callbacks: T3ClientCallbacks;

  private ws: WebSocket | null = null;
  private stopped = false;
  private connecting = false;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;

  private nextRequestId = 1;
  private pendingCalls = new Map<string, RpcPendingCall>();
  private streamHandlers = new Map<string, StreamHandler>();
  private currentOrigin: string | null = null;

  constructor(callbacks: T3ClientCallbacks, options: T3ClientOptions = {}) {
    this.callbacks = callbacks;
    this.t3Home = options.t3Home ?? defaultT3Home();
    this.t3Bin = options.t3Bin ?? defaultT3Bin(this.t3Home);
    this.sessionFilePath = options.sessionFilePath ?? defaultSessionFilePath();
    this.log = options.logger ?? (() => {});
  }

  get origin(): string | null {
    return this.currentOrigin;
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.rejectAllPending("T3 client stopped");
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore close errors
      }
      this.ws = null;
    }
  }

  async reconnectNow(): Promise<void> {
    this.clearTimers();
    this.reconnectAttempt = 0;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    await this.connect();
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(reason: string): void {
    if (this.stopped) return;
    if (this.reconnectTimer) return;
    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)] ?? 10000;
    this.reconnectAttempt += 1;
    this.callbacks.onConnectionChange("offline", reason);
    this.log("warn", `Scheduling reconnect in ${delay}ms (${reason})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private readRuntimeState(): ServerRuntimeState | null {
    const statePath = path.join(this.t3Home, "userdata", "server-runtime.json");
    try {
      const raw = fs.readFileSync(statePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<ServerRuntimeState>;
      if (typeof parsed.origin === "string" && parsed.origin.startsWith("http")) {
        return parsed as ServerRuntimeState;
      }
    } catch {
      // server not running yet
    }
    return null;
  }

  private loadStoredSession(): StoredSession | null {
    try {
      const raw = fs.readFileSync(this.sessionFilePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredSession>;
      if (typeof parsed.token === "string" && parsed.token.length > 0 && typeof parsed.sessionId === "string") {
        return parsed as StoredSession;
      }
    } catch {
      // no stored session yet
    }
    return null;
  }

  private saveStoredSession(session: StoredSession): void {
    const dir = path.dirname(this.sessionFilePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.sessionFilePath, `${JSON.stringify(session, null, 2)}\n`, {
      mode: 0o600
    });
  }

  private async issueNewSession(): Promise<StoredSession> {
    this.log("info", "Minting scoped T3 Code bearer session via t3 CLI");
    const { stdout } = await execFileAsync(
      this.t3Bin,
      [
        "auth",
        "session",
        "issue",
        "--scope",
        "orchestration:read",
        "--scope",
        "orchestration:operate",
        "--label",
        "T3 Deck (Stream Deck)",
        "--ttl",
        "365d",
        "--json"
      ],
      {
        env: { ...process.env, T3CODE_HOME: this.t3Home },
        timeout: 15_000
      }
    );
    const parsed = JSON.parse(stdout) as { sessionId?: string; token?: string };
    if (!parsed.sessionId || !parsed.token) {
      throw new Error("t3 auth session issue did not return sessionId and token");
    }
    const session: StoredSession = {
      sessionId: parsed.sessionId,
      token: parsed.token,
      createdAt: new Date().toISOString()
    };
    this.saveStoredSession(session);
    return session;
  }

  private async mintWebSocketTicket(origin: string, forceNewSession = false): Promise<string> {
    let session = forceNewSession ? null : this.loadStoredSession();
    if (!session) {
      session = await this.issueNewSession();
    }

    const requestTicket = async (token: string): Promise<Response> =>
      fetch(`${origin}/api/auth/websocket-ticket`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });

    let res = await requestTicket(session.token);
    if ((res.status === 401 || res.status === 403) && !forceNewSession) {
      this.log("warn", "Stored T3 session rejected (401/403); issuing a fresh scoped session");
      session = await this.issueNewSession();
      res = await requestTicket(session.token);
    }

    if (!res.ok) {
      throw new Error(`WebSocket ticket request failed: HTTP ${res.status}`);
    }

    const body = (await res.json()) as { ticket?: string };
    if (!body.ticket) {
      throw new Error("WebSocket ticket response missing ticket field");
    }
    return body.ticket;
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting) return;
    this.connecting = true;
    this.callbacks.onConnectionChange("connecting");

    try {
      const runtime = this.readRuntimeState();
      if (!runtime) {
        this.connecting = false;
        this.scheduleReconnect("T3 Code offline");
        return;
      }

      this.currentOrigin = runtime.origin;
      const ticket = await this.mintWebSocketTicket(runtime.origin);
      if (this.stopped) {
        this.connecting = false;
        return;
      }

      const wsOrigin = runtime.origin.replace(/^http/i, "ws");
      const wsUrl = `${wsOrigin}/ws?orchestrationProtocol=${ORCHESTRATION_PROTOCOL_VERSION}&wsTicket=${encodeURIComponent(ticket)}`;

      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("WebSocket open timeout")), 10_000);
        ws.addEventListener(
          "open",
          () => {
            clearTimeout(timeout);
            resolve();
          },
          { once: true }
        );
        ws.addEventListener(
          "error",
          () => {
            clearTimeout(timeout);
            reject(new Error("WebSocket handshake failed"));
          },
          { once: true }
        );
      });

      if (this.stopped || this.ws !== ws) {
        ws.close();
        this.connecting = false;
        return;
      }

      this.connecting = false;
      this.reconnectAttempt = 0;
      this.streamHandlers.clear();
      this.callbacks.onConnectionChange("connected", runtime.origin);
      this.log("info", `Connected to T3 Code server at ${runtime.origin}`);

      ws.addEventListener("message", (ev) => {
        this.handleMessage(String(ev.data));
      });

      ws.addEventListener("close", (ev) => {
        if (this.ws === ws) {
          this.ws = null;
          this.clearTimers();
          this.streamHandlers.clear();
          this.rejectAllPending(`WebSocket closed (${ev.code})`);
          this.scheduleReconnect(`Disconnected (${ev.code})`);
        }
      });

      ws.addEventListener("error", () => {
        this.log("warn", "WebSocket error event");
      });

      this.pingTimer = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ _tag: "Ping" }));
        }
      }, PING_INTERVAL_MS);

      await this.bootstrapStreams();
    } catch (err) {
      this.connecting = false;
      const message = err instanceof Error ? err.message : String(err);
      this.log("error", `Connect failed: ${message}`);
      this.scheduleReconnect(message);
    }
  }

  private async bootstrapStreams(): Promise<void> {
    // 1. Fetch initial full server config (environmentId, providers, models, usageLimits)
    try {
      const cfg = (await this.callRpc("server.getConfig", {})) as ServerConfigPayload;
      this.callbacks.onConfigSnapshot(cfg);
    } catch (err) {
      this.log("error", `server.getConfig failed: ${String(err)}`);
    }

    // 2. Subscribe to real-time server config & usage limit updates
    this.subscribeStream(
      "subscribeServerConfig",
      {
        usageLimitSources: true,
        workspaceSnapshotsOnDemand: true
      },
      (values) => {
        for (const raw of values) {
          const ev = raw as {
            type?: string;
            payload?: {
              config?: ServerConfigPayload;
              providers?: ServerProvider[];
              settings?: ServerSettingsPayload;
              sources?: UsageLimitSourceSnapshot[];
            };
          };
          if (ev.type === "snapshot" && ev.payload?.config) {
            this.callbacks.onConfigSnapshot(ev.payload.config);
          } else if (ev.type === "providerStatuses" && ev.payload?.providers) {
            this.callbacks.onProvidersUpdated(ev.payload.providers);
          } else if (ev.type === "settingsUpdated" && ev.payload?.settings) {
            this.callbacks.onSettingsUpdated?.(ev.payload.settings);
          } else if (ev.type === "usageLimitSourcesUpdated" && ev.payload?.sources) {
            this.callbacks.onUsageLimitSourcesUpdated(ev.payload.sources);
          }
        }
      }
    );

    // 3. Subscribe to real-time orchestration shell stream (all projects + threads + live status)
    this.subscribeStream(
      "orchestration.subscribeShell",
      { omitIdleSubagents: true },
      (values) => {
        for (const raw of values) {
          const item = raw as {
            kind?: string;
            snapshot?: {
              projects?: ProjectShell[];
              threads?: ThreadShell[];
            };
            resolvedRepositoryIdentityRoots?: string[];
            project?: ProjectShell;
            projectId?: string;
            thread?: ThreadShell;
            threadId?: string;
            location?: "active" | "archive";
          };

          switch (item.kind) {
            case "snapshot":
              if (item.snapshot) {
                this.callbacks.onShellSnapshot(
                  item.snapshot.projects ?? [],
                  item.snapshot.threads ?? [],
                  item.resolvedRepositoryIdentityRoots !== undefined
                );
              }
              break;
            case "project.updated":
              if (item.project) this.callbacks.onProjectUpdated(item.project);
              break;
            case "project.removed":
              if (item.projectId) this.callbacks.onProjectRemoved(item.projectId);
              break;
            case "thread.updated":
              if (item.thread) {
                this.callbacks.onThreadUpdated(item.thread, item.location ?? "active");
              }
              break;
            case "thread.removed":
              if (item.threadId) {
                this.callbacks.onThreadRemoved(item.threadId, item.location ?? "active");
              }
              break;
            default:
              break;
          }
        }
      }
    );
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const tag = msg._tag;
    if (tag === "Pong") return;

    const reqId = msg.requestId !== undefined ? String(msg.requestId) : undefined;
    if (!reqId) return;

    if (tag === "Chunk") {
      // Acknowledge every chunk promptly so the server keeps streaming
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ _tag: "Ack", requestId: reqId }));
      }
      const handler = this.streamHandlers.get(reqId);
      const values = Array.isArray(msg.values) ? msg.values : [];
      if (handler && values.length > 0) {
        try {
          handler(values);
        } catch (err) {
          this.log("error", `Stream handler error: ${String(err)}`);
        }
      }
      return;
    }

    if (tag === "Exit") {
      this.streamHandlers.delete(reqId);
      const pending = this.pendingCalls.get(reqId);
      if (!pending) return;
      this.pendingCalls.delete(reqId);
      clearTimeout(pending.timer);

      const exit = msg.exit as
        | { _tag: "Success"; value: unknown }
        | { _tag: "Failure"; cause?: unknown }
        | undefined;
      if (exit && exit._tag === "Success") {
        pending.resolve(exit.value);
      } else {
        const detail = exit ? JSON.stringify(exit.cause ?? exit).slice(0, 300) : "Unknown RPC failure";
        pending.reject(new Error(detail));
      }
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [, call] of this.pendingCalls) {
      clearTimeout(call.timer);
      call.reject(new Error(reason));
    }
    this.pendingCalls.clear();
  }

  callRpc(tag: string, payload: unknown): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Not connected to T3 Code"));
    }
    const id = String(this.nextRequestId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(id);
        reject(new Error(`RPC timeout: ${tag}`));
      }, RPC_TIMEOUT_MS);

      this.pendingCalls.set(id, { resolve, reject, timer });
      this.ws!.send(
        JSON.stringify({
          _tag: "Request",
          id,
          tag,
          payload,
          headers: []
        })
      );
    });
  }

  private subscribeStream(tag: string, payload: unknown, onValues: StreamHandler): string {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return "";
    }
    const id = String(this.nextRequestId++);
    this.streamHandlers.set(id, onValues);
    this.ws.send(
      JSON.stringify({
        _tag: "Request",
        id,
        tag,
        payload,
        headers: []
      })
    );
    return id;
  }

  // ---- High-level T3 Code orchestration commands ----

  async dispatchCommand(command: Record<string, unknown>): Promise<unknown> {
    return this.callRpc("orchestration.dispatchCommand", command);
  }

  async approveRequest(
    threadId: string,
    requestId: string,
    decision: ProviderApprovalDecision
  ): Promise<void> {
    await this.dispatchCommand({
      type: "runtime-request.respond",
      commandId: newId("cmd"),
      threadId,
      requestId,
      decision
    });
  }

  async interruptRun(threadId: string, runId: string): Promise<void> {
    await this.dispatchCommand({
      type: "run.interrupt",
      commandId: newId("cmd"),
      threadId,
      runId,
      reason: "Interrupted from T3 Deck"
    });
  }

  async forceStopThread(threadId: string): Promise<void> {
    await this.callRpc("orchestration.forceStopThread", { threadId });
  }

  async setRuntimeMode(threadId: string, runtimeMode: RuntimeMode): Promise<void> {
    await this.dispatchCommand({
      type: "thread.runtime-mode.set",
      commandId: newId("cmd"),
      threadId,
      runtimeMode
    });
  }

  async setInteractionMode(
    threadId: string,
    interactionMode: ProviderInteractionMode
  ): Promise<void> {
    await this.dispatchCommand({
      type: "thread.interaction-mode.set",
      commandId: newId("cmd"),
      threadId,
      interactionMode
    });
  }

  async setModelSelection(threadId: string, modelSelection: ModelSelection): Promise<void> {
    await this.dispatchCommand({
      type: "thread.model-selection.set",
      commandId: newId("cmd"),
      threadId,
      modelSelection
    });
  }

  async settleThread(threadId: string): Promise<void> {
    await this.dispatchCommand({
      type: "thread.settle",
      commandId: newId("cmd"),
      threadId
    });
  }

  async unsettleThread(threadId: string): Promise<void> {
    await this.dispatchCommand({
      type: "thread.unsettle",
      commandId: newId("cmd"),
      threadId,
      reason: "user"
    });
  }

  async pinThread(threadId: string): Promise<void> {
    await this.dispatchCommand({
      type: "thread.pin",
      commandId: newId("cmd"),
      threadId
    });
  }

  async unpinThread(threadId: string): Promise<void> {
    await this.dispatchCommand({
      type: "thread.unpin",
      commandId: newId("cmd"),
      threadId
    });
  }

  async snoozeThread(threadId: string, durationHours = 1): Promise<void> {
    const until = new Date(Date.now() + durationHours * 3_600_000).toISOString();
    await this.dispatchCommand({
      type: "thread.snooze",
      commandId: newId("cmd"),
      threadId,
      snoozedUntil: until
    });
  }

  async unsnoozeThread(threadId: string): Promise<void> {
    await this.dispatchCommand({
      type: "thread.unsnooze",
      commandId: newId("cmd"),
      threadId,
      reason: "user"
    });
  }

  async sendQuickMessage(
    threadId: string,
    text: string,
    mode: "auto" | "steer" | "queue",
    activeRunId: string | null
  ): Promise<void> {
    let dispatchMode: Record<string, unknown>;
    if (activeRunId && (mode === "steer" || mode === "auto")) {
      dispatchMode = { type: "steer_active", targetRunId: activeRunId };
    } else if (activeRunId && mode === "queue") {
      dispatchMode = { type: "queue_after_active" };
    } else {
      dispatchMode = { type: "start_immediately" };
    }

    await this.dispatchCommand({
      type: "message.dispatch",
      commandId: newId("cmd"),
      threadId,
      messageId: newId("msg"),
      text,
      attachments: [],
      dispatchMode
    });
  }

  async refreshProviders(): Promise<void> {
    await this.callRpc("server.refreshProviders", { fresh: true });
  }
}
