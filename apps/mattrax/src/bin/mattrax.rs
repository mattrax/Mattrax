//! The standard entrypoint for Mattrax.

use tokio::net::TcpListener;
use tracing::{error, info};

#[tokio::main]
async fn main() {
    let args = mattrax::setup();

    if let Ok(listener) = TcpListener::bind(args.listen_addr).await.map_err(|err| {
        error!(
            "Failed to bind to listen address {:?} with error: {err:?}",
            args.listen_addr
        )
    }) {
        info!(
            "Listening at: {:?}",
            listener.local_addr().unwrap_or(args.listen_addr)
        );
        axum::serve(listener, mx_api::mount())
            .await
            // I checked and I think this is actually unreachable.
            .expect("Error with Axum server");
    }
}
