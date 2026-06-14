import { useState } from "react";
import { Sparkles, Settings2, Eye, ShieldCheck, Loader2 } from "lucide-react";
import { api, errMessage, type AiFeature, type AiPayload, type AiSettings } from "@/lib/api";
import {
  DEFAULT_AI_SETTINGS,
  PROVIDER_LABELS,
  isCloud,
  loadAiSettings,
  saveAiSettings,
} from "@/lib/aiSettings";

/**
 * Privacy-first AI assistant (Decision #15/#16). NL→SQL, explain, and error-fix
 * — schema-only context, BYO key or local Ollama, and a pre-send inspector. The
 * generated SQL is inserted into the editor for review; it is never auto-run.
 */
export function AiPanel({
  sessionId,
  getSql,
  getError,
  onInsertSql,
}: {
  sessionId: string;
  getSql: () => string;
  getError: () => string | null;
  onInsertSql: (sql: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings());
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<AiFeature | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<{ text: string; insertable: boolean } | null>(null);
  const [preview, setPreview] = useState<AiPayload | null>(null);

  function update(patch: Partial<AiSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveAiSettings(next);
  }

  async function run(feature: AiFeature) {
    setError(null);
    setOutput(null);
    setPreview(null);
    if (feature === "nl_to_sql" && !prompt.trim()) {
      setError("Describe what you want first.");
      return;
    }
    const input = {
      feature,
      prompt: feature === "nl_to_sql" ? prompt : getSql(),
      error: feature === "explain_error" ? getError() : null,
    };
    if (feature !== "nl_to_sql" && !input.prompt.trim()) {
      setError("No SQL in the editor to work with.");
      return;
    }
    setBusy(feature);
    try {
      const res = await api.aiRun(sessionId, settings, input);
      setOutput({ text: res.text, insertable: feature === "nl_to_sql" });
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function inspect(feature: AiFeature) {
    setError(null);
    try {
      const p = await api.aiPreview(sessionId, {
        feature,
        prompt: feature === "nl_to_sql" ? prompt : getSql(),
        error: feature === "explain_error" ? getError() : null,
      });
      setPreview(p);
    } catch (e) {
      setError(errMessage(e));
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs hover:text-foreground"
        title="AI assistant"
      >
        <Sparkles className="h-3.5 w-3.5 text-primary" /> AI
      </button>
    );
  }

  const cloud = isCloud(settings.provider);

  return (
    <div className="absolute right-2 top-10 z-20 w-[360px] rounded-lg border bg-card p-3 shadow-xl">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">AI assistant</span>
        <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          <ShieldCheck className="h-3 w-3" /> schema-only
        </span>
        <button
          onClick={() => setShowSettings((s) => !s)}
          className="ml-auto text-muted-foreground hover:text-foreground"
          title="AI settings"
        >
          <Settings2 className="h-4 w-4" />
        </button>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
          ✕
        </button>
      </div>

      {showSettings && (
        <div className="mb-3 space-y-2 rounded-md border bg-background/50 p-2 text-xs">
          <label className="block">
            Provider
            <select
              value={settings.provider}
              onChange={(e) => update({ provider: e.target.value as AiSettings["provider"] })}
              className="mt-0.5 w-full rounded border bg-background px-1.5 py-1"
            >
              {Object.entries(PROVIDER_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Model
            <input
              value={settings.model ?? ""}
              onChange={(e) => update({ model: e.target.value })}
              placeholder={settings.provider === "anthropic" ? "claude-opus-4-8" : "model name"}
              className="mt-0.5 w-full rounded border bg-background px-1.5 py-1"
            />
          </label>
          {cloud && (
            <label className="block">
              API key
              <input
                type="password"
                value={settings.api_key ?? ""}
                onChange={(e) => update({ api_key: e.target.value })}
                placeholder="stored locally, never logged"
                className="mt-0.5 w-full rounded border bg-background px-1.5 py-1"
              />
            </label>
          )}
          <label className="block">
            Base URL (optional)
            <input
              value={settings.base_url ?? ""}
              onChange={(e) => update({ base_url: e.target.value })}
              placeholder={settings.provider === "ollama" ? "http://localhost:11434/v1" : "default"}
              className="mt-0.5 w-full rounded border bg-background px-1.5 py-1"
            />
          </label>
          <button
            onClick={() => update(DEFAULT_AI_SETTINGS)}
            className="text-muted-foreground underline hover:text-foreground"
          >
            reset
          </button>
        </div>
      )}

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe the query in plain English…"
        rows={2}
        className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-xs"
      />

      <div className="mt-2 flex flex-wrap gap-1.5">
        <AiButton busy={busy === "nl_to_sql"} onClick={() => run("nl_to_sql")}>
          Generate SQL
        </AiButton>
        <AiButton busy={busy === "explain_sql"} onClick={() => run("explain_sql")}>
          Explain SQL
        </AiButton>
        <AiButton busy={busy === "explain_error"} onClick={() => run("explain_error")}>
          Explain error
        </AiButton>
        <button
          onClick={() => inspect("nl_to_sql")}
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          title="See exactly what will be sent"
        >
          <Eye className="h-3 w-3" /> Inspect
        </button>
      </div>

      {cloud && (
        <p className="mt-2 text-[10px] text-amber-400">
          Sends schema (no row data) to {PROVIDER_LABELS[settings.provider]}.
        </p>
      )}

      {error && (
        <p className="mt-2 rounded border border-red-500/30 bg-red-500/10 p-1.5 text-[11px] text-red-300">
          {error}
        </p>
      )}

      {preview && (
        <div className="mt-2 rounded-md border bg-background/60 p-2">
          <p className="mb-1 text-[10px] uppercase text-muted-foreground">
            Pre-send inspector · data included: {String(preview.includes_data)}
          </p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">
            {preview.messages.map((m) => m.content).join("\n")}
          </pre>
        </div>
      )}

      {output && (
        <div className="mt-2 rounded-md border bg-background/60 p-2">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px]">{output.text}</pre>
          {output.insertable && (
            <button
              onClick={() => {
                onInsertSql(output.text);
                setOpen(false);
              }}
              className="mt-1.5 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground"
            >
              Insert into editor (review before running)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AiButton({
  busy,
  onClick,
  children,
}: {
  busy: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      disabled={busy}
      onClick={onClick}
      className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-[11px] hover:text-foreground disabled:opacity-50"
    >
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
      {children}
    </button>
  );
}
