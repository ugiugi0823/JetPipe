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
        // Theme-aware accents. The CSS variables `--brand` and `--brand2`
        // are set by data-theme="..." on <html> (see index.css). Using
        // `<alpha-value>` lets Tailwind's opacity modifiers (`bg-brand/10`,
        // `text-brand2/40` etc.) work normally.
        brand: "rgb(var(--brand) / <alpha-value>)",
        brand2: "rgb(var(--brand2) / <alpha-value>)",
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
