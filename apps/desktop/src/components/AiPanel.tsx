import { useState } from "react";
import { Sparkles, Settings2, Eye, ShieldCheck, Loader2, X } from "lucide-react";
import { api, errMessage, type AiFeature, type AiPayload, type AiSettings } from "@/lib/api";
import {
  DEFAULT_AI_SETTINGS,
  PROVIDER_LABELS,
  isCloud,
  loadAiSettings,
  saveAiSettings,
} from "@/lib/aiSettings";
import { Button, Badge, inputCls, selectCls } from "@/components/ui";

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
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} title="AI assistant">
        <Sparkles className="h-3.5 w-3.5 text-accent" /> AI
      </Button>
    );
  }

  const cloud = isCloud(settings.provider);

  return (
    <div className="absolute right-2 top-12 z-20 w-[360px] border border-ink/10 bg-paper p-3 shadow-pop">
      <div className="mb-2.5 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" />
        <span className="font-display text-sm">AI assistant</span>
        <Badge tone="ok">
          <ShieldCheck className="h-3 w-3" /> Schema-only
        </Badge>
        <button
          onClick={() => setShowSettings((s) => !s)}
          className="ml-auto p-0.5 text-muted transition-colors hover:bg-ink/[0.06] hover:text-ink"
          title="AI settings"
        >
          <Settings2 className="h-4 w-4" />
        </button>
        <button
          onClick={() => setOpen(false)}
          className="p-0.5 text-muted transition-colors hover:bg-ink/[0.06] hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {showSettings && (
        <div className="mb-3 space-y-2.5 bg-ink/[0.03] p-2.5 text-xs">
          <label className="block text-[11px] font-medium text-muted">
            Provider
            <select
              value={settings.provider}
              onChange={(e) => update({ provider: e.target.value as AiSettings["provider"] })}
              className={`mt-1 w-full ${selectCls}`}
            >
              {Object.entries(PROVIDER_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] font-medium text-muted">
            Model
            <input
              value={settings.model ?? ""}
              onChange={(e) => update({ model: e.target.value })}
              placeholder={settings.provider === "anthropic" ? "claude-opus-4-8" : "model name"}
              className={`mt-1 ${inputCls}`}
            />
          </label>
          {cloud && (
            <label className="block text-[11px] font-medium text-muted">
              API key
              <input
                type="password"
                value={settings.api_key ?? ""}
                onChange={(e) => update({ api_key: e.target.value })}
                placeholder="stored locally, never logged"
                className={`mt-1 ${inputCls}`}
              />
            </label>
          )}
          <label className="block text-[11px] font-medium text-muted">
            Base URL (optional)
            <input
              value={settings.base_url ?? ""}
              onChange={(e) => update({ base_url: e.target.value })}
              placeholder={settings.provider === "ollama" ? "http://localhost:11434/v1" : "default"}
              className={`mt-1 ${inputCls}`}
            />
          </label>
          <button
            onClick={() => update(DEFAULT_AI_SETTINGS)}
            className="text-[11px] text-muted underline transition-colors hover:text-ink"
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
        className={`resize-none ${inputCls}`}
      />

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button variant="ghost" size="xs" disabled={busy === "nl_to_sql"} onClick={() => run("nl_to_sql")}>
          {busy === "nl_to_sql" && <Loader2 className="h-3 w-3 animate-spin" />} Generate SQL
        </Button>
        <Button variant="ghost" size="xs" disabled={busy === "explain_sql"} onClick={() => run("explain_sql")}>
          {busy === "explain_sql" && <Loader2 className="h-3 w-3 animate-spin" />} Explain SQL
        </Button>
        <Button variant="ghost" size="xs" disabled={busy === "explain_error"} onClick={() => run("explain_error")}>
          {busy === "explain_error" && <Loader2 className="h-3 w-3 animate-spin" />} Explain error
        </Button>
        <Button
          variant="plain"
          size="xs"
          onClick={() => inspect("nl_to_sql")}
          className="ml-auto"
          title="See exactly what will be sent"
        >
          <Eye className="h-3 w-3" /> Inspect
        </Button>
      </div>

      {cloud && (
        <p className="mt-2 text-[11px] text-warn">
          Sends schema (no row data) to {PROVIDER_LABELS[settings.provider]}.
        </p>
      )}

      {error && (
        <p className="mt-2 bg-accent/[0.1] p-2 text-[11px] text-ink ring-1 ring-accent/20">
          {error}
        </p>
      )}

      {preview && (
        <div className="mt-2 bg-ink/[0.04] p-2.5">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">
            Pre-send inspector · data included: {String(preview.includes_data)}
          </p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-muted">
            {preview.messages.map((m) => m.content).join("\n")}
          </pre>
        </div>
      )}

      {output && (
        <div className="mt-2 bg-ink/[0.04] p-2.5">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
            {output.text}
          </pre>
          {output.insertable && (
            <Button
              variant="solid"
              size="xs"
              className="mt-2"
              onClick={() => {
                onInsertSql(output.text);
                setOpen(false);
              }}
            >
              Insert into editor (review before running)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
