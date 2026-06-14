import { useEffect, useState } from "react";
import { Code2, Table2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useStore } from "@/store";
import { cn } from "@/lib/utils";
import { ConnectionPanel } from "@/components/ConnectionPanel";
import { LocalDbPanel } from "@/components/LocalDbPanel";
import { Explorer } from "@/components/Explorer";
import { QueryPanel } from "@/components/QueryPanel";
import { DataGrid } from "@/components/DataGrid";
import { Onboarding, hasOnboarded } from "@/components/Onboarding";
import { LicensePanel } from "@/components/LicensePanel";

export default function App() {
  const [core, setCore] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => !hasOnboarded());
  const session = useStore((s) => s.session);
  const setSession = useStore((s) => s.setSession);
  const mainView = useStore((s) => s.mainView);
  const showQuery = useStore((s) => s.showQuery);

  useEffect(() => {
    api
      .appInfo()
      .then((i) => setCore(i.core_version))
      .catch(() => setCore(null));
  }, []);

  async function disconnect() {
    if (session) {
      await api.connectionDisconnect(session.sessionId).catch(() => {});
      setSession(null);
    }
  }

  return (
    <div className="relative flex h-full w-full flex-col">
      {showOnboarding && <Onboarding onDone={() => setShowOnboarding(false)} />}
      <header className="flex h-10 items-center gap-2 border-b px-3 text-sm">
        <div className="h-3 w-3 rounded-full bg-primary" />
        <span className="font-semibold tracking-tight">Penta</span>
        <span className="text-muted-foreground">PostgreSQL workbench</span>
        {session && (
          <button
            onClick={disconnect}
            className="ml-3 rounded-md border bg-muted px-2 py-0.5 text-xs hover:text-foreground"
          >
            Disconnect {session.name}
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          <LicensePanel />
          <span className="text-xs text-muted-foreground">
            {core ? `core v${core}` : "browser preview"}
          </span>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[280px_1fr] overflow-hidden">
        <aside className="flex flex-col gap-4 overflow-auto border-r p-3">
          <LocalDbPanel />
          <ConnectionPanel />
          <Explorer />
        </aside>
        <main className="flex flex-col overflow-hidden">
          <div className="flex h-8 items-center gap-1 border-b px-2 text-xs">
            <button
              onClick={showQuery}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1",
                mainView.kind === "query" ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              <Code2 className="h-3.5 w-3.5" /> Query
            </button>
            {mainView.kind === "data" && (
              <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 font-medium">
                <Table2 className="h-3.5 w-3.5" />
                {mainView.schema}.{mainView.table}
                <button
                  onClick={showQuery}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  title="Close table"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            {mainView.kind === "data" ? (
              <DataGrid
                key={`${mainView.schema}.${mainView.table}`}
                schema={mainView.schema}
                table={mainView.table}
              />
            ) : (
              <QueryPanel />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
