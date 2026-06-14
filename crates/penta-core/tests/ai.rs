//! AI provider integration smoke test.
//!
//! Hits a real OpenAI-compatible endpoint (local Ollama by default) only when
//! `PENTA_TEST_AI=1` is set, so `cargo test` stays green and offline without it.
//! Configure with `PENTA_TEST_AI_MODEL` / `PENTA_TEST_AI_BASE_URL`.

use penta_core::ai::{self, AiFeature, AiInput, AiProviderKind, AiSettings};

#[tokio::test]
async fn nl_to_sql_against_local_provider() {
    if std::env::var("PENTA_TEST_AI").ok().as_deref() != Some("1") {
        eprintln!("PENTA_TEST_AI != 1; skipping AI provider smoke test");
        return;
    }

    let settings = AiSettings {
        provider: AiProviderKind::Ollama,
        model: Some(
            std::env::var("PENTA_TEST_AI_MODEL").unwrap_or_else(|_| "qwen2.5:7b-instruct".into()),
        ),
        api_key: None,
        base_url: std::env::var("PENTA_TEST_AI_BASE_URL").ok(),
    };
    let schema = "-- Schema --\npublic.users(id bigint, email text, created_at timestamptz)\n";
    let input = AiInput {
        feature: AiFeature::NlToSql,
        prompt: "count all users".into(),
        error: None,
    };

    let res = ai::run(&settings, &input, schema)
        .await
        .expect("ai run should succeed against local Ollama");
    eprintln!("model {} returned: {}", res.model, res.text);
    let lower = res.text.to_lowercase();
    assert!(
        lower.contains("select") && lower.contains("users"),
        "expected a SELECT over users, got: {}",
        res.text
    );
}
