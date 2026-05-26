import { useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Palette,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { applyTheme, getStoredTheme, THEMES, type ThemeId } from "../lib/theme";
import { cn } from "../lib/utils";

interface Props {
  onClose: () => void;
}

type View = "menu" | "theme";

export default function SettingsDialog({ onClose }: Props) {
  const [view, setView] = useState<View>("menu");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[460px] bg-base border border-edge rounded-xl shadow-2xl">
        <header className="flex items-center gap-2 px-5 py-3 border-b border-edge">
          {view === "theme" ? (
            <>
              <button
                onClick={() => setView("menu")}
                className="text-ink-muted hover:text-ink transition"
                title="뒤로"
              >
                <ArrowLeft size={14} />
              </button>
              <Palette size={14} className="text-brand" />
              <h2 className="text-sm font-semibold tracking-tight">테마 변경</h2>
            </>
          ) : (
            <>
              <SettingsIcon size={14} className="text-brand" />
              <h2 className="text-sm font-semibold tracking-tight">설정</h2>
            </>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-ink-muted hover:text-ink transition"
          >
            <X size={15} />
          </button>
        </header>

        {view === "menu" && <MenuView onPickTheme={() => setView("theme")} />}
        {view === "theme" && <ThemeView />}

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

function MenuView({ onPickTheme }: { onPickTheme: () => void }) {
  const current = THEMES.find((t) => t.id === getStoredTheme());
  return (
    <div className="p-3">
      <button
        onClick={onPickTheme}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md border border-edge hover:border-brand/40 hover:bg-surface/50 transition text-left group"
      >
        <Palette size={16} className="text-brand shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-ink">테마 변경</div>
          <div className="text-[10px] text-ink-faint mt-0.5">
            현재: {current?.label ?? "Midnight"} · {current?.hint ?? ""}
          </div>
        </div>
        <ChevronRight
          size={14}
          className="text-ink-faint group-hover:text-ink-muted transition shrink-0"
        />
      </button>
    </div>
  );
}

function ThemeView() {
  const [active, setActive] = useState<ThemeId>(getStoredTheme());

  function pick(id: ThemeId) {
    setActive(id);
    applyTheme(id);
  }

  return (
    <div className="p-4 max-h-[70vh] overflow-y-auto">
      <div className="text-[10px] uppercase tracking-wider text-ink-faint mb-2">
        5가지 테마 — 클릭하면 즉시 적용
      </div>
      <div className="space-y-2">
        {THEMES.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              onClick={() => pick(t.id)}
              className={cn(
                "w-full flex items-start gap-3 p-3 rounded-md border transition text-left",
                selected
                  ? "border-brand/50 bg-brand/5"
                  : "border-edge hover:border-edge hover:bg-surface/40"
              )}
            >
              {/* Live preview: actual bg + surface + accent dots */}
              <div
                className="w-16 h-14 rounded-md ring-1 ring-edge shrink-0 relative overflow-hidden flex items-center justify-center"
                style={{ background: t.bg }}
              >
                <div
                  className="absolute left-1 right-1 top-1 h-4 rounded-sm"
                  style={{ background: t.surface }}
                />
                <div className="absolute bottom-1 left-1 right-1 flex items-center gap-0.5">
                  <span
                    className="w-3 h-3 rounded-full shadow"
                    style={{ background: t.brand }}
                  />
                  <span
                    className="w-3 h-3 rounded-full shadow -ml-1"
                    style={{ background: t.brand2 }}
                  />
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-ink">
                    {t.label}
                  </span>
                  <span
                    className={cn(
                      "text-[9px] uppercase tracking-wider px-1 py-0.5 rounded",
                      t.scheme === "light"
                        ? "bg-amber-500/15 text-amber-500"
                        : "bg-surface text-ink-muted"
                    )}
                  >
                    {t.scheme}
                  </span>
                  {selected && (
                    <Check size={12} className="text-brand ml-auto shrink-0" />
                  )}
                </div>
                <div className="text-[10px] text-ink-faint mt-0.5">
                  {t.hint}
                </div>
                <div className="text-[11px] text-ink-muted mt-1 leading-snug">
                  {t.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-3 text-[10px] text-ink-faint leading-relaxed">
        선택은 즉시 앱 전체에 적용되고 다음 실행 시에도 유지됩니다.
      </div>
    </div>
  );
}
