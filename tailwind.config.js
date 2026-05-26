/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "SF Mono", "Menlo", "monospace"],
      },
      colors: {
        jet: {
          bg: "#0a0a0b",
          panel: "#111114",
          border: "#1f1f24",
          muted: "#27272a",
          accent: "#22d3ee",
        },
        // Theme-aware tokens. CSS variables are set by data-theme="..." on
        // <html> (see index.css). Each token is `rgb(var(--xxx) / <alpha-value>)`
        // so Tailwind's opacity modifiers (`bg-surface/40`) keep working.
        brand: "rgb(var(--brand) / <alpha-value>)",
        brand2: "rgb(var(--brand2) / <alpha-value>)",
        base: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        edge: "rgb(var(--border) / <alpha-value>)",
        ink: "rgb(var(--text) / <alpha-value>)",
        "ink-muted": "rgb(var(--text-muted) / <alpha-value>)",
        "ink-faint": "rgb(var(--text-faint) / <alpha-value>)",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { opacity: "1", boxShadow: "0 0 0 0 rgba(34, 211, 238, 0.4)" },
          "50%": { opacity: "0.8", boxShadow: "0 0 0 6px rgba(34, 211, 238, 0)" },
        },
      },
      animation: {
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
