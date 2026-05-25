import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Terminal,
  Trash2,
  X,
  Filter,
} from "lucide-react";
import {
  append,
  clear,
  getBuffer,
  loadPersistedLog,
  subscribe,
  type LogEntry,
  type LogLevel,
} from "../lib/devlog";
import { cn } from "../lib/utils";

const LEVEL_COLOR: Record<LogLevel, string> = {
  log: "text-zinc-300",
  info: "text-zinc-200",
  warn: "text-amber-300",
  error: "text-rose-400",
  invoke: "text-cyan-300",
  event: "text-violet-300",
};

const LEVEL_BADGE: Record<LogLevel, string> = {
  log: "bg-zinc-800 text-zinc-400",
  info: "bg-zinc-800 text-zinc-300",
  warn: "bg-amber-500/20 text-amber-300",
  error: "bg-rose-500/20 text-rose-300",
  invoke: "bg-cyan-500/15 text-cyan-300",
  event: "bg-violet-500/15 text-violet-300",
};

function formatTime(t: number): string {
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

export default function DevConsole() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>(getBuffer());
  const [autoscroll, setAutoscroll] = useState(true);
  const [filter, setFilter] = useState("");
  const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(
    new Set(["log", "info", "warn", "error", "invoke", "event"])
  );
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribe(setEntries), []);

  useEffect(() => {
    if (!autoscroll || !open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, autoscroll, open]);

  // Live trace of in-flight invokes: start events without matching end event.
  const pendingTraces = useMemo(() => {
    const starts = new Map<string, LogEntry>();
    const ends = new Set<string>();
    for (const e of entries) {
      if (!e.trace) continue;
      if (e.durationMs !== undefined) ends.add(e.trace);
      else if (!starts.has(e.trace)) starts.set(e.trace, e);
    }
    const pending: LogEntry[] = [];
    for (const [k, v] of starts) {
      if (!ends.has(k)) pending.push(v);
    }
    return pending;
  }, [entries]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return entries.filter((e) => {
      if (!activeLevels.has(e.level)) return false;
      if (q && !`${e.message} ${e.data ?? ""}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [entries, filter, activeLevels]);

  function toggleLevel(l: LogLevel) {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });
  }

  function loadPrevious() {
    const prev = loadPersistedLog();
    if (prev.length === 0) {
      append({ level: "warn", message: "no previous session log found" });
      return;
    }
    append({
      level: "info",
      message: `── previous session log (${prev.length} entries) ──`,
    });
    for (const e of prev) {
      append({
        level: e.level,
        message: `[prev] ${e.message}`,
        data: e.data,
        durationMs: e.durationMs,
      });
    }
  }

  function copyAll() {
    const text = visible
      .map((e) => {
        const time = formatTime(e.t);
        const dur = e.durationMs != null ? ` (${e.durationMs}ms)` : "";
        return `${time} [${e.level}] ${e.message}${dur}${e.data ? "\n  " + e.data : ""}`;
      })
      .join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  }

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "fixed bottom-3 right-3 z-40 flex items-center gap-1.5 px-2.5 py-1 rounded-md shadow-lg transition border text-[10px] font-mono",
          pendingTraces.length > 0
            ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-200 animate-pulse"
            : "border-zinc-800 bg-zinc-950/90 text-zinc-400 hover:text-zinc-100"
        )}
        title="개발자 콘솔"
      >
        <Terminal size={11} />
        <span>console</span>
        {pendingTraces.length > 0 && (
          <span className="font-mono tabular-nums text-cyan-300">
            {pendingTraces.length}
          </span>
        )}
        {entries.length > 0 && pendingTraces.length === 0 && (
          <span className="font-mono tabular-nums text-zinc-500">
            {entries.length}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 bottom-12 z-40 h-[40vh] min-h-[200px] bg-zinc-950/95 backdrop-blur border border-zinc-800 rounded-lg shadow-2xl flex flex-col">
          <header className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-900 shrink-0">
            <Terminal size={12} className="text-cyan-400" />
            <span className="text-[11px] font-semibold tracking-tight">
              개발자 콘솔
            </span>
            <span className="text-[10px] text-zinc-500 font-mono tabular-nums">
              {visible.length} / {entries.length}
            </span>
            {pendingTraces.length > 0 && (
              <span
                className="text-[10px] text-cyan-300 font-mono tabular-nums"
                title={pendingTraces.map((p) => p.message).join("\n")}
              >
                ⟳ {pendingTraces.length} in-flight
              </span>
            )}
            <div className="flex-1" />
            <Filter size={10} className="text-zinc-600" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="필터…"
              className="w-40 bg-zinc-900/60 border border-zinc-800 rounded px-1.5 py-0.5 text-[10px] outline-none focus:border-cyan-500/50"
            />
            <button
              onClick={() => setAutoscroll((v) => !v)}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded border transition",
                autoscroll
                  ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                  : "border-zinc-800 text-zinc-500 hover:text-zinc-300"
              )}
              title={autoscroll ? "자동 스크롤 켜짐" : "자동 스크롤 꺼짐"}
            >
              {autoscroll ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
            </button>
            <button
              onClick={loadPrevious}
              className="text-zinc-500 hover:text-amber-300 transition p-1 text-[10px]"
              title="이전 세션(freeze 직전) 로그 불러오기"
            >
              prev
            </button>
            <button
              onClick={copyAll}
              className="text-zinc-500 hover:text-zinc-100 transition p-1"
              title="필터된 로그 클립보드로 복사"
            >
              <Copy size={11} />
            </button>
            <button
              onClick={() => clear()}
              className="text-zinc-500 hover:text-rose-400 transition p-1"
              title="비우기"
            >
              <Trash2 size={11} />
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-zinc-500 hover:text-zinc-100 transition p-1"
              title="닫기"
            >
              <X size={12} />
            </button>
          </header>

          {/* Level toggles */}
          <div className="flex items-center gap-1 px-3 py-1 border-b border-zinc-900 text-[9px] uppercase tracking-wider">
            {(Object.keys(LEVEL_BADGE) as LogLevel[]).map((l) => {
              const active = activeLevels.has(l);
              return (
                <button
                  key={l}
                  onClick={() => toggleLevel(l)}
                  className={cn(
                    "px-1.5 py-0.5 rounded transition",
                    active ? LEVEL_BADGE[l] : "text-zinc-700"
                  )}
                >
                  {l}
                </button>
              );
            })}
          </div>

          {/* Log body */}
          <div
            ref={listRef}
            className="flex-1 overflow-y-auto font-mono text-[10px] leading-snug"
          >
            {visible.length === 0 && (
              <div className="h-full flex items-center justify-center text-zinc-600">
                로그 없음
              </div>
            )}
            {visible.map((e) => (
              <div
                key={e.id}
                className={cn(
                  "px-3 py-0.5 border-b border-zinc-900/40 flex gap-2",
                  LEVEL_COLOR[e.level]
                )}
              >
                <span className="text-zinc-600 shrink-0 tabular-nums">
                  {formatTime(e.t)}
                </span>
                <span className="text-zinc-700 shrink-0 w-12 text-[9px] uppercase">
                  {e.level}
                </span>
                <div className="flex-1 min-w-0 break-all">
                  <div>
                    {e.message}
                    {e.durationMs != null && (
                      <span className="ml-1.5 text-zinc-500">
                        ({e.durationMs}ms)
                      </span>
                    )}
                  </div>
                  {e.data && (
                    <div className="text-zinc-500 mt-0.5 pl-2 border-l border-zinc-800">
                      {e.data}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
