import { useMemo } from "react";
import { X } from "lucide-react";
import { Button, overlayCls, modalCls } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Expanded view of a single cell value — pretty-prints JSON, scrolls long text. */
export function CellViewer({
  column,
  value,
  onClose,
}: {
  column: string;
  value: string | null;
  onClose: () => void;
}) {
  const pretty = useMemo(() => {
    if (value === null) return null;
    const t = value.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        return value;
      }
    }
    return value;
  }, [value]);

  async function copy() {
    if (value !== null) await navigator.clipboard.writeText(value).catch(() => {});
  }

  return (
    <div className={overlayCls} onClick={onClose}>
      <div className={cn(modalCls, "max-h-[80%] w-[600px]")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-ink/[0.08] px-3 py-2.5">
          <span className="font-mono text-sm font-semibold">{column}</span>
          {value === null && (
            <span className="font-mono text-[11px] italic text-muted">NULL</span>
          )}
          <Button variant="ghost" size="xs" onClick={copy} className="ml-auto">
            Copy
          </Button>
          <button onClick={onClose} className="text-muted transition-colors hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
        <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs">
          {pretty ?? <span className="italic text-muted">NULL</span>}
        </pre>
      </div>
    </div>
  );
}
