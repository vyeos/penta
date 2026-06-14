import { Check, ArrowRight, ArrowDown } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { Reveal } from "./Reveal";
import { Button } from "./Button";

type Tier = {
  name: string;
  price: string;
  per: string;
  blurb: string;
  feats: string[];
  ctaLabel: string;
  ctaHref: string;
  featured: boolean;
};

const tiers: Tier[] = [
  {
    name: "Free",
    price: "$0",
    per: "",
    blurb: "Everything you need to make Postgres your home.",
    feats: ["Connect, browse, query", "Schema-aware autocomplete", "Safe editing and safety mode", "BYO-key or local AI"],
    ctaLabel: "Download",
    ctaHref: "#download",
    featured: false,
  },
  {
    name: "Pro",
    price: "$10",
    per: "/mo",
    blurb: "For people who live in their database all day.",
    feats: ["Schema diff and sync", "ERD export", "Managed AI credits", "Advanced monitoring", "Visual table designer"],
    ctaLabel: "Get Pro",
    ctaHref: "#download",
    featured: true,
  },
  {
    name: "Team",
    price: "Custom",
    per: "",
    blurb: "Shared context and guardrails for the whole crew.",
    feats: ["Shared connections", "RBAC and audit logs", "OAuth and SSO", "Priority support"],
    ctaLabel: "Contact sales",
    ctaHref: "mailto:sales@penta.app",
    featured: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="border-b-2 border-line">
      <div className="mx-auto max-w-frame px-5 py-20 sm:px-8 lg:py-28">
        <h2 className="mb-3 max-w-[18ch] font-display text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02]">
          Free core. Pay for depth and teams.
        </h2>
        <p className="mb-12 max-w-[44ch] text-muted">
          We never paywall the activation loop. Connect, query, and edit safely, for $0, forever.
        </p>

        <Reveal>
          <div className="grid grid-cols-1 border-2 border-line md:grid-cols-3">
            {tiers.map((t, i) => (
              <div
                key={t.name}
                className={cn(
                  "flex flex-col p-7 sm:p-8",
                  i > 0 && "border-t-2 border-line md:border-l-2 md:border-t-0",
                  t.featured && "bg-accent text-accent-ink",
                )}
              >
                <div
                  className={cn(
                    "flex items-center font-mono text-xs uppercase tracking-[0.12em]",
                    t.featured ? "text-accent-ink" : "text-muted",
                  )}
                >
                  {t.name}
                  {t.featured && (
                    <span className="ml-2 border-2 border-accent-ink px-1.5 py-0.5 text-[10px]">
                      Most loved
                    </span>
                  )}
                </div>

                <div className="mt-5 font-display text-[3.2rem] leading-none">
                  {t.price}
                  {t.per && (
                    <span
                      className={cn(
                        "font-mono text-sm font-normal",
                        t.featured ? "text-accent-ink/70" : "text-muted",
                      )}
                    >
                      {t.per}
                    </span>
                  )}
                </div>

                <p className={cn("mt-3 min-h-[3rem] text-sm", t.featured ? "text-accent-ink/80" : "text-muted")}>
                  {t.blurb}
                </p>

                <ul className="mb-8 mt-6 space-y-2.5">
                  {t.feats.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <Check
                        size={16}
                        weight="bold"
                        className={cn("mt-0.5 shrink-0", t.featured ? "text-accent-ink" : "text-accent")}
                      />
                      <span className={t.featured ? "text-accent-ink" : undefined}>{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-auto">
                  <Button
                    href={t.ctaHref}
                    variant={t.featured ? "solid" : i === 0 ? "primary" : "ghost"}
                    className="w-full"
                  >
                    {t.ctaLabel}
                    {i === 0 ? <ArrowDown size={15} weight="bold" /> : <ArrowRight size={15} weight="bold" />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
