use std::{convert::Infallible, net::SocketAddr, sync::Arc, time::Duration};

use axum::{http::Request, Router};
use better_acme::{AcceptorAction, Acme, FsStore};
use futures_rustls::LazyConfigAcceptor;
use hyper::body::Incoming;
use hyper_util::{
    rt::{TokioExecutor, TokioIo, TokioTimer},
    server::conn::auto,
};
use tokio::net::TcpListener;
use tokio_util::compat::{FuturesAsyncReadCompatExt, TokioAsyncReadCompatExt};
use tower::{Service, ServiceExt};
use tracing::{info, warn};

use crate::{api::ConnectInfoTy, cli::serve::acme::MattraxAcmeStore};

// TODO: Graceful shutdown

/// A HTTPS server.
/// This is the "glue code" between `axum`, `rustls` and `better-acme`.
pub async fn server(router: Router, acme: Arc<Acme<FsStore<MattraxAcmeStore>>>, addr: SocketAddr) {
    let listener = TcpListener::bind(addr).await.unwrap();
    info!(
        "Starting server listening on https://{}",
        listener.local_addr().unwrap_or(addr)
    );

    let acme = Arc::new(acme);
    let make_service = router
        .clone()
        .into_make_service_with_connect_info::<ConnectInfoTy>();
    while let Ok((stream, remote_addr)) = listener.accept().await {
        let mut make_service = make_service.clone();
        let acme = acme.clone();

        tokio::spawn(async move {
            let stream = stream.compat();
            let start_handshake = match LazyConfigAcceptor::new(Default::default(), stream).await {
                Ok(v) => v,
                Err(err) => {
                    warn!("Error starting TLS handshake with {remote_addr}: {err:?}");
                    return;
                }
            };

            let Ok((domain, config, action)) = acme
                .acceptor(start_handshake.client_hello())
                .await
                .map_err(|err| {
                    warn!("Error accepting the TLS for connection with {remote_addr}: {err:?}");
                })
            else {
                return;
            };

            let Ok(stream) = start_handshake.into_stream(config).await.map_err(|err| {
                warn!("Error accepting the TLS for connection with {remote_addr} for {domain}: {err:?}");
            }) else {
                return;
            };

            if let AcceptorAction::ServedChallenge = action {
                return;
            }

            let client_cert = stream
                .get_ref()
                .1
                .peer_certificates()
                .map(|i| i.iter().map(|c| c.clone().into_owned()).collect::<Vec<_>>());

            let tower_service = unwrap_infallible(
                make_service
                    .call(ConnectInfoTy {
                        remote_addr,
                        client_cert,
                    })
                    .await,
            );
            if let Err(err) = auto::Builder::new(TokioExecutor::new())
                .http1()
                .header_read_timeout(Duration::from_secs(5))
                .timer(TokioTimer::new())
                .serve_connection_with_upgrades(
                    TokioIo::new(stream.compat()),
                    hyper::service::service_fn(move |request: Request<Incoming>| {
                        tower_service.clone().oneshot(request)
                    }),
                )
                .await
            {
                warn!("Error serving connection with {remote_addr}: {err:?}");
            };
        });
    }
}

fn unwrap_infallible<T>(result: Result<T, Infallible>) -> T {
    match result {
        Ok(value) => value,
        Err(err) => match err {},
    }
}
