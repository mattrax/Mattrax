//! Lambda entrypoint for Mattrax.
//! This is used by Mattrax's Cloud offering. We provide zero-guarantee that this will work in any other context.

use lambda_http::{run, tracing};
use tracing::error;

#[tokio::main]
async fn main() -> Result<(), ()> {
    tracing::init_default_subscriber();

    let args = mattrax::setup();

    let api = mx_core::Api::new(&args.database_url)
        .map_err(|err| error!("Failed to construct mx_core::Api: {err:?}"))?;

    std::env::set_var("AWS_LAMBDA_HTTP_IGNORE_STAGE_IN_PATH", "true");
    run(mx_api::mount(api))
        .await
        .map_err(|err| error!("Error serving the Lambda API: {err:?}"))
}
