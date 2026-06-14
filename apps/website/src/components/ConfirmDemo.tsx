import { useState, type FormEvent } from "react";
import { Warning, Prohibit } from "@phosphor-icons/react";
import { Button } from "./Button";

/**
 * A real, working mini-version of Penta's production safety guard (not a fake
 * screenshot). Type the table name to arm Execute. Nothing ever runs, which is
 * exactly the product's point.
 */
export function ConfirmDemo() {
  const [val, setVal] = useState("");
  const [ran, setRan] = useState(false);
  const armed = val.trim().toLowerCase() === "users";

  function exec(e: FormEvent) {
    e.preventDefault();
    if (!armed) return;
    setRan(true);
    setVal("");
  }

  return (
    <div className="border-2 border-line bg-surface shadow-brut-lg">
      <div className="flex items-center justify-between border-b-2 border-line px-4 py-2.5 font-mono text-[11px]">
        <span className="text-muted">query · prod-primary</span>
        <span className="bg-accent px-2 py-0.5 font-medium uppercase tracking-wider text-accent-ink">
          Production
        </span>
      </div>

      <div className="p-5">
        <pre className="mb-4 overflow-x-auto font-mono text-[15px] leading-relaxed">
          <span className="text-accent">DROP TABLE</span>{" "}
          <span className="font-semibold underline decoration-2 underline-offset-2">public.users</span>;
        </pre>

        <p className="mb-4 flex items-start gap-2 font-mono text-xs text-muted">
          <Warning size={16} weight="fill" className="mt-0.5 shrink-0 text-accent" />
          High-risk statement on a production connection.
        </p>

        <form onSubmit={exec} className="flex flex-col gap-2 sm:flex-row">
          <label className="flex flex-1 items-center gap-2 border-2 border-line bg-paper px-3">
            <span className="whitespace-nowrap font-mono text-[11px] uppercase tracking-wider text-muted">
              type <b className="text-accent">users</b>
            </span>
            <input
              value={val}
              onChange={(e) => {
                setVal(e.target.value);
                setRan(false);
              }}
              spellCheck={false}
              autoComplete="off"
              placeholder="table name"
              aria-label="Type the table name to confirm"
              className="w-full bg-transparent py-2.5 font-mono text-sm outline-none placeholder:text-muted/50"
            />
          </label>
          <Button type="submit" variant="primary" disabled={!armed}>
            Execute
          </Button>
        </form>

        {ran && (
          <div className="mt-4 flex items-start gap-2 border-2 border-line bg-ink p-3 font-mono text-xs text-paper">
            <Prohibit size={16} weight="bold" className="mt-0.5 shrink-0" />
            <span>
              <b>Aborted.</b> Nothing ran. In real Penta, the core re-checks this server-side too.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
