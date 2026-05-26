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
      <div className="w-[440px] bg-base border border-edge rounded-xl shadow-2xl">
        <header className="flex items-center justify-between px-5 py-3 border-b border-edge">
          <div className="flex items-center gap-2">
            <Palette size={14} className="text-brand" />
            <h2 className="text-sm font-semibold tracking-tight">설정</h2>
          </div>
          <button
            onClick={onClose}
            className="text-ink-faint hover:text-ink transition"
          >
            <X size={15} />
          </button>
        </header>

        <div className="p-5">
          <div className="text-[10px] uppercase tracking-wider text-ink-faint mb-2">
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
                      : "border-edge hover:border-edge hover:bg-surface/50"
                  )}
                >
                  <div
                    className="w-12 h-8 rounded-md ring-1 ring-edge flex items-center justify-center shrink-0"
                    style={{ background: t.bg }}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full shadow"
                      style={{ background: t.brand }}
                    />
                    <span
                      className="w-3.5 h-3.5 rounded-full shadow -ml-1.5"
                      style={{ background: t.brand2 }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-ink flex items-center gap-1.5">
                      {t.label}
                      <span
                        className={cn(
                          "text-[9px] uppercase tracking-wider px-1 py-0.5 rounded",
                          t.scheme === "light"
                            ? "bg-amber-500/15 text-amber-500"
                            : "bg-surface text-ink-faint"
                        )}
                      >
                        {t.scheme}
                      </span>
                    </div>
                    <div className="text-[10px] text-ink-faint">{t.hint}</div>
                  </div>
                  {selected && (
                    <Check size={12} className="text-brand shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-3 text-[10px] text-ink-faint leading-relaxed">
            선택 즉시 앱 전체에 적용됩니다. 다음 실행 시에도 유지됩니다.
          </div>
        </div>

        <footer className="px-5 py-3 border-t border-edge flex justify-end gap-2">
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
