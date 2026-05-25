import { useMemo, useState } from "react";
import { X, KeyRound, Lock, FileText, Check } from "lucide-react";
import type { SavedSession } from "../types";
import { parseSshConfig, toSavedSession, type ParsedHost } from "../lib/sshConfig";

const SAMPLE = `Host myhome
  HostName 192.168.0.8
  User acerg
  IdentityFile ~/.ssh/id_ed25519

Host nhn
  HostName 59.150.33.1
  User maru3
  Port 45301
  IdentityFile ~/.ssh/your_key`;

interface Props {
  existing: SavedSession[];
  onCancel: () => void;
  onImport: (sessions: SavedSession[]) => void;
}

export default function ImportDialog({ existing, onCancel, onImport }: Props) {
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const hosts: ParsedHost[] = useMemo(() => {
    if (!text.trim()) return [];
    try {
      return parseSshConfig(text);
    } catch {
      return [];
    }
  }, [text]);

  const existingLabels = useMemo(
    () => new Set(existing.map((s) => s.label)),
    [existing]
  );

  // Auto-select all newly parsed hosts that aren't already in the vault.
  useMemo(() => {
    setSelected((prev) => {
      const next = { ...prev };
      for (const h of hosts) {
        if (next[h.alias] === undefined) {
          next[h.alias] = !existingLabels.has(h.alias);
        }
      }
      return next;
    });
  }, [hosts, existingLabels]);

  const chosen = hosts.filter((h) => selected[h.alias]);

  async function handleImport() {
    const sessions: SavedSession[] = [];
    for (const h of chosen) {
      sessions.push(await toSavedSession(h));
    }
    onImport(sessions);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[720px] max-h-[85vh] bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl flex flex-col">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-900">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-cyan-400" />
            <h2 className="text-sm font-semibold tracking-tight">
              Import from SSH config
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-200 transition"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 min-h-0 flex">
          <div className="w-1/2 border-r border-zinc-900 flex flex-col">
            <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-900 flex items-center justify-between">
              <span>~/.ssh/config 내용 붙여넣기</span>
              {text === "" && (
                <button
                  onClick={() => setText(SAMPLE)}
                  className="text-cyan-400/70 hover:text-cyan-300 normal-case tracking-normal"
                >
                  예시 채우기
                </button>
              )}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={SAMPLE}
              spellCheck={false}
              className="flex-1 bg-transparent text-xs font-mono text-zinc-200 placeholder-zinc-700 p-4 outline-none resize-none"
            />
          </div>

          <div className="w-1/2 flex flex-col">
            <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-900 flex items-center justify-between">
              <span>파싱 결과 ({hosts.length})</span>
              {hosts.length > 0 && (
                <div className="flex gap-2 normal-case tracking-normal">
                  <button
                    onClick={() =>
                      setSelected(
                        Object.fromEntries(hosts.map((h) => [h.alias, true]))
                      )
                    }
                    className="text-zinc-400 hover:text-zinc-100"
                  >
                    전체
                  </button>
                  <button
                    onClick={() =>
                      setSelected(
                        Object.fromEntries(hosts.map((h) => [h.alias, false]))
                      )
                    }
                    className="text-zinc-400 hover:text-zinc-100"
                  >
                    해제
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {hosts.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-zinc-600 px-6 text-center">
                  왼쪽에 SSH config를 붙여넣으면
                  <br />
                  Host 블록이 자동으로 파싱됩니다
                </div>
              ) : (
                hosts.map((h) => {
                  const isSelected = !!selected[h.alias];
                  const exists = existingLabels.has(h.alias);
                  return (
                    <button
                      key={h.alias}
                      onClick={() =>
                        setSelected((p) => ({ ...p, [h.alias]: !p[h.alias] }))
                      }
                      className={`w-full text-left px-4 py-2.5 border-b border-zinc-900/60 transition hover:bg-zinc-900/40 ${
                        isSelected ? "bg-cyan-500/[0.04]" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                            isSelected
                              ? "border-cyan-500 bg-cyan-500/20"
                              : "border-zinc-700"
                          }`}
                        >
                          {isSelected && (
                            <Check size={9} className="text-cyan-300" />
                          )}
                        </div>
                        <span className="text-xs font-medium text-zinc-100 truncate">
                          {h.alias}
                        </span>
                        {h.identityFile ? (
                          <KeyRound size={10} className="text-zinc-500" />
                        ) : (
                          <Lock size={10} className="text-zinc-500" />
                        )}
                        {exists && (
                          <span className="ml-auto text-[9px] text-amber-400/80 uppercase tracking-wider">
                            duplicate
                          </span>
                        )}
                      </div>
                      <div className="mt-1 ml-5.5 text-[10px] font-mono text-zinc-500 truncate">
                        {h.user ? `${h.user}@` : ""}
                        {h.hostName}
                        {h.port !== 22 ? `:${h.port}` : ""}
                      </div>
                      {h.identityFile && (
                        <div className="ml-5.5 text-[10px] font-mono text-zinc-600 truncate">
                          {h.identityFile}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <footer className="px-5 py-3.5 border-t border-zinc-900 flex items-center justify-between">
          <div className="text-[11px] text-zinc-500">
            {chosen.length > 0
              ? `${chosen.length}개 세션이 추가됩니다`
              : "선택된 세션이 없습니다"}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs rounded border border-zinc-800 text-zinc-400 hover:text-zinc-100 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={chosen.length === 0}
              className="px-3 py-1.5 text-xs rounded bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-medium transition"
            >
              Import {chosen.length > 0 ? `(${chosen.length})` : ""}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
