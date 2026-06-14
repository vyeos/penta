# Contributing to Penta

Thanks for your interest! Penta's core is AGPL-3.0; Pro/Team features live in a
separate private overlay.

## Development setup

Prerequisites: Rust (stable), Node 20+, pnpm 11, and a PostgreSQL for testing.

```bash
pnpm install
# A throwaway local PG (or use docker/docker-compose.yml):
export PENTA_TEST_PG_URL=postgres://user@127.0.0.1:5432/penta_dev
cargo test --workspace             # Rust unit + integration tests
pnpm --filter @penta/desktop build # typecheck + build the UI
pnpm dev                           # run the Tauri app
```

## Before you open a PR

The CI gates every PR on these — run them locally first:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace             # with PENTA_TEST_PG_URL set for integration tests
pnpm --filter @penta/desktop build
```

## Guidelines

- **Correctness gates are sacred.** The data-edit suite and the safety risk
  scanner are the riskiest subsystems — never weaken a test to make a change
  pass. Add tests for new edit/DDL/risk paths.
- **No secrets in logs or errors.** Credentials and API keys must never be
  logged, echoed, or serialized into error messages.
- **Match the surrounding style.** Rust core is UI-agnostic; keep transport
  (Tauri) thin. TypeScript uses the existing component/store patterns.
- **Keep the core PG-native.** Penta is Postgres-only by design — that focus is
  the moat, not a limitation.

## Architecture

See [the README](README.md) and the execution plan referenced there. The Rust
core (`penta-core`, `penta-vault`, `penta-license`) is reusable by a future
server edition; the desktop shell (`src-tauri`) is a thin IPC layer.
