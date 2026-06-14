import { ArrowRight, GithubLogo } from "@phosphor-icons/react";
import { Button } from "./Button";
import { Reveal } from "./Reveal";
import { ConfirmDemo } from "./ConfirmDemo";

export function Hero() {
  return (
    <section id="top" className="border-b-2 border-line">
      <div className="mx-auto max-w-frame px-5 pb-16 pt-14 sm:px-8 lg:pb-24 lg:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <Reveal immediate>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
                The PostgreSQL workbench
              </p>
            </Reveal>
            <Reveal immediate delay={0.06}>
              <h1 className="mt-5 font-display text-[clamp(2.6rem,6vw,4.5rem)] leading-[0.96]">
                The Postgres workbench that{" "}
                <span className="box-decoration-clone bg-accent px-2 text-accent-ink">
                  won&rsquo;t kill prod.
                </span>
              </h1>
            </Reveal>
            <Reveal immediate delay={0.12}>
              <p className="mt-6 max-w-[48ch] text-lg text-muted">
                All of pgAdmin&rsquo;s depth, with the speed of a tool built this decade, plus the
                safety net it never had.
              </p>
            </Reveal>
            <Reveal immediate delay={0.18}>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Button href="#download" variant="primary">
                  Download for macOS <ArrowRight size={15} weight="bold" />
                </Button>
                <Button href="https://github.com/penta-dev/penta" variant="ghost">
                  <GithubLogo size={16} weight="bold" /> Star on GitHub
                </Button>
              </div>
            </Reveal>
          </div>

          <div className="lg:col-span-5">
            <Reveal immediate delay={0.22} className="lg:rotate-[1.2deg]">
              <ConfirmDemo />
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
