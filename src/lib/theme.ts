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
  /** Surface (panel) swatch — secondary background tier. */
  surface: string;
  /** Primary accent swatch. */
  brand: string;
  /** Secondary accent swatch (gradient pair). */
  brand2: string;
  hint: string;
  /** Multi-line user-facing description shown in the theme picker. */
  description: string;
  scheme: "dark" | "light";
}

export const THEMES: ThemeMeta[] = [
  {
    id: "midnight",
    label: "Midnight",
    bg: "rgb(10, 10, 11)",
    surface: "rgb(24, 24, 27)",
    brand: "rgb(34, 211, 238)",
    brand2: "rgb(168, 85, 247)",
    hint: "기본 — 검정 + cyan/violet",
    description:
      "거의 순수한 검정 배경에 시안과 보라색 강조. 야간 작업이나 어두운 환경에서 눈 피로가 가장 적은 기본값입니다.",
    scheme: "dark",
  },
  {
    id: "forest",
    label: "Forest",
    bg: "rgb(8, 14, 12)",
    surface: "rgb(20, 30, 26)",
    brand: "rgb(52, 211, 153)",
    brand2: "rgb(163, 230, 53)",
    hint: "짙은 녹 + emerald/lime",
    description:
      "짙은 숲 같은 녹색조 어둠에 에메랄드와 라임 강조. 자연 톤의 차분한 다크 테마.",
    scheme: "dark",
  },
  {
    id: "sunset",
    label: "Sunset",
    bg: "rgb(20, 12, 9)",
    surface: "rgb(36, 24, 20)",
    brand: "rgb(251, 146, 60)",
    brand2: "rgb(251, 113, 133)",
    hint: "따뜻한 어둠 + orange/rose",
    description:
      "노을빛 분위기. 따뜻한 갈색 어둠 위에 오렌지와 로즈가 흐릅니다. 저녁 작업의 분위기를 좋아하면 추천.",
    scheme: "dark",
  },
  {
    id: "daylight",
    label: "Daylight",
    bg: "rgb(250, 250, 250)",
    surface: "rgb(244, 244, 245)",
    brand: "rgb(6, 182, 212)",
    brand2: "rgb(124, 58, 237)",
    hint: "밝은 회백 + cyan/violet",
    description:
      "맑은 회백색 배경에 검정 텍스트. 밝은 환경, 카페, 야외에서 가장 가독성 좋은 light 테마.",
    scheme: "light",
  },
  {
    id: "paper",
    label: "Paper",
    bg: "rgb(250, 246, 238)",
    surface: "rgb(243, 237, 226)",
    brand: "rgb(217, 119, 6)",
    brand2: "rgb(219, 39, 119)",
    hint: "크림 + amber/pink",
    description:
      "오래된 종이 같은 크림 배경. 앰버와 핑크 포인트. 책 읽는 듯한 따뜻한 light 모드.",
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
