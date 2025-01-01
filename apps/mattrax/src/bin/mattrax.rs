//! The standard entrypoint for Mattrax.

use tokio::{net::TcpListener, signal};
use tracing::{error, info};

#[tokio::main]
async fn main() -> Result<(), ()> {
    let args = mattrax::setup();

    let listener = TcpListener::bind(args.listen_addr).await.map_err(|err| {
        error!(
            "Failed to bind to listen address {:?} with error: {err:?}",
            args.listen_addr
        )
    })?;

    let api = mx_core::Api::new(&args.database_url)
        .map_err(|err| error!("Failed to initialise database: {err:?}"))?;

    api.migrate()
        .await
        .map_err(|err| error!("Failed to connect or run migrations on database: {err:?}"))?;

    info!(
        "Listening at: http://{:?}",
        listener.local_addr().unwrap_or(args.listen_addr)
    );
    axum::serve(listener, mx_api::mount(api))
        .with_graceful_shutdown(shutdown_signal())
        .await
        // I checked and I think this is actually unreachable.
        .expect("Error with Axum server");

    Ok(())
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
