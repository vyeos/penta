//! Open-core licensing (Decision #17/#19, §32). The AGPL core is fully usable on
//! its own; **Pro** features are gated by an offline-verifiable license key.
//!
//! A license key is `base64(payload_json).base64(ed25519_signature)`. The key is
//! signed by the vendor's private key (held in the private `penta-pro` repo) and
//! verified here against an embedded public key — so verification needs no
//! network call and no phone-home. Tampering with the payload or forging a key
//! without the private key fails the signature check; an expired license
//! degrades to Free.
//!
//! This crate intentionally contains **no** Pro feature code — only the boundary.
//! The proprietary implementations live behind these entitlements in `penta-pro`.

use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// Subscription tier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Plan {
    Free,
    Pro,
    Team,
}

/// Individually grantable paid capabilities (the monetization surface, §32).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Feature {
    SchemaDiff,
    ErdExport,
    ManagedAi,
    AdvancedMonitoring,
    TableDesigner,
    MultiWorkspace,
    BackupScheduling,
}

impl Feature {
    /// Everything a paid plan unlocks (used when a license grants `["all"]`).
    pub fn all() -> Vec<Feature> {
        vec![
            Feature::SchemaDiff,
            Feature::ErdExport,
            Feature::ManagedAi,
            Feature::AdvancedMonitoring,
            Feature::TableDesigner,
            Feature::MultiWorkspace,
            Feature::BackupScheduling,
        ]
    }
}

/// The signed payload inside a license key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct License {
    pub email: String,
    pub plan: Plan,
    /// Explicit feature grant. If it contains the sentinel handled in
    /// [`Entitlements::from_license`], all features are granted.
    #[serde(default)]
    pub features: Vec<Feature>,
    /// Unix epoch seconds the license was issued.
    pub issued_at: i64,
    /// Optional expiry (Unix epoch seconds). `None` = perpetual.
    #[serde(default)]
    pub expires_at: Option<i64>,
}

/// What the running app may actually do, after verifying + expiry-checking.
#[derive(Debug, Clone, Serialize)]
pub struct Entitlements {
    pub plan: Plan,
    pub email: Option<String>,
    pub features: Vec<Feature>,
    pub expired: bool,
}

impl Default for Entitlements {
    fn default() -> Self {
        Entitlements::free()
    }
}

impl Entitlements {
    /// The free tier: the full AGPL core, no Pro features.
    pub fn free() -> Self {
        Entitlements {
            plan: Plan::Free,
            email: None,
            features: Vec::new(),
            expired: false,
        }
    }

    fn from_license(lic: License, now: i64) -> Self {
        let expired = lic.expires_at.is_some_and(|e| now > e);
        if expired {
            return Entitlements {
                plan: Plan::Free,
                email: Some(lic.email),
                features: Vec::new(),
                expired: true,
            };
        }
        Entitlements {
            plan: lic.plan,
            email: Some(lic.email),
            features: lic.features,
            expired: false,
        }
    }

    /// Whether a given paid feature is unlocked.
    pub fn has(&self, feature: Feature) -> bool {
        self.features.contains(&feature)
    }

    pub fn is_pro(&self) -> bool {
        matches!(self.plan, Plan::Pro | Plan::Team)
    }
}

#[derive(Debug)]
pub enum LicenseError {
    Malformed,
    BadSignature,
    BadKey,
}

impl std::fmt::Display for LicenseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LicenseError::Malformed => write!(f, "license key is malformed"),
            LicenseError::BadSignature => write!(f, "license signature is invalid"),
            LicenseError::BadKey => write!(f, "license verification key is invalid"),
        }
    }
}
impl std::error::Error for LicenseError {}

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD_NO_PAD;

/// Verify a license key against a 32-byte ed25519 public key, returning the
/// resulting entitlements. Any failure (malformed, bad signature) is the
/// caller's cue to fall back to [`Entitlements::free`].
pub fn verify(key: &str, public_key: &[u8; 32], now: i64) -> Result<Entitlements, LicenseError> {
    let (payload_b64, sig_b64) = key.trim().split_once('.').ok_or(LicenseError::Malformed)?;
    let payload = B64
        .decode(payload_b64)
        .map_err(|_| LicenseError::Malformed)?;
    let sig_bytes = B64.decode(sig_b64).map_err(|_| LicenseError::Malformed)?;

    let vk = VerifyingKey::from_bytes(public_key).map_err(|_| LicenseError::BadKey)?;
    let sig_arr: [u8; 64] = sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| LicenseError::Malformed)?;
    let signature = Signature::from_bytes(&sig_arr);
    vk.verify(&payload, &signature)
        .map_err(|_| LicenseError::BadSignature)?;

    let mut license: License =
        serde_json::from_slice(&payload).map_err(|_| LicenseError::Malformed)?;
    // A wildcard grant unlocks everything (vendor convenience).
    if license.features.is_empty() && matches!(license.plan, Plan::Pro | Plan::Team) {
        license.features = Feature::all();
    }
    Ok(Entitlements::from_license(license, now))
}

/// Vendor-side: sign a license payload with a 32-byte ed25519 seed. Lives here
/// (gated to test builds) so the verification path is covered end-to-end; the
/// real signer runs in the private release tooling, never shipping the seed.
#[cfg(any(test, feature = "vendor"))]
pub fn sign(license: &License, signing_seed: &[u8; 32]) -> String {
    use ed25519_dalek::{Signer, SigningKey};
    let sk = SigningKey::from_bytes(signing_seed);
    let payload = serde_json::to_vec(license).expect("serialize license");
    let sig = sk.sign(&payload);
    format!("{}.{}", B64.encode(&payload), B64.encode(sig.to_bytes()))
}

#[cfg(any(test, feature = "vendor"))]
pub fn public_key_for(signing_seed: &[u8; 32]) -> [u8; 32] {
    use ed25519_dalek::SigningKey;
    SigningKey::from_bytes(signing_seed)
        .verifying_key()
        .to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEED: [u8; 32] = [7u8; 32];

    fn lic(plan: Plan, expires_at: Option<i64>) -> License {
        License {
            email: "dana@example.com".into(),
            plan,
            features: Vec::new(),
            issued_at: 1_700_000_000,
            expires_at,
        }
    }

    #[test]
    fn valid_pro_license_unlocks_features() {
        let key = sign(&lic(Plan::Pro, None), &SEED);
        let ent = verify(&key, &public_key_for(&SEED), 1_700_000_100).unwrap();
        assert!(ent.is_pro());
        assert!(ent.has(Feature::SchemaDiff));
        assert!(ent.has(Feature::ErdExport));
    }

    #[test]
    fn tampered_payload_fails_signature() {
        let mut key = sign(&lic(Plan::Pro, None), &SEED);
        // Flip a character in the payload segment.
        let dot = key.find('.').unwrap();
        let bytes = unsafe { key.as_bytes_mut() };
        bytes[0] = if bytes[0] == b'A' { b'B' } else { b'A' };
        let _ = dot;
        let res = verify(&key, &public_key_for(&SEED), 1_700_000_100);
        assert!(matches!(
            res,
            Err(LicenseError::BadSignature) | Err(LicenseError::Malformed)
        ));
    }

    #[test]
    fn wrong_public_key_is_rejected() {
        let key = sign(&lic(Plan::Pro, None), &SEED);
        let other = public_key_for(&[9u8; 32]);
        assert!(matches!(
            verify(&key, &other, 1_700_000_100),
            Err(LicenseError::BadSignature)
        ));
    }

    #[test]
    fn expired_license_degrades_to_free() {
        let key = sign(&lic(Plan::Pro, Some(1_700_000_050)), &SEED);
        let ent = verify(&key, &public_key_for(&SEED), 1_700_000_100).unwrap();
        assert_eq!(ent.plan, Plan::Free);
        assert!(ent.expired);
        assert!(!ent.has(Feature::SchemaDiff));
    }

    #[test]
    fn free_default_has_no_paid_features() {
        let ent = Entitlements::free();
        assert!(!ent.is_pro());
        assert!(!ent.has(Feature::ManagedAi));
    }
}
