//! OS keychain secret store (default vault backend, Decision #6).
//! macOS Keychain / Windows Credential Manager via the `keyring` crate.

use keyring::Entry;

use crate::error::{Result, VaultError};
use crate::{SecretKind, SecretStore};

const SERVICE: &str = "dev.penta.app";

/// SecretStore backed by the OS keychain.
pub struct KeychainStore;

impl KeychainStore {
    fn entry(connection_id: &str, kind: SecretKind) -> Result<Entry> {
        let user = format!("{connection_id}:{}", kind.as_str());
        Entry::new(SERVICE, &user).map_err(|e| VaultError::Backend(e.to_string()))
    }

    /// Whether an OS keychain backend appears usable; drives auto-fallback to
    /// master-password mode when false.
    pub fn available() -> bool {
        Entry::new(SERVICE, "__probe__").is_ok()
    }
}

impl SecretStore for KeychainStore {
    fn store(&self, connection_id: &str, kind: SecretKind, secret: &str) -> Result<()> {
        Self::entry(connection_id, kind)?
            .set_password(secret)
            .map_err(|e| VaultError::Backend(e.to_string()))
    }

    fn get(&self, connection_id: &str, kind: SecretKind) -> Result<Option<String>> {
        match Self::entry(connection_id, kind)?.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(VaultError::Backend(e.to_string())),
        }
    }

    fn delete(&self, connection_id: &str, kind: SecretKind) -> Result<()> {
        match Self::entry(connection_id, kind)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(VaultError::Backend(e.to_string())),
        }
    }
}
