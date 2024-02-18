use std::{
    fs,
    net::{Ipv6Addr, SocketAddr},
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

use futures::{
    future::{select, Either},
    pin_mut,
};
use rcgen::{Certificate, CertificateParams, KeyPair};
use rustls::{pki_types::CertificateDer, server::WebPkiClientVerifier};
use rustls_acme::{
    futures_rustls::rustls::{RootCertStore, ServerConfig},
    AcmeConfig,
};
use tokio::{net::TcpListener, sync::mpsc};
use tokio_stream::StreamExt;
use tracing::{debug, error, info, warn};

use crate::{
    api,
    cli::serve::acme::MattraxAcmeStore,
    config::{AcmeServer, ConfigManager},
    db::Db,
};

mod acme;
mod server;

#[derive(clap::Args)]
#[command(about = "Serve Mattrax.")]
pub struct Command {
    #[arg(short, long, help = "Port to listen on")]
    port: Option<u16>,
}

impl Command {
    pub async fn run(&self, data_dir: PathBuf) {
        info!("Starting Mattrax...");

        #[cfg(debug_assertions)]
        warn!("Running in development mode! Do not use in production!");

        if !data_dir.exists() {
            error!("The configuration directory does not exist!");
            error!("To setup a new server, run '{} init'.", binary_name());
            return;
        }
        if !data_dir.join("config.json").exists() {
            error!("The configuration file does not exist!");
            error!("To setup a new server, run '{} init'.", binary_name());
            return;
        }

        let config_manager = ConfigManager::from_path(data_dir.join("config.json")).unwrap();
        let port = {
            let config = config_manager.get();

            let port = self.port.unwrap_or({
                #[cfg(debug_assertions)]
                if config.domain == "localhost" {
                    9000
                } else {
                    443
                }
                #[cfg(not(debug_assertions))]
                443
            });

            port
        };

        let params = CertificateParams::from_ca_cert_der(
            &fs::read(data_dir.join("certs").join("identity.der")).unwrap(),
        )
        .unwrap();

        let key_pair =
            KeyPair::from_der(&fs::read(data_dir.join("certs").join("identity-key.der")).unwrap())
                .unwrap();
        let db = Db::new(&config_manager.get().db_url);
        let (acme_tx, acme_rx) = mpsc::channel(25);
        let state = Arc::new(api::Context {
            config: config_manager,
            is_dev: cfg!(debug_assertions),
            server_port: port,
            db,
            // TODO: Is calling generate each time, okay????
            identity_cert: Certificate::generate_self_signed(params, &key_pair).unwrap(),
            identity_key: key_pair,
            acme_tx,
        });

        let router = api::mount(state.clone());

        // TODO: Graceful shutdown

        let config = state.config.get().clone();
        if config.domain == "localhost" {
            let addr = SocketAddr::from((Ipv6Addr::UNSPECIFIED, port));
            let listener = TcpListener::bind(addr).await.unwrap();
            info!(
                "Listening on http://{}",
                listener.local_addr().unwrap_or(addr)
            );
            axum::serve(listener, router).await.unwrap();
        } else {
            let mut acme =
                AcmeConfig::new(&[config.domain.clone(), config.enrollment_domain.clone()])
                    .contact(&[format!("mailto:{}", config.acme_email)])
                    .cache_option(Some(MattraxAcmeStore::new(
                        state.db.clone(),
                        data_dir.join("acme"),
                    )))
                    .directory_lets_encrypt(matches!(config.acme_server, AcmeServer::Production))
                    .state();

            let resolver = acme.resolver();
            let challenge_rustls_config = acme.challenge_rustls_config();
            let handle = tokio::spawn(async move {
                let mut acme_rx = acme_rx;
                loop {
                    let f1 = acme.next();
                    pin_mut!(f1);

                    let f2 = acme_rx.recv();
                    pin_mut!(f2);

                    match select(f1, f2).await {
                        Either::Left((result, _)) => match result.unwrap() {
                            Ok(ok) => debug!("event: {:?}", ok),
                            Err(err) => error!("error: {:?}", err),
                        },
                        Either::Right((result, _)) => match result {
                            Some(domains) => {
                                debug!("Starting new ACME order for: {domains:?}");
                                let _ = acme.order(domains).await;
                            }
                            None => error!("Acme channel closed!"),
                        },
                    }
                }
            });

            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(3)).await;
                handle.abort();
            });

            // Served for `enterpriseenrollment.*` domains.
            // Doesn't allow client auth because Microsoft MDM client's enrollment system breaks with it.
            let enrollment_config = Arc::new(
                ServerConfig::builder()
                    .with_no_client_auth()
                    .with_cert_resolver(resolver.clone()),
            );

            // Served for the configured domain name.
            // Allows client auth for MDM clients but doesn't require it for other requests.
            let management_config = Arc::new(
                ServerConfig::builder()
                    .with_client_cert_verifier(
                        WebPkiClientVerifier::builder({
                            // TODO: Allow this to be rotated at runtime for renewal
                            let mut root = RootCertStore::empty();
                            let cert: CertificateDer =
                                fs::read(data_dir.join("certs").join("identity.der"))
                                    .unwrap()
                                    .into();
                            let (added_certs, invalid_certs) =
                                root.add_parsable_certificates([cert]);
                            if added_certs != 1 && invalid_certs != 0 {
                                panic!("Failed to add identity certificate to root store");
                            }

                            Arc::new(root)
                        })
                        // We check for the cert in the handler
                        .allow_unauthenticated()
                        .build()
                        .unwrap(),
                    )
                    .with_cert_resolver(resolver),
            );

            server::Server::new(router, challenge_rustls_config, {
                let primary_domain = state.config.get().domain.clone();
                move |domain| match domain {
                    d if d == primary_domain => {
                        println!("YES");
                        management_config.clone()
                    }
                    _ => enrollment_config.clone(),
                }
            })
            .start(SocketAddr::from((Ipv6Addr::UNSPECIFIED, port)))
            .await;
        }
    }
}

/// Determine the name of the current binary.
pub fn binary_name() -> String {
    std::env::args()
        .next()
        .unwrap_or(env!("CARGO_PKG_NAME").to_string())
}
