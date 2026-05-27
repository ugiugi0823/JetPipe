import { useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Globe,
  Palette,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { applyTheme, getStoredTheme, THEMES, type ThemeId } from "../lib/theme";
import {
  getLang,
  LANGS,
  setLang,
  useT,
  type Lang,
} from "../lib/i18n";
import { cn } from "../lib/utils";

interface Props {
  onClose: () => void;
}

type View = "menu" | "theme" | "language";

export default function SettingsDialog({ onClose }: Props) {
  const t = useT();
  const [view, setView] = useState<View>("menu");

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
          {view !== "menu" ? (
            <>
              <button
                onClick={() => setView("menu")}
                className="text-ink-muted hover:text-ink transition"
                title={t("back")}
              >
                <ArrowLeft size={14} />
              </button>
              {view === "theme" ? (
                <Palette size={14} className="text-brand" />
              ) : (
                <Globe size={14} className="text-brand" />
              )}
              <h2 className="text-sm font-semibold tracking-tight">
                {view === "theme" ? t("themeChange") : t("languageChange")}
              </h2>
            </>
          ) : (
            <>
              <SettingsIcon size={14} className="text-brand" />
              <h2 className="text-sm font-semibold tracking-tight">
                {t("settings")}
              </h2>
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

        {view === "menu" && (
          <MenuView
            onPickTheme={() => setView("theme")}
            onPickLanguage={() => setView("language")}
          />
        )}
        {view === "theme" && <ThemeView />}
        {view === "language" && <LanguageView />}

        <footer className="px-5 py-3 border-t border-edge flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded bg-brand hover:bg-brand2 text-zinc-950 font-medium transition"
          >
            {t("done")}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

function MenuView({
  onPickTheme,
  onPickLanguage,
}: {
  onPickTheme: () => void;
  onPickLanguage: () => void;
}) {
  const t = useT();
  const currentTheme = THEMES.find((x) => x.id === getStoredTheme());
  const currentLang = LANGS.find((x) => x.id === getLang());
  return (
    <div className="p-3 space-y-1.5">
      <MenuRow
        icon={<Palette size={16} className="text-brand shrink-0" />}
        title={t("themeChange")}
        sub={`${t("themeCurrent")}: ${currentTheme?.label ?? "Midnight"}`}
        onClick={onPickTheme}
      />
      <MenuRow
        icon={<Globe size={16} className="text-brand shrink-0" />}
        title={t("languageChange")}
        sub={`${t("themeCurrent")}: ${currentLang?.native ?? "한국어"}`}
        onClick={onPickLanguage}
      />
    </div>
  );
}

function MenuRow({
  icon,
  title,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md border border-edge hover:border-brand/40 hover:bg-surface/50 transition text-left group"
    >
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-ink">{title}</div>
        <div className="text-[10px] text-ink-faint mt-0.5">{sub}</div>
      </div>
      <ChevronRight
        size={14}
        className="text-ink-faint group-hover:text-ink-muted transition shrink-0"
      />
    </button>
  );
}

function LanguageView() {
  const t = useT();
  const [active, setActive] = useState<Lang>(getLang());
  return (
    <div className="p-4">
      <div className="space-y-1.5">
        {LANGS.map((l) => {
          const selected = l.id === active;
          return (
            <button
              key={l.id}
              onClick={() => {
                setActive(l.id);
                setLang(l.id);
              }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-md border transition text-left",
                selected
                  ? "border-brand/50 bg-brand/5"
                  : "border-edge hover:border-edge hover:bg-surface/40"
              )}
            >
              <span className="text-sm font-semibold text-ink w-20">
                {l.native}
              </span>
              <span className="text-[10px] text-ink-faint flex-1">
                {l.label}
              </span>
              {selected && <Check size={12} className="text-brand shrink-0" />}
            </button>
          );
        })}
      </div>
      <div className="mt-3 text-[10px] text-ink-faint leading-relaxed">
        {t("langApplyNote")}
      </div>
    </div>
  );
}

function ThemeView() {
  const t = useT();
  const [active, setActive] = useState<ThemeId>(getStoredTheme());

  function pick(id: ThemeId) {
    setActive(id);
    applyTheme(id);
  }

  return (
    <div className="p-4 max-h-[70vh] overflow-y-auto">
      <div className="text-[10px] uppercase tracking-wider text-ink-faint mb-2">
        {THEMES.length}
        {t("themeCountSuffix")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {THEMES.map((th) => {
          const selected = th.id === active;
          return (
            <button
              key={th.id}
              onClick={() => pick(th.id)}
              className={cn(
                "flex items-start gap-2.5 p-2.5 rounded-md border transition text-left min-w-0",
                selected
                  ? "border-brand/50 bg-brand/5"
                  : "border-edge hover:border-edge hover:bg-surface/40"
              )}
            >
              <div
                className="w-12 h-11 rounded-md ring-1 ring-edge shrink-0 relative overflow-hidden"
                style={{ background: th.bg }}
              >
                <div
                  className="absolute left-1 right-1 top-1 h-3 rounded-sm"
                  style={{ background: th.surface }}
                />
                <div className="absolute bottom-1 left-1 right-1 flex items-center gap-0.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full shadow"
                    style={{ background: th.brand }}
                  />
                  <span
                    className="w-2.5 h-2.5 rounded-full shadow -ml-1"
                    style={{ background: th.brand2 }}
                  />
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-semibold text-ink truncate">
                    {th.label}
                  </span>
                  <span
                    className={cn(
                      "text-[8px] uppercase tracking-wider px-1 rounded shrink-0",
                      th.scheme === "light"
                        ? "bg-amber-500/15 text-amber-500"
                        : "bg-surface text-ink-muted"
                    )}
                  >
                    {th.scheme}
                  </span>
                  {selected && (
                    <Check size={11} className="text-brand ml-auto shrink-0" />
                  )}
                </div>
                <div className="text-[10px] text-ink-faint mt-0.5 truncate">
                  {t(`theme_${th.id}`)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-3 text-[10px] text-ink-faint leading-relaxed">
        {t("themeApplyNote")}
      </div>
    </div>
  );
}
