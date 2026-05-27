import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Ban,
  CheckCircle2,
  Clock,
  XCircle,
  Zap,
  Trash2,
  CheckSquare,
  Square,
  ListChecks,
  OctagonX,
} from "lucide-react";
import type { QueueEntry } from "../types";
import { cn, formatBytes, formatBytesExact, formatSpeed } from "../lib/utils";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import { useT, t } from "../lib/i18n";

interface Props {
  entries: QueueEntry[];
  onCancelJob: (jobId: string) => void;
  onCancelFiles: (fileIds: string[]) => void;
  onRemoveFiles: (fileIds: string[]) => void;
  onStopAndClearAll: () => void;
  onClearTab: (tab: TabKey) => void;
}

type TabKey = "queue" | "failed" | "done";
type ColKey = "source" | "dir" | "dest" | "size" | "status";

const TAB_KEYS: { key: TabKey; t: "tabQueue" | "tabFailed" | "tabDone" }[] = [
  { key: "queue", t: "tabQueue" },
  { key: "failed", t: "tabFailed" },
  { key: "done", t: "tabDone" },
];

const DEFAULT_COLS: Record<ColKey, number> = {
  source: 260,
  dir: 60,
  dest: 260,
  size: 100,
  status: 150,
};
const MIN_COL = 40;
const COL_STORAGE_KEY = "jetpipe.transferQueueCols.v3";

function loadCols(): Record<ColKey, number> {
  try {
    const raw = localStorage.getItem(COL_STORAGE_KEY);
    if (!raw) return DEFAULT_COLS;
    const parsed = JSON.parse(raw);
    return {
      source: Number(parsed.source) || DEFAULT_COLS.source,
      dir: Number(parsed.dir) || DEFAULT_COLS.dir,
      dest: Number(parsed.dest) || DEFAULT_COLS.dest,
      size: Number(parsed.size) || DEFAULT_COLS.size,
      status: Number(parsed.status) || DEFAULT_COLS.status,
    };
  } catch {
    return DEFAULT_COLS;
  }
}

function tabOf(e: QueueEntry): TabKey {
  if (e.status === "done") return "done";
  if (e.status === "failed") return "failed";
  return "queue";
}

export default function TransferQueue({
  entries,
  onCancelJob,
  onCancelFiles,
  onRemoveFiles,
  onStopAndClearAll,
  onClearTab,
}: Props) {
  const t = useT();
  const [tab, setTab] = useState<TabKey>("queue");
  const [cols, setCols] = useState<Record<ColKey, number>>(() => loadCols());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    rowId?: string;
  } | null>(null);
  const lastClickedRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(cols));
    } catch {
      /* noop */
    }
  }, [cols]);

  function resizeCol(key: ColKey, dx: number) {
    setCols((c) => ({ ...c, [key]: Math.max(MIN_COL, c[key] + dx) }));
  }

  const buckets = useMemo(() => {
    const b: Record<TabKey, QueueEntry[]> = { queue: [], failed: [], done: [] };
    for (const e of entries) b[tabOf(e)].push(e);
    return b;
  }, [entries]);

  const visible = buckets[tab];

  // Prune selections that no longer exist (e.g. after removal).
  useEffect(() => {
    const live = new Set(entries.map((e) => e.fileId));
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [entries]);

  function clickRow(e: React.MouseEvent, id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && lastClickedRef.current) {
        // Range select across the currently visible bucket.
        const ids = visible.map((v) => v.fileId);
        const a = ids.indexOf(lastClickedRef.current);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(ids[i]);
          return next;
        }
      }
      if (e.metaKey || e.ctrlKey) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      // Plain click → exclusive single selection.
      next.clear();
      next.add(id);
      return next;
    });
    lastClickedRef.current = id;
  }

  function selectAllInTab() {
    setSelected(new Set(visible.map((v) => v.fileId)));
  }
  function clearSelection() {
    setSelected(new Set());
  }

  function openContextMenu(e: React.MouseEvent, rowId?: string) {
    e.preventDefault();
    e.stopPropagation();
    // If the clicked row isn't in the selection, replace the selection
    // with just that row so the menu acts on what the user is pointing at.
    if (rowId && !selected.has(rowId)) {
      setSelected(new Set([rowId]));
      lastClickedRef.current = rowId;
    }
    setMenu({ x: e.clientX, y: e.clientY, rowId });
  }

  function buildMenuItems(): ContextMenuItem[] {
    // Always act on the right-clicked row even if the selection-state update
    // from openContextMenu hasn't flushed yet (frequent re-renders during an
    // active transfer can otherwise leave `selected` momentarily empty).
    const targetIds = new Set(selected);
    if (menu?.rowId) targetIds.add(menu.rowId);
    const sel = entries.filter((e) => targetIds.has(e.fileId));
    const items: ContextMenuItem[] = [];
    const activeIds = sel
      .filter((e) => e.status === "active" || e.status === "queued")
      .map((e) => e.fileId);
    const removableIds = sel
      .filter((e) => e.status !== "active")
      .map((e) => e.fileId);
    const hasActive = entries.some(
      (e) => e.status === "active" || e.status === "queued"
    );

    if (sel.length > 0) {
      if (activeIds.length > 0) {
        items.push({
          label: `${t("cancelSelected")} (${activeIds.length})`,
          icon: Ban,
          onClick: () => onCancelFiles(activeIds),
        });
      }
      if (removableIds.length > 0) {
        items.push({
          label: `${t("removeSelected")} (${removableIds.length})`,
          icon: Trash2,
          danger: true,
          onClick: () => onRemoveFiles(removableIds),
        });
      }
    }
    items.push({
      label:
        visible.length > 0
          ? `${t("selectAllInTab")} (${visible.length})`
          : t("selectAll"),
      icon: ListChecks,
      onClick: selectAllInTab,
    });
    if (selected.size > 0) {
      items.push({
        label: t("deselect"),
        icon: Square,
        onClick: clearSelection,
      });
    }
    items.push({
      label: hasActive ? t("stopClearAll") : t("clearAll"),
      icon: OctagonX,
      danger: true,
      onClick: onStopAndClearAll,
    });
    return items;
  }

  // Status is the flexible last column (min = stored width) so it absorbs
  // leftover window width. The earlier columns stay fixed/left-packed and
  // their headers line up cleanly above the data instead of floating.
  const template = `${cols.source}px ${cols.dir}px ${cols.dest}px ${cols.size}px minmax(${cols.status}px, 1fr)`;

  return (
    <div
      className="border-t border-edge bg-base/80 backdrop-blur flex flex-col h-full"
      onContextMenu={(e) => openContextMenu(e)}
    >
      {/* Column headers */}
      <div
        style={{ gridTemplateColumns: template }}
        className="grid gap-2 px-3 py-1.5 border-b border-edge text-[10px] uppercase tracking-wider text-ink-faint shrink-0 items-center"
      >
        <HeaderCell
          label={t("colSource")}
          align="center"
          onResize={(dx) => resizeCol("source", dx)}
        />
        <HeaderCell
          label={t("colDirection")}
          align="center"
          onResize={(dx) => resizeCol("dir", dx)}
        />
        <HeaderCell
          label={t("colTarget")}
          align="center"
          onResize={(dx) => resizeCol("dest", dx)}
        />
        <HeaderCell
          label={t("colSize")}
          align="center"
          onResize={(dx) => resizeCol("size", dx)}
        />
        <HeaderCell label={t("colStatus")} align="center" />
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[11px] text-ink-faint">
            {tab === "queue"
              ? t("emptyQueue")
              : tab === "failed"
              ? t("emptyFailed")
              : t("emptyDone")}
          </div>
        ) : (
          visible.map((e) => (
            <Row
              key={e.fileId}
              entry={e}
              template={template}
              selected={selected.has(e.fileId)}
              onClick={(ev) => clickRow(ev, e.fileId)}
              onContextMenu={(ev) => openContextMenu(ev, e.fileId)}
              onCancelJob={onCancelJob}
            />
          ))
        )}
      </div>

      {/* Tab bar */}
      <div className="flex items-center border-t border-edge shrink-0">
        {TAB_KEYS.map((tk) => {
          const count = buckets[tk.key].length;
          const active = tab === tk.key;
          return (
            <button
              key={tk.key}
              onClick={() => {
                setTab(tk.key);
                clearSelection();
              }}
              className={cn(
                "px-3 py-1.5 text-[11px] transition border-r border-edge",
                active
                  ? "text-ink bg-surface/70"
                  : "text-ink-faint hover:text-ink-muted"
              )}
            >
              {t(tk.t)}
              {count > 0 && (
                <span
                  className={cn(
                    "ml-1.5 text-[9px] tabular-nums",
                    active ? "text-brand" : "text-ink-faint"
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
        <div className="flex-1" />
        {selected.size > 0 && (
          <span className="px-3 py-1.5 text-[10px] text-brand font-mono tabular-nums">
            {selected.size}
            {t("selectedCount")}
          </span>
        )}
        {(tab === "failed" || tab === "done") && buckets[tab].length > 0 && (
          <button
            onClick={() => onClearTab(tab)}
            className="px-3 py-1.5 text-[10px] text-ink-faint hover:text-ink transition flex items-center gap-1"
          >
            <Trash2 size={10} /> {t("clearList")}
          </button>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems()}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function HeaderCell({
  label,
  align = "left",
  onResize,
}: {
  label: string;
  align?: "left" | "right" | "center";
  onResize?: (dx: number) => void;
}) {
  return (
    <div
      className={cn(
        "relative truncate",
        align === "right" && "text-right",
        align === "center" && "text-center"
      )}
    >
      {label}
      {onResize && <ColResize onDrag={onResize} />}
    </div>
  );
}

function ColResize({ onDrag }: { onDrag: (dx: number) => void }) {
  function onDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let last = e.clientX;
    function move(ev: PointerEvent) {
      const dx = ev.clientX - last;
      if (dx !== 0) {
        last = ev.clientX;
        onDrag(dx);
      }
    }
    function up() {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
    }
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    document.body.style.cursor = "col-resize";
  }
  return (
    <div
      onPointerDown={onDown}
      className="absolute -right-1 top-0 bottom-0 w-2 cursor-col-resize z-10 group flex justify-center"
    >
      {/* Resizer line: was using `bg-edge`/`bg-surface` which is too
       *  close to the surrounding chrome to read as a separator. Boost
       *  to ink-faint/40 so it's actually visible without being loud,
       *  and grow on hover for a clear drag affordance. */}
      <div className="w-[1.5px] h-full bg-ink-faint/40 group-hover:bg-brand/70 group-hover:w-[2.5px] group-active:bg-brand transition-all" />
    </div>
  );
}

function Row({
  entry,
  template,
  selected,
  onClick,
  onContextMenu,
  onCancelJob,
}: {
  entry: QueueEntry;
  template: string;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onCancelJob: (jobId: string) => void;
}) {
  const t = useT();
  const pct =
    entry.size > 0 ? Math.min(100, (entry.bytes / entry.size) * 100) : 0;

  const status = entry.status;
  const isActive = status === "active";
  const Icon =
    status === "done"
      ? CheckCircle2
      : status === "failed"
      ? XCircle
      : status === "cancelled"
      ? Ban
      : status === "active"
      ? Zap
      : Clock;

  const iconColor = {
    done: "text-emerald-400",
    failed: "text-rose-400",
    cancelled: "text-amber-400",
    active: "text-brand animate-pulse",
    queued: "text-ink-faint",
  }[status];

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{ gridTemplateColumns: template }}
      className={cn(
        "grid gap-2 px-3 py-1 text-[11px] transition relative cursor-default select-none items-center",
        selected
          ? "bg-brand/15 hover:bg-brand/20"
          : "hover:bg-surface/40"
      )}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="shrink-0 w-3 flex items-center justify-center">
          {selected ? (
            <CheckSquare size={10} className="text-brand" />
          ) : (
            <Icon size={11} className={cn(iconColor)} />
          )}
        </span>
        <PathCell path={entry.source || entry.rel} tone="bright" />
      </div>
      <div
        className="flex items-center justify-center"
        title={directionLabel(entry.sourceKind, entry.destKind)}
      >
        <DirectionIcon
          sourceKind={entry.sourceKind}
          destKind={entry.destKind}
        />
      </div>
      <PathCell path={entry.dest} tone="dim" />
      <div
        className="text-right font-mono text-ink-faint tabular-nums flex items-center justify-end"
        title={formatBytes(entry.size)}
      >
        {formatBytesExact(entry.size)}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] min-w-0">
        {status === "queued" && (
          <span className="text-ink-faint">{t("stWaiting")}</span>
        )}
        {isActive && (
          <>
            <span className="text-brand font-mono tabular-nums">
              {Math.floor(pct)}%
            </span>
            <span className="text-ink-faint font-mono tabular-nums truncate">
              {formatSpeed(entry.bps)}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancelJob(entry.jobId);
              }}
              className="text-ink-faint hover:text-rose-400 transition ml-auto"
              title={t("cancelJob")}
            >
              <Ban size={10} />
            </button>
          </>
        )}
        {status === "done" && (
          <span className="text-emerald-400">{t("stDone")}</span>
        )}
        {status === "failed" && (
          <span className="text-rose-400 truncate" title={entry.error}>
            {entry.error ?? t("stFailed")}
          </span>
        )}
        {status === "cancelled" && (
          <span className="text-amber-400">{t("stCancelled")}</span>
        )}
      </div>

      {isActive && (
        <div className="absolute left-0 right-0 bottom-0 h-[2px] bg-surface">
          <div
            className="h-full bg-gradient-to-r from-brand to-brand2 transition-all duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Upload (local→remote ⬆), download (remote→local ⬇), or direct (→). */
function DirectionIcon({
  sourceKind,
  destKind,
}: {
  sourceKind?: string;
  destKind?: string;
}) {
  if (sourceKind === "local" && destKind === "remote") {
    return <ArrowUp size={11} className="text-brand" />;
  }
  if (sourceKind === "remote" && destKind === "local") {
    return <ArrowDown size={11} className="text-brand2" />;
  }
  return <ArrowRight size={10} className="text-ink-faint" />;
}

function directionLabel(sourceKind?: string, destKind?: string): string {
  if (sourceKind === "local" && destKind === "remote") return t("dirUpload");
  if (sourceKind === "remote" && destKind === "local") return t("dirDownload");
  if (sourceKind === "local" && destKind === "local") return t("dirLocalCopy");
  return t("dirDirect");
}

/**
 * Path cell that keeps the basename (filename) always visible and truncates
 * only the directory portion. Layout:
 *   [ ...truncated/middle/dir/  ][filename.ext]
 *                                ^ never truncated
 *
 * Plain `truncate` chops off the right end — which for paths means losing
 * the filename, which is the part you actually need to see. Splitting on
 * the last `/` and shrinking only the prefix makes wider columns reveal
 * more directory context while filenames stay readable at any width.
 */
function PathCell({
  path,
  tone,
}: {
  path: string;
  tone: "bright" | "dim";
}) {
  const lastSlash = path.lastIndexOf("/");
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : "";
  const name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const nameColor = tone === "bright" ? "text-ink font-bold" : "text-ink font-semibold";
  const dirColor = tone === "bright" ? "text-ink-muted" : "text-ink-muted";

  return (
    <div
      className="flex items-center min-w-0 font-mono font-medium"
      title={path}
    >
      {dir && (
        <span className={cn("truncate shrink", dirColor)}>{dir}</span>
      )}
      <span className={cn("shrink-0", nameColor)}>{name}</span>
    </div>
  );
}
