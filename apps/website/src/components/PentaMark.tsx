import { cn } from "../lib/cn";

/** Penta = pentagon = the five pillars. A single simple geometric brand mark. */
export function PentaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("block", className)}
      aria-hidden="true"
      fill="none"
    >
      <polygon
        points="16,4 28.36,12.98 23.64,27.52 8.36,27.52 3.64,12.98"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="4" r="2.6" fill="var(--accent)" />
    </svg>
  );
}
