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
      <div className="w-[420px] bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl">
        <header className="flex items-center justify-between px-5 py-3 border-b border-zinc-900">
          <div className="flex items-center gap-2">
            {danger && (
              <AlertTriangle size={14} className="text-rose-400 shrink-0" />
            )}
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          </div>
          <button
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-200 transition"
          >
            <X size={15} />
          </button>
        </header>
        <div className="p-5 space-y-2">
          <div className="text-xs text-zinc-200 leading-relaxed">{message}</div>
          {detail && (
            <div className="text-[10px] text-zinc-500 font-mono break-all bg-zinc-900/40 border border-zinc-900 rounded px-2 py-1.5">
              {detail}
            </div>
          )}
          {error && (
            <div className="text-[10px] text-rose-400 font-mono break-all pt-1">
              {error}
            </div>
          )}
        </div>
        <footer className="px-5 py-3 border-t border-zinc-900 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded border border-zinc-800 text-zinc-400 hover:text-zinc-100 transition"
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
