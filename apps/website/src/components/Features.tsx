import { Reveal } from "./Reveal";

const features: [string, string, string, string][] = [
  [
    "01",
    "Schema-aware autocomplete",
    "Alias and column resolution from live introspection. In-scope columns rank first, so the next keystroke is usually the right one.",
    "Live introspection",
  ],
  [
    "02",
    "Safe data editing",
    "Primary-key detection, xmin optimistic concurrency, and a SQL preview before every commit. No key means no writes, by design.",
    "PK / xmin / preview",
  ],
  [
    "03",
    "Streaming results and CSV",
    "Stream big result sets and move data with COPY, straight to and from disk, without buffering the whole dataset into memory.",
    "COPY / no buffering",
  ],
  [
    "04",
    "Credential vault",
    "OS keychain by default, or an encrypted master-password vault. Secrets never touch a log or the application database.",
    "Keychain / AES-256",
  ],
];

export function Features() {
  return (
    <section id="features" className="border-b-2 border-line">
      <div className="mx-auto max-w-frame px-5 py-20 sm:px-8 lg:py-28">
        <h2 className="mb-12 max-w-[18ch] font-display text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02]">
          Your daily driver, finally fast.
        </h2>

        <div className="border-t-2 border-line">
          {features.map(([n, t, d, m], i) => (
            <Reveal
              as="div"
              key={n}
              delay={i * 0.04}
              className="group grid grid-cols-[auto_1fr] items-start gap-x-5 gap-y-2 border-b-2 border-line py-7 transition-colors duration-200 hover:bg-surface sm:grid-cols-[4rem_1fr_12rem] sm:gap-x-8 sm:px-3"
            >
              <div className="pt-1 font-mono text-sm text-muted transition-colors group-hover:text-accent">
                {n}
              </div>
              <div>
                <h3 className="font-display text-2xl transition-transform duration-300 group-hover:translate-x-1.5 sm:text-[1.7rem]">
                  {t}
                </h3>
                <p className="mt-2 max-w-[56ch] text-muted">{d}</p>
              </div>
              <div className="col-span-2 font-mono text-[11px] uppercase tracking-wider text-muted sm:col-span-1 sm:pt-2 sm:text-right">
                {m}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
