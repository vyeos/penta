import { useCallback, useEffect, useRef, useState } from "react";
import { errMessage } from "@/lib/api";
import { useStore } from "@/store";

/** How long the triggering control stays disabled + shows the red timer line.
 *  MUST match the `.animate-error-timer` duration in styles.css. */
export const FLASH_MS = 1000;

/**
 * Pairs the global top-left toast with a per-control "error flash": when an
 * action fails we surface the full message in a toast AND briefly disable the
 * button that triggered it, drawing a depleting red line so it's obvious which
 * control errored. Keys are caller-chosen strings (a connection id, "save", …).
 */
export function useActionFeedback() {
  const pushToast = useStore((s) => s.pushToast);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const flash = useCallback((key: string) => {
    window.clearTimeout(timer.current);
    setFlashKey(key);
    timer.current = window.setTimeout(() => setFlashKey(null), FLASH_MS);
  }, []);

  const fail = useCallback(
    (err: unknown, opts?: { key?: string; title?: string }) => {
      pushToast({ kind: "error", title: opts?.title, message: errMessage(err) });
      if (opts?.key) flash(opts.key);
    },
    [pushToast, flash],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const isFlashing = useCallback((key: string) => flashKey === key, [flashKey]);

  return { flashKey, flash, fail, isFlashing };
}
