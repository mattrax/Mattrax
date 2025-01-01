//! Lambda entrypoint for Mattrax.
//! This is used by Mattrax's Cloud offering. We provide zero-guarantee that this will work in any other context.

use lambda_http::run;
use tracing::error;

#[tokio::main]
async fn main() {
    mattrax::setup();

    std::env::set_var("AWS_LAMBDA_HTTP_IGNORE_STAGE_IN_PATH", "true");
    if let Err(err) = run(mx_api::mount()).await {
        error!("Error serving the Lambda API: {err:?}");
    }

    // if let Ok(listener) = TcpListener::bind(command.listen_addr).await.map_err(|err| {
    //     error!(
    //         "Failed to bind to listen address {:?} with error: {err:?}",
    //         command.listen_addr
    //     )
    // }) {
    //     info!(
    //         "Listening at: {:?}",
    //         listener.local_addr().unwrap_or(command.listen_addr)
    //     );
    //     axum::serve(listener, mx_api::mount())
    //         .await
    //         // I checked and I think this is actually unreachable.
    //         .expect("Error with Axum server");
    // }
}
