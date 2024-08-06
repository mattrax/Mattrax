use std::{
    net::{Ipv6Addr, SocketAddr},
    path::PathBuf,
    process,
    sync::Arc,
};

use hmac::{Hmac, Mac};
use rcgen::{CertificateParams, KeyPair, PKCS_ECDSA_P256_SHA256};
use tokio::{net::TcpListener, signal};
use tracing::{error, info};
use x509_parser::{certificate::X509Certificate, der_parser::asn1_rs::FromDer};

use crate::{
    api,
    cli::init::do_setup,
    config::{CloudConfig, ConfigManager, LocalConfig},
};

pub mod helpers;

#[cfg(all(not(debug_assertions), feature = "serve-web"))]
mod web;

#[derive(clap::Args)]
#[command(about = "Serve Mattrax.")]
pub struct Command {
    #[arg(short, long, help = "Port to listen on")]
    port: Option<u16>,

    /// You should not use this!
    #[arg(long, hide = false, default_value = "false")]
    cloud: bool,
}

impl Command {
    pub async fn run(&self, data_dir: PathBuf) {
        info!("Starting Mattrax...");

        #[cfg(debug_assertions)]
        tracing::warn!("Running in development mode! Do not use in production!");

        if !data_dir.exists() || !data_dir.join("config.json").exists() {
            error!("The Mattrax configuration was not found!");
            error!("To setup a new server, run '{} init'.", binary_name());
            process::exit(1);
        }

        let local_config = if self.cloud {
            info!("Running in Mattrax cloud mode!");

            LocalConfig::from_env()
        } else {
            let Ok(local_config) = LocalConfig::load(data_dir.join("config.json"))
                .map_err(|err| error!("Failed to load local configuration: {err}"))
            else {
                process::exit(1);
            };

            local_config
        };

        let (db, config) = helpers::get_db_and_config(&local_config.db_url).await;
        let config = if let Some(config) = config {
            if self.cloud
                && config.internal_secret
                    != std::env::var("INTERNAL_SECRET").expect("INTERNAL_SECRET must be set")
            {
                error!("'INTERNAL_SECRET' does not match the one in the database.");
                process::exit(1);
            }

            config
        } else {
            if self.cloud {
                do_setup(
                    &db,
                    "mdm.mattrax.app".into(),
                    "enterpriseenrollment.mattrax.app".into(),
                    Some(CloudConfig {
                        frontend: Some("cloud.mattrax.app".into()),
                    }),
                    std::env::var("INTERNAL_SECRET").expect("INTERNAL_SECRET must be set"),
                )
                .await
            } else {
                error!(
                    "Failed to get Mattrax configuration from DB. You may need to run '{} init'.",
                    binary_name()
                );
                process::exit(1);
            }
        };

        #[cfg(all(not(debug_assertions), feature = "serve-web"))]
        web::spawn_process(&config.internal_secret);

        let config_manager = ConfigManager::new(db.clone(), local_config, config).unwrap();

        let port = {
            let config = config_manager.get();

            config
                .cloud
                .as_ref()
                .map(|_| 9000)
                .or(self.port)
                .unwrap_or({
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

        let state = {
            let config = config_manager.get();
            let identity_key = KeyPair::from_der_and_sign_algo(
                &config.certificates.identity_key.clone().try_into().unwrap(),
                &PKCS_ECDSA_P256_SHA256,
            )
            .unwrap();
            let shared_secret = Hmac::new_from_slice(config.internal_secret.as_bytes()).unwrap();

            let identity_cert_rcgen = CertificateParams::from_ca_cert_der(
                &config.certificates.identity_cert.clone().into(),
            )
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
            })
        };

        let router = api::mount(state.clone());

        let config = config_manager.get();

        if self.cloud {
            std::fs::write(
                "/mtls-roots.pem",
                config.certificates.identity_pool.join(""),
            )
            .unwrap();

            std::process::Command::new("/caddy")
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
        axum::serve(listener, router)
            .with_graceful_shutdown(shutdown_signal())
            .await
            .unwrap();
    }
}

/// Determine the name of the current binary.
pub fn binary_name() -> String {
    std::env::args()
        .next()
        .unwrap_or(env!("CARGO_PKG_NAME").to_string())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
