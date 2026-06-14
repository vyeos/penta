import { GithubLogo, ArrowDown } from "@phosphor-icons/react";
import { Button } from "./Button";
import { PentaMark } from "./PentaMark";
import { ThemeToggle } from "./ThemeToggle";

const links: [string, string][] = [
  ["Features", "#features"],
  ["Safety", "#safety"],
  ["AI", "#ai"],
  ["Pricing", "#pricing"],
];

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b-2 border-line bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex h-[68px] max-w-frame items-center px-5 sm:px-8">
        <a href="#top" className="flex items-center gap-2.5 font-display text-xl">
          <PentaMark className="h-7 w-7 text-ink" />
          Penta
        </a>

        <nav className="ml-auto hidden items-center gap-7 md:flex">
          {links.map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="font-mono text-xs uppercase tracking-[0.08em] text-muted transition-colors hover:text-accent"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2.5 md:ml-7">
          <Button href="https://github.com/penta-dev/penta" aria-label="Penta on GitHub" variant="ghost" size="icon">
            <GithubLogo size={18} weight="bold" />
          </Button>
          <ThemeToggle />
          <Button href="#download" variant="primary" className="hidden sm:inline-flex">
            Download <ArrowDown size={15} weight="bold" />
          </Button>
        </div>
      </div>
    </header>
  );
}
