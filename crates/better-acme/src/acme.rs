use std::{
    collections::HashMap,
    io,
    sync::{
        atomic::{AtomicU16, Ordering},
        Arc, Mutex, PoisonError,
    },
};

use async_trait::async_trait;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, TimeZone, Utc};
use futures::{
    future::{select, Either},
    pin_mut,
    stream::StreamExt,
};
use rustls::{
    pki_types::{CertificateDer as RustlsCertificate, PrivateKeyDer, PrivatePkcs8KeyDer},
    server::{ClientHello, ResolvesServerCert, ServerConfig},
    sign::CertifiedKey,
};
use rustls_acme::{
    is_tls_alpn_challenge, AccountCache, AcmeConfig, CertCache, CertParseError,
    ResolvesServerCertAcme,
};
use sha2::{Digest, Sha256};
use tokio::sync::mpsc;
use x509_parser::parse_x509_certificate;

use crate::{Server, Store};

// TODO: Remove `rustls_acme::Cache`
// TODO: Make sure we internally handle disk IO w/ a LRU cache in memory for the cache abstraction

type TempStore = Arc<Mutex<HashMap<String, (Arc<CertifiedKey>, AtomicU16)>>>;
type TlsConfigFn = Arc<dyn Fn(&str) -> Arc<ServerConfig> + Send + Sync>;
type TlsConfigFnBuilder =
    Box<dyn FnOnce(Arc<dyn ResolvesServerCert>) -> TlsConfigFn + Send + Sync + 'static>;

/// TODO
pub struct Acme<S: Store> {
    /// The backend storage implementation.
    store: Arc<S>,
    /// The ACME server to use.
    server: Server,
    /// A temporary cache for sharing certificates between the acceptor and resolver.
    temp: TempStore,
    /// This is optional so we can unload it in development.
    /// I wanna use the prod certs from the DB but not try and renew them from my laptop given it has no public IP.
    acme_resolver: Option<Arc<ResolvesServerCertAcme>>,
    /// Issue certificate channel
    /// If `acme` is `None` this will not have a receiver registered.
    acme_tx: mpsc::Sender<Vec<String>>,
    /// The configuration to use for when a TLS ALPN challenge is received.
    challenge_rustls_config: Option<Arc<ServerConfig>>,
    /// Get the TLS configuration for a specific domain.
    /// This function must be deterministic!
    get_tls_config: TlsConfigFn,
}

impl<S: Store> Acme<S> {
    pub fn new(
        contact: &str,
        store: S,
        server: Server,
        // TODO: Remove these
        disable_acme: bool,
        domains: &[String],
        // TODO: Move this to a builder
        get_tls_config: Option<TlsConfigFnBuilder>,
    ) -> Self {
        let store = Arc::new(store);
        let (tx, rx) = mpsc::channel(5);

        let mut challenge_rustls_config = None;
        let acme_resolver = if disable_acme {
            None
        } else {
            let mut acme = AcmeConfig::new(domains)
                .contact([format!("mailto:{}", contact)])
                .cache_option(Some(StorageInterop(store.clone())))
                .directory_lets_encrypt(matches!(server, Server::LetsEncrypt))
                .state();

            let resolver = acme.resolver();
            challenge_rustls_config = Some(acme.challenge_rustls_config());

            tokio::spawn(async move {
                let mut rx = rx;
                loop {
                    let f1 = acme.next();
                    pin_mut!(f1);

                    let f2 = rx.recv();
                    pin_mut!(f2);

                    match select(f1, f2).await {
                        Either::Left((_result, _)) => {
                            // TODO: tracing
                        }
                        Either::Right((result, _)) => match result {
                            Some(domains) => {
                                // debug!("Starting new ACME order for: {domains:?}");  // TODO: tracing
                                let _ = acme.order(domains).await;
                            }
                            None => {} // error!("Acme channel closed!"),  // TODO: tracing
                        },
                    }
                }
            });

            Some(resolver)
        };

        let temp = TempStore::default();
        let get_tls_config = get_tls_config
            .map(|f| f(Arc::new(Resolver { temp: temp.clone() })))
            .unwrap_or_else(|| {
                let config = Arc::new(
                    ServerConfig::builder()
                        .with_no_client_auth()
                        .with_cert_resolver(Arc::new(Resolver { temp: temp.clone() })),
                );
                Arc::new(move |_| config.clone())
            });

        Self {
            store,
            server,
            temp,
            acme_resolver,
            acme_tx: tx,
            challenge_rustls_config,
            get_tls_config,
        }
    }

    // TODO: Make this method return a result once it's done.
    pub async fn request_certificate(&self, domains: Vec<String>) {
        // TODO: Make the acme challenges stateless as rustls-acme doesn't do that.

        self.acme_tx.send(domains).await.ok();
    }

    /// Accept an incoming connection.
    /// This will do the asynchronous action of getting the certificate from the store and storing it in memory.
    /// Then the [rustls::server::ResolvesServerCert] implementation can serve it without blocking.
    pub async fn acceptor(
        &self,
        hello: ClientHello<'_>,
    ) -> Result<(String, Arc<ServerConfig>, AcceptorAction), io::Error> {
        let Some(server_name) = hello.server_name() else {
            return Err(io::Error::new(
                io::ErrorKind::ConnectionRefused,
                "No SNI server name provided",
            ));
        };
        let server_name = server_name.to_string();

        if is_tls_alpn_challenge(&hello) {
            return Ok((
                server_name,
                self.challenge_rustls_config.clone().ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::Other,
                        "acme layer is disabled. Can't serve challenge!",
                    )
                })?,
                AcceptorAction::ServedChallenge,
            ));
        }

        // TODO: Store an in-memory lookup between domain & `Arc<CertifiedKey>` so we don't need to hash and parse the cert on each request.
        let key = {
            let mut hasher = Sha256::new();
            hasher.update(server_name.as_bytes());
            hasher.update(self.server.directory_url().as_bytes());
            let result = hasher.finalize();
            URL_SAFE_NO_PAD.encode(result.as_slice())
        };

        let output = match self.store.get(&key).await? {
            // TODO: Caching this parsing & reuse `Arc`
            Some(cert) => Arc::new(
                parse_cert(&cert)
                    .map_err(|err| {
                        io::Error::new(
                            io::ErrorKind::Other,
                            format!("Error parsing the server certificate: {:?}", err),
                        )
                    })?
                    .0,
            ),
            None => {
                return Err(io::Error::new(
                    io::ErrorKind::Other,
                    format!("Unable to find certificate for domain '{server_name}'"),
                ));
            }
        };

        {
            let mut temp = self.temp.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some((_, count)) = temp.get(&server_name) {
                count.fetch_add(1, Ordering::Relaxed);
            } else {
                temp.insert(server_name.clone(), (output.clone(), AtomicU16::new(0)));
            }
        }

        let tls_config = (self.get_tls_config)(&server_name);
        Ok((server_name, tls_config, AcceptorAction::Connection))
    }
}

/// TODO
pub enum AcceptorAction {
    ServedChallenge,
    Connection,
}

/// [rustls::server::ResolvesServerCert] implementation.
#[derive(Debug)]
struct Resolver {
    temp: TempStore,
}

impl ResolvesServerCert for Resolver {
    fn resolve(&self, client_hello: ClientHello) -> Option<Arc<CertifiedKey>> {
        // This should be unreachable when the acceptor is used.
        let Some(server_name) = client_hello.server_name() else {
            return None;
        };

        let mut temp = self.temp.lock().unwrap_or_else(PoisonError::into_inner);
        match temp.get(server_name) {
            Some((cert, count)) => {
                if count.fetch_sub(1, Ordering::Relaxed) == 0 {
                    Some(
                        temp.remove(server_name)
                            .expect("We checked before and are holding the mutex lock")
                            .0,
                    )
                } else {
                    Some(cert.clone())
                }
            }
            None => None,
        }
    }
}

struct StorageInterop<S>(Arc<S>);

#[async_trait]
impl<S: Store + Send + Sync> CertCache for StorageInterop<S> {
    type EC = std::io::Error;

    async fn load_cert(
        &self,
        domains: &[String],
        directory_url: &str,
    ) -> Result<Option<Vec<u8>>, Self::EC> {
        for domain in domains {
            let key = {
                let mut hasher = Sha256::new();
                hasher.update(domain.as_bytes());
                hasher.update(directory_url.as_bytes());
                let result = hasher.finalize();
                URL_SAFE_NO_PAD.encode(result.as_slice())
            };

            let Ok(cert) = self.0.get(&key).await else {
                continue;
            };

            return Ok(cert);
        }

        Ok(None)
    }

    async fn store_cert(
        &self,
        domains: &[String],
        directory_url: &str,
        cert: &[u8],
    ) -> Result<(), Self::EC> {
        for domain in domains {
            let key = {
                let mut hasher = Sha256::new();
                hasher.update(domain.as_bytes());
                hasher.update(directory_url.as_bytes());
                let result = hasher.finalize();
                URL_SAFE_NO_PAD.encode(result.as_slice())
            };

            self.0.set(&key, cert).await?;
        }

        Ok(())
    }
}

#[async_trait]
impl<S: Store + Send + Sync> AccountCache for StorageInterop<S> {
    type EA = std::io::Error;

    async fn load_account(
        &self,
        contacts: &[String],
        directory_url: &str,
    ) -> Result<Option<Vec<u8>>, Self::EA> {
        let key = {
            let mut hasher = Sha256::new();
            for contact in contacts.iter() {
                hasher.update(contact.as_bytes());
            }
            hasher.update(directory_url.as_bytes());
            let result = hasher.finalize();
            URL_SAFE_NO_PAD.encode(result.as_slice())
        };

        self.0.get(&key).await
    }

    async fn store_account(
        &self,
        contacts: &[String],
        directory_url: &str,
        account: &[u8],
    ) -> Result<(), Self::EA> {
        let key = {
            let mut hasher = Sha256::new();
            for contact in contacts.iter() {
                hasher.update(contact.as_bytes());
            }
            hasher.update(directory_url.as_bytes());
            let result = hasher.finalize();
            URL_SAFE_NO_PAD.encode(result.as_slice())
        };

        self.0.set(&key, account).await
    }
}

// Copied from: https://github.com/FlorianUekermann/rustls-acme/blob/f3dcfd169373b4593bb8b6c43febe0c6ead720f5/src/state.rs#L193
fn parse_cert(pem: &[u8]) -> Result<(CertifiedKey, [DateTime<Utc>; 2]), CertParseError> {
    let mut pems = pem::parse_many(pem)?;
    if pems.len() < 2 {
        return Err(CertParseError::TooFewPem(pems.len()));
    }
    let pk = match rustls::crypto::ring::sign::any_ecdsa_type(&PrivateKeyDer::Pkcs8(
        PrivatePkcs8KeyDer::from(pems.remove(0).contents()),
    )) {
        Ok(pk) => pk,
        Err(_) => return Err(CertParseError::InvalidPrivateKey),
    };
    let cert_chain: Vec<RustlsCertificate> = pems
        .into_iter()
        .map(|p| RustlsCertificate::from(p.into_contents()))
        .collect();
    let validity = match parse_x509_certificate(&cert_chain[0]) {
        Ok((_, cert)) => {
            let validity = cert.validity();
            [validity.not_before, validity.not_after]
                .map(|t| Utc.timestamp_opt(t.timestamp(), 0).earliest().unwrap())
        }
        Err(err) => return Err(CertParseError::X509(err)),
    };
    let cert = CertifiedKey::new(cert_chain, pk);
    Ok((cert, validity))
}
