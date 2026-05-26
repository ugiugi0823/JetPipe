// Theme registry. Each entry maps to CSS variables on <html data-theme="…">
// — see index.css for the actual color values.

export type ThemeId =
  | "midnight"
  | "forest"
  | "sunset"
  | "daylight"
  | "paper";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  /** Page background swatch — what the chrome will look like overall. */
  bg: string;
  /** Primary accent swatch. */
  brand: string;
  /** Secondary accent swatch (gradient pair). */
  brand2: string;
  hint: string;
  scheme: "dark" | "light";
}

export const THEMES: ThemeMeta[] = [
  {
    id: "midnight",
    label: "Midnight",
    bg: "rgb(10, 10, 11)",
    brand: "rgb(34, 211, 238)",
    brand2: "rgb(168, 85, 247)",
    hint: "기본 — 검정 + cyan/violet",
    scheme: "dark",
  },
  {
    id: "forest",
    label: "Forest",
    bg: "rgb(8, 14, 12)",
    brand: "rgb(52, 211, 153)",
    brand2: "rgb(163, 230, 53)",
    hint: "짙은 녹 + emerald/lime",
    scheme: "dark",
  },
  {
    id: "sunset",
    label: "Sunset",
    bg: "rgb(20, 12, 9)",
    brand: "rgb(251, 146, 60)",
    brand2: "rgb(251, 113, 133)",
    hint: "따뜻한 어둠 + orange/rose",
    scheme: "dark",
  },
  {
    id: "daylight",
    label: "Daylight",
    bg: "rgb(250, 250, 250)",
    brand: "rgb(6, 182, 212)",
    brand2: "rgb(124, 58, 237)",
    hint: "밝은 회백 + cyan/violet",
    scheme: "light",
  },
  {
    id: "paper",
    label: "Paper",
    bg: "rgb(250, 246, 238)",
    brand: "rgb(217, 119, 6)",
    brand2: "rgb(219, 39, 119)",
    hint: "크림 + amber/pink",
    scheme: "light",
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
