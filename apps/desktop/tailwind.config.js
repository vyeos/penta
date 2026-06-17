/** @type {import('tailwindcss').Config} */
export default {
  // Theme is driven by [data-theme="dark"] on <html> (matches the marketing site
  // and the pre-paint script in index.html), not the old `.dark` class.
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Channel-triple tokens so Tailwind's `/opacity` modifiers work
        // (e.g. bg-accent/10, border-line/20). Values mirror apps/website.
        paper: "rgb(var(--paper) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-ink": "rgb(var(--accent-ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        ok: "rgb(var(--ok) / <alpha-value>)",
      },
      fontFamily: {
        display: ['"Clash Display"', '"Switzer"', "system-ui", "sans-serif"],
        sans: ['"Switzer"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
