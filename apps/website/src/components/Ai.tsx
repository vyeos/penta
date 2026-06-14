import { useState } from "react";
import { Check, X } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { Reveal } from "./Reveal";
import { Button } from "./Button";

type Status = "in" | "warn" | "out";

function Line({ label, status }: { label: string; status: Status }) {
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      {status === "out" ? (
        <X size={16} weight="bold" className="shrink-0 text-muted" />
      ) : (
        <Check size={16} weight="bold" className={cn("shrink-0", status === "warn" ? "text-accent" : "text-ink")} />
      )}
      <span
        className={cn(
          status === "out" && "text-muted line-through decoration-2",
          status === "warn" && "text-accent",
        )}
      >
        {label}
      </span>
    </li>
  );
}

const guarantees: [string, string][] = [
  ["Schema-only context", "A pre-send inspector shows exactly what will leave before anything is sent."],
  ["BYO-key or local", "Use your Anthropic or OpenAI key, or run fully offline with Ollama."],
  ["Never auto-runs", "Generated SQL goes into the editor for review. You decide what executes."],
];

export function Ai() {
  const [includeRows, setIncludeRows] = useState(false);

  return (
    <section id="ai" className="border-b-2 border-line">
      <div className="mx-auto max-w-frame px-5 py-20 sm:px-8 lg:py-28">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">AI copilot</p>
          <h2 className="mt-5 max-w-[20ch] font-display text-[clamp(1.9rem,3.8vw,3.2rem)] leading-[1.0]">
            AI that respects your data.
          </h2>
          <p className="mt-5 max-w-[52ch] text-lg text-muted">
            Natural language to SQL, explain, and fix. Schema-only by default, never auto-run, and
            entirely optional.
          </p>
        </Reveal>

        <Reveal delay={0.1} className="mt-12">
          <div className="border-2 border-line bg-surface shadow-brut-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-line px-5 py-3 font-mono text-[11px] uppercase tracking-wider">
              <span className="text-muted">Pre-send inspector / what leaves this machine</span>
              <Button
                type="button"
                onClick={() => setIncludeRows((v) => !v)}
                aria-pressed={includeRows}
                variant="ghost"
                size="sm"
                className="bg-paper"
              >
                <span>
                  Include row data:{" "}
                  <b className={includeRows ? "text-accent" : "text-muted"}>{includeRows ? "ON" : "OFF"}</b>
                </span>
              </Button>
            </div>

            <ul className="divide-y-2 divide-line font-mono text-sm">
              <Line label="Schema: table and column names" status="in" />
              <Line label="Data types and relationships" status="in" />
              <Line label="Row data and query results" status={includeRows ? "warn" : "out"} />
              <Line label="Credentials and connection strings" status="out" />
            </ul>

            <div className="border-t-2 border-line px-5 py-3 font-mono text-[11px] text-muted">
              {includeRows
                ? "Row data is included for this request only. Toggle it off to keep it on your machine."
                : "Run fully offline with Ollama and nothing leaves at all."}
            </div>
          </div>
        </Reveal>

        <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-3">
          {guarantees.map(([t, d], i) => (
            <Reveal as="div" key={t} delay={i * 0.06}>
              <h3 className="font-display text-lg">{t}</h3>
              <p className="mt-2 text-sm text-muted">{d}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
