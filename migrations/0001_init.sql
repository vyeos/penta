-- Penta app database (SQLite, via sqlx). Initial schema.
-- Timestamps are epoch milliseconds (INTEGER). IDs are UUID strings (TEXT).
-- Secrets NEVER live here in plaintext: see encrypted_credentials + penta-vault.

CREATE TABLE IF NOT EXISTS server_groups (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    sort        INTEGER NOT NULL DEFAULT 0,
    color       TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS server_connections (
    id           TEXT PRIMARY KEY,
    group_id     TEXT REFERENCES server_groups(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    host         TEXT NOT NULL,
    port         INTEGER NOT NULL DEFAULT 5432,
    database     TEXT NOT NULL,
    username     TEXT NOT NULL,
    ssl_mode     TEXT NOT NULL DEFAULT 'prefer',
    ssh_config   TEXT,            -- JSON, nullable
    env_label    TEXT NOT NULL DEFAULT 'local',
    color        TEXT,
    read_only    INTEGER NOT NULL DEFAULT 0,
    favorite     INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conn_group ON server_connections(group_id);
CREATE INDEX IF NOT EXISTS idx_conn_last_used ON server_connections(last_used_at);

CREATE TABLE IF NOT EXISTS encrypted_credentials (
    id            TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES server_connections(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL,           -- password | ssh_key | ssl_client_key
    keychain_ref  TEXT,                    -- set when stored in the OS keychain
    ciphertext    BLOB,                    -- set in master-password mode
    nonce         BLOB,
    kdf_params    TEXT,                    -- JSON (Argon2id params)
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    UNIQUE(connection_id, kind)
);

CREATE TABLE IF NOT EXISTS query_history (
    id            TEXT PRIMARY KEY,
    connection_id TEXT REFERENCES server_connections(id) ON DELETE SET NULL,
    database      TEXT,
    sql           TEXT NOT NULL,
    status        TEXT NOT NULL,           -- ok | error | cancelled
    duration_ms   INTEGER,
    row_count     INTEGER,
    error         TEXT,
    executed_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_conn_time
    ON query_history(connection_id, executed_at);

CREATE TABLE IF NOT EXISTS object_cache (
    id            TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES server_connections(id) ON DELETE CASCADE,
    database      TEXT NOT NULL,
    object_key    TEXT NOT NULL,
    kind          TEXT NOT NULL,
    payload       TEXT NOT NULL,           -- JSON
    etag          TEXT,
    fetched_at    INTEGER NOT NULL,
    UNIQUE(connection_id, database, object_key)
);
CREATE INDEX IF NOT EXISTS idx_cache_kind
    ON object_cache(connection_id, database, kind);

CREATE TABLE IF NOT EXISTS app_settings (
    id         TEXT PRIMARY KEY,
    scope      TEXT NOT NULL DEFAULT 'global',
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,             -- JSON
    updated_at INTEGER NOT NULL,
    UNIQUE(scope, key)
);
