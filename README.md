# Penta

A modern, UI/UX-first **PostgreSQL workbench** — the power of pgAdmin with the
speed, clarity, and safety of tools like Linear, Raycast, and TablePlus, plus a
privacy-first AI copilot.

> Status: **MVP feature-complete (Phase 1).** The full activation loop is wired:
> connect → browse → query (with schema-aware autocomplete) → **safe edit**
> (PK + `xmin`, SQL preview) → **Production Safety Mode** (destructive-query
> guard) → **AI** (NL→SQL / explain / fix, schema-only, BYO-key or local Ollama).
> Remaining before a public release: signed/notarized installers, the Glide
> canvas grid, and onboarding polish — see [What's left to ship](#whats-left-to-ship).

## Five pillars

**Connect · Query · Design · Monitor · Secure**

## What works today (MVP)

- **Local databases (Docker-free)** — provision a real PostgreSQL on demand:
  Penta finds your `initdb`/`pg_ctl`, spins up a cluster on a free loopback port,
  creates a project DB, and hands you a `DATABASE_URL` to paste into `.env`.
  Start/stop/open/remove from the sidebar. No Docker required.
- **Connect** — add/test/connect, SSL modes, env labels (local/staging/prod) +
  read-only enforcement, OS-keychain credential vault.
- **Explore** — schema → table/view tree, lazy-loaded, single-click data grid.
- **Query** — CodeMirror editor, **schema-aware autocomplete** (alias/column
  resolution from live introspection), run/cancel, streamed results, timing.
- **Safe editing** — editable grid with PK / composite-key detection, `xmin`
  optimistic concurrency, **SQL preview before commit**, atomic apply, no-PK →
  read-only. 12-test correctness suite green vs live PG (the hard launch gate).
- **Production Safety Mode** — `sqlparser-rs` risk scan (`DROP`/`TRUNCATE`/
  unfiltered `DELETE`/`UPDATE`/`ALTER`/`GRANT`), enforced **server-side**, with a
  tiered confirm (one-click → type-to-confirm on prod) and a live risk badge.
- **AI v1** — NL→SQL, explain SQL, explain-and-fix error. **Schema-only context
  by default**, a pre-send inspector, BYO cloud key or local **Ollama**, and the
  generated SQL is inserted for review — **never auto-run**.

## What's left to ship

Now wired: **keyset pagination** (core), **CSV export/import** (streamed via
COPY), rich **cell viewer**, the **open-core licensing seam**
([`penta-license`](crates/penta-license) + in-app Pro panel), a **signed-release
workflow** ([release.yml](.github/workflows/release.yml)), and a **marketing
site** ([apps/website/](apps/website), React + Vite + Tailwind, neo-brutalist).

Still external (one credential away): an **Apple Developer cert** for
notarization and a **Windows code-signing cert** (the release workflow already
reads the secrets), the real **vendor public key** for Pro (release builds embed
a safe placeholder), **payments** (Stripe/Paddle → call the license signer), and
the **telemetry transport** (the opt-in preference is wired, OFF by default).
The **Glide canvas grid** (results currently use a capped HTML table) needs a
desktop GUI session to build + visually verify. See [docs/PRO.md](docs/PRO.md),
[SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md), and
[CONTRIBUTING.md](CONTRIBUTING.md).

## Tech stack

| Layer | Choice |
|---|---|
| Shell | Tauri v2 (desktop, macOS-first; Windows/Linux in CI) |
| UI | React 18 + TypeScript + Vite + Tailwind + shadcn/ui |
| SQL editor | CodeMirror 6 |
| Data grid | Glide Data Grid (canvas) |
| Core | Rust (`tokio-postgres` + `deadpool`, session-per-tab) |
| App store | SQLite via `sqlx` |
| Vault | OS keychain default + optional master password (Argon2id/AES-256-GCM) |
| SQL safety | `sqlparser-rs` (pure Rust) destructive-query detection |
| AI | BYO-key + local Ollama, schema-only context by default |

See full architecture and decisions in
`~/.claude/plans/you-are-a-senior-staged-boole.md` (§0 Locked Decisions).

## Repository layout

```
penta/
  crates/
    penta-core/      # introspection, query exec, grid, safety, AI, IO (reusable by server)
    penta-vault/     # keychain + master-password credential vault
    penta-license/   # open-core: offline Pro license verification + entitlements
  src-tauri/         # thin Tauri v2 shell (IPC commands)
  apps/desktop/      # React + TS desktop frontend (Tauri webview)
  apps/website/      # marketing site (React + Vite + Tailwind, neo-brutalist)
  migrations/        # sqlx SQLite migrations
  docker/            # PostgreSQL dev harness
  .github/workflows/ # CI (lint/test/build + integration) and release (signed installers)
```

The proprietary Pro/Team features (managed AI credits, schema diff, ERD export,
server edition) live in a separate private repo and are **not** part of this
AGPL-3.0 core.

## Development

Prerequisites: Rust (stable), Node 20+, pnpm 11, Docker.

```bash
pnpm install                      # JS deps
docker compose -f docker/docker-compose.yml up -d   # dev PostgreSQL on :55432
cargo test -p penta-core -p penta-vault             # core tests
pnpm --filter @penta/desktop build                  # build frontend
pnpm dev                          # run the Tauri app (installs webview deps on first run)
```

## License

[AGPL-3.0-or-later](./LICENSE). Pro/Team features are separately licensed.
