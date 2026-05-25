// Lightweight in-app log buffer + console capture. Used by DevConsole UI
// so we can diagnose hangs/errors *inside* the running app instead of
// needing devtools every time.

export type LogLevel = "log" | "info" | "warn" | "error" | "invoke" | "event";

export interface LogEntry {
  id: number;
  t: number; // unix ms
  level: LogLevel;
  message: string;
  /** Optional structured payload (truncated). */
  data?: string;
  /** Tracking pair id for invoke start/end. */
  trace?: string;
  /** Milliseconds elapsed (set on end events). */
  durationMs?: number;
}

const BUFFER_LIMIT = 1000;
let nextId = 1;
let buffer: LogEntry[] = [];
const listeners = new Set<(entries: LogEntry[]) => void>();

function notify() {
  for (const fn of listeners) fn(buffer);
}

function safeStringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    const s = JSON.stringify(v, (_, val) => {
      if (typeof val === "bigint") return val.toString();
      return val;
    });
    return s.length > 1500 ? s.slice(0, 1500) + "…" : s;
  } catch {
    return String(v);
  }
}

export function append(entry: Omit<LogEntry, "id" | "t">): LogEntry {
  const full: LogEntry = { ...entry, id: nextId++, t: Date.now() };
  buffer.push(full);
  if (buffer.length > BUFFER_LIMIT) {
    buffer = buffer.slice(buffer.length - BUFFER_LIMIT);
  }
  notify();
  return full;
}

export function getBuffer(): LogEntry[] {
  return buffer;
}

export function clear() {
  buffer = [];
  notify();
}

export function subscribe(fn: (entries: LogEntry[]) => void): () => void {
  listeners.add(fn);
  fn(buffer);
  return () => {
    listeners.delete(fn);
  };
}

/** Patch global console.* so anything routed through it lands in our buffer too. */
export function installConsoleCapture() {
  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  function wrap(level: LogLevel, original: (...args: unknown[]) => void) {
    return (...args: unknown[]) => {
      try {
        append({
          level,
          message: args.map(safeStringify).join(" "),
        });
      } catch {
        /* never let logging crash the app */
      }
      original(...args);
    };
  }
  console.log = wrap("log", orig.log);
  console.info = wrap("info", orig.info);
  console.warn = wrap("warn", orig.warn);
  console.error = wrap("error", orig.error);

  window.addEventListener("error", (e) => {
    append({
      level: "error",
      message: `[uncaught] ${e.message}`,
      data: e.error?.stack ? String(e.error.stack) : undefined,
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    append({
      level: "error",
      message: `[unhandled-promise] ${safeStringify(e.reason)}`,
    });
  });
}

/** Log helpers used directly by app code. */
export const devlog = {
  info(msg: string, data?: unknown) {
    append({ level: "info", message: msg, data: data ? safeStringify(data) : undefined });
  },
  warn(msg: string, data?: unknown) {
    append({ level: "warn", message: msg, data: data ? safeStringify(data) : undefined });
  },
  error(msg: string, data?: unknown) {
    append({ level: "error", message: msg, data: data ? safeStringify(data) : undefined });
  },
};

/** Trace one invoke call: pushes a start log, returns a function to push an end log. */
export function traceInvoke(cmd: string, args: unknown) {
  const trace = `inv-${nextId}-${Date.now()}`;
  const startedAt = Date.now();
  append({
    level: "invoke",
    message: `→ ${cmd}`,
    data: safeStringify(args),
    trace,
  });
  return {
    ok(result: unknown) {
      append({
        level: "invoke",
        message: `← ${cmd}`,
        data: safeStringify(result),
        trace,
        durationMs: Date.now() - startedAt,
      });
    },
    err(err: unknown) {
      append({
        level: "error",
        message: `× ${cmd}: ${safeStringify(err)}`,
        trace,
        durationMs: Date.now() - startedAt,
      });
    },
  };
}

export function logEvent(name: string, payload?: unknown) {
  append({
    level: "event",
    message: name,
    data: payload ? safeStringify(payload) : undefined,
  });
}
