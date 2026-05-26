import { useState } from "react";
import { Check, Palette, X } from "lucide-react";
import { applyTheme, getStoredTheme, THEMES, type ThemeId } from "../lib/theme";
import { cn } from "../lib/utils";

interface Props {
  onClose: () => void;
}

export default function SettingsDialog({ onClose }: Props) {
  const [active, setActive] = useState<ThemeId>(getStoredTheme());

  function pick(id: ThemeId) {
    setActive(id);
    applyTheme(id);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[440px] bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl">
        <header className="flex items-center justify-between px-5 py-3 border-b border-zinc-900">
          <div className="flex items-center gap-2">
            <Palette size={14} className="text-brand" />
            <h2 className="text-sm font-semibold tracking-tight">설정</h2>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 transition"
          >
            <X size={15} />
          </button>
        </header>

        <div className="p-5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
            테마
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {THEMES.map((t) => {
              const selected = t.id === active;
              return (
                <button
                  key={t.id}
                  onClick={() => pick(t.id)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded border transition text-left",
                    selected
                      ? "border-brand/40 bg-brand/5"
                      : "border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/50"
                  )}
                >
                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      className="w-4 h-4 rounded-full shadow-inner ring-1 ring-zinc-900"
                      style={{ background: t.brand }}
                    />
                    <span
                      className="w-4 h-4 rounded-full shadow-inner ring-1 ring-zinc-900 -ml-1.5"
                      style={{ background: t.brand2 }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-zinc-100">
                      {t.label}
                    </div>
                    <div className="text-[10px] text-zinc-500">{t.hint}</div>
                  </div>
                  {selected && (
                    <Check size={12} className="text-brand shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-3 text-[10px] text-zinc-600 leading-relaxed">
            선택 즉시 앱 전체에 적용됩니다. 다음 실행 시에도 유지됩니다.
          </div>
        </div>

        <footer className="px-5 py-3 border-t border-zinc-900 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded bg-brand hover:bg-brand2 text-zinc-950 font-medium transition"
          >
            완료
          </button>
        </footer>
      </div>
    </div>
  );
}
