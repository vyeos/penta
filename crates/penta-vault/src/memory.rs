//! In-memory secret store for tests and ephemeral (no-persistence) sessions.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::error::Result;
use crate::{SecretKind, SecretStore};

#[derive(Default)]
pub struct MemoryStore {
    map: Mutex<HashMap<String, String>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn key(id: &str, kind: SecretKind) -> String {
        format!("{id}:{}", kind.as_str())
    }
}

impl SecretStore for MemoryStore {
    fn store(&self, connection_id: &str, kind: SecretKind, secret: &str) -> Result<()> {
        self.map
            .lock()
            .unwrap()
            .insert(Self::key(connection_id, kind), secret.to_string());
        Ok(())
    }

    fn get(&self, connection_id: &str, kind: SecretKind) -> Result<Option<String>> {
        Ok(self
            .map
            .lock()
            .unwrap()
            .get(&Self::key(connection_id, kind))
            .cloned())
    }

    fn delete(&self, connection_id: &str, kind: SecretKind) -> Result<()> {
        self.map
            .lock()
            .unwrap()
            .remove(&Self::key(connection_id, kind));
        Ok(())
    }
}
