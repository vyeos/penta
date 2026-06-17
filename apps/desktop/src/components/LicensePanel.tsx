import { useEffect, useState } from "react";
import { Crown, Check } from "lucide-react";
import { api, type Entitlements, type Feature } from "@/lib/api";
import { Button, inputCls } from "@/components/ui";

const KEY = "penta.license.key";

const FEATURE_LABELS: Record<Feature, string> = {
  schema_diff: "Schema diff",
  erd_export: "ERD export",
  managed_ai: "Managed AI credits",
  advanced_monitoring: "Advanced monitoring",
  table_designer: "Visual table designer",
  multi_workspace: "Multiple workspaces",
  backup_scheduling: "Backup scheduling",
};

/** Open-core Pro panel: shows the active plan and accepts a license key. */
export function LicensePanel() {
  const [open, setOpen] = useState(false);
  const [keyInput, setKeyInput] = useState(() => localStorage.getItem(KEY) ?? "");
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(key: string | null) {
    try {
      setEnt(await api.licenseStatus(key));
    } catch {
      setEnt({ plan: "free", email: null, features: [], expired: false });
    }
  }

  useEffect(() => {
    void refresh(localStorage.getItem(KEY));
  }, []);

  async function activate() {
    setBusy(true);
    const k = keyInput.trim() || null;
    if (k) localStorage.setItem(KEY, k);
    else localStorage.removeItem(KEY);
    await refresh(k);
    setBusy(false);
  }

  const isPro = ent?.plan === "pro" || ent?.plan === "team";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={
          isPro
            ? "inline-flex items-center gap-1 bg-accent/[0.14] px-2 py-1 text-[11px] font-medium text-accent transition-colors"
            : "inline-flex items-center gap-1 bg-ink/[0.05] px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-ink/[0.09] hover:text-ink"
        }
        title="License"
      >
        <Crown className="h-3 w-3" />
        {isPro ? (ent?.plan === "team" ? "Team" : "Pro") : "Free"}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-30 w-72 border border-ink/10 bg-paper p-3 shadow-pop">
          <div className="mb-2 flex items-center gap-1.5 font-display text-sm">
            <Crown className="h-4 w-4 text-accent" /> Penta {isPro ? (ent?.plan === "team" ? "Team" : "Pro") : "Free"}
          </div>
          {ent?.expired && (
            <p className="mb-2 bg-warn/[0.14] px-2 py-1.5 text-[11px] text-warn">
              License expired — running on the free tier.
            </p>
          )}
          {isPro && ent && (
            <ul className="mb-3 space-y-1 text-[11px]">
              {ent.features.map((f) => (
                <li key={f} className="flex items-center gap-1.5 text-muted">
                  <Check className="h-3 w-3 text-ok" /> {FEATURE_LABELS[f]}
                </li>
              ))}
            </ul>
          )}
          {!isPro && (
            <p className="mb-2 text-[11px] text-muted">
              The full workbench is free and open-source. Pro unlocks schema diff, ERD export,
              managed AI, advanced monitoring, and the table designer.
            </p>
          )}
          <label className="block text-[11px] font-medium text-muted">
            License key
            <input
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="paste your key"
              className={`mt-1 font-mono text-[11px] ${inputCls}`}
            />
          </label>
          <Button variant="solid" size="sm" className="mt-2 w-full" onClick={activate} disabled={busy}>
            {keyInput.trim() ? "Activate" : "Clear"}
          </Button>
        </div>
      )}
    </div>
  );
}
