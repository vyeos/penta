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

interface AppStore {
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
}

export const useStore = create<AppStore>((set) => ({
  session: null,
  setSession: (session) => set({ session, mainView: { kind: "query" } }),
  query: "SELECT 1;",
  setQuery: (query) => set({ query }),
  runNonce: 0,
  requestRun: () => set((s) => ({ runNonce: s.runNonce + 1 })),
  mainView: { kind: "query" },
  openTable: (schema, table) => set({ mainView: { kind: "data", schema, table } }),
  showQuery: () => set({ mainView: { kind: "query" } }),
}));
