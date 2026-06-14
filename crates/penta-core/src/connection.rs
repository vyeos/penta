use serde::{Deserialize, Serialize};

/// SSL/TLS negotiation mode, mirroring libpq's `sslmode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SslMode {
    Disable,
    Allow,
    #[default]
    Prefer,
    Require,
    VerifyCa,
    VerifyFull,
}

/// Environment label that drives Production Safety Mode UX (banners, colors,
/// type-to-confirm gating).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnvLabel {
    #[default]
    Local,
    Staging,
    Production,
}

impl EnvLabel {
    /// Lowercase wire/display name (matches the serde representation).
    pub fn as_str(&self) -> &'static str {
        match self {
            EnvLabel::Local => "local",
            EnvLabel::Staging => "staging",
            EnvLabel::Production => "production",
        }
    }
}

/// A connection definition WITHOUT secrets. Credentials live only in
/// `penta-vault`; this struct is safe to persist in the app database and to log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    #[serde(default)]
    pub ssl_mode: SslMode,
    #[serde(default)]
    pub env_label: EnvLabel,
    #[serde(default)]
    pub read_only: bool,
}

impl ConnectionConfig {
    /// Whether this connection should trigger heightened safety prompts.
    pub fn is_production(&self) -> bool {
        matches!(self.env_label, EnvLabel::Production)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssl_mode_defaults_to_prefer() {
        assert_eq!(SslMode::default(), SslMode::Prefer);
    }

    #[test]
    fn production_label_is_flagged() {
        let cfg = ConnectionConfig {
            id: "1".into(),
            name: "prod".into(),
            host: "db".into(),
            port: 5432,
            database: "app".into(),
            username: "postgres".into(),
            ssl_mode: SslMode::Require,
            env_label: EnvLabel::Production,
            read_only: true,
        };
        assert!(cfg.is_production());
    }
}
