import { useMemo } from "react";

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
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div
        className="flex max-h-[80%] w-[600px] flex-col rounded-lg border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <span className="font-mono text-sm font-medium">{column}</span>
          {value === null && <span className="text-xs italic text-muted-foreground">NULL</span>}
          <button onClick={copy} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
            copy
          </button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs">
          {pretty ?? <span className="italic text-muted-foreground">NULL</span>}
        </pre>
      </div>
    </div>
  );
}
