//! Pro license verification bridge. The AGPL core is fully functional without a
//! license; this only decides which **Pro** entitlements are unlocked.

use penta_license::Entitlements;

/// ed25519 public key that verifies Pro license keys.
///
/// Debug builds embed a well-known DEV key (whose private seed is published in
/// the license crate's tests) so the Pro gate can be exercised locally with the
/// sample key in `docs/PRO.md`. Release builds embed a placeholder — replace
/// `RELEASE_PUBKEY` with the real vendor public key (or inject it at build time)
/// before shipping. A zeroed key verifies nothing, so a mis-built release safely
/// behaves as Free-only rather than unlocking Pro for everyone.
#[cfg(debug_assertions)]
const PUBKEY: [u8; 32] = [
    234, 74, 108, 99, 226, 156, 82, 10, 190, 245, 80, 123, 19, 46, 197, 249, 149, 71, 118, 174,
    190, 190, 123, 146, 66, 30, 234, 105, 20, 70, 210, 44,
];
#[cfg(not(debug_assertions))]
const PUBKEY: [u8; 32] = [0u8; 32]; // TODO(release): inject the vendor public key.

fn now() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Verify a (UI-supplied) license key and return the resulting entitlements.
/// Any verification failure degrades to the free tier.
#[tauri::command]
pub fn license_status(key: Option<String>) -> Entitlements {
    match key.filter(|k| !k.trim().is_empty()) {
        Some(k) => {
            penta_license::verify(&k, &PUBKEY, now()).unwrap_or_else(|_| Entitlements::free())
        }
        None => Entitlements::free(),
    }
}
