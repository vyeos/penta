# Penta Pro (open-core)

Penta's desktop workbench is **free and open-source** under AGPL-3.0. The
activation loop — connect, browse, query, autocomplete, safe editing, safety
mode, BYO-key/local AI — is never paywalled. **Pro** unlocks depth and teams.

## What Pro unlocks

| Feature | Entitlement key |
|---|---|
| Schema diff + sync script | `schema_diff` |
| ERD export (PNG/SVG) | `erd_export` |
| Managed AI credits (no BYO key) | `managed_ai` |
| Advanced monitoring | `advanced_monitoring` |
| Visual table designer | `table_designer` |
| Multiple workspaces | `multi_workspace` |
| Backup scheduling | `backup_scheduling` |

The boundary lives in the open-source [`penta-license`](../crates/penta-license)
crate. It contains **no** Pro feature code — only the verified-entitlement gate.
The proprietary implementations live in the private `penta-pro` overlay.

## How licensing works (offline, no phone-home)

A license key is `base64(payload).base64(ed25519_signature)`:

1. The vendor signs a `License { email, plan, features, issued_at, expires_at }`
   payload with a **private** ed25519 key (held only in the release tooling).
2. The app verifies the key against the **embedded public key** — no network
   call. Tampering or forgery fails the signature check; an expired license
   silently degrades to Free.

### Issuing a key (vendor side)

The signer is gated behind the `vendor` feature so it never ships in the app:

```rust
use penta_license::{sign, License, Plan};
let key = sign(&License {
    email: "buyer@example.com".into(),
    plan: Plan::Pro,
    features: vec![],            // empty ⇒ all Pro features
    issued_at: now_secs(),
    expires_at: Some(one_year_from_now),
}, &SIGNING_SEED);               // 32-byte secret, never committed
```

Generate the keypair once, publish the **public** key into
[`src-tauri/src/license.rs`](../src-tauri/src/license.rs) (`RELEASE_PUBKEY`), and
keep the private seed in a secrets manager.

### Dev / demo

Debug builds embed a well-known **dev** public key (its private seed is in the
crate's tests) so you can exercise the Pro gate locally. Paste this sample Pro
key into the in-app license panel when running a debug build:

```
eyJlbWFpbCI6ImRldkBwZW50YS5hcHAiLCJwbGFuIjoicHJvIiwiZmVhdHVyZXMiOltdLCJpc3N1ZWRfYXQiOjE3MDAwMDAwMDAsImV4cGlyZXNfYXQiOm51bGx9./sIxVDD99c/tUK9bRwMieIwgaJx7LsnlgfuLhmv1LXvtBFyI4Bum6tNovrmmmr+joHJ09EkuKsIc8mDKuPyxCw
```

> Release builds embed a placeholder public key — replace `RELEASE_PUBKEY` with
> your real vendor key before shipping, or Pro stays locked for everyone (the
> safe default).

## Payments

Penta has no payment backend yet. Wire your checkout (Stripe / Paddle /
LemonSqueezy) to call the vendor-side `sign(...)` on a successful purchase and
email the key to the buyer. Managed-AI credits would additionally need a metered
billing integration and the AI gateway.
