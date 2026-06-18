import { create } from "zustand";
import type { EnvLabel } from "@/lib/api";

interface ActiveSession {
  sessionId: string;
  connectionId: string;
  name: string;
  envLabel: EnvLabel;
  readOnly: boolean;
}

/** Which view occupies the main pane. */
export type MainView =
  | { kind: "query" }
  | { kind: "data"; schema: string; table: string };

export type Theme = "light" | "dark";

/** A transient notification surfaced top-left. Errors that would otherwise be
 *  cut off in the cramped sidebar get the full, readable space here. */
export type ToastKind = "error" | "success" | "info";
export interface Toast {
  id: string;
  kind: ToastKind;
  title?: string;
  message: string;
}

let toastSeq = 0;

function initialTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

interface AppStore {
  /** Light/dark, mirrored to <html data-theme> + localStorage["penta-theme"]. */
  theme: Theme;
  toggleTheme: () => void;

  session: ActiveSession | null;
  setSession: (s: ActiveSession | null) => void;

  /** SQL shared between the explorer (click-to-query) and the editor. */
  query: string;
  setQuery: (q: string) => void;

  /** Bumped to ask the editor to run the current query (explorer double-click). */
  runNonce: number;
  requestRun: () => void;

  /** Main-pane routing: the SQL editor or an open table's data grid. */
  mainView: MainView;
  openTable: (schema: string, table: string) => void;
  showQuery: () => void;

  /** Bumped after a successful query so the explorer re-introspects the schema. */
  schemaVersion: number;
  bumpSchema: () => void;

  /** Top-left toast stack (errors, mostly). Newest last; capped to a few. */
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => string;
  dismissToast: (id: string) => void;
}

export const useStore = create<AppStore>((set) => ({
  theme: initialTheme(),
  toggleTheme: () =>
    set((s) => {
      const next: Theme = s.theme === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("penta-theme", next);
      } catch {
        /* ignore */
      }
      return { theme: next };
    }),
  session: null,
  setSession: (session) => set({ session, mainView: { kind: "query" } }),
  query: "SELECT 1;",
  setQuery: (query) => set({ query }),
  runNonce: 0,
  requestRun: () => set((s) => ({ runNonce: s.runNonce + 1 })),
  mainView: { kind: "query" },
  openTable: (schema, table) => set({ mainView: { kind: "data", schema, table } }),
  showQuery: () => set({ mainView: { kind: "query" } }),
  schemaVersion: 0,
  bumpSchema: () => set((s) => ({ schemaVersion: s.schemaVersion + 1 })),
  toasts: [],
  pushToast: (t) => {
    const id = `toast-${++toastSeq}`;
    // Keep at most the 4 most recent so a burst of failures can't fill the screen.
    set((s) => ({ toasts: [...s.toasts, { ...t, id }].slice(-4) }));
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
