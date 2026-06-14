import { PentaMark } from "./PentaMark";

function FootCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className="mb-4 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{title}</h4>
      <ul className="space-y-2.5">
        {links.map(([label, href]) => (
          <li key={label}>
            <a
              href={href}
              className="inline-block text-sm text-ink transition-transform duration-200 hover:translate-x-1 hover:text-accent"
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="bg-paper">
      <div className="mx-auto max-w-frame px-5 py-16 sm:px-8">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <a href="#top" className="flex items-center gap-2.5 font-display text-xl">
              <PentaMark className="h-7 w-7 text-ink" />
              Penta
            </a>
            <p className="mt-4 max-w-[30ch] text-sm text-muted">
              The PostgreSQL workbench that won&rsquo;t kill prod. Postgres-native, open-core,
              desktop-first.
            </p>
          </div>
          <FootCol
            title="Product"
            links={[
              ["Features", "#features"],
              ["Safety", "#safety"],
              ["AI copilot", "#ai"],
              ["Pricing", "#pricing"],
            ]}
          />
          <FootCol
            title="Resources"
            links={[
              ["GitHub", "https://github.com/penta-dev/penta"],
              ["Releases", "https://github.com/penta-dev/penta/releases"],
              ["Security", "https://github.com/penta-dev/penta/blob/main/SECURITY.md"],
              ["Report a bug", "https://github.com/penta-dev/penta/issues"],
            ]}
          />
          <FootCol
            title="Legal"
            links={[
              ["Privacy", "https://github.com/penta-dev/penta/blob/main/PRIVACY.md"],
              ["Terms", "https://github.com/penta-dev/penta/blob/main/TERMS.md"],
              ["License", "https://github.com/penta-dev/penta/blob/main/LICENSE"],
            ]}
          />
        </div>

        <div className="mt-14 flex flex-col gap-2 border-t-2 border-line pt-6 font-mono text-xs text-muted sm:flex-row sm:items-center">
          <span>&copy; {new Date().getFullYear()} Penta contributors</span>
          <span className="sm:ml-7">Built in Rust, Tauri, React</span>
          <span className="sm:ml-auto">AGPL-3.0 core</span>
        </div>
      </div>
    </footer>
  );
}
