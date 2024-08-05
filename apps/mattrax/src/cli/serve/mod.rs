use std::{
    net::{Ipv6Addr, SocketAddr},
    path::PathBuf,
    process,
    sync::Arc,
};

use better_acme::{Acme, FsStore};
use hmac::{Hmac, Mac};
use mx_db::Db;
use rcgen::{CertificateParams, KeyPair, PKCS_ECDSA_P256_SHA256};
use rustls::{
    pki_types::CertificateDer, server::WebPkiClientVerifier, RootCertStore, ServerConfig,
};
use tokio::{net::TcpListener, sync::mpsc};
use tracing::{error, info, warn};
use x509_parser::{certificate::X509Certificate, der_parser::asn1_rs::FromDer};

use crate::{
    api,
    cli::serve::{acme::MattraxAcmeStore, updater::UpdateManager},
    config::{Config, ConfigManager, LocalConfig},
};

mod acme;
pub mod helpers;
mod server;
mod updater;

#[cfg(all(not(debug_assertions), feature = "serve-web"))]
mod web;

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

        if !data_dir.exists() || !data_dir.join("config.json").exists() {
            error!("The Mattrax configuration was not found!");
            error!("To setup a new server, run '{} init'.", binary_name());
            process::exit(1);
        }
        let Ok(local_config) = LocalConfig::load(data_dir.join("config.json"))
            .map_err(|err| error!("Failed to load local configuration: {err}"))
        else {
            process::exit(1);
        };
        info!("Node {:?}", local_config.node_id);

        let (db, config) = helpers::get_db_and_config(&local_config.db_url).await;
        let Some(config) = config else {
            error!(
                "Failed to get Mattrax configuration from DB. You may need to run '{} init'.",
                binary_name()
            );
            process::exit(1);
        };

        #[cfg(all(not(debug_assertions), feature = "serve-web"))]
        web::spawn_process(&config.internal_secret);

        serve_inner(self.port, data_dir, db, local_config, config).await;
    }
}

/// Determine the name of the current binary.
pub fn binary_name() -> String {
    std::env::args()
        .next()
        .unwrap_or(env!("CARGO_PKG_NAME").to_string())
}

// TODO: Probs remove and just structure commands for Cloud better
pub(super) async fn serve_inner(
    port: Option<u16>,
    data_dir: PathBuf,
    db: Db,
    local_config: LocalConfig,
    config: Config,
) {
    let config_manager = ConfigManager::new(db.clone(), local_config, config).unwrap();
    let _updater = UpdateManager::new(db.clone(), config_manager.clone());

    let port = {
        let config = config_manager.get();

        port.unwrap_or({
            #[cfg(debug_assertions)]
            if config.domain == "localhost" {
                9000
            } else {
                443
            }
            #[cfg(not(debug_assertions))]
            443
        })
    };

    let (acme_tx, acme_rx) = mpsc::channel(25);
    let state = {
        let config = config_manager.get();
        let identity_key = KeyPair::from_der_and_sign_algo(
            &config.certificates.identity_key.clone().try_into().unwrap(),
            &PKCS_ECDSA_P256_SHA256,
        )
        .unwrap();
        let shared_secret = Hmac::new_from_slice(config.internal_secret.as_bytes()).unwrap();

        let identity_cert_rcgen =
            CertificateParams::from_ca_cert_der(&config.certificates.identity_cert.clone().into())
                .unwrap()
                // TODO: https://github.com/rustls/rcgen/issues/274
                .self_signed(&identity_key)
                .unwrap();

        Arc::new(api::Context {
            config: config_manager.clone(),
            is_dev: cfg!(debug_assertions),
            server_port: port,
            db,
            identity_cert_rcgen,
            identity_cert_x509: {
                // TODO: We *have* to leak memory right because of how `x509_parser` is built. Should be fixed by https://github.com/rusticata/x509-parser/issues/76
                let public_key = Vec::leak(config.certificates.identity_cert.clone());
                X509Certificate::from_der(public_key).unwrap().1.to_owned()
            },
            identity_key,
            shared_secret,
            acme_tx,
        })
    };

    let router = api::mount(state.clone());

    // TODO: Graceful shutdown

    let config = config_manager.get();

    if config.domain == "localhost" || config.cloud.is_some() {
        let port = config.cloud.as_ref().map(|_| 9000).unwrap_or(port);

        if config.cloud.is_some() {
            info!("Running in cloud mode.");

            std::fs::write(
                "/mtls-roots.pem",
                config.certificates.identity_pool.join(""),
            )
            .unwrap();

            std::process::Command::new("caddy")
                .args(&["run", "--config", "/Caddyfile"])
                .env("INTERNAL_SECRET", &config.internal_secret)
                .spawn()
                .unwrap();
        }

        let addr = SocketAddr::from((Ipv6Addr::UNSPECIFIED, port));
        let listener = TcpListener::bind(addr).await.unwrap();
        info!(
            "Listening on http://{}",
            listener.local_addr().unwrap_or(addr)
        );
        axum::serve(listener, router).await.unwrap();
    } else {
        let identity_cert = config.certificates.identity_cert.clone();
        let acme = Arc::new(Acme::new(
            &config.acme_email,
            FsStore::new(
                data_dir.join("acme"),
                MattraxAcmeStore::new(state.db.clone()),
            )
            .unwrap(),
            config.acme_server.to_better_acme_server(),
            state.is_dev, // TODO: We should probs document this cause it's not an obvious default
            // TODO: Remove these argument
            &[config.domain.clone(), config.enrollment_domain.clone()],
            Some(Box::new(move |resolver| {
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
                                let cert: CertificateDer = identity_cert.clone().into();
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

                let primary_domain = state.config.get().domain.clone();
                Arc::new(move |domain| match domain {
                    d if d == primary_domain => management_config.clone(),
                    _ => enrollment_config.clone(),
                })
            })),
        ));

        tokio::spawn({
            let acme = acme.clone();
            let mut acme_rx = acme_rx;
            async move {
                while let Some(domains) = acme_rx.recv().await {
                    acme.request_certificate(domains).await;
                }
            }
        });

        server::server(
            router,
            acme,
            SocketAddr::from((Ipv6Addr::UNSPECIFIED, port)),
        )
        .await;
    }
}
