import { useCallback, useEffect, useState } from "react";
import { api, errMessage, type ConnectionConfig, type EnvLabel } from "@/lib/api";
import { useStore } from "@/store";
import { cn } from "@/lib/utils";

const ENV_DOT: Record<EnvLabel, string> = {
  local: "bg-emerald-500",
  staging: "bg-amber-500",
  production: "bg-red-500",
};

const emptyForm = {
  name: "",
  host: "127.0.0.1",
  port: 5432,
  database: "postgres",
  username: "postgres",
  password: "",
  env_label: "local" as EnvLabel,
  read_only: false,
};

export function ConnectionPanel() {
  const [connections, setConnections] = useState<ConnectionConfig[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setSession = useStore((s) => s.setSession);

  const refresh = useCallback(async () => {
    try {
      setConnections(await api.connectionList());
    } catch (e) {
      setStatus(errMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function test() {
    setBusy(true);
    setStatus("Testing…");
    try {
      const r = await api.connectionTest(form);
      setStatus(`OK · ${r.server_version.split(",")[0]}`);
    } catch (e) {
      setStatus(`✗ ${errMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await api.connectionCreate(form);
      setShowForm(false);
      setForm(emptyForm);
      setStatus(null);
      await refresh();
    } catch (e) {
      setStatus(`✗ ${errMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function connect(c: ConnectionConfig) {
    setStatus(`Connecting to ${c.name}…`);
    try {
      const sessionId = await api.connectionConnect(c.id);
      setSession({
        sessionId,
        connectionId: c.id,
        name: c.name,
        envLabel: c.env_label,
        readOnly: c.read_only,
      });
      setStatus(null);
    } catch (e) {
      setStatus(`✗ ${errMessage(e)}`);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Connections
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
          <Field label="Name">
            <Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          </Field>
          <div className="flex gap-1.5">
            <Field label="Host">
              <Input value={form.host} onChange={(v) => setForm({ ...form, host: v })} />
            </Field>
            <Field label="Port" className="w-16">
              <Input
                value={String(form.port)}
                onChange={(v) => setForm({ ...form, port: Number(v) || 5432 })}
              />
            </Field>
          </div>
          <Field label="Database">
            <Input
              value={form.database}
              onChange={(v) => setForm({ ...form, database: v })}
            />
          </Field>
          <Field label="User">
            <Input
              value={form.username}
              onChange={(v) => setForm({ ...form, username: v })}
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={form.password}
              onChange={(v) => setForm({ ...form, password: v })}
            />
          </Field>
          <div className="flex items-center gap-2">
            <select
              className="rounded-md border bg-background px-1.5 py-1 text-xs"
              value={form.env_label}
              onChange={(e) =>
                setForm({ ...form, env_label: e.target.value as EnvLabel })
              }
            >
              <option value="local">local</option>
              <option value="staging">staging</option>
              <option value="production">production</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={form.read_only}
                onChange={(e) => setForm({ ...form, read_only: e.target.checked })}
              />
              read-only
            </label>
          </div>
          <div className="flex gap-1.5 pt-1">
            <button
              disabled={busy}
              onClick={test}
              className="rounded-md border bg-muted px-2 py-1 text-xs disabled:opacity-50"
            >
              Test
            </button>
            <button
              disabled={busy || !form.name}
              onClick={save}
              className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      )}

      <ul className="space-y-0.5">
        {connections.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => connect(c)}
              className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
            >
              <span className={cn("h-2 w-2 rounded-full", ENV_DOT[c.env_label])} />
              <span className="truncate">{c.name}</span>
              <span className="ml-auto truncate text-xs text-muted-foreground">
                {c.host}:{c.port}
              </span>
            </button>
          </li>
        ))}
        {connections.length === 0 && !showForm && (
          <li className="px-2 py-1 text-xs text-muted-foreground">
            No connections yet — add one to begin.
          </li>
        )}
      </ul>

      {status && (
        <p className="truncate px-1 text-xs text-muted-foreground" title={status}>
          {status}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
    />
  );
}
