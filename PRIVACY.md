# Privacy Policy (draft)

> **This is a starting-point draft, not legal advice.** Have counsel review it
> and fill in the bracketed details before publishing.

_Last updated: [DATE]. Operated by [COMPANY/INDIVIDUAL], [JURISDICTION]._

Penta is a **desktop application**. By design, the things you'd most worry about
— your database credentials, the SQL you write, your schema, and your data —
stay on your machine. We do not run a server that receives them.

## What stays on your device

- **Connections & credentials.** Stored locally (OS keychain or an encrypted
  local vault). Never transmitted to us.
- **Queries, schemas, and results.** Processed locally against your own database.
- **Settings.** Stored locally.

## What may leave your device (only with your action)

- **AI features.** Off until you configure a provider. With a **local model
  (Ollama)**, nothing leaves your device. With a **cloud provider** (your own
  API key), Penta sends a **schema-only** context plus your prompt/SQL to *that
  provider* — never to us — and a pre-send inspector shows you exactly what will
  be sent. Row data is never included. Those requests are governed by the
  provider's privacy policy.
- **Telemetry.** **Opt-in and off by default.** If you enable it, we collect
  anonymous usage and crash data only — never your SQL, connections,
  credentials, schema, or data. [Describe what is collected and the processor.]

## Updates

If auto-updates are enabled, the app contacts the update server to check for new
versions; this transmits only your app version and platform.

## Your choices

You can disable telemetry and AI at any time, and delete all local data by
removing `~/.penta` and Penta's keychain entries.

## Contact

[privacy@penta.app]
