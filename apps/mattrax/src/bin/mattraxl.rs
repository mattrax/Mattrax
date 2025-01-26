//! Lambda entrypoint for Mattrax.
//! This is used by Mattrax's Cloud offering. We provide zero-guarantee that this will work in any other context.

use axum::{extract::Request, http::StatusCode, routing::post};
use lambda_http::{request::RequestContext, run, tracing, RequestExt};
use tracing::error;

#[tokio::main]
async fn main() -> Result<(), ()> {
    tracing::init_default_subscriber();

    let args = mattrax::setup();

    let api = mx_api::Core::new(&args.database_url, args.secret.into_bytes(), args.origin)
        .map_err(|err| error!("Failed to construct mx_core::Api: {err:?}"))?;

    std::env::set_var("AWS_LAMBDA_HTTP_IGNORE_STAGE_IN_PATH", "true");
    run(api.mount().route(
        // Any event that `lambda_http` fails to match will be sent here (`pass_through` feature).
        "/events",
        post(|req: Request| async move {
            // This ensures the endpoint is being invoked by another AWS service not a user.
            let RequestContext::PassThrough = req.request_context() else {
                return StatusCode::FORBIDDEN;
            };

            api.cron().await;
            StatusCode::NO_CONTENT
        }),
    ))
    .await
    .map_err(|err| error!("Error serving the Lambda API: {err:?}"))
}
