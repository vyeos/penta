import { useState } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import type { RiskReport } from "@/lib/api";

/**
 * Production Safety Mode confirmation (§26). Tiered by the server's risk scan:
 * a one-click confirm for medium risk, and type-to-confirm on high-risk
 * statements against a production connection.
 */
export function ConfirmRiskDialog({
  report,
  onConfirm,
  onCancel,
}: {
  report: RiskReport;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const typeToConfirm = report.confirm_tier === "type_to_confirm";
  const phrase = report.confirm_phrase ?? "";
  const canProceed = !typeToConfirm || typed.trim() === phrase;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
      <div className="w-[440px] rounded-lg border border-red-500/40 bg-card p-4 shadow-2xl">
        <div className="mb-2 flex items-center gap-2">
          {report.level === "high" ? (
            <ShieldAlert className="h-5 w-5 text-red-400" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-amber-400" />
          )}
          <h2 className="text-sm font-semibold">
            {report.level === "high" ? "Destructive statement" : "Confirm this statement"}
          </h2>
          {!report.parsed && (
            <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              unparsed — flagged by heuristic
            </span>
          )}
        </div>

        <ul className="mb-3 space-y-1 text-xs">
          {report.findings
            .filter((f) => f.level !== "none" && f.level !== "low")
            .map((f, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span
                  className={
                    f.level === "high"
                      ? "mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400"
                      : "mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                  }
                />
                <span>
                  {f.message}
                  {f.object && <span className="text-muted-foreground"> · {f.object}</span>}
                </span>
              </li>
            ))}
        </ul>

        {typeToConfirm && (
          <label className="mb-3 block text-xs">
            Type <span className="font-mono font-semibold text-red-300">{phrase}</span> to confirm:
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-2 py-1 font-mono"
            />
          </label>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border bg-muted px-3 py-1 text-xs hover:text-foreground"
          >
            Cancel
          </button>
          <button
            disabled={!canProceed}
            onClick={onConfirm}
            className="rounded-md bg-red-500 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
          >
            Run anyway
          </button>
        </div>
      </div>
    </div>
  );
}
