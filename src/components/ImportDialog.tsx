import { useMemo, useState } from "react";
import { X, KeyRound, Lock, FileText, Check } from "lucide-react";
import type { SavedSession } from "../types";
import { parseSshConfig, toSavedSession, type ParsedHost } from "../lib/sshConfig";
import { useT } from "../lib/i18n";

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
  const t = useT();
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
      <div className="w-[720px] max-h-[85vh] bg-base border border-edge rounded-xl shadow-2xl flex flex-col">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-edge">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-brand" />
            <h2 className="text-sm font-semibold tracking-tight">
              Import from SSH config
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="text-ink-faint hover:text-ink transition"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 min-h-0 flex">
          <div className="w-1/2 border-r border-edge flex flex-col">
            <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-ink-faint border-b border-edge flex items-center justify-between">
              <span>{t("pasteSshConfig")}</span>
              {text === "" && (
                <button
                  onClick={() => setText(SAMPLE)}
                  className="text-brand/70 hover:text-brand normal-case tracking-normal"
                >
                  {t("fillExample")}
                </button>
              )}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={SAMPLE}
              spellCheck={false}
              className="flex-1 bg-transparent text-xs font-mono text-ink placeholder-ink-faint p-4 outline-none resize-none"
            />
          </div>

          <div className="w-1/2 flex flex-col">
            <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-ink-faint border-b border-edge flex items-center justify-between">
              <span>{t("parseResult")} ({hosts.length})</span>
              {hosts.length > 0 && (
                <div className="flex gap-2 normal-case tracking-normal">
                  <button
                    onClick={() =>
                      setSelected(
                        Object.fromEntries(hosts.map((h) => [h.alias, true]))
                      )
                    }
                    className="text-ink-muted hover:text-ink"
                  >
                    {t("selAll")}
                  </button>
                  <button
                    onClick={() =>
                      setSelected(
                        Object.fromEntries(hosts.map((h) => [h.alias, false]))
                      )
                    }
                    className="text-ink-muted hover:text-ink"
                  >
                    {t("clearSel")}
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {hosts.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-ink-faint px-6 text-center">
                  {t("importHint")}
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
                      className={`w-full text-left px-4 py-2.5 border-b border-edge/60 transition hover:bg-surface/40 ${
                        isSelected ? "bg-brand/[0.04]" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                            isSelected
                              ? "border-brand bg-brand/20"
                              : "border-edge"
                          }`}
                        >
                          {isSelected && (
                            <Check size={9} className="text-brand" />
                          )}
                        </div>
                        <span className="text-xs font-medium text-ink truncate">
                          {h.alias}
                        </span>
                        {h.identityFile ? (
                          <KeyRound size={10} className="text-ink-faint" />
                        ) : (
                          <Lock size={10} className="text-ink-faint" />
                        )}
                        {exists && (
                          <span className="ml-auto text-[9px] text-amber-400/80 uppercase tracking-wider">
                            duplicate
                          </span>
                        )}
                      </div>
                      <div className="mt-1 ml-5.5 text-[10px] font-mono text-ink-faint truncate">
                        {h.user ? `${h.user}@` : ""}
                        {h.hostName}
                        {h.port !== 22 ? `:${h.port}` : ""}
                      </div>
                      {h.identityFile && (
                        <div className="ml-5.5 text-[10px] font-mono text-ink-faint truncate">
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

        <footer className="px-5 py-3.5 border-t border-edge flex items-center justify-between">
          <div className="text-[11px] text-ink-faint">
            {chosen.length > 0
              ? `${chosen.length}${t("sessionsWillAdd")}`
              : t("noSessionSelected")}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs rounded border border-edge text-ink-muted hover:text-ink transition"
            >
              {t("cancel")}
            </button>
            <button
              onClick={handleImport}
              disabled={chosen.length === 0}
              className="px-3 py-1.5 text-xs rounded bg-brand hover:bg-brand disabled:bg-surface disabled:text-ink-faint text-zinc-950 font-medium transition"
            >
              Import {chosen.length > 0 ? `(${chosen.length})` : ""}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
