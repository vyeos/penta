import { Reveal } from "./Reveal";
import { PentaDraw } from "./PentaDraw";

const pillars: [string, string, string][] = [
  ["01", "Connect", "Sticky session per tab, keychain-backed credentials."],
  ["02", "Query", "Schema-aware autocomplete and streaming results."],
  ["03", "Design", "Visual table designer, ERD, schema diff and sync."],
  ["04", "Monitor", "Live activity, locks, and slow-query insight."],
  ["05", "Secure", "Read-only sessions and production safety mode."],
];

export function Pillars() {
  return (
    <section className="border-b-2 border-line">
      <div className="mx-auto max-w-frame px-5 py-20 sm:px-8 lg:py-28">
        <div className="mb-12 flex items-end justify-between gap-6">
          <h2 className="max-w-[16ch] font-display text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02]">
            Five sides of the database. One window.
          </h2>
          <PentaDraw className="hidden h-16 w-16 shrink-0 text-ink sm:block" />
        </div>

        <div className="grid grid-cols-1 gap-[2px] bg-line sm:grid-cols-5">
          {pillars.map(([n, t, d], i) => (
            <Reveal
              as="div"
              key={n}
              delay={i * 0.05}
              className="group bg-paper p-6 transition-colors duration-200 hover:bg-accent"
            >
              <div className="font-mono text-sm text-accent group-hover:text-accent-ink">{n}</div>
              <div className="mt-7 font-display text-xl group-hover:text-accent-ink">{t}</div>
              <p className="mt-2 text-sm text-muted group-hover:text-accent-ink">{d}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
