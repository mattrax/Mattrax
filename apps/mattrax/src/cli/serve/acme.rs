use std::{io::ErrorKind, path::PathBuf};

use axum::async_trait;
use chrono::Utc;
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
        if domains.len() > 1 {
            return Err(std::io::Error::new(
                ErrorKind::Other,
                "MattraxAcmeStore: only one domain per certificate is supported",
            ));
        }

        let result = self.file_cache.load_cert(domains, directory_url).await?;
        let result = match result {
            Some(cert) => Some(cert),
            None => {
                let mut cert = None;
                if let Some(domain) = domains.first() {
                    cert = self
                        .db
                        .get_certificate(domain.clone())
                        .await
                        .map_err(|err| {
                            std::io::Error::new(
                                ErrorKind::Other,
                                format!("MattraxAcmeStore: {err:?}"),
                            )
                        })?
                        .into_iter()
                        .next()
                        .map(|v| v.certificate);

                    if let Some(cert) = &cert {
                        self.store_cert(domains, directory_url, cert).await?;
                    }
                }

                cert
            }
        };

        return Ok(result);
    }

    async fn store_cert(
        &self,
        domains: &[String],
        directory_url: &str,
        cert: &[u8],
    ) -> Result<(), Self::EC> {
        println!("STORE LEN: {:?}", cert.len()); // TODO
        for domain in domains {
            self.db
                .store_certificate(domain.clone(), cert.to_vec(), Utc::now().naive_utc())
                .await
                .map_err(|err| std::io::Error::new(ErrorKind::Other, err))?;
        }

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
        contacts: &[String],
        directory_url: &str,
    ) -> Result<Option<Vec<u8>>, Self::EA> {
        if contacts.len() > 1 {
            return Err(std::io::Error::new(
                ErrorKind::Other,
                "MattraxAcmeStore: only one contact per certificate is supported",
            ));
        }

        let result = self.file_cache.load_cert(contacts, directory_url).await?;
        let result = match result {
            Some(cert) => Some(cert),
            None => {
                let mut cert = None;
                if let Some(contact) = contacts.first() {
                    cert = self
                        .db
                        .get_certificate(contact.clone())
                        .await
                        .map_err(|err| {
                            std::io::Error::new(
                                ErrorKind::Other,
                                format!("MattraxAcmeStore: {err:?}"),
                            )
                        })?
                        .into_iter()
                        .next()
                        .map(|v| v.certificate);

                    if let Some(cert) = &cert {
                        self.store_cert(contacts, directory_url, cert).await?;
                    }
                }

                cert
            }
        };

        return Ok(result);
    }

    async fn store_account(
        &self,
        contact: &[String],
        directory_url: &str,
        account: &[u8],
    ) -> Result<(), Self::EA> {
        println!("ACCOUNT LEN: {:?}", account.len()); // TODO
        for contact in contact {
            self.db
                .store_certificate(contact.clone(), account.to_vec(), Utc::now().naive_utc())
                .await
                .map_err(|err| std::io::Error::new(ErrorKind::Other, err))?;
        }

        self.file_cache
            .store_account(contact, directory_url, account)
            .await
    }
}
