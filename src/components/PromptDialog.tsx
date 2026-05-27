import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useT } from "../lib/i18n";

interface Props {
  title: string;
  label?: string;
  initialValue?: string;
  /** When true, select the basename (text before the last dot) — handy for renames. */
  selectBasename?: boolean;
  confirmText?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void | Promise<void>;
}

export default function PromptDialog({
  title,
  label,
  initialValue = "",
  selectBasename = false,
  confirmText,
  onCancel,
  onConfirm,
}: Props) {
  const tr = useT();
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      if (selectBasename) {
        const dot = initialValue.lastIndexOf(".");
        if (dot > 0) input.setSelectionRange(0, dot);
        else input.select();
      } else {
        input.select();
      }
    }, 30);
    return () => clearTimeout(t);
  }, [initialValue, selectBasename]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(value.trim());
    } catch (err: any) {
      setError(String(err?.message ?? err));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="w-[380px] bg-base border border-edge rounded-xl shadow-2xl"
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-edge">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-ink-faint hover:text-ink transition"
          >
            <X size={15} />
          </button>
        </header>
        <div className="p-5 space-y-2">
          {label && (
            <div className="text-[10px] uppercase tracking-wider text-ink-faint">
              {label}
            </div>
          )}
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel();
            }}
            spellCheck={false}
            className="w-full bg-surface/60 border border-edge rounded px-2.5 py-1.5 text-xs font-mono text-ink outline-none focus:border-brand/50 transition"
          />
          {error && (
            <div className="text-[10px] text-rose-400 font-mono break-all pt-1">
              {error}
            </div>
          )}
        </div>
        <footer className="px-5 py-3 border-t border-edge flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded border border-edge text-ink-muted hover:text-ink transition"
          >
            {tr("cancel")}
          </button>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="px-3 py-1.5 text-xs rounded bg-brand hover:bg-brand disabled:bg-surface disabled:text-ink-faint text-zinc-950 font-medium transition"
          >
            {busy ? tr("processing") : confirmText ?? tr("confirm")}
          </button>
        </footer>
      </form>
    </div>
  );
}
