use axum::{
    extract::{MatchedPath, Request},
    response::Response,
};
use rcgen::{CertificateParams, KeyPair};
use std::{env::set_var, time::Duration};
use tower_http::trace::TraceLayer;
use tracing::{info_span, Span};

mod api;
mod mdm;
mod sql;

#[tokio::main]
async fn main() -> Result<(), lambda_http::Error> {
    tracing_subscriber::fmt().init();
    std::panic::set_hook(Box::new(move |panic| tracing::error!("{panic}")));

    // If you use API Gateway stages, the Rust Runtime will include the stage name
    // as part of the path that your application receives. We don't want this!
    set_var("AWS_LAMBDA_HTTP_IGNORE_STAGE_IN_PATH", "true");

    let manage_domain = std::env::var("MANAGE_DOMAIN").expect("'MANAGE_DOMAIN' must be set");
    let enrollment_domain =
        std::env::var("ENROLLMENT_DOMAIN").expect("'ENROLLMENT_DOMAIN' must be set");
    let cert = std::env::var("IDENTITY_CERT").expect("'IDENTITY_CERT' must be set");
    let key = std::env::var("IDENTITY_KEY").expect("'IDENTITY_KEY' must be set");

    let key = KeyPair::from_pem(&key).unwrap();
    let cert = CertificateParams::from_ca_cert_pem(&cert)
        .unwrap()
        // TODO: https://github.com/rustls/rcgen/issues/274
        .self_signed(&key)
        .unwrap();

    let router = mx_manage::mount(mdm::App {
        manage_domain,
        enrollment_domain,
        cert,
        key,
    })
    .merge(api::mount())
    .layer(
        TraceLayer::new_for_http()
            .make_span_with(|request: &Request<_>| {
                let matched_path = request
                    .extensions()
                    .get::<MatchedPath>()
                    .map(MatchedPath::as_str);

                info_span!(
                    "http_request",
                    method = ?request.method(),
                    matched_path,
                    some_other_field = tracing::field::Empty,
                )
            })
            .on_response(|resp: &Response, latency: Duration, _span: &Span| {
                #[cfg(debug_assertions)]
                tracing::info!("responded with {} in {:?}", resp.status(), latency);
            }),
    );

    lambda_http::run(router).await
}
