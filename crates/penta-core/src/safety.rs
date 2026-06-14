//! Production Safety Mode (Decision #10 / §26): pre-execution risk detection.
//!
//! We parse SQL with `sqlparser-rs` (pure Rust, PG dialect) and classify each
//! statement's blast radius — `DROP`/`TRUNCATE`/`DELETE`/`UPDATE` without a
//! `WHERE`, schema `ALTER`, `GRANT`/`REVOKE`. The detected **risk level** is a
//! property of the SQL; the **confirmation tier** the UI must enforce also folds
//! in the connection's environment label (a `DROP` on a `production` connection
//! demands type-to-confirm; the same on `local` is a one-click confirm).
//!
//! If the parser can't handle a statement (sqlparser doesn't cover 100% of PG),
//! we **fail safe**: a keyword heuristic scans the raw text so a dangerous
//! statement is never silently waved through just because it didn't parse.

use serde::Serialize;
use sqlparser::ast::{Delete, FromTable, ObjectType, Statement};
use sqlparser::dialect::PostgreSqlDialect;
use sqlparser::parser::Parser;

use crate::connection::EnvLabel;

/// Blast-radius classification of a statement, ordered so the max is meaningful.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    /// Read-only or no statements.
    None,
    /// A scoped write (INSERT, or UPDATE/DELETE with a WHERE).
    Low,
    /// Schema change or privilege change (ALTER, GRANT/REVOKE, CREATE).
    Medium,
    /// Data-destroying (DROP, TRUNCATE, unfiltered DELETE/UPDATE).
    High,
}

impl RiskLevel {
    fn max(self, other: RiskLevel) -> RiskLevel {
        if other > self {
            other
        } else {
            self
        }
    }
}

/// What the UI must do before this SQL is allowed to run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfirmTier {
    /// Run immediately.
    Allow,
    /// Show a confirm dialog (one click).
    Confirm,
    /// Require the user to type a phrase to proceed (prod guard rail).
    TypeToConfirm,
}

/// One classified statement (or heuristic hit).
#[derive(Debug, Clone, Serialize)]
pub struct RiskFinding {
    pub level: RiskLevel,
    /// Stable machine code, e.g. `drop`, `delete_no_where`, `alter`.
    pub kind: &'static str,
    pub statement_index: usize,
    pub message: String,
    /// Primary object the statement targets, when we can name it.
    pub object: Option<String>,
}

/// Aggregate risk verdict for a SQL string, factoring in the connection env.
#[derive(Debug, Clone, Serialize)]
pub struct RiskReport {
    pub level: RiskLevel,
    pub statement_count: usize,
    pub findings: Vec<RiskFinding>,
    /// `false` when the parser failed and we fell back to the keyword heuristic.
    pub parsed: bool,
    pub confirm_tier: ConfirmTier,
    /// The phrase the user must type when `confirm_tier == TypeToConfirm`.
    pub confirm_phrase: Option<String>,
}

impl RiskReport {
    /// Whether the SQL may run without any extra acknowledgement.
    pub fn allowed_without_ack(&self) -> bool {
        matches!(self.confirm_tier, ConfirmTier::Allow)
    }
}

/// Analyze `sql` for a connection with environment label `env`.
pub fn analyze(sql: &str, env: EnvLabel) -> RiskReport {
    let dialect = PostgreSqlDialect {};
    let (findings, parsed, statement_count) = match Parser::parse_sql(&dialect, sql) {
        Ok(stmts) => {
            let mut findings = Vec::new();
            for (i, stmt) in stmts.iter().enumerate() {
                if let Some(f) = classify_statement(stmt, i) {
                    findings.push(f);
                }
            }
            (findings, true, stmts.len())
        }
        Err(_) => {
            let findings = heuristic_scan(sql);
            let count = split_statements(sql).len();
            (findings, false, count)
        }
    };

    let level = findings
        .iter()
        .map(|f| f.level)
        .fold(RiskLevel::None, RiskLevel::max);

    let confirm_tier = confirm_tier(level, env, parsed);
    let confirm_phrase = if matches!(confirm_tier, ConfirmTier::TypeToConfirm) {
        Some(
            findings
                .iter()
                .find(|f| f.level == RiskLevel::High)
                .and_then(|f| f.object.clone())
                .unwrap_or_else(|| env.as_str().to_string()),
        )
    } else {
        None
    };

    RiskReport {
        level,
        statement_count,
        findings,
        parsed,
        confirm_tier,
        confirm_phrase,
    }
}

/// Map (risk level, environment) → required confirmation. Production is strict;
/// a failed parse on a non-local env is treated cautiously (confirm).
fn confirm_tier(level: RiskLevel, env: EnvLabel, parsed: bool) -> ConfirmTier {
    use ConfirmTier::*;
    use EnvLabel::*;
    let base = match (env, level) {
        (Production, RiskLevel::High) => TypeToConfirm,
        (Production, RiskLevel::Medium) => Confirm,
        (Staging, RiskLevel::High) => Confirm,
        (Staging, RiskLevel::Medium) => Confirm,
        (Local, RiskLevel::High) => Confirm,
        _ => Allow,
    };
    // A statement we couldn't parse on a remote-ish env: nudge to at least confirm.
    if !parsed && matches!(env, Production | Staging) && matches!(base, Allow) {
        Confirm
    } else {
        base
    }
}

fn classify_statement(stmt: &Statement, idx: usize) -> Option<RiskFinding> {
    match stmt {
        Statement::Drop {
            object_type, names, ..
        } => Some(RiskFinding {
            level: RiskLevel::High,
            kind: "drop",
            statement_index: idx,
            message: format!(
                "DROP {} — permanently removes the object",
                object_label(object_type)
            ),
            object: names.first().map(|n| n.to_string()),
        }),
        Statement::Truncate { table_names, .. } => Some(RiskFinding {
            level: RiskLevel::High,
            kind: "truncate",
            statement_index: idx,
            message: "TRUNCATE — deletes all rows, not transaction-logged per row".into(),
            object: table_names.first().map(|t| t.name.to_string()),
        }),
        Statement::Delete(Delete {
            selection, from, ..
        }) => {
            let object = delete_target(from);
            if selection.is_none() {
                Some(RiskFinding {
                    level: RiskLevel::High,
                    kind: "delete_no_where",
                    statement_index: idx,
                    message: "DELETE without WHERE — removes every row in the table".into(),
                    object,
                })
            } else {
                Some(RiskFinding {
                    level: RiskLevel::Low,
                    kind: "delete",
                    statement_index: idx,
                    message: "DELETE with a filter".into(),
                    object,
                })
            }
        }
        Statement::Update {
            selection, table, ..
        } => {
            let object = Some(table.to_string());
            if selection.is_none() {
                Some(RiskFinding {
                    level: RiskLevel::High,
                    kind: "update_no_where",
                    statement_index: idx,
                    message: "UPDATE without WHERE — rewrites every row in the table".into(),
                    object,
                })
            } else {
                Some(RiskFinding {
                    level: RiskLevel::Low,
                    kind: "update",
                    statement_index: idx,
                    message: "UPDATE with a filter".into(),
                    object,
                })
            }
        }
        Statement::AlterTable { name, .. } => Some(RiskFinding {
            level: RiskLevel::Medium,
            kind: "alter",
            statement_index: idx,
            message: "ALTER TABLE — schema change".into(),
            object: Some(name.to_string()),
        }),
        Statement::Grant { .. } => Some(RiskFinding {
            level: RiskLevel::Medium,
            kind: "grant",
            statement_index: idx,
            message: "GRANT — privilege change".into(),
            object: None,
        }),
        Statement::Revoke { .. } => Some(RiskFinding {
            level: RiskLevel::Medium,
            kind: "revoke",
            statement_index: idx,
            message: "REVOKE — privilege change".into(),
            object: None,
        }),
        Statement::Insert(_) => Some(RiskFinding {
            level: RiskLevel::Low,
            kind: "insert",
            statement_index: idx,
            message: "INSERT".into(),
            object: None,
        }),
        Statement::CreateTable(_)
        | Statement::CreateView { .. }
        | Statement::CreateIndex(_)
        | Statement::CreateSchema { .. } => Some(RiskFinding {
            level: RiskLevel::Medium,
            kind: "create",
            statement_index: idx,
            message: "CREATE — adds a schema object".into(),
            object: None,
        }),
        _ => None,
    }
}

fn object_label(o: &ObjectType) -> String {
    format!("{o:?}").to_uppercase()
}

fn delete_target(from: &FromTable) -> Option<String> {
    let tables = match from {
        FromTable::WithFromKeyword(t) | FromTable::WithoutKeyword(t) => t,
    };
    tables.first().map(|t| t.relation.to_string())
}

/// Split SQL into statements on top-level semicolons, ignoring those inside
/// single/double-quoted strings, line/block comments, and `$tag$` dollar quotes.
/// Used for counting and as the unit of the heuristic fallback scan.
pub fn split_statements(sql: &str) -> Vec<String> {
    let bytes = sql.as_bytes();
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut i = 0usize;
    let n = bytes.len();

    while i < n {
        let c = bytes[i] as char;
        match c {
            '\'' | '"' => {
                let quote = c;
                i += 1;
                while i < n {
                    if bytes[i] as char == quote {
                        // Doubled quote is an escape; skip both.
                        if i + 1 < n && bytes[i + 1] as char == quote {
                            i += 2;
                            continue;
                        }
                        break;
                    }
                    i += 1;
                }
            }
            '-' if i + 1 < n && bytes[i + 1] as char == '-' => {
                while i < n && bytes[i] as char != '\n' {
                    i += 1;
                }
            }
            '/' if i + 1 < n && bytes[i + 1] as char == '*' => {
                i += 2;
                while i + 1 < n && !(bytes[i] as char == '*' && bytes[i + 1] as char == '/') {
                    i += 1;
                }
                i += 1;
            }
            '$' => {
                // Possible dollar-quote opener: $tag$ ... $tag$
                if let Some(tag_end) = dollar_tag_end(bytes, i) {
                    let tag = &sql[i..tag_end];
                    if let Some(close) = sql[tag_end..].find(tag) {
                        i = tag_end + close + tag.len();
                        continue;
                    }
                }
            }
            ';' => {
                let chunk = sql[start..i].trim();
                if !chunk.is_empty() {
                    out.push(chunk.to_string());
                }
                start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    let tail = sql[start..].trim();
    if !tail.is_empty() {
        out.push(tail.to_string());
    }
    out
}

/// If `bytes[start]` begins a `$tag$` opener, return the index just past it.
fn dollar_tag_end(bytes: &[u8], start: usize) -> Option<usize> {
    let n = bytes.len();
    let mut j = start + 1;
    while j < n {
        let ch = bytes[j] as char;
        if ch == '$' {
            return Some(j + 1);
        }
        if ch.is_alphanumeric() || ch == '_' {
            j += 1;
        } else {
            return None;
        }
    }
    None
}

/// Keyword fallback used only when the parser fails. Conservative: it errs
/// toward flagging risk rather than missing it.
fn heuristic_scan(sql: &str) -> Vec<RiskFinding> {
    let mut findings = Vec::new();
    for (idx, stmt) in split_statements(sql).into_iter().enumerate() {
        let upper = stmt.to_uppercase();
        let first = upper.split_whitespace().next().unwrap_or("");
        let has_where = upper.contains(" WHERE ") || upper.ends_with(" WHERE");
        let finding = match first {
            "DROP" => Some(("drop", RiskLevel::High, "DROP statement")),
            "TRUNCATE" => Some(("truncate", RiskLevel::High, "TRUNCATE statement")),
            "DELETE" if !has_where => {
                Some(("delete_no_where", RiskLevel::High, "DELETE without WHERE"))
            }
            "UPDATE" if !has_where => {
                Some(("update_no_where", RiskLevel::High, "UPDATE without WHERE"))
            }
            "DELETE" | "UPDATE" => Some(("mutation", RiskLevel::Low, "filtered write")),
            "ALTER" => Some(("alter", RiskLevel::Medium, "ALTER statement")),
            "GRANT" => Some(("grant", RiskLevel::Medium, "GRANT statement")),
            "REVOKE" => Some(("revoke", RiskLevel::Medium, "REVOKE statement")),
            "INSERT" => Some(("insert", RiskLevel::Low, "INSERT statement")),
            "CREATE" => Some(("create", RiskLevel::Medium, "CREATE statement")),
            _ => None,
        };
        if let Some((kind, level, msg)) = finding {
            findings.push(RiskFinding {
                level,
                kind,
                statement_index: idx,
                message: format!("{msg} (unparsed — flagged by heuristic)"),
                object: None,
            });
        }
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lvl(sql: &str) -> RiskLevel {
        analyze(sql, EnvLabel::Local).level
    }

    #[test]
    fn select_is_no_risk() {
        assert_eq!(lvl("SELECT * FROM users WHERE id = 1"), RiskLevel::None);
    }

    #[test]
    fn delete_without_where_is_high() {
        assert_eq!(lvl("DELETE FROM users"), RiskLevel::High);
    }

    #[test]
    fn delete_with_where_is_low() {
        assert_eq!(lvl("DELETE FROM users WHERE id = 1"), RiskLevel::Low);
    }

    #[test]
    fn update_without_where_is_high() {
        assert_eq!(lvl("UPDATE users SET active = false"), RiskLevel::High);
    }

    #[test]
    fn update_with_where_is_low() {
        assert_eq!(
            lvl("UPDATE users SET active = false WHERE id = 1"),
            RiskLevel::Low
        );
    }

    #[test]
    fn drop_and_truncate_are_high() {
        assert_eq!(lvl("DROP TABLE users"), RiskLevel::High);
        assert_eq!(lvl("TRUNCATE users"), RiskLevel::High);
    }

    #[test]
    fn alter_and_grant_are_medium() {
        assert_eq!(lvl("ALTER TABLE users ADD COLUMN x int"), RiskLevel::Medium);
        assert_eq!(lvl("GRANT SELECT ON users TO bob"), RiskLevel::Medium);
    }

    #[test]
    fn prod_drop_requires_typed_confirmation() {
        let r = analyze("DROP TABLE orders", EnvLabel::Production);
        assert_eq!(r.confirm_tier, ConfirmTier::TypeToConfirm);
        assert_eq!(r.confirm_phrase.as_deref(), Some("orders"));
    }

    #[test]
    fn local_drop_is_one_click_confirm() {
        let r = analyze("DROP TABLE orders", EnvLabel::Local);
        assert_eq!(r.confirm_tier, ConfirmTier::Confirm);
    }

    #[test]
    fn prod_select_runs_freely() {
        let r = analyze("SELECT 1", EnvLabel::Production);
        assert!(r.allowed_without_ack());
    }

    #[test]
    fn highest_statement_wins_in_a_batch() {
        let r = analyze(
            "SELECT 1; DELETE FROM logs; INSERT INTO t VALUES (1)",
            EnvLabel::Local,
        );
        assert_eq!(r.level, RiskLevel::High);
        assert_eq!(r.statement_count, 3);
    }

    #[test]
    fn semicolon_inside_string_is_not_a_split() {
        let stmts = split_statements("SELECT ';' AS a; SELECT 2");
        assert_eq!(stmts.len(), 2);
    }

    #[test]
    fn dollar_quoted_body_is_one_statement() {
        let sql = "CREATE FUNCTION f() RETURNS int AS $$ BEGIN; RETURN 1; END; $$ LANGUAGE plpgsql";
        let stmts = split_statements(sql);
        assert_eq!(stmts.len(), 1);
    }

    #[test]
    fn unparseable_destructive_sql_still_flags_via_heuristic() {
        // Intentionally odd syntax sqlparser may reject; must not be waved through.
        let r = analyze(
            "DROP TABLE IF EXISTS x CASCADE RESTRICT GARBAGE",
            EnvLabel::Production,
        );
        assert!(r.level >= RiskLevel::Medium);
        assert!(!r.allowed_without_ack());
    }
}
