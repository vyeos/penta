import { EditorView } from "@codemirror/view";

/**
 * Brand CodeMirror theme. Reads the same CSS variables as the rest of the app so
 * it follows light/dark automatically; the `dark` flag only picks CodeMirror's
 * built-in syntax-highlight palette. Transparent background so the editor sits
 * on the canvas with no boxy chrome (calm/Linear-like). Accent caret + selection.
 */
export function pentaEditorTheme(dark: boolean) {
  return EditorView.theme(
    {
      "&": {
        color: "rgb(var(--ink))",
        backgroundColor: "transparent",
        fontSize: "13px",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-content": {
        fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
        caretColor: "rgb(var(--accent))",
        padding: "10px 0",
      },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "rgb(var(--accent))" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "rgb(var(--accent) / 0.2)",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: "rgb(var(--muted) / 0.7)",
        border: "none",
      },
      ".cm-activeLine": { backgroundColor: "rgb(var(--ink) / 0.035)" },
      ".cm-activeLineGutter": { backgroundColor: "transparent", color: "rgb(var(--muted))" },
      // Reserve room for 3 digits (border-box, so min-width spans padding + glyphs)
      // so the gutter width is stable from line 1..999 and the editor never shifts
      // as the line count crosses 9→10→100. Right-aligned, so the extra space fills
      // on the left and the gutter's right edge stays fixed against the code.
      ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 8px", minWidth: "48px" },
      ".cm-tooltip": {
        backgroundColor: "rgb(var(--paper))",
        border: "1px solid rgb(var(--ink) / 0.1)",
        borderRadius: "8px",
        color: "rgb(var(--ink))",
        overflow: "hidden",
        boxShadow: "0 10px 30px rgb(0 0 0 / 0.18), 0 2px 8px rgb(0 0 0 / 0.1)",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: "rgb(var(--accent) / 0.14)",
        color: "rgb(var(--ink))",
      },
      ".cm-tooltip-autocomplete ul li": {
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        padding: "3px 8px",
      },
    },
    { dark },
  );
}
