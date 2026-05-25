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

let notifyScheduled = false;
function notify() {
  // Throttle notifications to the next macro-tick. Without this, a burst of
  // logs (which can happen if any library warns during render) would each
  // trigger a synchronous React state update *during* the in-progress
  // render, deadlocking the UI in an infinite render loop. setTimeout(0)
  // ensures we always batch on the next event-loop iteration, well after
  // the current render finishes.
  if (notifyScheduled) return;
  notifyScheduled = true;
  setTimeout(() => {
    notifyScheduled = false;
    const snapshot = buffer.slice();
    for (const fn of listeners) {
      try {
        fn(snapshot);
      } catch {
        /* swallow — a broken listener mustn't break logging for others */
      }
    }
  }, 0);
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

const PERSIST_KEY = "jetpipe.devlog.lastSession";
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    try {
      const recent = buffer.slice(-300);
      localStorage.setItem(PERSIST_KEY, JSON.stringify(recent));
    } catch {
      /* localStorage may be full or unavailable */
    }
  }, 200);
}

export function append(entry: Omit<LogEntry, "id" | "t">): LogEntry {
  const full: LogEntry = { ...entry, id: nextId++, t: Date.now() };
  buffer.push(full);
  if (buffer.length > BUFFER_LIMIT) {
    buffer = buffer.slice(buffer.length - BUFFER_LIMIT);
  }
  notify();
  schedulePersist();
  return full;
}

/** Read the *previous* session's logs (persisted at most 200ms before the
 *  app froze / quit). Use this to recover what was happening when the UI
 *  locked up. */
export function loadPersistedLog(): LogEntry[] {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as LogEntry[];
  } catch {
    return [];
  }
}

/** Synchronous emergency-write that bypasses the buffer's notify schedule.
 *  Used at the very top of click handlers so the log survives even if React
 *  freezes before the regular persist timer fires. */
export function hardLog(message: string) {
  try {
    const stamp = new Date().toISOString();
    const raw = localStorage.getItem(PERSIST_KEY);
    const prev = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(prev) ? prev : [];
    list.push({
      id: nextId++,
      t: Date.now(),
      level: "info" as LogLevel,
      message: `[hardlog ${stamp}] ${message}`,
    });
    localStorage.setItem(PERSIST_KEY, JSON.stringify(list.slice(-300)));
  } catch {
    /* swallow */
  }
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

/** Hook the *crash* signals only — uncaught errors and unhandled promise
 *  rejections. We deliberately do NOT override console.log/warn/error: a
 *  library or React internal warning emitted during render would otherwise
 *  cascade through our notify() → setState chain and deadlock the renderer
 *  in an infinite loop. */
export function installConsoleCapture() {
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
