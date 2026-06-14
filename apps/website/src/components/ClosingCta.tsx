import { ArrowRight } from "@phosphor-icons/react";
import { Button } from "./Button";
import { Reveal } from "./Reveal";

export function ClosingCta() {
  return (
    <section id="download" className="border-b-2 border-line bg-accent text-accent-ink">
      <div className="mx-auto max-w-frame px-5 py-24 text-center sm:px-8 lg:py-32">
        <Reveal>
          <h2 className="mx-auto max-w-[14ch] font-display text-[clamp(2.4rem,6vw,5rem)] leading-[0.95]">
            Stop being scared of prod.
          </h2>
          <p className="mx-auto mt-6 max-w-[42ch] font-mono text-sm uppercase tracking-wider">
            Free and open source. AGPL-3.0. macOS, Windows, Linux.
          </p>
          <div className="mt-9 flex justify-center">
            <Button href="https://github.com/penta-dev/penta/releases" variant="solid">
              Download for macOS <ArrowRight size={15} weight="bold" />
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
