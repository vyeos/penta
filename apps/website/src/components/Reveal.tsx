import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: "div" | "li" | "tr";
  /** Animate on mount instead of on scroll-into-view. Use for above-the-fold content. */
  immediate?: boolean;
};

/** Fade + rise once. `immediate` animates on load; otherwise on scroll-into-view. Static under reduced motion. */
export function Reveal({ children, className, delay = 0, y = 22, as = "div", immediate = false }: RevealProps) {
  const reduce = useReducedMotion();
  const Comp = motion[as] as typeof motion.div;
  const shown = { opacity: 1, y: 0 };
  const motionProps = immediate
    ? { animate: shown }
    : { whileInView: shown, viewport: { once: true, amount: 0.25 } };
  return (
    <Comp
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      {...motionProps}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </Comp>
  );
}
