import { cn } from "@/lib/utils";

/** Penta = pentagon = the five pillars. The shared brand mark (see apps/website). */
export function PentaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("block", className)} aria-hidden="true" fill="none">
      <polygon
        points="16,4 28.36,12.98 23.64,27.52 8.36,27.52 3.64,12.98"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="4" r="2.6" fill="rgb(var(--accent))" />
    </svg>
  );
}
