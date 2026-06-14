import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { autocompletion } from "@codemirror/autocomplete";
import { keymap } from "@codemirror/view";
import { Play, Square, ShieldCheck, ShieldAlert, AlertTriangle, Download } from "lucide-react";
import {
  api,
  errMessage,
  type CompletionModel,
  type QueryResult,
  type RiskLevel,
  type RiskReport,
} from "@/lib/api";
import { useStore } from "@/store";
import { makeSqlCompletionSource } from "@/lib/autocomplete";
import { exportQueryToCsv } from "@/lib/csv";
import { AiPanel } from "@/components/AiPanel";
import { ConfirmRiskDialog } from "@/components/ConfirmRiskDialog";
import { CellViewer } from "@/components/CellViewer";

const DOM_ROW_CAP = 500;

export function QueryPanel() {
  const session = useStore((s) => s.session);
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const runNonce = useStore((s) => s.runNonce);

  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [risk, setRisk] = useState<RiskReport | null>(null);
  const [pending, setPending] = useState<RiskReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const runRef = useRef<() => void>(() => {});

  // Schema model for autocomplete, fetched once per session, read via ref so the
  // completion source always sees the latest without rebuilding the editor.
  const modelRef = useRef<CompletionModel | null>(null);
  useEffect(() => {
    modelRef.current = null;
    if (!session) return;
    api
      .schemaCompletion(session.sessionId)
      .then((m) => (modelRef.current = m))
      .catch(() => {});
  }, [session]);

  async function execute(confirmed: boolean) {
    if (!session || running) return;
    setRunning(true);
    setError(null);
    try {
      const r = await api.queryExecute(
        session.sessionId,
        useStore.getState().query,
        undefined,
        confirmed,
      );
      setResult(r);
    } catch (e) {
      setError(errMessage(e));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  async function run() {
    if (!session || running) return;
    setError(null);
    try {
      const report = await api.queryAnalyze(session.sessionId, useStore.getState().query);
      setRisk(report);
      if (report.confirm_tier === "allow") {
        await execute(false);
      } else {
        setPending(report); // show the tiered confirm dialog
      }
    } catch (e) {
      // If analysis itself fails, fall back to a direct run (server re-checks).
      setError(errMessage(e));
    }
  }

  async function cancel() {
    if (session) await api.queryCancel(session.sessionId).catch(() => {});
  }

  async function exportCsv() {
    if (!session) return;
    setError(null);
    try {
      const bytes = await exportQueryToCsv(session.sessionId, useStore.getState().query);
      if (bytes !== null) setNotice(`Exported ${bytes.toLocaleString()} bytes`);
    } catch (e) {
      setError(errMessage(e));
    }
  }

  runRef.current = run;

  // Explorer double-click requests a run via the store nonce.
  useEffect(() => {
    if (runNonce > 0) runRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runNonce]);

  // Live, debounced risk badge as the user types.
  useEffect(() => {
    if (!session || !query.trim()) {
      setRisk(null);
      return;
    }
    const id = setTimeout(() => {
      api
        .queryAnalyze(session.sessionId, query)
        .then(setRisk)
        .catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [query, session]);

  const completionSource = useCallback(
    // Stable source closing over the ref; indexing happens lazily on trigger.
    (ctx: Parameters<ReturnType<typeof makeSqlCompletionSource>>[0]) =>
      makeSqlCompletionSource(modelRef.current)(ctx),
    [],
  );

  const extensions = useMemo(
    () => [
      sql({ dialect: PostgreSQL }),
      autocompletion({ override: [completionSource] }),
      keymap.of([{ key: "Mod-Enter", run: () => (runRef.current(), true) }]),
    ],
    [completionSource],
  );

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <button
          disabled={!session || running}
          onClick={run}
          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          <Play className="h-3 w-3" /> Run
          <kbd className="ml-1 opacity-70">⌘↵</kbd>
        </button>
        <button
          disabled={!running}
          onClick={cancel}
          className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs disabled:opacity-50"
        >
          <Square className="h-3 w-3" /> Cancel
        </button>
        <button
          disabled={!result}
          onClick={exportCsv}
          title="Export result to CSV"
          className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs disabled:opacity-50"
        >
          <Download className="h-3 w-3" /> CSV
        </button>

        <RiskBadge risk={risk} />

        {session?.readOnly && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-amber-400">read-only</span>
        )}
        {session?.envLabel === "production" && (
          <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] text-red-400">
            PRODUCTION
          </span>
        )}

        {session && (
          <AiPanel
            sessionId={session.sessionId}
            getSql={() => useStore.getState().query}
            getError={() => error}
            onInsertSql={(s) => setQuery(s)}
          />
        )}

        <div className="ml-auto text-xs text-muted-foreground">
          {notice && <span className="mr-2 text-emerald-400">{notice}</span>}
          {result &&
            `${result.row_count} rows · ${result.duration_ms} ms${
              result.truncated ? " · truncated" : ""
            }`}
        </div>
      </div>

      <div className="min-h-[120px] border-b">
        <CodeMirror
          value={query}
          height="180px"
          theme="dark"
          extensions={extensions}
          onChange={setQuery}
          basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: false }}
        />
      </div>

      <div className="flex-1 overflow-auto">
        {error && (
          <pre className="m-2 whitespace-pre-wrap rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
            {error}
          </pre>
        )}
        {result && !error && <ResultTable result={result} />}
        {!result && !error && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {session ? "Run a query to see results." : "Connect to begin."}
          </div>
        )}
      </div>

      {pending && (
        <ConfirmRiskDialog
          report={pending}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            execute(true);
          }}
        />
      )}
    </div>
  );
}

function RiskBadge({ risk }: { risk: RiskReport | null }) {
  if (!risk || risk.level === "none" || risk.level === "low") {
    if (risk && risk.statement_count > 0) {
      return (
        <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-emerald-400">
          <ShieldCheck className="h-3 w-3" /> safe
        </span>
      );
    }
    return null;
  }
  const cfg: Record<Exclude<RiskLevel, "none" | "low">, { cls: string; label: string; icon: typeof ShieldAlert }> = {
    medium: { cls: "bg-amber-500/15 text-amber-300", label: "schema change", icon: AlertTriangle },
    high: { cls: "bg-red-500/15 text-red-300", label: "destructive", icon: ShieldAlert },
  };
  const c = cfg[risk.level as "medium" | "high"];
  const Icon = c.icon;
  return (
    <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${c.cls}`}>
      <Icon className="h-3 w-3" /> {c.label}
    </span>
  );
}

function ResultTable({ result }: { result: QueryResult }) {
  const rows = result.rows.slice(0, DOM_ROW_CAP);
  const [view, setView] = useState<{ column: string; value: string | null } | null>(null);
  return (
    <div className="overflow-auto">
      {view && (
        <CellViewer column={view.column} value={view.value} onClose={() => setView(null)} />
      )}
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-card">
          <tr>
            <th className="border-b border-r px-2 py-1 text-right text-muted-foreground">#</th>
            {result.columns.map((c) => (
              <th
                key={c.name}
                className="border-b border-r px-2 py-1 text-left font-medium"
                title={c.type_name}
              >
                {c.name}
                <span className="ml-1 font-normal text-muted-foreground">{c.type_name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-muted/50">
              <td className="border-b border-r px-2 py-1 text-right text-muted-foreground">{i + 1}</td>
              {row.map((cell, j) => (
                <td
                  key={j}
                  onClick={() => setView({ column: result.columns[j]?.name ?? "", value: cell })}
                  className="max-w-[28rem] cursor-pointer truncate border-b border-r px-2 py-1 font-mono hover:bg-muted"
                  title="Click to expand"
                >
                  {cell === null ? (
                    <span className="italic text-muted-foreground">NULL</span>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length > DOM_ROW_CAP && (
        <p className="p-2 text-xs text-muted-foreground">
          Showing first {DOM_ROW_CAP} of {result.rows.length} fetched rows (canvas grid upgrade
          pending).
        </p>
      )}
    </div>
  );
}
