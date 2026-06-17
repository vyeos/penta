import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api, errMessage, type ConnectionConfig, type EnvLabel, type SslMode } from "@/lib/api";
import { parseConnectionString, type ParsedConn } from "@/lib/connString";
import { useStore } from "@/store";
import { cn } from "@/lib/utils";
import { Button, inputCls, selectCls, sectionLabelCls } from "@/components/ui";

const ENV_DOT: Record<EnvLabel, string> = {
  local: "bg-ok",
  staging: "bg-warn",
  production: "bg-accent",
};

const emptyForm = {
  name: "",
  host: "127.0.0.1",
  port: 5432,
  database: "postgres",
  username: "postgres",
  password: "",
  ssl_mode: "prefer" as SslMode,
  env_label: "local" as EnvLabel,
  read_only: false,
};

export function ConnectionPanel() {
  const [connections, setConnections] = useState<ConnectionConfig[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [connStr, setConnStr] = useState("");
  const [connNote, setConnNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setSession = useStore((s) => s.setSession);
  const session = useStore((s) => s.session);

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

  // Paste a DSN to seed the fields below; only the keys present are overwritten,
  // and an empty Name is seeded from the database so saving is one less step.
  function applyConnString(value: string) {
    setConnStr(value);
    if (!value.trim()) {
      setConnNote(null);
      return;
    }
    const p = parseConnectionString(value);
    if (!p) {
      setConnNote({ ok: false, text: "Couldn't read that — enter the fields manually." });
      return;
    }
    setForm((f) => ({
      ...f,
      ...(p.host !== undefined ? { host: p.host } : {}),
      ...(p.port !== undefined ? { port: p.port } : {}),
      ...(p.database !== undefined ? { database: p.database } : {}),
      ...(p.username !== undefined ? { username: p.username } : {}),
      ...(p.password !== undefined ? { password: p.password } : {}),
      ...(p.ssl_mode !== undefined ? { ssl_mode: p.ssl_mode } : {}),
      name: f.name || p.database || p.host || f.name,
    }));
    setConnNote({ ok: true, text: summarizeConn(p) });
  }

  function resetForm() {
    setForm(emptyForm);
    setConnStr("");
    setConnNote(null);
  }

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
      resetForm();
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

  async function remove(c: ConnectionConfig) {
    if (
      !confirm(
        `Delete the connection "${c.name}"? Penta forgets its saved credentials. ` +
          `The database itself is not touched. This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    setStatus(null);
    try {
      await api.connectionDelete(c.id);
      // If we just deleted the connection we're attached to, clear the session.
      if (session?.connectionId === c.id) setSession(null);
      await refresh();
    } catch (e) {
      setStatus(`✗ ${errMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className={sectionLabelCls}>Connections</p>
        <Button variant="ghost" size="xs" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New"}
        </Button>
      </div>

      {showForm && (
        <div className="space-y-2 bg-ink/[0.03] p-2.5">
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted">
              Connection string
              <span className="font-normal text-muted/60">optional</span>
            </span>
            <textarea
              className={cn(inputCls, "resize-none font-mono text-[11px] leading-snug")}
              rows={2}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="postgresql://user:password@host:5432/dbname"
              value={connStr}
              onChange={(e) => applyConnString(e.target.value)}
            />
          </label>
          {connNote && (
            <p
              className={cn("truncate font-mono text-[10px]", connNote.ok ? "text-ok" : "text-muted/70")}
              title={connNote.text}
            >
              {connNote.text}
            </p>
          )}

          <div className="flex items-center gap-2 py-0.5 text-[10px] uppercase tracking-wide text-muted/50">
            <span className="h-px flex-1 bg-ink/[0.08]" />
            or enter manually
            <span className="h-px flex-1 bg-ink/[0.08]" />
          </div>

          <Field label="Name">
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="flex gap-2">
            <Field label="Host">
              <input className={inputCls} value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
            </Field>
            <Field label="Port" className="w-16">
              <input
                className={inputCls}
                value={String(form.port)}
                onChange={(e) => setForm({ ...form, port: Number(e.target.value) || 5432 })}
              />
            </Field>
          </div>
          <Field label="Database">
            <input
              className={inputCls}
              value={form.database}
              onChange={(e) => setForm({ ...form, database: e.target.value })}
            />
          </Field>
          <Field label="User">
            <input
              className={inputCls}
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </Field>
          <Field label="Password">
            <input
              className={inputCls}
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <div className="flex items-center gap-2">
            <select
              className={selectCls}
              value={form.env_label}
              onChange={(e) => setForm({ ...form, env_label: e.target.value as EnvLabel })}
            >
              <option value="local">local</option>
              <option value="staging">staging</option>
              <option value="production">production</option>
            </select>
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              <input
                type="checkbox"
                className="accent-accent"
                checked={form.read_only}
                onChange={(e) => setForm({ ...form, read_only: e.target.checked })}
              />
              read-only
            </label>
          </div>
          <div className="flex gap-2 pt-0.5">
            <Button variant="ghost" size="sm" disabled={busy} onClick={test}>
              Test
            </Button>
            <Button variant="solid" size="sm" disabled={busy || !form.name} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      )}

      <ul className="space-y-0.5">
        {connections.map((c) => (
          <li key={c.id} className="group flex items-center gap-1">
            <button
              onClick={() => connect(c)}
              className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left text-sm transition-colors hover:bg-ink/[0.05]"
            >
              <span className={cn("h-2 w-2 shrink-0", ENV_DOT[c.env_label])} />
              <span className="truncate">{c.name}</span>
              <span className="ml-auto truncate font-mono text-[10px] text-muted/70">
                {c.host}:{c.port}
              </span>
            </button>
            <Button
              variant="plain"
              size="xs"
              onClick={() => remove(c)}
              disabled={busy}
              title="Delete connection"
              className="shrink-0 opacity-0 transition-opacity hover:bg-accent/10 hover:text-accent focus:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </li>
        ))}
        {connections.length === 0 && !showForm && (
          <li className="px-2 py-1 text-xs text-muted/80">No connections yet — add one to begin.</li>
        )}
      </ul>

      {status && (
        <p className="truncate px-1 font-mono text-[11px] text-muted" title={status}>
          {status}
        </p>
      )}
    </div>
  );
}

/** One-line "Filled user@host:port/db · sslmode=…" recap of a parsed DSN. */
function summarizeConn(p: ParsedConn): string {
  const auth = p.username ? `${p.username}@` : "";
  const port = p.port ? `:${p.port}` : "";
  const db = p.database ? `/${p.database}` : "";
  const ssl = p.ssl_mode ? ` · sslmode=${p.ssl_mode}` : "";
  return `Filled ${auth}${p.host ?? ""}${port}${db}${ssl}`;
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
      <span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
