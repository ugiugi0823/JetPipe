import { useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import Panel from "./components/Panel";
import ConnectionDialog from "./components/ConnectionDialog";
import ImportDialog from "./components/ImportDialog";
import TransferQueue from "./components/TransferQueue";
import Splitter from "./components/Splitter";
import type { LiveSession, PanelSide, QueueEntry, SavedSession } from "./types";
import {
  cancelTransfer,
  connect,
  disconnect,
  onEnqueue,
  onFileProgress,
  pipeTransfer,
} from "./lib/api";
import {
  deleteSession,
  loadVault,
  resolveCredentials,
  upsertSession,
} from "./lib/vault";
import { joinPath } from "./lib/utils";

interface PanelBinding {
  liveId: string;
  savedId: string;
}

export default function App() {
  const [vault, setVault] = useState<SavedSession[]>([]);
  const [live, setLive] = useState<Record<PanelSide, LiveSession | null>>({
    left: null,
    right: null,
  });
  const [connecting, setConnecting] = useState<PanelSide | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const panelBindings = useRef<Map<PanelSide, PanelBinding>>(new Map());
  const [bindingTick, setBindingTick] = useState(0);
  const jobMeta = useRef<
    Map<string, { sourceSide: PanelSide; destSide: PanelSide }>
  >(new Map());
  const [queueHeight, setQueueHeight] = useState(260);
  const mainRef = useRef<HTMLDivElement>(null);

  function handleQueueSplitterDrag(dy: number) {
    // Pulling the splitter up grows the queue, down shrinks it.
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
        // Filter out previous entries for this job (re-runs) then append.
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

  async function handleConnect(saved: SavedSession, side: PanelSide) {
    setConnecting(side);
    try {
      const prior = live[side];
      if (prior) await disconnect(prior.id).catch(() => {});

      const credential = await resolveCredentials(saved);
      const ls = await connect({
        host: saved.host,
        port: saved.port,
        username: saved.username,
        credential,
        compression: !!saved.compression,
      });
      setLive((prev) => ({ ...prev, [side]: ls }));
      panelBindings.current.set(side, { liveId: ls.id, savedId: saved.id });
      setBindingTick((t) => t + 1);
    } catch (e: any) {
      pushErrorRow(`연결 실패: ${e?.message ?? e}`);
    } finally {
      setConnecting(null);
    }
  }

  async function handleDisconnect(side: PanelSide) {
    const ls = live[side];
    if (!ls) return;
    await disconnect(ls.id).catch(() => {});
    setLive((prev) => ({ ...prev, [side]: null }));
    panelBindings.current.delete(side);
    setBindingTick((t) => t + 1);
  }

  async function handleNewOrEditSession(s: SavedSession) {
    const items = await upsertSession(s);
    setVault(items);
    setShowDialog(false);
  }

  async function handleDeleteSession(id: string) {
    const items = await deleteSession(id);
    setVault(items);
  }

  async function handleToggleCompression(side: PanelSide) {
    const savedId = panelBindings.current.get(side)?.savedId;
    if (!savedId) return;
    const saved = vault.find((s) => s.id === savedId);
    if (!saved) return;
    const updated: SavedSession = { ...saved, compression: !saved.compression };
    // Persist new setting.
    const newVault = await upsertSession(updated);
    setVault(newVault);
    // Reconnect with new setting (compression must be negotiated during the
    // SSH handshake, so a fresh session is required).
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
    targetSide: PanelSide,
    sourceSessionId: string,
    sourcePath: string,
    sourceName: string,
    _sourceIsDir: boolean,
    sourceSide: PanelSide,
    destDir: string
  ) {
    const target = live[targetSide];
    if (!target) return;
    const destPath = joinPath(destDir, sourceName);
    const jobId = crypto.randomUUID();
    jobMeta.current.set(jobId, { sourceSide, destSide: targetSide });

    try {
      await pipeTransfer({
        jobId,
        sourceSessionId,
        sourcePath,
        destSessionId: target.id,
        destPath,
      });
    } catch {
      // Per-file errors already surfaced via transfer:file events; this
      // outer catch only fires when the whole job failed before/after walks.
    }
  }

  async function handleCancelJob(jobId: string) {
    await cancelTransfer(jobId).catch(() => {});
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

  void bindingTick;
  const liveByPanelForSidebar: Record<PanelSide, LiveSession | null> = {
    left:
      live.left && panelBindings.current.get("left")
        ? { ...live.left, id: panelBindings.current.get("left")!.savedId }
        : null,
    right:
      live.right && panelBindings.current.get("right")
        ? { ...live.right, id: panelBindings.current.get("right")!.savedId }
        : null,
  };

  return (
    <div className="h-screen w-screen flex bg-zinc-950 text-zinc-100 overflow-hidden">
      <Sidebar
        vault={vault}
        liveByPanel={liveByPanelForSidebar}
        connectingPanel={connecting}
        onNewSession={() => setShowDialog(true)}
        onImportSshConfig={() => setShowImport(true)}
        onDeleteSession={handleDeleteSession}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />

      <main ref={mainRef} className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 flex gap-3 p-3 min-h-0">
          <Panel
            side="left"
            session={live.left}
            savedId={panelBindings.current.get("left")?.savedId ?? null}
            compression={
              !!vault.find(
                (s) =>
                  s.id === panelBindings.current.get("left")?.savedId
              )?.compression
            }
            onToggleCompression={() => handleToggleCompression("left")}
            onDropFrom={(sid, sp, sn, isDir, sourceSide, destDir) =>
              handleDrop("left", sid, sp, sn, isDir, sourceSide, destDir)
            }
          />
          <Panel
            side="right"
            session={live.right}
            savedId={panelBindings.current.get("right")?.savedId ?? null}
            compression={
              !!vault.find(
                (s) =>
                  s.id === panelBindings.current.get("right")?.savedId
              )?.compression
            }
            onToggleCompression={() => handleToggleCompression("right")}
            onDropFrom={(sid, sp, sn, isDir, sourceSide, destDir) =>
              handleDrop("right", sid, sp, sn, isDir, sourceSide, destDir)
            }
          />
        </div>
        <Splitter onDrag={handleQueueSplitterDrag} />
        <div style={{ height: queueHeight }} className="shrink-0">
          <TransferQueue
            entries={queue}
            onCancelJob={handleCancelJob}
            onClearTab={handleClearTab}
          />
        </div>
      </main>

      {showDialog && (
        <ConnectionDialog
          onCancel={() => setShowDialog(false)}
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
    </div>
  );
}
