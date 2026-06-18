import { useCallback, useEffect, useState } from "react";
import { Database, Plus, Play, Square, Copy, Check, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { api, type InstanceInfo } from "@/lib/api";
import { useStore } from "@/store";
import { useActionFeedback } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { Button, inputCls, sectionLabelCls } from "@/components/ui";

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
  const [copied, setCopied] = useState<string | null>(null);
  const { fail, isFlashing } = useActionFeedback();

  const refresh = useCallback(async () => {
    try {
      setInstances(await api.instanceList());
    } catch (e) {
      fail(e, { title: "Couldn't load local databases" });
    }
  }, [fail]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create() {
    if (!name.trim()) return;
    setBusy("create");
    try {
      await api.instanceProvision(name.trim());
      setName("");
      setShowForm(false);
      await refresh();
    } catch (e) {
      fail(e, { key: "create", title: "Couldn't create database" });
    } finally {
      setBusy(null);
    }
  }

  async function toggle(inst: InstanceInfo) {
    setBusy(inst.id);
    try {
      if (inst.running) await api.instanceStop(inst.id);
      else await api.instanceStart(inst.id);
      await refresh();
    } catch (e) {
      fail(e, { key: inst.id, title: `Couldn't ${inst.running ? "stop" : "start"} ${inst.name}` });
    } finally {
      setBusy(null);
    }
  }

  async function open(inst: InstanceInfo) {
    setBusy(inst.id);
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
      fail(e, { key: `open-${inst.id}`, title: `Couldn't open ${inst.name}` });
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
      fail(e, { key: `del-${inst.id}`, title: "Couldn't delete database" });
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
        <p className={cn(sectionLabelCls, "flex items-center gap-1.5")}>
          <Database className="h-3.5 w-3.5 text-muted/70" /> Local databases
        </p>
        <Button variant="ghost" size="xs" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New"}
        </Button>
      </div>

      {showForm && (
        <div className="space-y-2 bg-ink/[0.03] p-2.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="project name, e.g. my-app"
            className={inputCls}
          />
          <Button
            variant="solid"
            size="sm"
            className="w-full"
            disabled={busy === "create" || !name.trim()}
            flashing={isFlashing("create")}
            onClick={create}
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
          </Button>
          <p className="text-[11px] text-muted/80">
            Spins up a real PostgreSQL on a free port. No Docker required.
          </p>
        </div>
      )}

      <ul className="space-y-1.5">
        {instances.map((inst) => (
          <li key={inst.id} className="bg-ink/[0.03] p-2.5">
            <div className="flex items-center gap-2">
              <span
                className={cn("h-2 w-2 shrink-0", inst.running ? "bg-ok" : "bg-muted/40")}
                title={inst.running ? "running" : "stopped"}
              />
              <span className="truncate text-sm font-medium">{inst.name}</span>
              <span className="ml-auto font-mono text-[10px] text-muted/70">
                :{inst.port} · PG{inst.pg_version.match(/\d+/)?.[0] ?? ""}
              </span>
            </div>

            <button
              onClick={() => copy(inst.url, inst.id)}
              title="Copy DATABASE_URL"
              className="mt-2 flex w-full items-center gap-1.5 bg-ink/[0.04] px-2 py-1.5 text-left font-mono text-[10px] text-muted transition-colors hover:bg-ink/[0.08] hover:text-ink"
            >
              {copied === inst.id ? (
                <Check className="h-3 w-3 shrink-0 text-ok" />
              ) : (
                <Copy className="h-3 w-3 shrink-0" />
              )}
              <span className="truncate">{inst.url}</span>
            </button>

            <div className="mt-2 flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => toggle(inst)}
                disabled={busy === inst.id}
                flashing={isFlashing(inst.id)}
                title={inst.running ? "Stop" : "Start"}
              >
                {busy === inst.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : inst.running ? (
                  <Square className="h-3 w-3" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={!inst.running || busy === inst.id}
                flashing={isFlashing(`open-${inst.id}`)}
                onClick={() => open(inst)}
              >
                <ExternalLink className="h-3 w-3" /> Open
              </Button>
              <Button
                variant="plain"
                size="xs"
                onClick={() => remove(inst)}
                disabled={busy === inst.id}
                flashing={isFlashing(`del-${inst.id}`)}
                title="Delete database"
                className="ml-auto hover:bg-accent/10 hover:text-accent"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </li>
        ))}
        {instances.length === 0 && !showForm && (
          <li className="px-1 text-xs text-muted/80">
            No local databases yet — create one to get a ready-to-use Postgres.
          </li>
        )}
      </ul>
    </div>
  );
}
