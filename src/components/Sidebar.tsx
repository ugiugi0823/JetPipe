import { useEffect, useState } from "react";
import { devlog, hardLog } from "../lib/devlog";
import {
  X,
  Plus,
  Server,
  Trash2,
  ArrowLeftRight,
  KeyRound,
  Lock,
  FileDown,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Settings,
} from "lucide-react";
import SettingsDialog from "./SettingsDialog";
import type { LiveSession, PanelSide, SavedSession } from "../types";
import { cn } from "../lib/utils";

interface Props {
  vault: SavedSession[];
  liveByPanel: Record<PanelSide, LiveSession | null>;
  connectingPanel: PanelSide | null;
  onNewSession: () => void;
  onImportSshConfig: () => void;
  onEditSession: (saved: SavedSession) => void;
  onDeleteSession: (id: string) => void;
  onConnect: (saved: SavedSession, side: PanelSide) => void;
  onDisconnect: (side: PanelSide) => void;
}

const COLLAPSE_KEY = "jetpipe.sidebar.collapsed";

export default function Sidebar({
  vault,
  liveByPanel,
  connectingPanel,
  onNewSession,
  onImportSshConfig,
  onEditSession,
  onDeleteSession,
  onConnect,
  onDisconnect,
}: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* noop */
    }
  }, [collapsed]);

  const liveIds = new Set<string>();
  if (liveByPanel.left) liveIds.add(liveByPanel.left.id);
  if (liveByPanel.right) liveIds.add(liveByPanel.right.id);

  if (collapsed) {
    return (
      <aside className="w-11 shrink-0 border-r border-edge/80 bg-base/40 backdrop-blur flex flex-col items-center py-3 gap-1">
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand to-brand2 flex items-center justify-center text-zinc-950 font-bold mb-1">
          J
        </div>
        <button
          onClick={() => setCollapsed(false)}
          className="text-ink-muted hover:text-ink p-1.5 rounded transition"
          title="사이드바 펼치기"
        >
          <PanelLeftOpen size={14} />
        </button>
        <div className="h-px w-6 bg-surface my-1" />
        <button
          onClick={() => {
            setCollapsed(false);
            onNewSession();
          }}
          className="text-ink-faint hover:text-ink p-1.5 rounded transition"
          title="새 세션"
        >
          <Plus size={14} />
        </button>
        <button
          onClick={() => {
            setCollapsed(false);
            onImportSshConfig();
          }}
          className="text-ink-faint hover:text-ink p-1.5 rounded transition"
          title="SSH config 가져오기"
        >
          <FileDown size={14} />
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="text-ink-faint hover:text-ink p-1.5 rounded transition"
          title="설정"
        >
          <Settings size={14} />
        </button>
        <div className="flex-1" />
        <div
          className="text-[9px] font-mono text-ink-faint tabular-nums"
          title={`${vault.length}개 세션`}
        >
          {vault.length}
        </div>
        {showSettings && (
          <SettingsDialog onClose={() => setShowSettings(false)} />
        )}
      </aside>
    );
  }

  return (
    <aside className="w-72 shrink-0 border-r border-edge/80 bg-base/40 backdrop-blur flex flex-col">
      <header className="px-4 pt-5 pb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand to-brand2 flex items-center justify-center text-zinc-950 font-bold">
            J
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">JetPipe</div>
            <div className="text-[10px] text-ink-faint -mt-0.5">
              in-memory SFTP pipeline
            </div>
          </div>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="text-ink-faint hover:text-ink p-1 rounded transition"
          title="사이드바 접기"
        >
          <PanelLeftClose size={14} />
        </button>
      </header>

      <div className="px-3 pb-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-ink-faint">
          Sessions ({vault.length})
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onImportSshConfig}
            className="text-ink-muted hover:text-ink rounded p-1 transition"
            title="Import from SSH config"
          >
            <FileDown size={14} />
          </button>
          <button
            onClick={onNewSession}
            className="text-ink-muted hover:text-ink rounded p-1 transition"
            title="New session"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
        {vault.length === 0 && (
          <div className="text-xs text-ink-faint p-4 text-center leading-relaxed">
            저장된 세션이 없습니다.
            <br />
            <span className="text-ink-faint">+ 버튼으로 추가</span>
          </div>
        )}
        {vault.map((s) => {
          const live = liveIds.has(s.id);
          return (
            <div
              key={s.id}
              className={cn(
                "group rounded-md border px-2.5 py-2 transition",
                live
                  ? "border-brand/40 bg-brand/5"
                  : "border-transparent hover:border-edge hover:bg-surface/50"
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Server
                  size={14}
                  className={cn(
                    "shrink-0",
                    live ? "text-brand" : "text-ink-faint"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{s.label}</div>
                  <div className="text-[10px] text-ink-faint truncate font-mono">
                    {s.username}@{s.host}
                  </div>
                </div>
                {s.credential.kind === "key" ? (
                  <KeyRound size={11} className="text-ink-faint" />
                ) : (
                  <Lock size={11} className="text-ink-faint" />
                )}
              </div>

              <div className="mt-2 flex items-center gap-1">
                <button
                  disabled={connectingPanel !== null}
                  onClick={() => {
                    hardLog(`click:connect-left label=${s.label} host=${s.host}:${s.port}`);
                    devlog.info(`click:connect-left label=${s.label}`);
                    setPendingId(s.id);
                    onConnect(s, "left");
                    setPendingId(null);
                  }}
                  className={cn(
                    "flex-1 text-[10px] px-1.5 py-1 rounded transition border",
                    liveByPanel.left?.id === s.id
                      ? "border-brand/40 bg-brand/10 text-brand"
                      : "border-edge hover:border-edge hover:bg-surface text-ink-muted"
                  )}
                >
                  {liveByPanel.left?.id === s.id
                    ? "← connected"
                    : connectingPanel === "left" && pendingId === s.id
                    ? "..."
                    : "← left"}
                </button>
                <button
                  disabled={connectingPanel !== null}
                  onClick={() => {
                    hardLog(`click:connect-right label=${s.label} host=${s.host}:${s.port}`);
                    devlog.info(`click:connect-right label=${s.label}`);
                    setPendingId(s.id);
                    onConnect(s, "right");
                    setPendingId(null);
                  }}
                  className={cn(
                    "flex-1 text-[10px] px-1.5 py-1 rounded transition border",
                    liveByPanel.right?.id === s.id
                      ? "border-brand/40 bg-brand/10 text-brand"
                      : "border-edge hover:border-edge hover:bg-surface text-ink-muted"
                  )}
                >
                  {liveByPanel.right?.id === s.id
                    ? "connected →"
                    : connectingPanel === "right" && pendingId === s.id
                    ? "..."
                    : "right →"}
                </button>
                <button
                  onClick={() => onEditSession(s)}
                  className="text-ink-faint hover:text-brand p-1 transition opacity-0 group-hover:opacity-100"
                  title="세션 수정"
                >
                  <Pencil size={11} />
                </button>
                <button
                  onClick={() => onDeleteSession(s.id)}
                  className="text-ink-faint hover:text-rose-400 p-1 transition opacity-0 group-hover:opacity-100"
                  title="삭제"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <footer className="border-t border-edge/80 px-3 py-2.5 space-y-1">
        {(["left", "right"] as PanelSide[]).map((side) => {
          const live = liveByPanel[side];
          return (
            <div
              key={side}
              className="flex items-center justify-between gap-2 text-[10px]"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <ArrowLeftRight
                  size={10}
                  className={cn(
                    "shrink-0",
                    side === "left" ? "rotate-180 text-brand/70" : "text-brand2/70"
                  )}
                />
                <span className="text-ink-faint uppercase tracking-wider">
                  {side}
                </span>
                {live ? (
                  <span className="font-mono text-ink-muted truncate">
                    {live.username}@{live.host}
                  </span>
                ) : (
                  <span className="text-ink-faint">—</span>
                )}
              </div>
              {live && (
                <button
                  onClick={() => onDisconnect(side)}
                  className="shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-rose-500/30 text-rose-400 hover:bg-rose-500/15 hover:border-rose-500/50 transition"
                  title={`${side} 연결 종료`}
                >
                  <X size={10} />
                  <span className="text-[9px]">종료</span>
                </button>
              )}
            </div>
          );
        })}
        <button
          onClick={() => setShowSettings(true)}
          className="w-full mt-1 flex items-center gap-1.5 px-1.5 py-1 rounded text-[10px] text-ink-faint hover:text-ink hover:bg-surface/50 transition"
          title="테마 / 설정"
        >
          <Settings size={11} />
          <span>설정 / 테마</span>
        </button>
      </footer>
      {showSettings && (
        <SettingsDialog onClose={() => setShowSettings(false)} />
      )}
    </aside>
  );
}
