import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  FolderPlus,
  History,
  Home,
  Pencil,
  RefreshCw,
  Trash2,
  Zap,
  ZapOff,
} from "lucide-react";
import TreeView from "./TreeView";
import FileList from "./FileList";
import PromptDialog from "./PromptDialog";
import ConfirmDialog from "./ConfirmDialog";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import Splitter from "./Splitter";
import type { LiveSession, PanelSide } from "../types";
import { deletePath, mkdir, renamePath } from "../lib/api";
import { cn, joinPath, parentPath } from "../lib/utils";
import { getVisits, recordVisit } from "../lib/pathHistory";
import { useT } from "../lib/i18n";

interface Props {
  side: PanelSide;
  session: LiveSession | null;
  savedId: string | null;
  compression: boolean;
  /** Incremented by the parent (e.g. when a transfer into this panel
   *  finishes) to force a re-listing without the user hitting refresh. */
  refreshNonce?: number;
  onToggleCompression: () => void;
  onDropFrom: (
    sourceSessionId: string,
    sourcePath: string,
    sourceName: string,
    sourceIsDir: boolean,
    sourceSide: PanelSide,
    destDir: string
  ) => void;
}

function readPayload(dt: DataTransfer): string | null {
  const custom = dt.getData("application/jetpipe");
  if (custom) return custom;
  const text = dt.getData("text/plain");
  if (text.startsWith("jetpipe:")) return text.slice("jetpipe:".length);
  return (
    (window as unknown as { __jetpipeDrag?: string }).__jetpipeDrag ?? null
  );
}

type RenameTarget = { path: string; name: string };
type NewFolderRequest = { parent: string };
type DeleteTarget = { path: string; name: string; isDir: boolean };
type Menu = { x: number; y: number; items: ContextMenuItem[] };

const MAX_HISTORY = 50;

export default function Panel({
  side,
  session,
  savedId,
  compression,
  refreshNonce,
  onToggleCompression,
  onDropFrom,
}: Props) {
  const t = useT();
  const [selected, setSelected] = useState<string>("/");
  const [pathInput, setPathInput] = useState<string>("/");
  const [refreshTick, setRefreshTick] = useState(0);

  // External refresh trigger (transfer-into-this-panel completed).
  useEffect(() => {
    if (refreshNonce === undefined || refreshNonce === 0) return;
    setRefreshTick((t) => t + 1);
  }, [refreshNonce]);
  const [dragOver, setDragOver] = useState(false);
  const [newFolder, setNewFolder] = useState<NewFolderRequest | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [showHistoryMenu, setShowHistoryMenu] = useState(false);
  // Tree section's flex ratio (0-1). The file list takes the remainder.
  const [treeRatio, setTreeRatio] = useState(0.6);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  // Browser-style navigation history. `idx` points at the current path.
  // back/forward shift the index; any other `selected` change truncates
  // forward entries and appends (a fresh branch).
  const [history, setHistory] = useState<{ paths: string[]; idx: number }>({
    paths: ["/"],
    idx: 0,
  });
  // Set when back/forward/session-init mutates `selected` so the effect
  // below doesn't treat it as a fresh user navigation.
  const skipHistoryPush = useRef(false);

  useEffect(() => {
    setPathInput(selected);
  }, [selected]);

  // Reset history on session change to that session's home dir.
  useEffect(() => {
    const start = session ? session.home || "/" : "/";
    setHistory({ paths: [start], idx: 0 });
    skipHistoryPush.current = true;
    setSelected(start);
  }, [session?.id]);

  // Push every external `selected` change onto the history stack and persist
  // it to the saved-session's visit log so it shows up in the dropdown next
  // time the user connects to this server.
  useEffect(() => {
    if (skipHistoryPush.current) {
      skipHistoryPush.current = false;
      return;
    }
    setHistory((h) => {
      if (h.paths[h.idx] === selected) return h;
      const trunc = h.paths.slice(0, h.idx + 1);
      const next = [...trunc, selected];
      const overflow = Math.max(0, next.length - MAX_HISTORY);
      return {
        paths: next.slice(overflow),
        idx: trunc.length - overflow,
      };
    });
    if (savedId && selected) recordVisit(savedId, selected);
  }, [selected, savedId]);

  function handleSplitterDrag(dy: number) {
    const c = splitContainerRef.current;
    if (!c) return;
    const h = c.clientHeight;
    if (h < 50) return;
    setTreeRatio((p) => Math.max(0.12, Math.min(0.88, p + dy / h)));
  }

  function handleDropToFolder(destDir: string, payload: string) {
    if (!session) return;
    try {
      const data = JSON.parse(payload);
      if (data.side === side && data.path === destDir) return; // dropping a folder onto itself
      onDropFrom(
        data.sessionId,
        data.path,
        data.name,
        !!data.isDir,
        data.side as PanelSide,
        destDir
      );
    } catch {
      /* noop */
    } finally {
      (window as unknown as { __jetpipeDrag?: string }).__jetpipeDrag =
        undefined;
    }
  }

  function navigateBack() {
    if (history.idx === 0) return;
    const newIdx = history.idx - 1;
    skipHistoryPush.current = true;
    setHistory((h) => ({ ...h, idx: newIdx }));
    setSelected(history.paths[newIdx]);
  }

  function navigateForward() {
    if (history.idx >= history.paths.length - 1) return;
    const newIdx = history.idx + 1;
    skipHistoryPush.current = true;
    setHistory((h) => ({ ...h, idx: newIdx }));
    setSelected(history.paths[newIdx]);
  }

  const canBack = history.idx > 0;
  const canForward = history.idx < history.paths.length - 1;

  async function handleCreateFolder(name: string) {
    if (!session || !newFolder) return;
    const target = joinPath(newFolder.parent, name);
    await mkdir(session.id, target);
    setNewFolder(null);
    setRefreshTick((t) => t + 1);
  }

  async function handleDelete() {
    if (!session || !deleteTarget) return;
    await deletePath(session.id, deleteTarget.path);
    // If we deleted the currently selected dir (or an ancestor), step up.
    if (
      selected === deleteTarget.path ||
      selected.startsWith(deleteTarget.path + "/")
    ) {
      setSelected(parentPath(deleteTarget.path));
    }
    setDeleteTarget(null);
    setRefreshTick((t) => t + 1);
  }

  async function handleRename(newName: string) {
    if (!session || !renameTarget) return;
    const parent = parentPath(renameTarget.path);
    const to = joinPath(parent, newName);
    if (to === renameTarget.path) {
      setRenameTarget(null);
      return;
    }
    await renamePath(session.id, renameTarget.path, to);
    setRenameTarget(null);
    setRefreshTick((t) => t + 1);
  }

  function openMenu(
    e: React.MouseEvent,
    target?: { path: string; name: string; isDir: boolean }
  ) {
    if (!session) return;
    e.preventDefault();
    e.stopPropagation();
    const items: ContextMenuItem[] = [];

    // Determine which parent dir a "new folder" should be created in.
    // - Right-click on a dir: inside that dir
    // - Right-click on a file or empty area: inside the currently selected dir
    const parentForNew =
      target && target.isDir ? target.path : selected;

    items.push({
      label: t("newFolder"),
      icon: FolderPlus,
      onClick: () => setNewFolder({ parent: parentForNew }),
    });

    if (target) {
      items.push({
        label: t("rename"),
        icon: Pencil,
        onClick: () =>
          setRenameTarget({ path: target.path, name: target.name }),
      });
      items.push({
        label: t("delete"),
        icon: Trash2,
        danger: true,
        onClick: () =>
          setDeleteTarget({
            path: target.path,
            name: target.name,
            isDir: target.isDir,
          }),
      });
    }

    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  function handleDragOver(e: React.DragEvent) {
    if (!session) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }
  function handleDragLeave() {
    setDragOver(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!session) return;
    const raw = readPayload(e.dataTransfer);
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (data.side === side) return; // same panel
      onDropFrom(
        data.sessionId,
        data.path,
        data.name,
        !!data.isDir,
        data.side as PanelSide,
        selected
      );
    } catch {
      /* noop */
    } finally {
      (window as unknown as { __jetpipeDrag?: string }).__jetpipeDrag =
        undefined;
    }
  }

  const accent = side === "left" ? "from-brand/20" : "from-brand2/20";

  return (
    <section
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "flex-1 min-w-0 flex flex-col bg-base/40 border border-edge rounded-lg overflow-hidden relative transition",
        dragOver && "ring-1 ring-inset ring-brand/50 bg-brand/[0.03]"
      )}
    >
      <header
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 border-b border-edge bg-gradient-to-r to-transparent shrink-0",
          accent
        )}
      >
        <span className="text-[10px] uppercase tracking-wider text-ink-faint font-medium">
          {side}
        </span>
        {session ? (
          <span className="text-[11px] font-mono text-ink-muted truncate">
            {session.username}@{session.host}
          </span>
        ) : (
          <span className="text-[11px] text-ink-faint">{t("notConnected")}</span>
        )}
      </header>

      {/* Path bar — single source of truth for selected directory */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-edge bg-base/60 shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-ink-faint shrink-0 mr-1">
          {side === "left" ? t("leftSite") : t("rightSite")}
        </span>
        <button
          onClick={navigateBack}
          disabled={!session || !canBack}
          className="text-ink-faint hover:text-ink disabled:opacity-20 p-0.5 rounded transition shrink-0"
          title={
            canBack
              ? `${t("histBack")}: ${history.paths[history.idx - 1]}`
              : t("noHistBack")
          }
        >
          <ArrowLeft size={11} />
        </button>
        <button
          onClick={navigateForward}
          disabled={!session || !canForward}
          className="text-ink-faint hover:text-ink disabled:opacity-20 p-0.5 rounded transition shrink-0"
          title={
            canForward
              ? `${t("histFwd")}: ${history.paths[history.idx + 1]}`
              : t("noHistFwd")
          }
        >
          <ArrowRight size={11} />
        </button>
        <button
          onClick={() => session && setSelected(parentPath(selected))}
          disabled={!session || selected === "/"}
          className="text-ink-faint hover:text-ink disabled:opacity-20 p-0.5 rounded transition shrink-0"
          title={t("parentFolder")}
        >
          <ChevronUp size={11} />
        </button>
        <button
          onClick={() => session && setSelected(session.home || "/")}
          disabled={!session}
          className="text-ink-faint hover:text-ink disabled:opacity-20 p-0.5 rounded transition shrink-0"
          title={t("home")}
        >
          <Home size={11} />
        </button>
        <div className="flex-1 min-w-0 relative">
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setSelected(pathInput);
            }}
            onBlur={() => {
              if (pathInput !== selected) setSelected(pathInput);
            }}
            disabled={!session}
            spellCheck={false}
            className="w-full bg-surface/60 border border-edge rounded pl-2 pr-6 py-0.5 text-[11px] font-mono text-ink placeholder-ink-faint outline-none focus:border-brand/50 disabled:text-ink-faint transition"
            placeholder="/"
          />
          <button
            type="button"
            onClick={() => setShowHistoryMenu((v) => !v)}
            disabled={!session}
            className="absolute top-1/2 -translate-y-1/2 right-1 text-ink-faint hover:text-ink disabled:opacity-20 transition p-0.5 rounded"
            title={t("visitedPaths")}
          >
            <ChevronDown size={11} />
          </button>
          {showHistoryMenu && session && savedId && (
            <PathHistoryMenu
              savedId={savedId}
              current={selected}
              onPick={(p) => {
                setShowHistoryMenu(false);
                setSelected(p);
              }}
              onClose={() => setShowHistoryMenu(false)}
            />
          )}
        </div>
        <button
          onClick={onToggleCompression}
          disabled={!session || !savedId}
          className={cn(
            "transition p-0.5 rounded shrink-0 disabled:opacity-30",
            compression
              ? "text-brand hover:text-brand"
              : "text-ink-faint hover:text-ink"
          )}
          title={compression ? t("compOn") : t("compOff")}
        >
          {compression ? <Zap size={11} /> : <ZapOff size={11} />}
        </button>
        <button
          onClick={() => setNewFolder({ parent: selected })}
          disabled={!session}
          className="text-ink-faint hover:text-ink disabled:opacity-30 transition p-0.5 rounded shrink-0"
          title={t("newFolder")}
        >
          <FolderPlus size={11} />
        </button>
        <button
          onClick={() => setRefreshTick((t) => t + 1)}
          disabled={!session}
          className="text-ink-faint hover:text-ink disabled:opacity-30 transition p-0.5 rounded shrink-0"
          title={t("refresh")}
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {/* Tree (top) + FileList (bottom) with a draggable divider */}
      <div ref={splitContainerRef} className="flex-1 min-h-0 flex flex-col">
        <div
          style={{ flexBasis: `${treeRatio * 100}%` }}
          className="min-h-0 flex-shrink overflow-hidden"
          onContextMenu={(e) => openMenu(e)}
        >
          <TreeView
            side={side}
            session={session}
            selected={selected}
            refreshTick={refreshTick}
            onSelect={setSelected}
            onRename={(path, name) => setRenameTarget({ path, name })}
            onContextMenuEntry={(e, path, name, isDir) =>
              openMenu(e, { path, name, isDir })
            }
            onDropToFolder={handleDropToFolder}
            onDragStartFolder={() => {}}
          />
        </div>
        <Splitter onDrag={handleSplitterDrag} />
        <div
          className="flex-1 min-h-0 overflow-hidden"
          onContextMenu={(e) => openMenu(e)}
        >
          <FileList
            side={side}
            session={session}
            path={selected}
            refreshTick={refreshTick}
            onNavigate={setSelected}
            onRename={(path, name) => setRenameTarget({ path, name })}
            onContextMenuEntry={(e, path, name, isDir) =>
              openMenu(e, { path, name, isDir })
            }
            onDropToFolder={handleDropToFolder}
            onDragStartFile={() => {}}
          />
        </div>
      </div>

      {dragOver && (
        <div className="pointer-events-none absolute top-2 right-2 px-2.5 py-1 rounded-full bg-brand/15 border border-brand/40 text-brand text-[10px] font-medium tracking-wide animate-pulse-glow">
          ⚡ {selected} {t("transferTo")}
        </div>
      )}

      {newFolder && (
        <PromptDialog
          title={t("newFolder")}
          label={`${t("pathColon")}: ${newFolder.parent}`}
          initialValue="new-folder"
          confirmText={t("create")}
          onCancel={() => setNewFolder(null)}
          onConfirm={handleCreateFolder}
        />
      )}
      {renameTarget && (
        <PromptDialog
          title={t("rename")}
          label={`${t("currentColon")}: ${renameTarget.path}`}
          initialValue={renameTarget.name}
          selectBasename
          confirmText={t("change")}
          onCancel={() => setRenameTarget(null)}
          onConfirm={handleRename}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title={deleteTarget.isDir ? t("delFolderTitle") : t("delFileTitle")}
          message={
            deleteTarget.isDir ? t("delFolderMsg") : t("delFileMsg")
          }
          detail={deleteTarget.path}
          confirmText={t("delete")}
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}

function PathHistoryMenu({
  savedId,
  current,
  onPick,
  onClose,
}: {
  savedId: string;
  current: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [paths] = useState(() => getVisits(savedId));

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute z-30 top-full left-0 right-0 mt-1 bg-base border border-edge rounded-md shadow-2xl py-1 max-h-72 overflow-y-auto"
    >
      <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-ink-faint flex items-center gap-1">
        <History size={10} /> {t("visitHistory")} ({paths.length})
      </div>
      {paths.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-ink-faint">
          {t("noVisits")}
        </div>
      ) : (
        paths.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className={`w-full text-left px-3 py-1 text-[11px] font-mono truncate transition ${
              p === current
                ? "bg-brand/10 text-brand"
                : "text-ink-muted hover:bg-surface"
            }`}
          >
            {p}
          </button>
        ))
      )}
    </div>
  );
}
