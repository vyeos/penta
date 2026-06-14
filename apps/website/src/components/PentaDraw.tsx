import { motion, useReducedMotion } from "motion/react";

/**
 * The pentagon brand mark draws itself the first time it scrolls into view
 * (motion/react pathLength). Static and fully drawn under reduced motion.
 */
export function PentaDraw({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden="true">
      <motion.path
        d="M16 3 L29.31 12.67 L24.23 28.33 L7.77 28.33 L2.69 12.67 Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
      />
      <motion.circle
        cx="16"
        cy="3"
        r="2.4"
        fill="var(--accent)"
        style={{ transformOrigin: "16px 3px" }}
        initial={reduce ? false : { scale: 0 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: 0.4, delay: 0.85, ease: [0.16, 1, 0.3, 1] }}
      />
    </svg>
  );
}
