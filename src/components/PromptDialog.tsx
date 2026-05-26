import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

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
  confirmText = "확인",
  onCancel,
  onConfirm,
}: Props) {
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
        className="w-[380px] bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl"
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-zinc-900">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-200 transition"
          >
            <X size={15} />
          </button>
        </header>
        <div className="p-5 space-y-2">
          {label && (
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
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
            className="w-full bg-zinc-900/60 border border-zinc-800 rounded px-2.5 py-1.5 text-xs font-mono text-zinc-100 outline-none focus:border-brand/50 transition"
          />
          {error && (
            <div className="text-[10px] text-rose-400 font-mono break-all pt-1">
              {error}
            </div>
          )}
        </div>
        <footer className="px-5 py-3 border-t border-zinc-900 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded border border-zinc-800 text-zinc-400 hover:text-zinc-100 transition"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="px-3 py-1.5 text-xs rounded bg-brand hover:bg-brand disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-medium transition"
          >
            {busy ? "처리 중…" : confirmText}
          </button>
        </footer>
      </form>
    </div>
  );
}
