// Theme registry. Each theme's `brand` / `brand2` rgb triplets feed into
// CSS variables on <html data-theme="..."> — see index.css.

export type ThemeId = "midnight" | "ocean" | "forest" | "sunset" | "aurora";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  /** Swatch colors used in the picker preview. Mirror the CSS vars. */
  brand: string;
  brand2: string;
  hint: string;
}

export const THEMES: ThemeMeta[] = [
  {
    id: "midnight",
    label: "Midnight",
    brand: "rgb(34, 211, 238)",
    brand2: "rgb(168, 85, 247)",
    hint: "cyan + violet (default)",
  },
  {
    id: "ocean",
    label: "Ocean",
    brand: "rgb(45, 212, 191)",
    brand2: "rgb(56, 189, 248)",
    hint: "teal + sky",
  },
  {
    id: "forest",
    label: "Forest",
    brand: "rgb(52, 211, 153)",
    brand2: "rgb(163, 230, 53)",
    hint: "emerald + lime",
  },
  {
    id: "sunset",
    label: "Sunset",
    brand: "rgb(251, 146, 60)",
    brand2: "rgb(251, 113, 133)",
    hint: "orange + rose",
  },
  {
    id: "aurora",
    label: "Aurora",
    brand: "rgb(192, 132, 252)",
    brand2: "rgb(232, 121, 249)",
    hint: "purple + fuchsia",
  },
];

const KEY = "jetpipe.theme.v1";
const DEFAULT: ThemeId = "midnight";

export function getStoredTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY);
    if (v && THEMES.some((t) => t.id === v)) return v as ThemeId;
  } catch {
    /* ignore */
  }
  return DEFAULT;
}

export function applyTheme(id: ThemeId) {
  document.documentElement.setAttribute("data-theme", id);
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}
