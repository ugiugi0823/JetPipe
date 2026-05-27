import { useState } from "react";
import { createPortal } from "react-dom";
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

  // Render through a portal so the modal escapes the sidebar's
  // `backdrop-blur` ancestor — `backdrop-filter` creates a containing
  // block for `position: fixed`, otherwise pinning the modal inside
  // the sidebar instead of the viewport.
  const wide = view === "theme";
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className={cn(
          "bg-base border border-edge rounded-xl shadow-2xl transition-all",
          wide ? "w-[680px]" : "w-[460px]"
        )}
      >
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
    </div>,
    document.body
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
        {THEMES.length}가지 테마 — 클릭하면 즉시 적용
      </div>
      <div className="grid grid-cols-2 gap-2">
        {THEMES.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              onClick={() => pick(t.id)}
              className={cn(
                "flex items-start gap-2.5 p-2.5 rounded-md border transition text-left min-w-0",
                selected
                  ? "border-brand/50 bg-brand/5"
                  : "border-edge hover:border-edge hover:bg-surface/40"
              )}
            >
              {/* Live preview: actual bg + surface + accent dots */}
              <div
                className="w-12 h-11 rounded-md ring-1 ring-edge shrink-0 relative overflow-hidden"
                style={{ background: t.bg }}
              >
                <div
                  className="absolute left-1 right-1 top-1 h-3 rounded-sm"
                  style={{ background: t.surface }}
                />
                <div className="absolute bottom-1 left-1 right-1 flex items-center gap-0.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full shadow"
                    style={{ background: t.brand }}
                  />
                  <span
                    className="w-2.5 h-2.5 rounded-full shadow -ml-1"
                    style={{ background: t.brand2 }}
                  />
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-semibold text-ink truncate">
                    {t.label}
                  </span>
                  <span
                    className={cn(
                      "text-[8px] uppercase tracking-wider px-1 rounded shrink-0",
                      t.scheme === "light"
                        ? "bg-amber-500/15 text-amber-500"
                        : "bg-surface text-ink-muted"
                    )}
                  >
                    {t.scheme}
                  </span>
                  {selected && (
                    <Check size={11} className="text-brand ml-auto shrink-0" />
                  )}
                </div>
                <div className="text-[10px] text-ink-faint mt-0.5 truncate">
                  {t.hint}
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
