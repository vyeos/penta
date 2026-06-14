//! AI v1 (Decision #15/#16, §27): privacy-first NL→SQL, explain, and error-fix.
//!
//! Provider abstraction over three backends — Anthropic (BYO key), any
//! OpenAI-compatible HTTP API (OpenAI, a gateway, etc.), and local **Ollama**.
//! All calls + context building live here in the Rust core so the privacy spine
//! is enforced in one place:
//!
//! * **Schema-only context by default.** The context bundle we build from the
//!   introspected schema never contains row data. Data is opt-in per request
//!   and not wired into the MVP features below.
//! * **AI never executes SQL.** Every feature returns text the user reviews and
//!   runs themselves; NL→SQL output is stripped of markdown fences but never run.
//! * **A pre-send inspector** (`build_messages`) lets the UI show exactly what
//!   bytes would leave the machine before any request is made.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{PentaError, Result};
use crate::introspection::CompletionModel;

/// Default cloud model when the user hasn't picked one (latest Claude).
pub const DEFAULT_ANTHROPIC_MODEL: &str = "claude-opus-4-8";
/// Default local model for Ollama.
pub const DEFAULT_OLLAMA_MODEL: &str = "llama3.1";

const SCHEMA_CHAR_BUDGET: usize = 12_000;

/// Which backend an AI request targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiProviderKind {
    /// Anthropic Messages API (`x-api-key`).
    Anthropic,
    /// Any OpenAI-compatible `/chat/completions` endpoint (OpenAI, gateways).
    OpenAiCompatible,
    /// Local Ollama (OpenAI-compatible endpoint, no key).
    Ollama,
}

/// Per-request AI configuration. Sent from the UI; the API key is never logged
/// and never persisted by the core.
#[derive(Debug, Clone, Deserialize)]
pub struct AiSettings {
    pub provider: AiProviderKind,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    /// Override base URL (e.g. a gateway, or a non-default Ollama host).
    #[serde(default)]
    pub base_url: Option<String>,
}

impl AiSettings {
    fn model(&self) -> String {
        match &self.model {
            Some(m) if !m.is_empty() => m.clone(),
            _ => match self.provider {
                AiProviderKind::Anthropic => DEFAULT_ANTHROPIC_MODEL.to_string(),
                AiProviderKind::Ollama => DEFAULT_OLLAMA_MODEL.to_string(),
                AiProviderKind::OpenAiCompatible => "gpt-4o-mini".to_string(),
            },
        }
    }

    fn base_url(&self) -> String {
        match &self.base_url {
            Some(b) if !b.is_empty() => b.trim_end_matches('/').to_string(),
            _ => match self.provider {
                AiProviderKind::Anthropic => "https://api.anthropic.com".to_string(),
                AiProviderKind::Ollama => "http://localhost:11434/v1".to_string(),
                AiProviderKind::OpenAiCompatible => "https://api.openai.com/v1".to_string(),
            },
        }
    }
}

/// The three MVP AI features (§27 phase 1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiFeature {
    NlToSql,
    ExplainSql,
    ExplainError,
}

/// The inputs for one AI request. `schema` is the schema-only context bundle;
/// row data is never placed here in the MVP.
#[derive(Debug, Clone, Deserialize)]
pub struct AiInput {
    pub feature: AiFeature,
    /// The natural-language request (NL→SQL) or the SQL to explain/fix.
    pub prompt: String,
    /// PostgreSQL error text, for `explain_error`.
    #[serde(default)]
    pub error: Option<String>,
}

/// A single chat message in the redactable, inspectable payload.
#[derive(Debug, Clone, Serialize)]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

/// What the UI shows in the pre-send inspector + what we transmit.
#[derive(Debug, Clone, Serialize)]
pub struct AiPayload {
    pub system: String,
    pub messages: Vec<AiMessage>,
    /// True if any row data is included (always false in the MVP).
    pub includes_data: bool,
}

/// Result of a completed AI request.
#[derive(Debug, Clone, Serialize)]
pub struct AiResponse {
    pub text: String,
    pub provider: String,
    pub model: String,
}

fn system_prompt(feature: AiFeature) -> &'static str {
    match feature {
        AiFeature::NlToSql => {
            "You are a senior PostgreSQL engineer. Given a database schema and a \
             request, reply with ONE valid PostgreSQL statement that satisfies it. \
             Output ONLY the SQL — no prose, no explanation, no markdown code \
             fences. Prefer explicit column lists. Never include destructive \
             statements unless explicitly asked."
        }
        AiFeature::ExplainSql => {
            "You are a senior PostgreSQL engineer. Explain what the given SQL does, \
             clearly and concisely, grounded in the provided schema. Note any \
             performance or correctness caveats. Do not rewrite the query unless \
             asked."
        }
        AiFeature::ExplainError => {
            "You are a senior PostgreSQL engineer. Given a SQL statement, the \
             PostgreSQL error it produced, and the schema, explain the root cause \
             in one short paragraph, then provide a corrected SQL statement in a \
             fenced ```sql block. Do not run anything."
        }
    }
}

/// Render the schema-only context from the introspected completion model,
/// capped to a character budget so huge schemas don't blow the request size.
pub fn build_schema_context(model: &CompletionModel) -> String {
    let mut out = String::new();
    out.push_str("-- Schema (schema-only context; no row data) --\n");
    for rel in &model.relations {
        if out.len() > SCHEMA_CHAR_BUDGET {
            out.push_str("-- … schema truncated for length …\n");
            break;
        }
        let cols = rel
            .columns
            .iter()
            .map(|c| format!("{} {}", c.name, c.data_type))
            .collect::<Vec<_>>()
            .join(", ");
        out.push_str(&format!("{}.{}({})\n", rel.schema, rel.name, cols));
    }
    out
}

/// Build the exact messages that will be sent — used both to transmit and to
/// show the user a pre-send inspector. No row data is ever included.
pub fn build_payload(input: &AiInput, schema: &str) -> AiPayload {
    let user = match input.feature {
        AiFeature::NlToSql => format!(
            "{schema}\n-- Request --\n{}\n\nReturn only the SQL.",
            input.prompt
        ),
        AiFeature::ExplainSql => {
            format!("{schema}\n-- SQL to explain --\n{}", input.prompt)
        }
        AiFeature::ExplainError => format!(
            "{schema}\n-- SQL --\n{}\n\n-- PostgreSQL error --\n{}",
            input.prompt,
            input.error.as_deref().unwrap_or("(no error text provided)")
        ),
    };
    AiPayload {
        system: system_prompt(input.feature).to_string(),
        messages: vec![AiMessage {
            role: "user".to_string(),
            content: user,
        }],
        includes_data: false,
    }
}

/// Run an AI request against the configured provider. Returns the model's text
/// (for NL→SQL, markdown fences are stripped so it drops straight into the
/// editor — but it is never executed).
pub async fn run(settings: &AiSettings, input: &AiInput, schema: &str) -> Result<AiResponse> {
    let payload = build_payload(input, schema);
    let model = settings.model();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| PentaError::Internal(format!("http client: {e}")))?;

    let text = match settings.provider {
        AiProviderKind::Anthropic => call_anthropic(&client, settings, &model, &payload).await?,
        AiProviderKind::OpenAiCompatible | AiProviderKind::Ollama => {
            call_openai_compatible(&client, settings, &model, &payload).await?
        }
    };

    let text = if input.feature == AiFeature::NlToSql {
        strip_code_fences(&text)
    } else {
        text
    };

    Ok(AiResponse {
        text,
        provider: format!("{:?}", settings.provider).to_lowercase(),
        model,
    })
}

async fn call_anthropic(
    client: &reqwest::Client,
    settings: &AiSettings,
    model: &str,
    payload: &AiPayload,
) -> Result<String> {
    let key = settings
        .api_key
        .as_deref()
        .filter(|k| !k.is_empty())
        .ok_or_else(|| PentaError::Invalid("Anthropic provider needs an API key".into()))?;

    let messages: Vec<Value> = payload
        .messages
        .iter()
        .map(|m| json!({ "role": m.role, "content": m.content }))
        .collect();
    let body = json!({
        "model": model,
        "max_tokens": 1500,
        "system": payload.system,
        "messages": messages,
    });

    let resp = client
        .post(format!("{}/v1/messages", settings.base_url()))
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| PentaError::Connection(format!("AI request failed: {e}")))?;

    let status = resp.status();
    let v: Value = resp
        .json()
        .await
        .map_err(|e| PentaError::Internal(format!("AI response decode: {e}")))?;
    if !status.is_success() {
        return Err(PentaError::Query(format!(
            "AI provider error ({}): {}",
            status,
            v["error"]["message"].as_str().unwrap_or("unknown")
        )));
    }

    // content is an array of blocks; concatenate the text ones.
    let text: String = v["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|b| b["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    if text.is_empty() {
        return Err(PentaError::Query("AI returned no text".into()));
    }
    Ok(text.trim().to_string())
}

async fn call_openai_compatible(
    client: &reqwest::Client,
    settings: &AiSettings,
    model: &str,
    payload: &AiPayload,
) -> Result<String> {
    let mut messages = vec![json!({ "role": "system", "content": payload.system })];
    for m in &payload.messages {
        messages.push(json!({ "role": m.role, "content": m.content }));
    }
    let body = json!({ "model": model, "messages": messages, "stream": false });

    let mut req = client
        .post(format!("{}/chat/completions", settings.base_url()))
        .header("content-type", "application/json")
        .json(&body);
    if let Some(key) = settings.api_key.as_deref().filter(|k| !k.is_empty()) {
        req = req.bearer_auth(key);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| PentaError::Connection(format!("AI request failed: {e}")))?;
    let status = resp.status();
    let v: Value = resp
        .json()
        .await
        .map_err(|e| PentaError::Internal(format!("AI response decode: {e}")))?;
    if !status.is_success() {
        return Err(PentaError::Query(format!(
            "AI provider error ({}): {}",
            status,
            v["error"]["message"].as_str().unwrap_or("unknown")
        )));
    }
    let text = v["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();
    if text.is_empty() {
        return Err(PentaError::Query("AI returned no text".into()));
    }
    Ok(text)
}

/// Strip a leading/trailing markdown code fence (``` or ```sql) so generated SQL
/// drops straight into the editor.
fn strip_code_fences(s: &str) -> String {
    let t = s.trim();
    if let Some(rest) = t.strip_prefix("```") {
        // Drop the optional language tag on the first line.
        let after_lang = rest.split_once('\n').map(|x| x.1).unwrap_or("");
        let body = after_lang.strip_suffix("```").unwrap_or(after_lang);
        return body.trim().to_string();
    }
    t.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::introspection::{ColumnBrief, CompletionModel, RelationColumns, RelationKind};

    fn model() -> CompletionModel {
        CompletionModel {
            schemas: vec!["public".into()],
            relations: vec![RelationColumns {
                schema: "public".into(),
                name: "users".into(),
                kind: RelationKind::Table,
                columns: vec![
                    ColumnBrief {
                        name: "id".into(),
                        data_type: "bigint".into(),
                    },
                    ColumnBrief {
                        name: "email".into(),
                        data_type: "text".into(),
                    },
                ],
            }],
            functions: vec![],
        }
    }

    #[test]
    fn schema_context_is_schema_only() {
        let ctx = build_schema_context(&model());
        assert!(ctx.contains("public.users(id bigint, email text)"));
        // No row data, ever.
        assert!(!ctx.to_lowercase().contains("select"));
    }

    #[test]
    fn payload_never_includes_data() {
        let input = AiInput {
            feature: AiFeature::NlToSql,
            prompt: "all users".into(),
            error: None,
        };
        let p = build_payload(&input, &build_schema_context(&model()));
        assert!(!p.includes_data);
        assert!(p.messages[0].content.contains("all users"));
    }

    #[test]
    fn explain_error_includes_error_text() {
        let input = AiInput {
            feature: AiFeature::ExplainError,
            prompt: "SELECT * FROM uXsers".into(),
            error: Some("relation \"uxsers\" does not exist".into()),
        };
        let p = build_payload(&input, "");
        assert!(p.messages[0].content.contains("does not exist"));
    }

    #[test]
    fn fences_are_stripped() {
        assert_eq!(strip_code_fences("```sql\nSELECT 1;\n```"), "SELECT 1;");
        assert_eq!(strip_code_fences("SELECT 1;"), "SELECT 1;");
        assert_eq!(strip_code_fences("```\nSELECT 2\n```"), "SELECT 2");
    }

    #[test]
    fn default_model_is_latest_claude() {
        let s = AiSettings {
            provider: AiProviderKind::Anthropic,
            model: None,
            api_key: None,
            base_url: None,
        };
        assert_eq!(s.model(), DEFAULT_ANTHROPIC_MODEL);
    }
}
