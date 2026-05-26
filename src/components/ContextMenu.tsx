import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";

export interface ContextMenuItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    // Capture so we close before any other click handler runs.
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("contextmenu", onClose);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("contextmenu", onClose);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Clamp into viewport (estimate height as item count * 28 + padding)
  const estHeight = items.length * 28 + 8;
  const top = Math.min(y, window.innerHeight - estHeight - 8);
  const left = Math.min(x, window.innerWidth - 180);

  return (
    <div
      ref={ref}
      style={{ top, left }}
      className="fixed z-[60] min-w-[170px] bg-base border border-edge rounded-md shadow-2xl py-1"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <button
            key={i}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition ${
              item.danger
                ? "text-rose-400 hover:bg-rose-500/10"
                : "text-ink hover:bg-surface/80"
            }`}
          >
            {Icon && <Icon size={11} className="shrink-0" />}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
