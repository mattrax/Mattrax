use std::path::PathBuf;

use axum::async_trait;
use rustls_acme::{caches::DirCache, AccountCache, CertCache};

use crate::db::Db;

/// A custom implementation of `CertCache` and `AccountCache` which uses
/// the MySQL DB as the source of truth with a disk cache for quick access.
pub struct MattraxAcmeStore {
    db: Db,
    file_cache: DirCache<PathBuf>,
}

impl MattraxAcmeStore {
    pub fn new(db: Db, cache_dir: PathBuf) -> Self {
        Self {
            db,
            file_cache: DirCache::new(cache_dir),
        }
    }
}

#[async_trait]
impl CertCache for MattraxAcmeStore {
    type EC = std::io::Error;

    async fn load_cert(
        &self,
        domains: &[String],
        directory_url: &str,
    ) -> Result<Option<Vec<u8>>, Self::EC> {
        let result = self.file_cache.load_cert(domains, directory_url).await?;

        // TODO: Get from the DB & store into disk cache, and return

        return Ok(result);
    }

    async fn store_cert(
        &self,
        domains: &[String],
        directory_url: &str,
        cert: &[u8],
    ) -> Result<(), Self::EC> {
        // TODO: Update DB

        self.file_cache
            .store_cert(domains, directory_url, cert)
            .await
    }
}

#[async_trait]
impl AccountCache for MattraxAcmeStore {
    type EA = std::io::Error;

    async fn load_account(
        &self,
        contact: &[String],
        directory_url: &str,
    ) -> Result<Option<Vec<u8>>, Self::EA> {
        // TODO: Load from the DB if found and cache on the FS

        self.file_cache.load_account(contact, directory_url).await
    }

    async fn store_account(
        &self,
        contact: &[String],
        directory_url: &str,
        account: &[u8],
    ) -> Result<(), Self::EA> {
        // TODO: Store into the DB

        self.file_cache
            .store_account(contact, directory_url, account)
            .await
    }
}
