//! Master-password cryptography: Argon2id key derivation + AES-256-GCM
//! authenticated encryption (Decision #6). Used when the user opts into
//! master-password mode or when no OS keychain is available.
//!
//! The derived key is zeroized on drop; decryption failure (including a wrong
//! password) is reported uniformly as `VaultError::Crypto`.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::Argon2;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::error::{Result, VaultError};

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

/// A 256-bit key derived from the user's master password. Zeroized on drop.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct MasterKey([u8; 32]);

/// Self-describing encrypted secret persisted by the app DB in
/// master-password mode (`encrypted_credentials`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedBlob {
    pub ciphertext: Vec<u8>,
    pub nonce: Vec<u8>,
    pub salt: Vec<u8>,
}

/// Generate a fresh random salt for key derivation.
pub fn new_salt() -> Vec<u8> {
    let mut salt = vec![0u8; SALT_LEN];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    salt
}

/// Derive a master key from a password + salt using Argon2id (default params).
pub fn derive_key(password: &str, salt: &[u8]) -> Result<MasterKey> {
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|_| VaultError::Crypto)?;
    Ok(MasterKey(key))
}

/// Encrypt `plaintext` with AES-256-GCM under `key`, embedding `salt` so the
/// blob is self-describing for later decryption.
pub fn encrypt(key: &MasterKey, salt: &[u8], plaintext: &[u8]) -> Result<EncryptedBlob> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key.0));
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| VaultError::Crypto)?;
    Ok(EncryptedBlob {
        ciphertext,
        nonce: nonce_bytes.to_vec(),
        salt: salt.to_vec(),
    })
}

/// Decrypt a blob produced by [`encrypt`]. Any authentication failure (e.g. a
/// wrong password) returns `VaultError::Crypto`.
pub fn decrypt(key: &MasterKey, blob: &EncryptedBlob) -> Result<Vec<u8>> {
    if blob.nonce.len() != NONCE_LEN {
        return Err(VaultError::Crypto);
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key.0));
    let nonce = Nonce::from_slice(&blob.nonce);
    cipher
        .decrypt(nonce, blob.ciphertext.as_ref())
        .map_err(|_| VaultError::Crypto)
}
