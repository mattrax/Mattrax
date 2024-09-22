use std::{sync::Arc, time::Duration};

use axum::{
    extract::{MatchedPath, Request},
    http::{HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{Redirect, Response},
    routing::get,
    Router,
};
use tower_http::trace::TraceLayer;
use tracing::{info_span, Span};

mod sql;

pub struct Context {
    pub internal_secret: String,
    pub db: mx_db::Db,
}

impl Context {
    /// Load the Mattrax Cloud context from environment variables
    pub fn from_env() -> Result<Context, String> {
        Ok(Context {
            internal_secret: std::env::var("INTERNAL_SECRET")
                .map_err(|_| "'INTERNAL_SECRET' must be set")?,
            db: mx_db::Db::new(
                &std::env::var("DATABASE_URL").map_err(|_| "'DATABASE_URL' must be set")?,
            ),
        })
    }

    /// Mount the Mattrax Cloud API onto an Axum router
    pub fn mount(self) -> Router {
        let this = Arc::new(self);
        tracing_subscriber::fmt().init();
        std::panic::set_hook(Box::new(move |panic| tracing::error!("{panic}")));

        Router::new()
            .route(
                "/",
                get(|| async move { Redirect::temporary("https://mattrax.app") }),
            )
            .route(
                "/_/version",
                get(|| async move {
                    format!(
                        "Mattrax MDM {} ({})",
                        env!("CARGO_PKG_VERSION"),
                        env!("GIT_HASH")
                    )
                }),
            )
            .nest(
                "/psdb.v1alpha1.Database",
                sql::mount().route_layer(middleware::from_fn_with_state(this.clone(), sql::auth)),
            )
            .with_state(this.clone())
            .layer(
                TraceLayer::new_for_http()
                    .make_span_with(|request: &axum::http::Request<_>| {
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
            )
            .route_layer(middleware::from_fn(headers))
            .fallback(|| async move { (StatusCode::NOT_FOUND, "404: Not Found") })
    }
}

async fn headers(request: Request, next: Next) -> Response {
    let (method, uri) = (request.method().clone(), request.uri().clone());
    let mut response = next.run(request).await;

    #[cfg(debug_assertions)]
    tracing::debug!("{method} {uri} - {:?}", response.status());

    let headers = response.headers_mut();
    headers.append("Server", HeaderValue::from_static("Mattrax"));
    // if cgg!(debug_assertions) {
    //     headers.append(
    //         "Strict-Transport-Security",
    //         HeaderValue::from_static("max-age=31536000; preload"),
    //     );
    // }
    headers.append("X-Frame-Options", HeaderValue::from_static("DENY"));
    headers.append(
        "X-Content-Type-Options",
        HeaderValue::from_static("nosniff"),
    );
    headers.append(
        "Referrer-Policy",
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );

    response
}
