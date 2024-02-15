use std::{convert::Infallible, net::SocketAddr, sync::Arc, time::Duration};

use axum::{http::Request, Router};
use hyper::body::Incoming;
use hyper_util::{
    rt::{TokioExecutor, TokioIo, TokioTimer},
    server::conn::auto,
};
use rustls_acme::{
    futures_rustls::{rustls::ServerConfig, LazyConfigAcceptor},
    is_tls_alpn_challenge,
};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio_util::compat::{FuturesAsyncReadCompatExt, TokioAsyncReadCompatExt};
use tower::{Service, ServiceExt};
use tracing::{debug, info, warn};

// TODO: Graceful shutdown
// TODO: `ConnectInfo` should include rustls client certificate

/// A HTTPS server.
/// This struct acts as the "glue code" between `axum`, `rustls` and `rustls-acme`.
/// Originally we used `axum-server` but I couldn't find a way to handle our mutual TLS requirements.
#[derive(Clone)]
pub struct Server {
    router: Router,
    // Used for connections from Let's Encrypt for the TLS-ALPN challenge.
    challenge_rustls_config: Arc<ServerConfig>,
    // Used for all other connections.
    // This is `Option` so it can be lazily set in `Self::start`.
    default_rustls_config: Option<Arc<ServerConfig>>,
}

impl Server {
    pub fn new(router: Router, challenge_rustls_config: Arc<ServerConfig>) -> Self {
        Self {
            router,
            challenge_rustls_config,
            default_rustls_config: None,
        }
    }

    pub async fn start(self, addr: SocketAddr, config: ServerConfig) {
        let listener = TcpListener::bind(addr).await.unwrap();
        info!(
            "Starting server listening on https://{}",
            listener.local_addr().unwrap_or(addr)
        );

        let this = Arc::new(Self {
            default_rustls_config: Some(Arc::new(config)),
            ..self
        });

        let mut make_service = this
            .router
            .clone()
            .into_make_service_with_connect_info::<SocketAddr>();
        while let Ok((stream, remote_addr)) = listener.accept().await {
            let tower_service = unwrap_infallible(make_service.call(remote_addr).await);
            let this = this.clone();

            tokio::spawn(async move {
                let stream = stream.compat();
                let start_handshake =
                    match LazyConfigAcceptor::new(Default::default(), stream).await {
                        Ok(v) => v,
                        Err(err) => {
                            warn!("Error starting TLS handshake with '{remote_addr}': {err:?}");
                            return;
                        }
                    };

                let client_hello = start_handshake.client_hello();
                let server_name = client_hello.server_name().map(ToString::to_string);
                if is_tls_alpn_challenge(&client_hello) {
                    debug!("received TLS-ALPN-01 validation request for '{server_name:?}'",);
                    match start_handshake
                        .into_stream(this.challenge_rustls_config.clone())
                        .await
                    {
                        Ok(tls) => {
                            let _ = tls.into_inner().0.into_inner().shutdown().await;
                        }
                        Err(err) => warn!("Error completing TLS-ALPN-01 validation request for '{server_name:?}': {err:?}"),
                    }
                    return;
                }

                // TODO: Should we fallback to the main cert??? I don't think we could do this without forking rustls.
                if server_name.is_none() {
                    warn!("Error: no server name in client hello from '{remote_addr}'");
                    return;
                }

                let stream = match start_handshake
                    .into_stream(this.default_rustls_config.clone().expect("trust me bro"))
                    .await
                {
                    Ok(v) => v,
                    Err(err) => {
                        warn!("Error doing TLS handshake with '{remote_addr}' for '{server_name:?}': {err:?}");
                        return;
                    }
                };

                if let Err(err) = auto::Builder::new(TokioExecutor::new())
                    .http1()
                    .header_read_timeout(Duration::from_secs(5))
                    .timer(TokioTimer::new())
                    .serve_connection(
                        TokioIo::new(stream.compat()),
                        hyper::service::service_fn(move |request: Request<Incoming>| {
                            tower_service.clone().oneshot(request)
                        }),
                    )
                    .await
                {
                    warn!("Error serving connection with '{remote_addr}': {err:?}");
                };
            });
        }
    }
}

fn unwrap_infallible<T>(result: Result<T, Infallible>) -> T {
    match result {
        Ok(value) => value,
        Err(err) => match err {},
    }
}
