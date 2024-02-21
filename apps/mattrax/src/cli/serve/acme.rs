use std::io::ErrorKind;

use better_acme::Store;
use chrono::Utc;

use crate::db::Db;

/// A storage backend for `better-acme` that uses MySQL as the source of truth.
pub struct MattraxAcmeStore {
    db: Db,
}

impl MattraxAcmeStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }
}

impl Store for MattraxAcmeStore {
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, std::io::Error> {
        Ok(self
            .db
            .get_certificate(key.to_string())
            .await
            .map_err(|err| {
                std::io::Error::new(ErrorKind::Other, format!("MattraxAcmeStore: {err:?}"))
            })?
            .into_iter()
            .next()
            .map(|v| v.certificate))
    }

    async fn set(&self, key: &str, value: &[u8]) -> Result<(), std::io::Error> {
        self.db
            .store_certificate(key.to_string(), value.to_vec(), Utc::now().naive_utc())
            .await
            .map_err(|err| std::io::Error::new(ErrorKind::Other, err))
    }
}
