import { useState } from "react";
import { Database, Search, Play, Pencil, Sparkles, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui";
import { PentaMark } from "@/components/PentaMark";

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
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-ink/50 p-6 backdrop-blur-[2px]">
      <div className="w-[540px] overflow-hidden border border-ink/10 bg-paper shadow-pop">
        <div className="p-6">
          <div className="mb-1.5 flex items-center gap-2.5">
            <PentaMark className="h-7 w-7 text-ink" />
            <h1 className="font-display text-2xl">Welcome to Penta</h1>
          </div>
          <p className="mb-5 text-sm text-muted">
            A fast, safe, AI-assisted PostgreSQL workbench. Here's the loop:
          </p>

          <ol className="mb-5 space-y-1.5">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <li key={i} className="flex items-center gap-3 bg-ink/[0.03] px-3 py-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-ink/[0.06] font-mono text-[11px] text-muted">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Icon className="h-4 w-4 shrink-0 text-accent" />
                  <div>
                    <div className="text-sm font-medium">{s.label}</div>
                    <div className="text-[12px] text-muted">{s.hint}</div>
                  </div>
                </li>
              );
            })}
          </ol>

          <label className="mb-5 flex items-start gap-2.5 bg-ink/[0.03] px-3 py-2.5 text-xs">
            <input
              type="checkbox"
              checked={telemetry}
              onChange={(e) => setTelemetry(e.target.checked)}
              className="mt-0.5 accent-accent"
            />
            <span className="flex-1">
              <span className="flex items-center gap-1 font-medium">
                <ShieldCheck className="h-3.5 w-3.5 text-ok" />
                Share anonymous usage &amp; crash data
              </span>
              <span className="text-muted">
                Off by default. Never your SQL, connections, credentials, or data. You can change this
                any time.
              </span>
            </span>
          </label>

          <div className="flex justify-end">
            <Button variant="solid" size="md" onClick={finish}>
              Get started
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
