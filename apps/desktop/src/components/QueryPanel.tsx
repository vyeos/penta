import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { autocompletion } from "@codemirror/autocomplete";
import { keymap } from "@codemirror/view";
import {
  Play,
  Square,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Download,
  CheckCircle2,
} from "lucide-react";
import {
  api,
  errMessage,
  type CompletionModel,
  type QueryResult,
  type RiskReport,
} from "@/lib/api";
import { useStore } from "@/store";
import { makeSqlCompletionSource } from "@/lib/autocomplete";
import { pentaEditorTheme } from "@/lib/editorTheme";
import { exportQueryToCsv } from "@/lib/csv";
import { Button, Badge } from "@/components/ui";
import { AiPanel } from "@/components/AiPanel";
import { ConfirmRiskDialog } from "@/components/ConfirmRiskDialog";
import { CellViewer } from "@/components/CellViewer";

const DOM_ROW_CAP = 500;

export function QueryPanel() {
  const session = useStore((s) => s.session);
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const runNonce = useStore((s) => s.runNonce);
  const theme = useStore((s) => s.theme);
  const bumpSchema = useStore((s) => s.bumpSchema);

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
      // A query may have created/altered/dropped objects; refresh the tree.
      bumpSchema();
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
      pentaEditorTheme(theme === "dark"),
      sql({ dialect: PostgreSQL }),
      autocompletion({ override: [completionSource] }),
      keymap.of([{ key: "Mod-Enter", run: () => (runRef.current(), true) }]),
    ],
    [completionSource, theme],
  );

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <Button variant="solid" size="sm" disabled={!session || running} onClick={run}>
          <Play className="h-3 w-3" /> Run
          <kbd className="ml-0.5 font-mono text-[10px] opacity-60">⌘↵</kbd>
        </Button>
        <Button variant="ghost" size="sm" disabled={!running} onClick={cancel}>
          <Square className="h-3 w-3" /> Cancel
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!result}
          onClick={exportCsv}
          title="Export result to CSV"
        >
          <Download className="h-3 w-3" /> CSV
        </Button>

        <RiskBadge risk={risk} />

        {session?.readOnly && <Badge tone="warn">Read-only</Badge>}
        {session?.envLabel === "production" && <Badge tone="danger">Production</Badge>}

        {session && (
          <AiPanel
            sessionId={session.sessionId}
            getSql={() => useStore.getState().query}
            getError={() => error}
            onInsertSql={(s) => setQuery(s)}
          />
        )}

        <div className="ml-auto font-mono text-[11px] text-muted">
          {notice && <span className="mr-2 text-ok">{notice}</span>}
          {result &&
            `${result.row_count} rows · ${result.duration_ms} ms${
              result.truncated ? " · truncated" : ""
            }`}
        </div>
      </div>

      <div className="min-h-[120px] border-y border-ink/[0.07]">
        <CodeMirror
          value={query}
          height="180px"
          theme="none"
          extensions={extensions}
          onChange={setQuery}
          basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: false }}
        />
      </div>

      <div className="flex-1 overflow-auto">
        {error && (
          <pre className="m-3 whitespace-pre-wrap bg-accent/[0.1] p-3 font-mono text-xs text-ink ring-1 ring-accent/20">
            {error}
          </pre>
        )}
        {result && !error && result.columns.length > 0 && <ResultTable result={result} />}
        {result && !error && result.columns.length === 0 && (
          <SuccessNotice result={result} />
        )}
        {!result && !error && (
          <div className="flex h-full items-center justify-center text-sm text-muted">
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
        <Badge tone="ok">
          <ShieldCheck className="h-3 w-3" /> Safe
        </Badge>
      );
    }
    return null;
  }
  if (risk.level === "medium") {
    return (
      <Badge tone="warn">
        <AlertTriangle className="h-3 w-3" /> Schema change
      </Badge>
    );
  }
  return (
    <Badge tone="danger">
      <ShieldAlert className="h-3 w-3" /> Destructive
    </Badge>
  );
}

function SuccessNotice({ result }: { result: QueryResult }) {
  return (
    <div className="m-3 flex items-center gap-2 bg-ok/[0.1] p-3 font-mono text-xs text-ink ring-1 ring-ok/20">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" />
      <span>Command executed successfully · {result.duration_ms} ms</span>
    </div>
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
        <thead className="sticky top-0 bg-paper">
          <tr>
            <th className="border-b border-ink/[0.1] px-3 py-2 text-right font-mono text-[11px] font-medium text-muted/70">
              #
            </th>
            {result.columns.map((c) => (
              <th
                key={c.name}
                className="border-b border-ink/[0.1] px-3 py-2 text-left font-mono text-[11px] font-semibold text-muted"
                title={c.type_name}
              >
                {c.name}
                <span className="ml-1.5 font-normal text-muted/60">{c.type_name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="transition-colors hover:bg-ink/[0.03]">
              <td className="border-b border-ink/[0.05] px-3 py-1.5 text-right font-mono text-muted/60">
                {i + 1}
              </td>
              {row.map((cell, j) => (
                <td
                  key={j}
                  onClick={() => setView({ column: result.columns[j]?.name ?? "", value: cell })}
                  className="max-w-[28rem] cursor-pointer truncate border-b border-ink/[0.05] px-3 py-1.5 font-mono"
                  title="Click to expand"
                >
                  {cell === null ? <span className="italic text-muted/60">NULL</span> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length > DOM_ROW_CAP && (
        <p className="p-3 font-mono text-[11px] text-muted">
          Showing first {DOM_ROW_CAP} of {result.rows.length} fetched rows (canvas grid upgrade
          pending).
        </p>
      )}
    </div>
  );
}
