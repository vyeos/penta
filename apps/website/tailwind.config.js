/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        ink: "var(--ink)",
        accent: "var(--accent)",
        "accent-ink": "var(--accent-ink)",
        muted: "var(--muted)",
        surface: "var(--surface)",
        line: "var(--line)",
      },
      fontFamily: {
        display: ['"Clash Display"', '"Switzer"', "system-ui", "sans-serif"],
        sans: ['"Switzer"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      maxWidth: {
        frame: "1320px",
      },
    },
  },
  plugins: [],
};
