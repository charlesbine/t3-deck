import { spawn, type ChildProcessByStdio } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import type { SpeechTranscriptionOptions } from "./types.js";

export const SPEECH_SAMPLE_RATE = 16_000;
export const SPEECH_BYTES_PER_SAMPLE = 4; // Float32 LE
export const SPEECH_MAX_DURATION_SEC = 300;
export const SPEECH_MAX_PCM_BYTES =
  SPEECH_SAMPLE_RATE * SPEECH_BYTES_PER_SAMPLE * SPEECH_MAX_DURATION_SEC;
export const SPEECH_WS_CHUNK_BYTES = 16_000; // ~0.25s of 16kHz Float32 PCM (< 64KB T3 limit)

export function defaultSpeechOptions(
  overrides: Partial<SpeechTranscriptionOptions> = {}
): SpeechTranscriptionOptions {
  return {
    speechLanguage: "en",
    speechTranslateToEnglish: false,
    speechCustomWords: [],
    speechRemoveFillerWords: true,
    speechSilenceFiltering: true,
    ...overrides
  };
}

/**
 * Encodes audio for T3 Code's POST /api/voice/transcribe and /api/voice/cloud/:provider/transcribe:
 *   [uint32LE(jsonByteLength)][utf8(JSON(options))][16kHz mono Float32 LE PCM bytes]
 */
export function encodeSpeechPcmRequest(
  pcm: Uint8Array,
  options: SpeechTranscriptionOptions = defaultSpeechOptions()
): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(options));
  const alignedLen = pcm.byteLength - (pcm.byteLength % SPEECH_BYTES_PER_SAMPLE);
  const out = new Uint8Array(4 + jsonBytes.byteLength + alignedLen);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(0, jsonBytes.byteLength, true);
  out.set(jsonBytes, 4);
  if (alignedLen > 0) {
    out.set(pcm.subarray(0, alignedLen), 4 + jsonBytes.byteLength);
  }
  return out;
}

/**
 * Sanitizes Float32 LE PCM bytes into [-1, 1] so T3 Code's strict validator never rejects
 * an out-of-range or NaN hardware sample, and returns a normalized 0..1 visual VU level.
 */
export function sanitizeFloat32Pcm(raw: Uint8Array): { pcm: Uint8Array; level: number } {
  const alignedLen = raw.byteLength - (raw.byteLength % SPEECH_BYTES_PER_SAMPLE);
  if (alignedLen === 0) {
    return { pcm: new Uint8Array(0), level: 0 };
  }
  const copy = new Uint8Array(alignedLen);
  copy.set(raw.subarray(0, alignedLen));
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  const count = alignedLen / SPEECH_BYTES_PER_SAMPLE;
  let sumSq = 0;

  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    let s = view.getFloat32(offset, true);
    if (!Number.isFinite(s)) {
      s = 0;
      view.setFloat32(offset, 0, true);
    } else if (s > 1) {
      s = 1;
      view.setFloat32(offset, 1, true);
    } else if (s < -1) {
      s = -1;
      view.setFloat32(offset, -1, true);
    }
    sumSq += s * s;
  }

  const rms = Math.sqrt(sumSq / Math.max(1, count));
  // Boost quiet mic RMS into a lively 0..1 meter curve
  const level = Math.max(0, Math.min(1, Math.pow(rms * 6.5, 0.72)));
  return { pcm: copy, level };
}

export interface RecorderCommand {
  tool: "sox" | "ffmpeg";
  bin: string;
  args: string[];
}

function searchBinary(names: string[]): string | null {
  const dirs = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    ...(process.env.PATH ? process.env.PATH.split(path.delimiter) : [])
  ];
  const seen = new Set<string>();
  for (const dir of dirs) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // continue
      }
    }
  }
  return null;
}

export function resolveRecorderCommand(): RecorderCommand | null {
  const soxBin = searchBinary(process.platform === "win32" ? ["sox.exe"] : ["sox"]);
  if (soxBin) {
    return {
      tool: "sox",
      bin: soxBin,
      args: [
        "-q",
        "-d",
        "-t",
        "raw",
        "-r",
        String(SPEECH_SAMPLE_RATE),
        "-c",
        "1",
        "-e",
        "floating-point",
        "-b",
        "32",
        "-L",
        "-"
      ]
    };
  }

  const ffmpegBin = searchBinary(process.platform === "win32" ? ["ffmpeg.exe"] : ["ffmpeg"]);
  if (ffmpegBin) {
    const inputArgs =
      process.platform === "darwin"
        ? ["-f", "avfoundation", "-i", ":0"]
        : process.platform === "win32"
          ? ["-f", "dshow", "-i", "audio=default"]
          : ["-f", "pulse", "-i", "default"];
    return {
      tool: "ffmpeg",
      bin: ffmpegBin,
      args: [
        "-loglevel",
        "error",
        ...inputArgs,
        "-ar",
        String(SPEECH_SAMPLE_RATE),
        "-ac",
        "1",
        "-f",
        "f32le",
        "-"
      ]
    };
  }

  return null;
}

export interface MicRecorderCallbacks {
  onChunk: (pcm: Uint8Array, level: number, durationSec: number) => void;
  onError: (message: string) => void;
}

export class MicRecorder {
  private proc: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private chunks: Uint8Array[] = [];
  private totalBytes = 0;
  private remainder = new Uint8Array(0);
  private pendingOut = new Uint8Array(0);
  private startedAt = 0;
  private stopped = false;
  private stderrBuf = "";
  private readonly callbacks: MicRecorderCallbacks;

  constructor(callbacks: MicRecorderCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    const cmd = resolveRecorderCommand();
    if (!cmd) {
      throw new Error("No audio recorder found. Install SoX (`brew install sox`) or ffmpeg.");
    }
    this.stopped = false;
    this.chunks = [];
    this.totalBytes = 0;
    this.remainder = new Uint8Array(0);
    this.pendingOut = new Uint8Array(0);
    this.stderrBuf = "";
    this.startedAt = Date.now();

    const proc = spawn(cmd.bin, cmd.args, { stdio: ["ignore", "pipe", "pipe"] });
    this.proc = proc;

    proc.stdout.on("data", (buf: Buffer) => {
      if (this.stopped) return;
      const incoming = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      const merged = new Uint8Array(this.remainder.byteLength + incoming.byteLength);
      merged.set(this.remainder, 0);
      merged.set(incoming, this.remainder.byteLength);

      const alignedLen = merged.byteLength - (merged.byteLength % SPEECH_BYTES_PER_SAMPLE);
      this.remainder = merged.slice(alignedLen);
      if (alignedLen === 0) return;

      const { pcm, level } = sanitizeFloat32Pcm(merged.subarray(0, alignedLen));
      if (pcm.byteLength === 0) return;

      const remainingAllowance = SPEECH_MAX_PCM_BYTES - this.totalBytes;
      if (remainingAllowance <= 0) {
        void this.stop();
        return;
      }
      const bounded =
        pcm.byteLength > remainingAllowance
          ? pcm.subarray(0, remainingAllowance - (remainingAllowance % SPEECH_BYTES_PER_SAMPLE))
          : pcm;

      this.chunks.push(bounded);
      this.totalBytes += bounded.byteLength;

      // Batch outgoing stream chunks to ~250ms (16KB) for smooth WS streaming
      const combined = new Uint8Array(this.pendingOut.byteLength + bounded.byteLength);
      combined.set(this.pendingOut, 0);
      combined.set(bounded, this.pendingOut.byteLength);

      let offset = 0;
      const durationSec = (Date.now() - this.startedAt) / 1000;
      while (combined.byteLength - offset >= SPEECH_WS_CHUNK_BYTES) {
        const slice = combined.slice(offset, offset + SPEECH_WS_CHUNK_BYTES);
        offset += SPEECH_WS_CHUNK_BYTES;
        this.callbacks.onChunk(slice, level, durationSec);
      }
      this.pendingOut = combined.slice(offset);
    });

    proc.stderr.on("data", (buf: Buffer) => {
      this.stderrBuf += buf.toString("utf8");
      if (this.stderrBuf.length > 600) {
        this.stderrBuf = this.stderrBuf.slice(-600);
      }
    });

    proc.on("error", (err) => {
      if (!this.stopped) {
        this.callbacks.onError(`Mic capture error: ${err.message}`);
      }
    });

    proc.on("close", (code) => {
      if (!this.stopped && code && code !== 0 && this.totalBytes === 0) {
        const detail = this.stderrBuf.trim().slice(0, 140) || `exit ${code}`;
        this.callbacks.onError(`Mic capture failed (${detail})`);
      }
    });
  }

  /** Stops recording, flushes any remaining audio chunk, and returns the complete Float32 PCM buffer. */
  async stop(): Promise<{ pcm: Uint8Array; durationSec: number }> {
    if (this.stopped) {
      return { pcm: this.concatChunks(), durationSec: this.elapsedSec() };
    }
    this.stopped = true;
    const proc = this.proc;
    this.proc = null;

    if (proc) {
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            // ignore
          }
          resolve();
        }, 600);
        proc.once("close", () => {
          clearTimeout(killTimer);
          resolve();
        });
        try {
          proc.kill("SIGINT");
        } catch {
          clearTimeout(killTimer);
          resolve();
        }
      });
    }

    if (this.pendingOut.byteLength >= SPEECH_BYTES_PER_SAMPLE) {
      const tail = this.pendingOut;
      this.pendingOut = new Uint8Array(0);
      this.callbacks.onChunk(tail, 0, this.elapsedSec());
    }

    return { pcm: this.concatChunks(), durationSec: this.elapsedSec() };
  }

  abort(): void {
    this.stopped = true;
    const proc = this.proc;
    this.proc = null;
    this.chunks = [];
    this.pendingOut = new Uint8Array(0);
    this.remainder = new Uint8Array(0);
    if (proc) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }

  private elapsedSec(): number {
    return this.startedAt > 0 ? (Date.now() - this.startedAt) / 1000 : 0;
  }

  private concatChunks(): Uint8Array {
    const out = new Uint8Array(this.totalBytes);
    let offset = 0;
    for (const c of this.chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }
}
