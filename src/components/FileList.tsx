import { useEffect, useState } from "react";
import { File as FileIcon, Folder, Pencil, ServerCrash } from "lucide-react";
import type { LiveSession, PanelSide, RemoteEntry } from "../types";
import { listDir } from "../lib/api";
import { cn, formatBytes, formatBytesExact } from "../lib/utils";
import { useT } from "../lib/i18n";

interface Props {
  side: PanelSide;
  session: LiveSession | null;
  path: string;
  refreshTick?: number;
  onNavigate?: (path: string) => void;
  onRename?: (path: string, currentName: string) => void;
  onContextMenuEntry?: (
    e: React.MouseEvent,
    path: string,
    name: string,
    isDir: boolean
  ) => void;
  onDropToFolder?: (destDir: string, payload: string) => void;
  onDragStartFile: (file: RemoteEntry) => void;
}

function readDragPayload(dt: DataTransfer): string | null {
  const custom = dt.getData("application/jetpipe");
  if (custom) return custom;
  const text = dt.getData("text/plain");
  if (text.startsWith("jetpipe:")) return text.slice("jetpipe:".length);
  return (
    (window as unknown as { __jetpipeDrag?: string }).__jetpipeDrag ?? null
  );
}

function formatDate(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

export default function FileList({
  side,
  session,
  path,
  refreshTick,
  onNavigate,
  onRename,
  onContextMenuEntry,
  onDropToFolder,
  onDragStartFile,
}: Props) {
  const t = useT();
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setEntries([]);
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, path, refreshTick]);

  async function refresh() {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listDir(session.id, path);
      // Show folders + files. Rust already sorts folders first by name.
      setEntries(rows);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  const fileCount = entries.filter((e) => !e.isDir).length;
  const dirCount = entries.filter((e) => e.isDir).length;
  const totalFileBytes = entries
    .filter((e) => !e.isDir)
    .reduce((sum, e) => sum + e.size, 0);

  return (
    <div className="h-full flex flex-col">
      {/* Column headers */}
      <div className="grid grid-cols-[1fr_70px_90px_90px] gap-2 px-2 py-1 border-b border-edge text-[10px] uppercase tracking-wider text-ink-faint shrink-0">
        <div>{t("fileName")}</div>
        <div className="text-right">{t("colSize")}</div>
        <div>{t("fileType")}</div>
        <div>{t("modified")}</div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!session && (
          <div className="h-full flex items-center justify-center text-[11px] text-ink-faint">
            {t("notConnected")}
          </div>
        )}
        {session && error && (
          <div className="p-3 text-xs text-rose-400 flex items-start gap-2">
            <ServerCrash size={13} className="mt-0.5 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}
        {session && !error && entries.length === 0 && !loading && (
          <div className="h-full flex items-center justify-center text-[11px] text-ink-faint">
            {t("noFiles")}
          </div>
        )}
        {session &&
          entries.map((e) => (
            <div
              key={e.path}
              draggable
              onDragStart={(ev) => {
                onDragStartFile(e);
                const payload = JSON.stringify({
                  sessionId: session.id,
                  path: e.path,
                  name: e.name,
                  isDir: e.isDir,
                  side,
                });
                ev.dataTransfer.setData("application/jetpipe", payload);
                ev.dataTransfer.setData("text/plain", `jetpipe:${payload}`);
                ev.dataTransfer.effectAllowed = "copy";
                (window as unknown as { __jetpipeDrag?: string }).__jetpipeDrag =
                  payload;
              }}
              onClick={() => {
                if (e.isDir && onNavigate) onNavigate(e.path);
              }}
              onContextMenu={(ev) =>
                onContextMenuEntry?.(ev, e.path, e.name, e.isDir)
              }
              onDragOver={(ev) => {
                if (!e.isDir || !onDropToFolder) return;
                ev.preventDefault();
                ev.stopPropagation();
                ev.dataTransfer.dropEffect = "copy";
                if (dragOverPath !== e.path) setDragOverPath(e.path);
              }}
              onDragLeave={(ev) => {
                if (!e.isDir) return;
                ev.stopPropagation();
                if (dragOverPath === e.path) setDragOverPath(null);
              }}
              onDrop={(ev) => {
                if (!e.isDir || !onDropToFolder) return;
                ev.preventDefault();
                ev.stopPropagation();
                const raw = readDragPayload(ev.dataTransfer);
                setDragOverPath(null);
                if (raw) onDropToFolder(e.path, raw);
              }}
              className={cn(
                "group grid grid-cols-[1fr_70px_90px_90px] gap-2 px-2 py-0.5 text-xs transition select-none",
                dragOverPath === e.path
                  ? "bg-brand/25 ring-1 ring-inset ring-brand/50"
                  : "hover:bg-surface/60",
                e.isDir
                  ? "cursor-pointer"
                  : "cursor-grab active:cursor-grabbing"
              )}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {e.isDir ? (
                  <Folder size={11} className="text-amber-400/80 shrink-0" />
                ) : (
                  <FileIcon size={11} className="text-ink-faint shrink-0" />
                )}
                <span className="truncate text-ink flex-1">{e.name}</span>
                {onRename && (
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onRename(e.path, e.name);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-brand shrink-0 transition"
                    title={t("rename")}
                  >
                    <Pencil size={10} />
                  </button>
                )}
              </div>
              <div
                className="text-right font-mono text-[10px] text-ink-muted tabular-nums"
                title={e.isDir ? "" : formatBytes(e.size)}
              >
                {e.isDir ? "" : formatBytesExact(e.size)}
              </div>
              <div className="text-[10px] text-ink-faint truncate">
                {e.isDir
                  ? t("folder")
                  : e.name.includes(".")
                  ? e.name.split(".").pop()?.toUpperCase()
                  : t("file")}
              </div>
              <div className="text-[10px] text-ink-faint truncate font-mono">
                {formatDate(e.modified)}
              </div>
            </div>
          ))}
      </div>

      <div className="px-2 py-1 border-t border-edge text-[10px] text-ink-faint font-mono tabular-nums shrink-0">
        {session
          ? `${fileCount} ${t("file")} / ${dirCount} ${t("folder")} · ${formatBytesExact(totalFileBytes)} B`
          : "—"}
      </div>
    </div>
  );
}
