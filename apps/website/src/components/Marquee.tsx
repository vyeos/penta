const items = [
  "Schema-aware autocomplete",
  "xmin optimistic concurrency",
  "COPY streaming and CSV",
  "BYO-key or local AI",
  "Read-only enforced server-side",
  "Type-to-confirm on prod",
  "OS-keychain vault",
  "Open-core, AGPL-3.0",
];

export function Marquee() {
  const row = [...items, ...items];
  return (
    <div className="marquee overflow-hidden border-b-2 border-line bg-ink py-3 text-paper">
      <div className="marquee-track flex w-max items-center whitespace-nowrap">
        {row.map((item, i) => (
          <span key={i} className="flex items-center font-mono text-sm uppercase tracking-wider">
            <span className="px-6">{item}</span>
            <span aria-hidden="true" className="text-accent">
              //
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
