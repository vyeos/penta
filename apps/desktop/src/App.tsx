import { useEffect, useState } from "react";
import { Code2, Table2, X, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useStore } from "@/store";
import { cn } from "@/lib/utils";
import { Button, ThemeToggle } from "@/components/ui";
import { PentaMark } from "@/components/PentaMark";
import { ConnectionPanel } from "@/components/ConnectionPanel";
import { LocalDbPanel } from "@/components/LocalDbPanel";
import { Explorer } from "@/components/Explorer";
import { QueryPanel } from "@/components/QueryPanel";
import { DataGrid } from "@/components/DataGrid";
import { Onboarding, hasOnboarded } from "@/components/Onboarding";
import { LicensePanel } from "@/components/LicensePanel";
import { Toaster } from "@/components/Toaster";

export default function App() {
  const [core, setCore] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => !hasOnboarded());
  const session = useStore((s) => s.session);
  const setSession = useStore((s) => s.setSession);
  const mainView = useStore((s) => s.mainView);
  const openTabs = useStore((s) => s.openTabs);
  const openTable = useStore((s) => s.openTable);
  const closeTable = useStore((s) => s.closeTable);
  const queryOpen = useStore((s) => s.queryOpen);
  const showQuery = useStore((s) => s.showQuery);
  const closeQuery = useStore((s) => s.closeQuery);

  useEffect(() => {
    api
      .appInfo()
      .then((i) => setCore(i.core_version))
      .catch(() => setCore(null));
  }, []);

  async function disconnect() {
    if (session) {
      await api.connectionDisconnect(session.sessionId).catch(() => { });
      setSession(null);
    }
  }

  return (
    <div className="relative flex h-full w-full flex-col bg-paper text-ink">
      <Toaster />
      {showOnboarding && <Onboarding onDone={() => setShowOnboarding(false)} />}

      <header className="flex h-12 items-center gap-3 px-4">
        <a href="#" className="flex items-center gap-2 font-display text-[17px] leading-none">
          <PentaMark className="h-[22px] w-[22px] text-ink" />
          Penta
        </a>
        {session && (
          <Button variant="ghost" size="xs" onClick={disconnect} className="ml-1">
            Disconnect {session.name}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {core && <span className="font-mono text-[11px] text-muted/70">core v{core}</span>}
          <LicensePanel />
          <ThemeToggle />
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[264px_1fr] overflow-hidden">
        <aside className="flex flex-col gap-6 overflow-auto bg-ink/[0.02] px-3 pb-4 pt-2">
          <LocalDbPanel />
          <ConnectionPanel />
          <Explorer />
        </aside>
        <main className="flex min-w-0 flex-col overflow-hidden bg-paper">
          <div className="flex h-10 items-center gap-1 overflow-x-auto px-2.5">
            {queryOpen && (
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium transition-colors",
                  mainView.kind === "query"
                    ? "bg-ink/[0.06] text-ink"
                    : "text-muted hover:bg-ink/[0.04] hover:text-ink",
                )}
              >
                <button onClick={showQuery} className="flex items-center gap-1.5" title="Query">
                  <Code2 className="h-3.5 w-3.5" /> Query
                </button>
                <button
                  onClick={closeQuery}
                  className="ml-0.5 text-muted hover:text-ink"
                  title="Close tab"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {openTabs.map((tab) => {
              const active =
                mainView.kind === "data" &&
                mainView.schema === tab.schema &&
                mainView.table === tab.table;
              return (
                <span
                  key={`${tab.schema}.${tab.table}`}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium transition-colors",
                    active
                      ? "bg-ink/[0.06] text-ink"
                      : "text-muted hover:bg-ink/[0.04] hover:text-ink",
                  )}
                >
                  <button
                    onClick={() => openTable(tab.schema, tab.table)}
                    className="flex items-center gap-1.5"
                    title={`${tab.schema}.${tab.table}`}
                  >
                    <Table2 className="h-3.5 w-3.5" />
                    <span className="font-mono text-[11px]">
                      {tab.schema}.{tab.table}
                    </span>
                  </button>
                  <button
                    onClick={() => closeTable(tab.schema, tab.table)}
                    className="ml-0.5 text-muted hover:text-ink"
                    title="Close tab"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            {!queryOpen && (
              <button
                onClick={showQuery}
                title="Open query editor"
                className="flex shrink-0 items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-muted transition-colors hover:bg-ink/[0.04] hover:text-ink"
              >
                <Plus className="h-3.5 w-3.5" /> Query
              </button>
            )}
          </div>
          <div className="flex-1 overflow-hidden border-t border-ink/[0.07]">
            {mainView.kind === "data" ? (
              <DataGrid
                key={`${mainView.schema}.${mainView.table}`}
                schema={mainView.schema}
                table={mainView.table}
              />
            ) : queryOpen ? (
              <QueryPanel />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
                <p className="text-sm">No tabs open.</p>
                <Button variant="ghost" size="sm" onClick={showQuery}>
                  <Plus className="h-3.5 w-3.5" /> Open query editor
                </Button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
