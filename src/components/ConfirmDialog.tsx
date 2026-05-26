import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";

interface Props {
  title: string;
  message: string;
  detail?: string;
  confirmText?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export default function ConfirmDialog({
  title,
  message,
  detail,
  confirmText = "확인",
  danger = false,
  onCancel,
  onConfirm,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err: any) {
      setError(String(err?.message ?? err));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[420px] bg-base border border-edge rounded-xl shadow-2xl">
        <header className="flex items-center justify-between px-5 py-3 border-b border-edge">
          <div className="flex items-center gap-2">
            {danger && (
              <AlertTriangle size={14} className="text-rose-400 shrink-0" />
            )}
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          </div>
          <button
            onClick={onCancel}
            className="text-ink-faint hover:text-ink transition"
          >
            <X size={15} />
          </button>
        </header>
        <div className="p-5 space-y-2">
          <div className="text-xs text-ink leading-relaxed">{message}</div>
          {detail && (
            <div className="text-[10px] text-ink-faint font-mono break-all bg-surface/40 border border-edge rounded px-2 py-1.5">
              {detail}
            </div>
          )}
          {error && (
            <div className="text-[10px] text-rose-400 font-mono break-all pt-1">
              {error}
            </div>
          )}
        </div>
        <footer className="px-5 py-3 border-t border-edge flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded border border-edge text-ink-muted hover:text-ink transition"
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            className={`px-3 py-1.5 text-xs rounded font-medium transition disabled:opacity-50 ${
              danger
                ? "bg-rose-500 hover:bg-rose-400 text-zinc-950"
                : "bg-brand hover:bg-brand text-zinc-950"
            }`}
          >
            {busy ? "처리 중…" : confirmText}
          </button>
        </footer>
      </div>
    </div>
  );
}
