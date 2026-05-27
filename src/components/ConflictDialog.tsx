import { useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";
import type { Conflict } from "../types";
import { formatBytes } from "../lib/utils";
import { useT } from "../lib/i18n";

type Action = "overwrite" | "skip" | "ifSize" | "ifNewer";

/** Resolve one conflict under an action → true means SKIP (don't transfer). */
function shouldSkip(c: Conflict, action: Action): boolean {
  switch (action) {
    case "overwrite":
      return false;
    case "skip":
      return true;
    case "ifSize":
      // Same size → assume identical, skip. Different size → overwrite.
      return c.sourceSize === c.destSize;
    case "ifNewer":
      // Overwrite only when the source is strictly newer; otherwise skip.
      return !(
        c.sourceMtime != null &&
        c.destMtime != null &&
        c.sourceMtime > c.destMtime
      );
  }
}

function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

interface Props {
  conflicts: Conflict[];
  /** Called with the dest paths the user chose to skip. */
  onResolve: (skipDestPaths: string[]) => void;
  onCancel: () => void;
}

export default function ConflictDialog({
  conflicts,
  onResolve,
  onCancel,
}: Props) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [applyAll, setApplyAll] = useState(true);
  const [skip, setSkip] = useState<string[]>([]);

  const current = conflicts[index];
  if (!current) return null;

  function choose(action: Action) {
    if (applyAll) {
      const rest = conflicts.slice(index);
      const newlySkipped = rest
        .filter((c) => shouldSkip(c, action))
        .map((c) => c.dest);
      onResolve([...skip, ...newlySkipped]);
      return;
    }
    const nextSkip = shouldSkip(current, action)
      ? [...skip, current.dest]
      : skip;
    if (index + 1 >= conflicts.length) {
      onResolve(nextSkip);
    } else {
      setSkip(nextSkip);
      setIndex(index + 1);
    }
  }

  const actions: { key: Action; label: string; danger?: boolean }[] = [
    { key: "overwrite", label: t("actOverwrite"), danger: true },
    { key: "skip", label: t("actSkip") },
    { key: "ifSize", label: t("actOverwriteIfSize") },
    { key: "ifNewer", label: t("actOverwriteIfNewer") },
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[460px] bg-base border border-edge rounded-xl shadow-2xl">
        <header className="flex items-center justify-between px-5 py-3 border-b border-edge">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-400 shrink-0" />
            <h2 className="text-sm font-semibold tracking-tight">
              {t("conflictTitle")}
            </h2>
            {conflicts.length > 1 && (
              <span className="text-[10px] text-ink-faint font-mono tabular-nums">
                {index + 1} / {conflicts.length}
              </span>
            )}
          </div>
          <button
            onClick={onCancel}
            className="text-ink-faint hover:text-ink transition"
          >
            <X size={15} />
          </button>
        </header>

        <div className="p-5 space-y-3">
          <div className="text-xs text-ink-muted">{t("conflictExists")}</div>
          <div className="text-xs font-mono font-semibold text-ink break-all bg-surface/40 border border-edge rounded px-2 py-1.5">
            {current.rel}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded border border-edge px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-ink-faint mb-0.5">
                {t("colSource")}
              </div>
              <div className="font-mono text-ink">
                {formatBytes(current.sourceSize)}
              </div>
              <div className="font-mono text-ink-faint text-[10px]">
                {fmtDate(current.sourceMtime)}
              </div>
            </div>
            <div className="rounded border border-edge px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-ink-faint mb-0.5">
                {t("colTarget")}
              </div>
              <div className="font-mono text-ink">
                {formatBytes(current.destSize)}
              </div>
              <div className="font-mono text-ink-faint text-[10px]">
                {fmtDate(current.destMtime)}
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-[11px] text-ink-muted cursor-pointer select-none pt-1">
            <input
              type="checkbox"
              checked={applyAll}
              onChange={(e) => setApplyAll(e.target.checked)}
              className="accent-brand"
            />
            {t("applyToAll")}
          </label>
        </div>

        <footer className="px-5 py-3 border-t border-edge grid grid-cols-2 gap-2">
          {actions.map((a) => (
            <button
              key={a.key}
              onClick={() => choose(a.key)}
              className={
                a.danger
                  ? "px-3 py-1.5 text-xs rounded bg-rose-500 hover:bg-rose-400 text-zinc-950 font-medium transition"
                  : "px-3 py-1.5 text-xs rounded border border-edge text-ink hover:bg-surface/70 transition"
              }
            >
              {a.label}
            </button>
          ))}
        </footer>
      </div>
    </div>,
    document.body
  );
}
