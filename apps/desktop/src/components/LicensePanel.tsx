import { useEffect, useState } from "react";
import { Crown, Check } from "lucide-react";
import { api, type Entitlements, type Feature } from "@/lib/api";

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
            ? "flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300"
            : "flex items-center gap-1 rounded-md border bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
        }
        title="License"
      >
        <Crown className="h-3 w-3" />
        {isPro ? (ent?.plan === "team" ? "Team" : "Pro") : "Free"}
      </button>

      {open && (
        <div className="absolute right-0 top-7 z-30 w-72 rounded-lg border bg-card p-3 shadow-xl">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Crown className="h-4 w-4 text-amber-400" /> Penta {isPro ? "Pro" : "Free"}
          </div>
          {ent?.expired && (
            <p className="mb-2 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
              License expired — running on the free tier.
            </p>
          )}
          {isPro && ent && (
            <ul className="mb-3 space-y-0.5 text-[11px]">
              {ent.features.map((f) => (
                <li key={f} className="flex items-center gap-1 text-muted-foreground">
                  <Check className="h-3 w-3 text-emerald-400" /> {FEATURE_LABELS[f]}
                </li>
              ))}
            </ul>
          )}
          {!isPro && (
            <p className="mb-2 text-[11px] text-muted-foreground">
              The full workbench is free and open-source. Pro unlocks schema diff, ERD export,
              managed AI, advanced monitoring, and the table designer.
            </p>
          )}
          <label className="block text-[11px] text-muted-foreground">
            License key
            <input
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="paste your key"
              className="mt-0.5 w-full rounded border bg-background px-2 py-1 font-mono text-[11px]"
            />
          </label>
          <button
            onClick={activate}
            disabled={busy}
            className="mt-2 w-full rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {keyInput.trim() ? "Activate" : "Clear"}
          </button>
        </div>
      )}
    </div>
  );
}
