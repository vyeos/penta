import type { ReactNode, ComponentPropsWithoutRef } from "react";
import { Sun, Moon } from "lucide-react";
import { useStore } from "@/store";
import { cn } from "@/lib/utils";

/*
  Calm, Linear-like UI kit for the desktop workbench. Keeps the brand (paper/ink
  palette, safety-orange accent, the fonts) but sheds the brutalist chrome:
  separation comes from subtle background tints + spacing, not hard borders.
  Soft fills, quiet hover states, sentence-case sans labels.

  Color discipline: ink-fill = the one primary action in a context; ghost = the
  quiet soft-chip default; accent orange is reserved for genuinely destructive
  confirms so it keeps its "danger / production" meaning.
*/

type Variant = "solid" | "ghost" | "danger" | "plain";
type Size = "md" | "sm" | "xs" | "icon";

const btnBase =
  "inline-flex items-center justify-center gap-1.5 font-medium leading-none select-none transition-colors disabled:cursor-not-allowed disabled:opacity-45";

const btnSizes: Record<Size, string> = {
  md: "px-3 py-1.5 text-[13px]",
  sm: "px-2.5 py-1 text-[12px]",
  xs: "px-2 py-1 text-[11px]",
  icon: "h-7 w-7",
};

const btnVariants: Record<Variant, string> = {
  solid: "bg-ink text-paper hover:bg-ink/90",
  ghost: "bg-ink/[0.05] text-ink hover:bg-ink/[0.09]",
  danger: "bg-accent text-accent-ink hover:bg-accent/90",
  plain: "text-muted hover:bg-ink/[0.06] hover:text-ink",
};

type Common = { variant?: Variant; size?: Size; className?: string; children: ReactNode };
type BtnProps = Common & Omit<ComponentPropsWithoutRef<"button">, keyof Common>;

/** The shared control: soft fill, quiet hover, no hard borders. */
export function Button({ variant = "ghost", size = "sm", className, children, ...rest }: BtnProps) {
  return (
    <button className={cn(btnBase, btnSizes[size], btnVariants[variant], className)} {...rest}>
      {children}
    </button>
  );
}

type BadgeTone = "ok" | "warn" | "danger" | "neutral";

const badgeTones: Record<BadgeTone, string> = {
  ok: "bg-ok/[0.14] text-ok",
  warn: "bg-warn/[0.16] text-warn",
  danger: "bg-accent/[0.14] text-accent",
  neutral: "bg-ink/[0.06] text-muted",
};

/** Small status pill: soft tinted fill, sentence case, no border. */
export function Badge({
  tone = "neutral",
  className,
  children,
  title,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Light/dark switch, wired to the shared store + localStorage["penta-theme"]. */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useStore((s) => s.theme);
  const toggle = useStore((s) => s.toggleTheme);
  return (
    <Button
      variant="plain"
      size="icon"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
      className={className}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

// Shared class strings for native form controls and floating surfaces.
export const inputCls =
  "w-full border border-ink/[0.12] bg-ink/[0.03] px-2.5 py-1.5 text-sm text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-accent/70 focus:bg-paper focus:ring-1 focus:ring-accent/25";

export const selectCls =
  "border border-ink/[0.12] bg-ink/[0.03] px-2 py-1.5 text-xs text-ink outline-none transition-colors focus:border-accent/70";

export const sectionLabelCls = "text-[11px] font-semibold tracking-wide text-muted";

export const overlayCls =
  "absolute inset-0 z-30 flex items-center justify-center bg-ink/40 p-6 backdrop-blur-[2px]";

export const modalCls = "flex flex-col border border-ink/10 bg-paper shadow-pop";
