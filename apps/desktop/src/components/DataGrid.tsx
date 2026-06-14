import { useCallback, useEffect, useState } from "react";
import { Plus, RotateCcw, Save, Eye, RefreshCw, Trash2, Undo2, X, Download, Upload } from "lucide-react";
import {
  api,
  errMessage,
  type ApiError,
  type CellValue,
  type EditStatement,
  type RowEdit,
  type TableData,
} from "@/lib/api";
import { useStore } from "@/store";
import { cn } from "@/lib/utils";
import { exportTableToCsv, importCsvIntoTable } from "@/lib/csv";

/** A draft cell can be unset (use DB default), explicit NULL, or a text value. */
type DraftValue = string | null | undefined;

export function DataGrid({ schema, table }: { schema: string; table: string }) {
  const session = useStore((s) => s.session);

  const [data, setData] = useState<TableData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Staged edits, keyed by original row index.
  const [updates, setUpdates] = useState<Record<number, Record<string, string | null>>>({});
  const [deletes, setDeletes] = useState<Record<number, true>>({});
  const [inserts, setInserts] = useState<Record<string, DraftValue>[]>([]);

  const [editing, setEditing] = useState<string | null>(null); // "rowKind:idx:col"
  const [preview, setPreview] = useState<EditStatement[] | null>(null);
  const [applying, setApplying] = useState(false);

  const reset = useCallback(() => {
    setUpdates({});
    setDeletes({});
    setInserts([]);
    setEditing(null);
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const d = await api.tableData(session.sessionId, schema, table, 200);
      setData(d);
      reset();
    } catch (e) {
      setError(errMessage(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [session, schema, table, reset]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv() {
    if (!session) return;
    setError(null);
    try {
      const bytes = await exportTableToCsv(session.sessionId, schema, table);
      if (bytes !== null) setNotice(`Exported ${bytes.toLocaleString()} bytes to CSV`);
    } catch (e) {
      setError(errMessage(e));
    }
  }

  async function importCsv() {
    if (!session) return;
    setError(null);
    try {
      const rows = await importCsvIntoTable(session.sessionId, schema, table);
      if (rows !== null) {
        setNotice(`Imported ${rows.toLocaleString()} rows`);
        await load();
      }
    } catch (e) {
      setError(errMessage(e));
    }
  }

  const dirtyCount =
    Object.values(updates).filter((c) => Object.keys(c).length > 0).length +
    Object.keys(deletes).length +
    inserts.length;

  const keyCells = useCallback(
    (idx: number): CellValue[] => {
      if (!data) return [];
      return data.key_columns.map((kc) => {
        const colIdx = data.columns.findIndex((c) => c.name === kc);
        return { column: kc, value: data.rows[idx][colIdx] ?? null };
      });
    },
    [data],
  );

  const buildEdits = useCallback((): RowEdit[] => {
    if (!data) return [];
    const edits: RowEdit[] = [];
    for (const [idxStr, cols] of Object.entries(updates)) {
      const idx = Number(idxStr);
      if (deletes[idx]) continue; // a delete supersedes edits to the same row
      const set = Object.entries(cols).map(([column, value]) => ({ column, value }));
      if (set.length === 0) continue;
      edits.push({
        kind: "update",
        schema,
        table,
        key: keyCells(idx),
        xmin: data.row_xmins[idx] ?? "",
        set,
      });
    }
    for (const idxStr of Object.keys(deletes)) {
      const idx = Number(idxStr);
      edits.push({
        kind: "delete",
        schema,
        table,
        key: keyCells(idx),
        xmin: data.row_xmins[idx] ?? "",
      });
    }
    for (const draft of inserts) {
      const values: CellValue[] = Object.entries(draft)
        .filter(([, v]) => v !== undefined) // unset ⇒ omit ⇒ DB default
        .map(([column, value]) => ({ column, value: value as string | null }));
      if (values.length > 0) edits.push({ kind: "insert", schema, table, values });
    }
    return edits;
  }, [data, updates, deletes, inserts, schema, table, keyCells]);

  async function doPreview() {
    if (!session) return;
    setError(null);
    try {
      const stmts = await api.gridBuildEditSql(session.sessionId, buildEdits());
      setPreview(stmts);
    } catch (e) {
      setError(errMessage(e));
    }
  }

  async function doApply() {
    if (!session) return;
    setApplying(true);
    setError(null);
    setNotice(null);
    try {
      const out = await api.gridApplyEdits(session.sessionId, buildEdits(), true);
      setPreview(null);
      setNotice(`Applied ${out.applied} change${out.applied === 1 ? "" : "s"}.`);
      await load();
    } catch (e) {
      const code = (e as ApiError)?.code;
      setError(errMessage(e));
      setPreview(null);
      if (code === "conflict") {
        setNotice("Reloaded after a concurrency conflict — re-apply your changes.");
        await load();
      }
    } finally {
      setApplying(false);
    }
  }

  // --- cell editing helpers ---------------------------------------------

  function stageUpdate(idx: number, col: string, value: string | null) {
    setUpdates((u) => {
      const original = data?.rows[idx][colIndex(col)] ?? null;
      const next = { ...(u[idx] ?? {}) };
      if (value === original) {
        delete next[col];
      } else {
        next[col] = value;
      }
      return { ...u, [idx]: next };
    });
  }

  function colIndex(col: string): number {
    return data?.columns.findIndex((c) => c.name === col) ?? -1;
  }

  function effectiveValue(idx: number, col: string): string | null {
    const staged = updates[idx]?.[col];
    if (staged !== undefined) return staged;
    return data?.rows[idx][colIndex(col)] ?? null;
  }

  function isDirty(idx: number, col: string): boolean {
    return updates[idx]?.[col] !== undefined;
  }

  function addRow() {
    setInserts((rows) => [...rows, {}]);
  }

  const columns = data?.columns ?? [];
  const editable = data?.editable ?? false;

  if (!session) {
    return <Empty text="Connect to a server to view data." />;
  }

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        schema={schema}
        table={table}
        editable={editable}
        readonlyReason={data?.readonly_reason ?? null}
        dirtyCount={dirtyCount}
        rowCount={data?.rows.length ?? 0}
        truncated={data?.truncated ?? false}
        busy={loading || applying}
        onAddRow={addRow}
        onRevert={reset}
        onPreview={doPreview}
        onRefresh={load}
        onExport={exportCsv}
        onImport={importCsv}
      />

      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="info">{notice}</Banner>}

      <div className="flex-1 overflow-auto">
        {loading && !data ? (
          <Empty text="Loading…" />
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-card">
              <tr>
                <th className="w-10 border-b border-r px-1 py-1" />
                {columns.map((c) => (
                  <th
                    key={c.name}
                    className="border-b border-r px-2 py-1 text-left font-medium"
                    title={c.type_name}
                  >
                    {c.name}
                    {data?.key_columns.includes(c.name) && (
                      <span className="ml-1 text-amber-400" title="key column">
                        🔑
                      </span>
                    )}
                    <span className="ml-1 font-normal text-muted-foreground">{c.type_name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((_row, idx) => {
                const deleted = !!deletes[idx];
                return (
                  <tr key={idx} className={cn("hover:bg-muted/40", deleted && "opacity-50")}>
                    <td className="border-b border-r px-1 py-0.5 text-center">
                      {editable ? (
                        <button
                          title={deleted ? "Undo delete" : "Delete row"}
                          onClick={() =>
                            setDeletes((d) => {
                              const next = { ...d };
                              if (next[idx]) delete next[idx];
                              else next[idx] = true;
                              return next;
                            })
                          }
                          className="text-muted-foreground hover:text-red-400"
                        >
                          {deleted ? (
                            <Undo2 className="h-3.5 w-3.5" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">{idx + 1}</span>
                      )}
                    </td>
                    {columns.map((c) => {
                      const cellKey = `r:${idx}:${c.name}`;
                      const val = effectiveValue(idx, c.name);
                      return (
                        <Cell
                          key={c.name}
                          editable={editable && !deleted}
                          editing={editing === cellKey}
                          dirty={isDirty(idx, c.name)}
                          value={val}
                          onStartEdit={() => setEditing(cellKey)}
                          onCommit={(v) => {
                            stageUpdate(idx, c.name, v);
                            setEditing(null);
                          }}
                          onCancel={() => setEditing(null)}
                        />
                      );
                    })}
                  </tr>
                );
              })}

              {/* Draft (insert) rows */}
              {inserts.map((draft, di) => (
                <tr key={`ins:${di}`} className="bg-emerald-500/5">
                  <td className="border-b border-r px-1 py-0.5 text-center">
                    <button
                      title="Discard new row"
                      onClick={() => setInserts((r) => r.filter((_, i) => i !== di))}
                      className="text-muted-foreground hover:text-red-400"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </td>
                  {columns.map((c) => {
                    const cellKey = `i:${di}:${c.name}`;
                    return (
                      <DraftCell
                        key={c.name}
                        editing={editing === cellKey}
                        value={draft[c.name]}
                        onStartEdit={() => setEditing(cellKey)}
                        onCommit={(v) => {
                          setInserts((rows) =>
                            rows.map((r, i) => (i === di ? { ...r, [c.name]: v } : r)),
                          );
                          setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {preview && (
        <PreviewDialog
          statements={preview}
          applying={applying}
          onApply={doApply}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Toolbar(props: {
  schema: string;
  table: string;
  editable: boolean;
  readonlyReason: string | null;
  dirtyCount: number;
  rowCount: number;
  truncated: boolean;
  busy: boolean;
  onAddRow: () => void;
  onRevert: () => void;
  onPreview: () => void;
  onRefresh: () => void;
  onExport: () => void;
  onImport: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-2 py-1.5 text-xs">
      <span className="font-medium">
        {props.schema}.{props.table}
      </span>
      {props.editable ? (
        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-400">
          editable
        </span>
      ) : (
        <span
          className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-amber-400"
          title={props.readonlyReason ?? undefined}
        >
          read-only{props.readonlyReason ? ` · ${props.readonlyReason}` : ""}
        </span>
      )}

      {props.editable && (
        <>
          <button
            onClick={props.onAddRow}
            className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 hover:text-foreground"
          >
            <Plus className="h-3 w-3" /> Add row
          </button>
          <button
            disabled={props.dirtyCount === 0}
            onClick={props.onRevert}
            className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 disabled:opacity-40"
          >
            <RotateCcw className="h-3 w-3" /> Revert
          </button>
          <button
            disabled={props.dirtyCount === 0}
            onClick={props.onPreview}
            className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground disabled:opacity-40"
          >
            <Eye className="h-3 w-3" /> Preview &amp; Save
            {props.dirtyCount > 0 && (
              <span className="ml-0.5 rounded bg-primary-foreground/20 px-1">
                {props.dirtyCount}
              </span>
            )}
          </button>
        </>
      )}

      <div className="ml-auto flex items-center gap-2 text-muted-foreground">
        <span>
          {props.rowCount} rows{props.truncated ? " (page)" : ""}
        </span>
        <button
          onClick={props.onExport}
          disabled={props.busy}
          title="Export table to CSV"
          className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 disabled:opacity-40"
        >
          <Download className="h-3 w-3" /> Export
        </button>
        {props.editable && (
          <button
            onClick={props.onImport}
            disabled={props.busy}
            title="Import CSV into this table"
            className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 disabled:opacity-40"
          >
            <Upload className="h-3 w-3" /> Import
          </button>
        )}
        <button
          onClick={props.onRefresh}
          disabled={props.busy}
          title="Refresh"
          className="rounded-md border bg-muted p-1 disabled:opacity-40"
        >
          <RefreshCw className={cn("h-3 w-3", props.busy && "animate-spin")} />
        </button>
      </div>
    </div>
  );
}

function Cell(props: {
  editable: boolean;
  editing: boolean;
  dirty: boolean;
  value: string | null;
  onStartEdit: () => void;
  onCommit: (v: string | null) => void;
  onCancel: () => void;
}) {
  if (props.editing) {
    return (
      <td className="border-b border-r p-0">
        <CellEditor value={props.value} onCommit={props.onCommit} onCancel={props.onCancel} />
      </td>
    );
  }
  return (
    <td
      onClick={props.editable ? props.onStartEdit : undefined}
      className={cn(
        "max-w-[28rem] truncate border-b border-r px-2 py-1 font-mono",
        props.editable && "cursor-text",
        props.dirty && "bg-amber-500/15",
      )}
      title={props.value ?? "NULL"}
    >
      {props.value === null ? <span className="italic text-muted-foreground">NULL</span> : props.value}
    </td>
  );
}

function DraftCell(props: {
  editing: boolean;
  value: DraftValue;
  onStartEdit: () => void;
  onCommit: (v: string | null) => void;
  onCancel: () => void;
}) {
  if (props.editing) {
    return (
      <td className="border-b border-r p-0">
        <CellEditor
          value={props.value ?? null}
          onCommit={props.onCommit}
          onCancel={props.onCancel}
        />
      </td>
    );
  }
  return (
    <td
      onClick={props.onStartEdit}
      className="max-w-[28rem] cursor-text truncate border-b border-r px-2 py-1 font-mono"
    >
      {props.value === undefined ? (
        <span className="italic text-muted-foreground/60">default</span>
      ) : props.value === null ? (
        <span className="italic text-muted-foreground">NULL</span>
      ) : (
        props.value
      )}
    </td>
  );
}

function CellEditor(props: {
  value: string | null;
  onCommit: (v: string | null) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(props.value ?? "");
  return (
    <div className="flex items-center gap-1 bg-background px-1 py-0.5">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") props.onCommit(text);
          if (e.key === "Escape") props.onCancel();
        }}
        onBlur={() => props.onCommit(text)}
        className="w-full min-w-[6rem] rounded border bg-card px-1 py-0.5 font-mono text-xs outline-none focus:ring-1 focus:ring-primary"
      />
      <button
        title="Set NULL"
        // onMouseDown fires before the input's onBlur, so NULL wins.
        onMouseDown={(e) => {
          e.preventDefault();
          props.onCommit(null);
        }}
        className="rounded border px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
      >
        ∅
      </button>
    </div>
  );
}

function PreviewDialog(props: {
  statements: EditStatement[];
  applying: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 p-6">
      <div className="flex max-h-full w-full max-w-3xl flex-col rounded-lg border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <h2 className="text-sm font-semibold">
            SQL preview · {props.statements.length} statement
            {props.statements.length === 1 ? "" : "s"}
          </h2>
          <button onClick={props.onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-auto p-4">
          {props.statements.length === 0 && (
            <p className="text-xs text-muted-foreground">No changes to apply.</p>
          )}
          {props.statements.map((s, i) => (
            <div key={i} className="rounded-md border">
              <pre className="overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-xs">
                {s.sql}
              </pre>
              {s.params.length > 0 && (
                <div className="border-t px-2 py-1 text-[11px] text-muted-foreground">
                  params:{" "}
                  {s.params
                    .map((p, j) => `$${j + 1}=${p === null ? "NULL" : JSON.stringify(p)}`)
                    .join("  ")}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-2">
          <p className="mr-auto text-[11px] text-muted-foreground">
            Runs in one transaction; any conflict or error rolls back everything.
          </p>
          <button onClick={props.onClose} className="rounded-md border bg-muted px-3 py-1 text-xs">
            Cancel
          </button>
          <button
            disabled={props.applying || props.statements.length === 0}
            onClick={props.onApply}
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            <Save className="h-3 w-3" /> {props.applying ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Banner({ kind, children }: { kind: "error" | "info"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "border-b px-3 py-1.5 text-xs",
        kind === "error"
          ? "border-red-500/30 bg-red-500/10 text-red-300"
          : "border-sky-500/30 bg-sky-500/10 text-sky-300",
      )}
    >
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
