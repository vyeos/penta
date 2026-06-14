import { cn } from "../lib/cn";
import { Reveal } from "./Reveal";

const mechanisms: [string, string, string][] = [
  [
    "Enforced server-side",
    "Destructive-query guard",
    "A pure-Rust parser flags DROP, TRUNCATE, and unfiltered DELETE or UPDATE, then re-checks in the core so a UI bug cannot slip one through.",
  ],
  [
    "Tiered",
    "Confirmation scales with blast radius",
    "Local, staging, and prod labels drive a one-click confirm, or a type-the-name confirmation on production.",
  ],
  [
    "Session-level",
    "Read-only connections",
    "Enforced with default_transaction_read_only at the session, not just disabled buttons in the UI.",
  ],
];

export function Safety() {
  return (
    <section id="safety" className="border-b-2 border-line bg-surface">
      <div className="hazard h-3 border-b-2 border-line" aria-hidden="true" />
      <div className="mx-auto max-w-frame px-5 py-20 sm:px-8 lg:py-28">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
            Production Safety Mode
          </p>
          <h2 className="mt-5 max-w-[22ch] font-display text-[clamp(2rem,4vw,3.4rem)] leading-[1.0]">
            Every dangerous query gets a second look.{" "}
            <span className="text-accent">Enforced in the core,</span> not just hidden in the UI.
          </h2>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-3">
          {mechanisms.map(([tag, t, d], i) => (
            <Reveal
              as="div"
              key={t}
              delay={i * 0.06}
              className={cn(
                "border-t-2 border-line py-6 md:border-t-0 md:py-0",
                i === 0 ? "md:pr-7" : "md:border-l-2 md:border-line md:px-7",
              )}
            >
              <div className="font-mono text-[11px] uppercase tracking-wider text-accent">{tag}</div>
              <h3 className="mt-3 font-display text-xl">{t}</h3>
              <p className="mt-2 text-sm text-muted">{d}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
