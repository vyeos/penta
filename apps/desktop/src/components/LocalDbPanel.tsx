import { useCallback, useEffect, useState } from "react";
import { Database, Plus, Play, Square, Copy, Check, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { api, errMessage, type InstanceInfo } from "@/lib/api";
import { useStore } from "@/store";

/**
 * Docker-free local PostgreSQL manager. Create an instance and Penta spins up a
 * real Postgres cluster on a free port, then hands you a DATABASE_URL to paste
 * into a project's `.env`. Start/stop/open/remove from here.
 */
export function LocalDbPanel() {
  const setSession = useStore((s) => s.setSession);
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // "create" | instance id
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setInstances(await api.instanceList());
    } catch (e) {
      setError(errMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create() {
    if (!name.trim()) return;
    setBusy("create");
    setError(null);
    try {
      await api.instanceProvision(name.trim());
      setName("");
      setShowForm(false);
      await refresh();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function toggle(inst: InstanceInfo) {
    setBusy(inst.id);
    setError(null);
    try {
      if (inst.running) await api.instanceStop(inst.id);
      else await api.instanceStart(inst.id);
      await refresh();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function open(inst: InstanceInfo) {
    setBusy(inst.id);
    setError(null);
    try {
      const s = await api.instanceOpen(inst.id);
      setSession({
        sessionId: s.session_id,
        connectionId: s.connection_id,
        name: s.name,
        envLabel: s.env_label,
        readOnly: s.read_only,
      });
      await refresh();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(inst: InstanceInfo) {
    if (!confirm(`Delete local database "${inst.name}" and all its data? This cannot be undone.`))
      return;
    setBusy(inst.id);
    try {
      await api.instanceRemove(inst.id);
      await refresh();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function copy(url: string, id: string) {
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Database className="h-3 w-3" /> Local databases
        </p>
        <button
          className="rounded-md border bg-muted px-2 py-0.5 text-xs hover:text-foreground"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "Cancel" : "+ New"}
        </button>
      </div>

      {showForm && (
        <div className="space-y-1.5 rounded-md border bg-card p-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="project name, e.g. my-app"
            className="w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            disabled={busy === "create" || !name.trim()}
            onClick={create}
            className="flex w-full items-center justify-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy === "create" ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Provisioning Postgres…
              </>
            ) : (
              <>
                <Plus className="h-3 w-3" /> Create &amp; start
              </>
            )}
          </button>
          <p className="text-[10px] text-muted-foreground">
            Spins up a real PostgreSQL on a free port. No Docker required.
          </p>
        </div>
      )}

      {error && <p className="px-1 text-xs text-red-400">{error}</p>}

      <ul className="space-y-1">
        {instances.map((inst) => (
          <li key={inst.id} className="rounded-md border bg-card/50 p-2">
            <div className="flex items-center gap-2">
              <span
                className={inst.running ? "h-2 w-2 rounded-full bg-emerald-500" : "h-2 w-2 rounded-full bg-muted-foreground/40"}
                title={inst.running ? "running" : "stopped"}
              />
              <span className="truncate text-sm font-medium">{inst.name}</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                :{inst.port} · PG{inst.pg_version.match(/\d+/)?.[0] ?? ""}
              </span>
            </div>

            <button
              onClick={() => copy(inst.url, inst.id)}
              title="Copy DATABASE_URL"
              className="mt-1 flex w-full items-center gap-1 rounded border bg-background px-1.5 py-1 text-left font-mono text-[10px] text-muted-foreground hover:text-foreground"
            >
              {copied === inst.id ? (
                <Check className="h-3 w-3 shrink-0 text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3 shrink-0" />
              )}
              <span className="truncate">{inst.url}</span>
            </button>

            <div className="mt-1 flex items-center gap-1">
              <IconBtn onClick={() => toggle(inst)} busy={busy === inst.id} title={inst.running ? "Stop" : "Start"}>
                {inst.running ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              </IconBtn>
              <button
                disabled={!inst.running || busy === inst.id}
                onClick={() => open(inst)}
                className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-[11px] hover:text-foreground disabled:opacity-40"
              >
                <ExternalLink className="h-3 w-3" /> Open
              </button>
              <button
                onClick={() => remove(inst)}
                disabled={busy === inst.id}
                title="Delete database"
                className="ml-auto rounded-md border bg-muted p-1 text-muted-foreground hover:text-red-400 disabled:opacity-40"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </li>
        ))}
        {instances.length === 0 && !showForm && (
          <li className="px-1 text-xs text-muted-foreground">
            No local databases yet — create one to get a ready-to-use Postgres.
          </li>
        )}
      </ul>
    </div>
  );
}

function IconBtn({
  onClick,
  busy,
  title,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={title}
      className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-[11px] hover:text-foreground disabled:opacity-40"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : children}
    </button>
  );
}
