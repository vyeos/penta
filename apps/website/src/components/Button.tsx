import type { ReactNode, ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn";

type Variant = "primary" | "solid" | "ghost";
type Size = "md" | "sm" | "icon";

const base =
  "inline-flex items-center justify-center gap-2 border-2 border-line font-mono font-medium uppercase tracking-[0.06em] press select-none disabled:cursor-not-allowed disabled:bg-transparent disabled:text-muted disabled:shadow-none";

const sizes: Record<Size, string> = {
  md: "px-5 py-3 text-[13px]",
  sm: "px-3 py-1.5 text-[11px]",
  icon: "h-10 w-10 text-[13px]",
};

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink shadow-brut",
  solid: "bg-ink text-paper shadow-brut",
  ghost: "bg-transparent text-ink shadow-brut-sm",
};

type Common = { variant?: Variant; size?: Size; className?: string; children: ReactNode };
type AnchorProps = Common & { href: string } & Omit<ComponentPropsWithoutRef<"a">, keyof Common | "href">;
type ButtonElProps = Common & { href?: never } & Omit<ComponentPropsWithoutRef<"button">, keyof Common>;

/**
 * The one brutalist press-button: a hard-shadow control that physically
 * depresses on hover and click (the `.press` utility). Renders an <a> when
 * given `href`, otherwise a <button>. Recolor via `variant`, resize via `size`.
 */
export function Button(props: AnchorProps | ButtonElProps) {
  const { variant = "primary", size = "md", className, children, ...rest } = props;
  const cls = cn(base, sizes[size], variants[variant], className);

  if ("href" in props) {
    return (
      <a className={cls} {...(rest as ComponentPropsWithoutRef<"a">)}>
        {children}
      </a>
    );
  }
  return (
    <button className={cls} {...(rest as ComponentPropsWithoutRef<"button">)}>
      {children}
    </button>
  );
}
