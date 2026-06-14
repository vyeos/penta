# Security Policy

Penta handles database credentials and runs arbitrary SQL, so we take security
seriously.

## Reporting a vulnerability

**Do not open a public issue for security problems.** Email
`security@penta.app` (update to your real address) with details and, if
possible, a reproduction. We aim to acknowledge within 72 hours and to ship a
fix or mitigation before any public disclosure.

## Security model (how Penta protects you)

- **Credential vault** — secrets live in the OS keychain by default, or as
  Argon2id→AES-256-GCM blobs under an optional master password. They are never
  stored in plaintext config, never written to logs, and never put on a command
  line.
- **Parameterized SQL everywhere** — all dynamic SQL binds parameters; the only
  thing interpolated into SQL text is identifiers, quoted via a safe routine.
  Edit values are bound `$n::text::<type>`, never string-concatenated.
- **Safe editing** — grid edits require a primary/unique key, use `xmin`
  optimistic concurrency, show a SQL preview before commit, and run atomically.
- **Production Safety Mode** — destructive statements are detected and
  re-checked **server-side** in the Rust core, so a UI bypass can't slip a
  `DROP`/unfiltered `DELETE` past the confirmation gate.
- **AI privacy** — schema-only context by default; a pre-send inspector shows
  exactly what would leave the machine; local-model (Ollama) option means zero
  data leaves the device. The AI never executes SQL.
- **Telemetry** — opt-in, off by default; never SQL, connections, credentials,
  or row data.

## Scope

Penta is a desktop client. Server/Team edition (RBAC, OAuth, audit) is a future
phase with its own threat model.
