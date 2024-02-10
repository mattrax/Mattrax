use std::{
    fs,
    net::{Ipv6Addr, SocketAddr},
    path::PathBuf,
    sync::Arc,
};

use rustls_acme::{
    caches::DirCache,
    futures_rustls::rustls::{
        server::AllowAnyAnonymousOrAuthenticatedClient, RootCertStore, ServerConfig,
    },
    AcmeConfig,
};
use tokio_stream::StreamExt;
use tracing::{debug, error, info, warn};

use crate::{
    api,
    config::{AcmeServer, ConfigManager},
};

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

        let state = Arc::new(api::Context {
            config: config_manager,
            is_dev: cfg!(debug_assertions),
            server_port: port,
        });

        let router = api::mount(state.clone());

        // TODO: Graceful shutdown

        let config = state.config.get().clone();
        if config.domain == "localhost" {
            let addr = SocketAddr::from((Ipv6Addr::UNSPECIFIED, port));
            info!("Listening on http://{addr}");
            axum_server::bind(addr)
                .serve(router.into_make_service())
                .await
                .unwrap();
        } else {
            let mut state = AcmeConfig::new(&[config.domain.clone()])
                .contact(&[format!("mailto:{}", config.acme_email)])
                .cache_option(Some(DirCache::new(data_dir.join("acme"))))
                .directory_lets_encrypt(matches!(config.acme_server, AcmeServer::Production))
                .state();

            let acceptor = state.axum_acceptor(Arc::new(
                ServerConfig::builder()
                    .with_safe_defaults()
                    .with_no_client_auth()
                    .with_cert_resolver(state.resolver()),
            ));

            let acceptor2 = state.axum_acceptor(Arc::new(
                ServerConfig::builder()
                    .with_safe_defaults()
                    .with_client_cert_verifier(
                        AllowAnyAnonymousOrAuthenticatedClient::new({
                            // TODO: Allow this to be rotated at runtime for renewal
                            let mut root = RootCertStore::empty();
                            let _ = root.add_parsable_certificates(&[fs::read(
                                data_dir.join("certs").join("identity.der"),
                            )
                            .unwrap()]); // TODO: Check result that the cert was valid

                            root
                        })
                        .boxed(),
                    )
                    .with_cert_resolver(state.resolver()),
            ));

            tokio::spawn(async move {
                loop {
                    match state.next().await.unwrap() {
                        Ok(ok) => debug!("event: {:?}", ok),
                        Err(err) => error!("error: {:?}", err),
                    }
                }
            });

            // TODO: Mutual-TLS is breaking the Windows enrollment flow so an extra port. Fix this so they can be on the same port.
            tokio::spawn({
                let router = router.clone();
                async move {
                    let addr = SocketAddr::from((Ipv6Addr::UNSPECIFIED, 8443)); // TODO: Configurable port
                    info!("Listening on https://{addr}");
                    axum_server::bind(addr)
                        .acceptor(acceptor2)
                        .serve(router.into_make_service())
                        .await
                        .unwrap();
                }
            });

            let addr = SocketAddr::from((Ipv6Addr::UNSPECIFIED, port));
            info!("Listening on https://{addr}");
            axum_server::bind(addr)
                .acceptor(acceptor)
                .serve(router.into_make_service())
                .await
                .unwrap();
        }
    }
}

/// Determine the name of the current binary.
pub fn binary_name() -> String {
    std::env::args()
        .next()
        .unwrap_or(env!("CARGO_PKG_NAME").to_string())
}
