// Parse a PostgreSQL connection string into the fields the connection form
// understands. Lets users paste a DSN instead of typing each field by hand.
import type { SslMode } from "@/lib/api";

export interface ParsedConn {
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  ssl_mode?: SslMode;
}

const SSL_MODES: readonly string[] = [
  "disable",
  "allow",
  "prefer",
  "require",
  "verify-ca",
  "verify-full",
];

function asSslMode(v: string | null | undefined): SslMode | undefined {
  const m = v?.trim().toLowerCase();
  return m && SSL_MODES.includes(m) ? (m as SslMode) : undefined;
}

/** Percent-decode, but never throw on a malformed escape — fall back to raw. */
function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/**
 * Parse a PostgreSQL connection string into form fields. Returns `null` when the
 * input doesn't look like a connection string, so callers can leave whatever was
 * typed manually untouched. Only the keys actually present are returned.
 *
 * Accepts both shapes Postgres tooling emits:
 *   - URI:     postgresql://user:pass@host:5432/dbname?sslmode=require
 *   - keyword: host=localhost port=5432 dbname=mydb user=postgres sslmode=require
 */
export function parseConnectionString(raw: string): ParsedConn | null {
  const input = raw.trim();
  if (!input) return null;
  if (/^postgres(ql)?:\/\//i.test(input)) return parseUri(input);
  if (/(^|\s)(host|hostaddr|port|dbname|user|password|sslmode)\s*=/i.test(input)) {
    return parseKeyword(input);
  }
  return null;
}

function parseUri(input: string): ParsedConn | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const out: ParsedConn = {};
  const host = url.hostname.replace(/^\[|\]$/g, ""); // unwrap IPv6 brackets
  if (host) out.host = safeDecode(host);
  if (url.port) {
    const p = Number(url.port);
    if (Number.isFinite(p)) out.port = p;
  }
  const db = url.pathname.replace(/^\//, "");
  if (db) out.database = safeDecode(db);
  if (url.username) out.username = safeDecode(url.username);
  if (url.password) out.password = safeDecode(url.password);
  const ssl = asSslMode(url.searchParams.get("sslmode"));
  if (ssl) out.ssl_mode = ssl;
  return out;
}

function parseKeyword(input: string): ParsedConn {
  const out: ParsedConn = {};
  // key = value, where value is either single-quoted (with \-escapes) or runs
  // up to the next whitespace.
  const re = /(\w+)\s*=\s*('(?:[^'\\]|\\.)*'|\S*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const key = m[1].toLowerCase();
    let val = m[2];
    if (val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1).replace(/\\(.)/g, "$1");
    }
    switch (key) {
      case "host":
        if (val) out.host = val;
        break;
      case "hostaddr":
        if (val && !out.host) out.host = val;
        break;
      case "port": {
        const p = Number(val);
        if (Number.isFinite(p) && p > 0) out.port = p;
        break;
      }
      case "dbname":
        if (val) out.database = val;
        break;
      case "user":
        if (val) out.username = val;
        break;
      case "password":
        out.password = val;
        break;
      case "sslmode": {
        const s = asSslMode(val);
        if (s) out.ssl_mode = s;
        break;
      }
    }
  }
  return out;
}
