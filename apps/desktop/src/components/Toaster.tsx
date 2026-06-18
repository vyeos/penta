import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useStore, type Toast, type ToastKind } from "@/store";
import { cn } from "@/lib/utils";

/*
  Top-left toast stack. Errors (connection failures, db-creation failures, …)
  used to render as a truncated line inside the cramped sidebar; here they get
  the full width to wrap and stay readable. Each toast auto-dismisses, shows a
  draining progress line, and can be closed by hand.
*/

const META: Record<
  ToastKind,
  { bar: string; text: string; Icon: typeof AlertTriangle; duration: number }
> = {
  error: { bar: "bg-accent", text: "text-accent", Icon: AlertTriangle, duration: 7000 },
  success: { bar: "bg-ok", text: "text-ok", Icon: CheckCircle2, duration: 3000 },
  info: { bar: "bg-ink/40", text: "text-muted", Icon: Info, duration: 4500 },
};

export function Toaster() {
  const toasts = useStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useStore((s) => s.dismissToast);
  const meta = META[toast.kind];
  const Icon = meta.Icon;

  useEffect(() => {
    const id = window.setTimeout(() => dismiss(toast.id), meta.duration);
    return () => window.clearTimeout(id);
  }, [toast.id, dismiss, meta.duration]);

  return (
    <div className="pointer-events-auto relative flex gap-2.5 overflow-hidden bg-paper p-3 pr-8 shadow-pop">

      <Icon className={cn("mt-px h-4 w-4 shrink-0", meta.text)} aria-hidden />
      <div className="min-w-0 flex-1">
        {toast.title && (
          <p className="text-[13px] font-semibold leading-snug text-ink">{toast.title}</p>
        )}
        <p
          className={cn(
            "max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-muted",
            toast.title && "mt-0.5",
          )}
        >
          {toast.message}
        </p>
      </div>
      <button
        onClick={() => dismiss(toast.id)}
        className="absolute right-1 top-1 p-1 text-muted/70 transition-colors hover:text-ink"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <span
        className={cn("absolute bottom-0 left-0 h-[2px] w-full origin-left", meta.bar)}
        style={{ animation: `penta-error-timer ${meta.duration}ms linear forwards` }}
        aria-hidden
      />
    </div>
  );
}
