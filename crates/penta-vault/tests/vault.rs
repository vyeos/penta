//! Vault crypto + store tests. The crypto path is deterministic and runs in CI;
//! the live keychain test is `#[ignore]`d (it touches the real OS keychain).

use penta_vault::crypto;
use penta_vault::{MemoryStore, SecretKind, SecretStore};

#[test]
fn crypto_round_trip() {
    let salt = crypto::new_salt();
    let key = crypto::derive_key("correct horse battery staple", &salt).unwrap();
    let blob = crypto::encrypt(&key, &salt, b"super-secret-password").unwrap();
    let pt = crypto::decrypt(&key, &blob).unwrap();
    assert_eq!(pt, b"super-secret-password");
}

#[test]
fn wrong_password_fails() {
    let salt = crypto::new_salt();
    let key = crypto::derive_key("right-password", &salt).unwrap();
    let blob = crypto::encrypt(&key, &salt, b"secret").unwrap();

    let wrong = crypto::derive_key("wrong-password", &blob.salt).unwrap();
    assert!(crypto::decrypt(&wrong, &blob).is_err());
}

#[test]
fn ciphertext_does_not_leak_plaintext() {
    let salt = crypto::new_salt();
    let key = crypto::derive_key("pw", &salt).unwrap();
    let secret = b"plaintext-here";
    let blob = crypto::encrypt(&key, &salt, secret).unwrap();
    assert!(
        !blob.ciphertext.windows(secret.len()).any(|w| w == secret),
        "plaintext must not appear in ciphertext"
    );
}

#[test]
fn memory_store_crud() {
    let store = MemoryStore::new();
    assert_eq!(store.get("c1", SecretKind::Password).unwrap(), None);

    store.store("c1", SecretKind::Password, "pw").unwrap();
    assert_eq!(
        store.get("c1", SecretKind::Password).unwrap(),
        Some("pw".to_string())
    );

    // Different kinds are isolated.
    assert_eq!(store.get("c1", SecretKind::SshKey).unwrap(), None);

    store.delete("c1", SecretKind::Password).unwrap();
    assert_eq!(store.get("c1", SecretKind::Password).unwrap(), None);
}

#[test]
#[ignore = "touches the real OS keychain; run manually with --ignored"]
fn keychain_round_trip() {
    use penta_vault::KeychainStore;
    let store = KeychainStore;
    store
        .store("penta-test-conn", SecretKind::Password, "kc-secret")
        .unwrap();
    assert_eq!(
        store.get("penta-test-conn", SecretKind::Password).unwrap(),
        Some("kc-secret".to_string())
    );
    store
        .delete("penta-test-conn", SecretKind::Password)
        .unwrap();
}
