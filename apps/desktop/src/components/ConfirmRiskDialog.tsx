import { useState } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import type { RiskReport } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button, overlayCls } from "@/components/ui";

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
  const high = report.level === "high";

  return (
    <div className={cn(overlayCls, "z-40")}>
      <div
        className={cn(
          "flex w-[460px] flex-col overflow-hidden border bg-paper shadow-pop",
          high ? "border-accent/40" : "border-ink/10",
        )}
      >
        {/* High risk gets the hazard-bar cue from the marketing site. */}
        {high && <div className="hazard h-1.5" aria-hidden="true" />}
        <div className="p-5">
          <div className="mb-3 flex items-center gap-2">
            {high ? (
              <ShieldAlert className="h-5 w-5 text-accent" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-warn" />
            )}
            <h2 className="text-base font-semibold">
              {high ? "Destructive statement" : "Confirm this statement"}
            </h2>
            {!report.parsed && (
              <span className="ml-auto bg-ink/[0.06] px-2 py-0.5 text-[10px] text-muted">
                heuristic
              </span>
            )}
          </div>

          <ul className="mb-3 space-y-1.5 text-xs">
            {report.findings
              .filter((f) => f.level !== "none" && f.level !== "low")
              .map((f, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-1 h-1.5 w-1.5 shrink-0",
                      f.level === "high" ? "bg-accent" : "bg-warn",
                    )}
                  />
                  <span>
                    {f.message}
                    {f.object && <span className="font-mono text-muted"> · {f.object}</span>}
                  </span>
                </li>
              ))}
          </ul>

          {typeToConfirm && (
            <label className="mb-4 block text-xs">
              Type{" "}
              <span className="bg-accent/[0.14] px-1 py-0.5 font-mono font-semibold text-accent">
                {phrase}
              </span>{" "}
              to confirm:
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="mt-1.5 w-full border border-accent/70 bg-paper px-2.5 py-1.5 font-mono text-sm outline-none ring-1 ring-accent/25"
              />
            </label>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" disabled={!canProceed} onClick={onConfirm}>
              Run anyway
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
