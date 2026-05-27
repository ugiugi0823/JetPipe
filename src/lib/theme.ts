// Theme registry. Each entry maps to CSS variables on <html data-theme="…">
// — see index.css for the actual color values.

export type ThemeId =
  | "midnight"
  | "forest"
  | "sunset"
  | "daylight"
  | "paper"
  | "ocean"
  | "aurora"
  | "crimson"
  | "nord"
  | "mint";

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
  {
    id: "ocean",
    label: "Ocean",
    bg: "rgb(8, 12, 20)",
    surface: "rgb(18, 26, 40)",
    brand: "rgb(45, 212, 191)",
    brand2: "rgb(56, 189, 248)",
    hint: "심해 네이비 + teal/sky",
    description:
      "깊은 바다 같은 네이비 배경에 청록과 하늘색. 차갑고 집중되는 다크 테마.",
    scheme: "dark",
  },
  {
    id: "aurora",
    label: "Aurora",
    bg: "rgb(14, 10, 22)",
    surface: "rgb(26, 20, 38)",
    brand: "rgb(192, 132, 252)",
    brand2: "rgb(232, 121, 249)",
    hint: "보랏빛 어둠 + purple/fuchsia",
    description:
      "오로라 같은 보랏빛. 자주와 푸시아 네온. 화려하고 몽환적인 다크 테마.",
    scheme: "dark",
  },
  {
    id: "crimson",
    label: "Crimson",
    bg: "rgb(16, 9, 10)",
    surface: "rgb(30, 18, 20)",
    brand: "rgb(248, 113, 113)",
    brand2: "rgb(251, 191, 36)",
    hint: "검붉은 어둠 + red/amber",
    description:
      "거의 검은 적색 배경에 선홍과 앰버. 강렬한 대비를 좋아할 때.",
    scheme: "dark",
  },
  {
    id: "nord",
    label: "Nord",
    bg: "rgb(18, 22, 30)",
    surface: "rgb(30, 36, 48)",
    brand: "rgb(136, 192, 208)",
    brand2: "rgb(129, 161, 193)",
    hint: "차분한 슬레이트 + frost",
    description:
      "Nord 팔레트. 부드러운 슬레이트 블루 배경에 절제된 프로스트 색. 눈이 편한 다크.",
    scheme: "dark",
  },
  {
    id: "mint",
    label: "Mint",
    bg: "rgb(244, 250, 246)",
    surface: "rgb(232, 244, 238)",
    brand: "rgb(16, 185, 129)",
    brand2: "rgb(20, 184, 166)",
    hint: "민트 화이트 + emerald/teal",
    description:
      "산뜻한 민트빛 흰 배경에 에메랄드와 청록. 가볍고 깨끗한 light 모드.",
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
