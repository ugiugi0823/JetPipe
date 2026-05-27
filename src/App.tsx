import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import Sidebar from "./components/Sidebar";
import Panel from "./components/Panel";
import ConnectionDialog from "./components/ConnectionDialog";
import ImportDialog from "./components/ImportDialog";
import TransferQueue from "./components/TransferQueue";
import Splitter from "./components/Splitter";
import DevConsole from "./components/DevConsole";
import type { LiveSession, PanelSide, QueueEntry, SavedSession } from "./types";
import {
  cancelTransfer,
  connect,
  connectLocal,
  disconnect,
  onEnqueue,
  onFileProgress,
  pipeTransfer,
} from "./lib/api";

const LOCAL_SAVED_ID = "__local__";
const LOCAL_LABEL = "로컬 PC";
import {
  deleteSession,
  loadVault,
  resolveCredentials,
  upsertSession,
} from "./lib/vault";
import { cn, joinPath } from "./lib/utils";
import { devlog } from "./lib/devlog";

interface PanelConn {
  live: LiveSession;
  savedId: string;
  label: string;
}

interface Workspace {
  id: string;
  left: PanelConn | null;
  right: PanelConn | null;
}

let wsCounter = 1;
function newWorkspace(): Workspace {
  return { id: `ws-${wsCounter++}-${Date.now()}`, left: null, right: null };
}

function wsTitle(ws: Workspace, index: number): string {
  if (!ws.left && !ws.right) return `작업 ${index + 1}`;
  const l = ws.left?.label ?? "—";
  const r = ws.right?.label ?? "—";
  return `${l} ↔ ${r}`;
}

export default function App() {
  const [vault, setVault] = useState<SavedSession[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => [
    newWorkspace(),
  ]);
  const [activeWsId, setActiveWsId] = useState<string>(() => workspaces[0].id);
  const [connecting, setConnecting] = useState<PanelSide | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [editingSession, setEditingSession] = useState<SavedSession | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const jobMeta = useRef<
    Map<string, { sourceSide: PanelSide; destSide: PanelSide }>
  >(new Map());
  const [queueHeight, setQueueHeight] = useState(260);
  const mainRef = useRef<HTMLDivElement>(null);

  const activeWs =
    workspaces.find((w) => w.id === activeWsId) ?? workspaces[0];

  function patchWorkspace(id: string, patch: (ws: Workspace) => Workspace) {
    setWorkspaces((all) => all.map((w) => (w.id === id ? patch(w) : w)));
  }

  function handleQueueSplitterDrag(dy: number) {
    setQueueHeight((h) => {
      const main = mainRef.current;
      const maxH = main ? Math.max(120, main.clientHeight - 160) : 600;
      return Math.max(80, Math.min(maxH, h - dy));
    });
  }

  useEffect(() => {
    setVault(loadVault());
  }, []);

  useEffect(() => {
    const enqueueUnlisten = onEnqueue((jobId, files) => {
      const meta = jobMeta.current.get(jobId);
      setQueue((prev) => {
        const filtered = prev.filter((q) => q.jobId !== jobId);
        return [
          ...filtered,
          ...files.map((f) => ({
            ...f,
            sourceSide: meta?.sourceSide,
            destSide: meta?.destSide,
          })),
        ];
      });
    });

    const progressUnlisten = onFileProgress((p) => {
      setQueue((prev) =>
        prev.map((q) =>
          q.jobId === p.jobId && q.fileId === p.fileId
            ? {
                ...q,
                bytes: p.bytes,
                bps: p.bps,
                status: p.status,
                error: p.error,
              }
            : q
        )
      );
    });

    return () => {
      enqueueUnlisten.then((u) => u());
      progressUnlisten.then((u) => u());
    };
  }, []);

  // Connect into the *active* workspace's panel side.
  async function handleConnect(saved: SavedSession, side: PanelSide) {
    const wsId = activeWsId;
    devlog.info(`handleConnect:start ws=${wsId} side=${side} label=${saved.label}`);
    setConnecting(side);
    try {
      const ws = workspaces.find((w) => w.id === wsId);
      const prior = ws?.[side];
      if (prior) {
        await disconnect(prior.live.id).catch((e) =>
          devlog.warn("disconnect-prior failed", e)
        );
      }

      const credential = await resolveCredentials(saved);
      const ls = await connect({
        host: saved.host,
        port: saved.port,
        username: saved.username,
        credential,
        compression: !!saved.compression,
      });
      devlog.info(`handleConnect:connected liveId=${ls.id} home=${ls.home}`);

      patchWorkspace(wsId, (w) => ({
        ...w,
        [side]: { live: ls, savedId: saved.id, label: saved.label },
      }));
    } catch (e: any) {
      devlog.error(`handleConnect:failed ${side}`, e?.message ?? e);
      pushErrorRow(`연결 실패: ${e?.message ?? e}`);
    } finally {
      setConnecting(null);
    }
  }

  // Connect the local filesystem into the active workspace's panel side.
  async function handleConnectLocal(side: PanelSide) {
    const wsId = activeWsId;
    setConnecting(side);
    try {
      const ws = workspaces.find((w) => w.id === wsId);
      const prior = ws?.[side];
      if (prior) await disconnect(prior.live.id).catch(() => {});
      const ls = await connectLocal();
      patchWorkspace(wsId, (w) => ({
        ...w,
        [side]: { live: ls, savedId: LOCAL_SAVED_ID, label: LOCAL_LABEL },
      }));
    } catch (e: any) {
      pushErrorRow(`로컬 연결 실패: ${e?.message ?? e}`);
    } finally {
      setConnecting(null);
    }
  }

  async function handleDisconnect(side: PanelSide) {
    const ws = workspaces.find((w) => w.id === activeWsId);
    const conn = ws?.[side];
    if (!conn) return;
    await disconnect(conn.live.id).catch(() => {});
    patchWorkspace(activeWsId, (w) => ({ ...w, [side]: null }));
  }

  async function handleNewOrEditSession(s: SavedSession) {
    const items = await upsertSession(s);
    setVault(items);
    const wasEditing = !!editingSession;
    setShowDialog(false);
    setEditingSession(null);

    if (wasEditing) {
      // Reconnect any active-workspace panel bound to this saved session.
      for (const side of ["left", "right"] as PanelSide[]) {
        if (activeWs[side]?.savedId === s.id) {
          await handleConnect(s, side);
        }
      }
    }
  }

  async function handleDeleteSession(id: string) {
    const items = await deleteSession(id);
    setVault(items);
  }

  async function handleToggleCompression(side: PanelSide) {
    const savedId = activeWs[side]?.savedId;
    if (!savedId) return;
    const saved = vault.find((s) => s.id === savedId);
    if (!saved) return;
    const updated: SavedSession = { ...saved, compression: !saved.compression };
    const newVault = await upsertSession(updated);
    setVault(newVault);
    await handleConnect(updated, side);
  }

  async function handleImport(sessions: SavedSession[]) {
    let items: SavedSession[] = vault;
    for (const s of sessions) {
      items = await upsertSession(s);
    }
    setVault(items);
    setShowImport(false);
  }

  async function handleDrop(
    wsId: string,
    targetSide: PanelSide,
    sourceSessionId: string,
    sourcePath: string,
    sourceName: string,
    _sourceIsDir: boolean,
    sourceSide: PanelSide,
    destDir: string
  ) {
    const ws = workspaces.find((w) => w.id === wsId);
    const target = ws?.[targetSide];
    if (!target) return;
    const destPath = joinPath(destDir, sourceName);
    const jobId = crypto.randomUUID();
    jobMeta.current.set(jobId, { sourceSide, destSide: targetSide });

    try {
      await pipeTransfer({
        jobId,
        sourceSessionId,
        sourcePath,
        destSessionId: target.live.id,
        destPath,
      });
    } catch {
      /* per-file errors surface via transfer:file events */
    }
  }

  // ── Workspace tab management ───────────────────────────────────────────
  function addWorkspace() {
    const ws = newWorkspace();
    setWorkspaces((all) => [...all, ws]);
    setActiveWsId(ws.id);
  }

  async function closeWorkspace(id: string) {
    const ws = workspaces.find((w) => w.id === id);
    if (ws) {
      // Tear down its live sessions.
      if (ws.left) await disconnect(ws.left.live.id).catch(() => {});
      if (ws.right) await disconnect(ws.right.live.id).catch(() => {});
    }
    setWorkspaces((all) => {
      const remaining = all.filter((w) => w.id !== id);
      if (remaining.length === 0) {
        const fresh = newWorkspace();
        setActiveWsId(fresh.id);
        return [fresh];
      }
      if (id === activeWsId) {
        setActiveWsId(remaining[remaining.length - 1].id);
      }
      return remaining;
    });
  }

  async function handleCancelJob(jobId: string) {
    await cancelTransfer(jobId).catch(() => {});
  }

  async function handleCancelFiles(fileIds: string[]) {
    const jobIds = new Set<string>();
    for (const f of fileIds) {
      const entry = queue.find((q) => q.fileId === f);
      if (entry) jobIds.add(entry.jobId);
    }
    await Promise.all([...jobIds].map((j) => cancelTransfer(j).catch(() => {})));
  }

  function handleRemoveFiles(fileIds: string[]) {
    const ids = new Set(fileIds);
    setQueue((prev) => prev.filter((q) => !ids.has(q.fileId)));
  }

  async function handleStopAndClearAll() {
    const activeJobIds = new Set(
      queue
        .filter((q) => q.status === "active" || q.status === "queued")
        .map((q) => q.jobId)
    );
    await Promise.all(
      [...activeJobIds].map((j) => cancelTransfer(j).catch(() => {}))
    );
    setQueue([]);
  }

  function handleClearTab(tab: "queue" | "failed" | "done") {
    setQueue((prev) =>
      prev.filter((q) => {
        if (tab === "done") return q.status !== "done";
        if (tab === "failed") return q.status !== "failed";
        return true;
      })
    );
  }

  function pushErrorRow(msg: string) {
    const jobId = `err-${crypto.randomUUID()}`;
    const fileId = `err-${crypto.randomUUID()}`;
    setQueue((prev) => [
      ...prev,
      {
        jobId,
        fileId,
        rel: msg,
        source: "",
        dest: "",
        size: 0,
        bytes: 0,
        bps: 0,
        status: "failed",
        error: msg,
      },
    ]);
  }

  // Sidebar shows the *active* workspace's bindings (keyed by savedId so the
  // session list can highlight connected entries).
  const liveByPanelForSidebar: Record<PanelSide, LiveSession | null> = {
    left: activeWs.left
      ? { ...activeWs.left.live, id: activeWs.left.savedId }
      : null,
    right: activeWs.right
      ? { ...activeWs.right.live, id: activeWs.right.savedId }
      : null,
  };

  return (
    <div className="h-screen w-screen flex bg-base text-ink overflow-hidden">
      <Sidebar
        vault={vault}
        liveByPanel={liveByPanelForSidebar}
        connectingPanel={connecting}
        onNewSession={() => {
          setEditingSession(null);
          setShowDialog(true);
        }}
        onImportSshConfig={() => setShowImport(true)}
        onEditSession={async (s) => {
          try {
            const cred = await resolveCredentials(s);
            setEditingSession({ ...s, credential: cred });
          } catch {
            setEditingSession(s);
          }
          setShowDialog(true);
        }}
        onDeleteSession={handleDeleteSession}
        onConnect={handleConnect}
        onConnectLocal={handleConnectLocal}
        onDisconnect={handleDisconnect}
      />

      <main ref={mainRef} className="flex-1 flex flex-col min-w-0">
        {/* Workspace tab bar */}
        <div className="flex items-center gap-1 px-2 pt-1.5 pb-0 border-b border-edge bg-base/60 shrink-0 overflow-x-auto">
          {workspaces.map((ws, i) => {
            const active = ws.id === activeWsId;
            return (
              <div
                key={ws.id}
                onClick={() => setActiveWsId(ws.id)}
                className={cn(
                  "group flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-t-md cursor-pointer transition border-b-2 max-w-[200px]",
                  active
                    ? "bg-surface/60 border-brand text-ink"
                    : "border-transparent text-ink-muted hover:text-ink hover:bg-surface/30"
                )}
                title={wsTitle(ws, i)}
              >
                <span className="text-[11px] truncate">{wsTitle(ws, i)}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeWorkspace(ws.id);
                  }}
                  className="shrink-0 text-ink-faint hover:text-rose-400 opacity-0 group-hover:opacity-100 transition p-0.5 rounded"
                  title="탭 닫기 (연결 종료)"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
          <button
            onClick={addWorkspace}
            className="shrink-0 text-ink-muted hover:text-ink p-1.5 rounded transition"
            title="새 작업 탭"
          >
            <Plus size={13} />
          </button>
        </div>

        {/* All workspaces are mounted; only the active one is shown so each
            keeps its own panel state (path, tree expansion) across switches. */}
        <div className="flex-1 min-h-0 relative">
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              className={cn(
                "absolute inset-0 flex gap-3 p-3 min-h-0",
                ws.id !== activeWsId && "hidden"
              )}
            >
              <Panel
                side="left"
                session={ws.left?.live ?? null}
                savedId={ws.left?.savedId ?? null}
                compression={
                  !!vault.find((s) => s.id === ws.left?.savedId)?.compression
                }
                onToggleCompression={() => handleToggleCompression("left")}
                onDropFrom={(sid, sp, sn, isDir, sourceSide, destDir) =>
                  handleDrop(ws.id, "left", sid, sp, sn, isDir, sourceSide, destDir)
                }
              />
              <Panel
                side="right"
                session={ws.right?.live ?? null}
                savedId={ws.right?.savedId ?? null}
                compression={
                  !!vault.find((s) => s.id === ws.right?.savedId)?.compression
                }
                onToggleCompression={() => handleToggleCompression("right")}
                onDropFrom={(sid, sp, sn, isDir, sourceSide, destDir) =>
                  handleDrop(ws.id, "right", sid, sp, sn, isDir, sourceSide, destDir)
                }
              />
            </div>
          ))}
        </div>

        <Splitter onDrag={handleQueueSplitterDrag} />
        <div style={{ height: queueHeight }} className="shrink-0">
          <TransferQueue
            entries={queue}
            onCancelJob={handleCancelJob}
            onCancelFiles={handleCancelFiles}
            onRemoveFiles={handleRemoveFiles}
            onStopAndClearAll={handleStopAndClearAll}
            onClearTab={handleClearTab}
          />
        </div>
      </main>

      {showDialog && (
        <ConnectionDialog
          initial={editingSession}
          onCancel={() => {
            setShowDialog(false);
            setEditingSession(null);
          }}
          onSave={handleNewOrEditSession}
        />
      )}

      {showImport && (
        <ImportDialog
          existing={vault}
          onCancel={() => setShowImport(false)}
          onImport={handleImport}
        />
      )}

      <DevConsole />
    </div>
  );
}
