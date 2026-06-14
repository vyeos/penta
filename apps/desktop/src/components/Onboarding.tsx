import { useState } from "react";
import { Database, Search, Play, Pencil, Sparkles, ShieldCheck } from "lucide-react";

const ONBOARDED_KEY = "penta.onboarded";
const TELEMETRY_KEY = "penta.telemetry";

/** Whether the first-run flow has already been completed. */
export function hasOnboarded(): boolean {
  return localStorage.getItem(ONBOARDED_KEY) === "1";
}

/** Anonymous-telemetry preference (Decision #18: opt-in, OFF by default). */
export function telemetryEnabled(): boolean {
  return localStorage.getItem(TELEMETRY_KEY) === "1";
}

const STEPS = [
  { icon: Database, label: "Add a connection", hint: "host, port, db — env-labelled & color-coded" },
  { icon: Search, label: "Browse the tree", hint: "schemas, tables, views" },
  { icon: Play, label: "Run a query", hint: "schema-aware autocomplete · ⌘↵" },
  { icon: Pencil, label: "Edit data safely", hint: "PK + xmin, SQL preview before commit" },
  { icon: Sparkles, label: "Ask the AI", hint: "NL→SQL · schema-only · never auto-runs" },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [telemetry, setTelemetry] = useState(false);

  function finish() {
    localStorage.setItem(ONBOARDED_KEY, "1");
    localStorage.setItem(TELEMETRY_KEY, telemetry ? "1" : "0");
    onDone();
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-6">
      <div className="w-[520px] rounded-xl border bg-card p-6 shadow-2xl">
        <div className="mb-1 flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-primary" />
          <h1 className="text-lg font-semibold tracking-tight">Welcome to Penta</h1>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          A fast, safe, AI-assisted PostgreSQL workbench. Here's the loop:
        </p>

        <ol className="mb-5 space-y-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={i} className="flex items-center gap-3 rounded-md border bg-background/50 px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="text-[11px] text-muted-foreground">{s.hint}</div>
                </div>
              </li>
            );
          })}
        </ol>

        <label className="mb-4 flex items-start gap-2 rounded-md border bg-background/50 px-3 py-2 text-xs">
          <input
            type="checkbox"
            checked={telemetry}
            onChange={(e) => setTelemetry(e.target.checked)}
            className="mt-0.5"
          />
          <span className="flex-1">
            <span className="flex items-center gap-1 font-medium">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              Share anonymous usage &amp; crash data
            </span>
            <span className="text-muted-foreground">
              Off by default. Never your SQL, connections, credentials, or data. You can change this
              any time.
            </span>
          </span>
        </label>

        <div className="flex justify-end">
          <button
            onClick={finish}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground"
          >
            Get started
          </button>
        </div>
      </div>
    </div>
  );
}
