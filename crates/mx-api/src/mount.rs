use std::time::Instant;

use axum::{
    extract::Request,
    http::{HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{Html, Response},
    routing::{any, get},
    Router,
};
use tracing::{field, info_span, Instrument, Span};

use crate::{
    utils::{include_static, Static},
    Core,
};

static INDEX_HTML: Static = include_static!("index.html");

pub fn mount(core: Core) -> Router {
    Router::new()
        .route("/", get(|| async { Html(INDEX_HTML.get()) }))
        .route(
            "/health",
            get(|| async {
                // TODO: Check with the database
                StatusCode::NO_CONTENT
            }),
        )
        .nest("/api", crate::api::mount())
        .merge(crate::dm::mount(core))
        // This will match everything bar `/` and is used as the 404 fallback.
        // We intentionally don't use `.fallback` as middleware don't apply to it.
        .route(
            "/{*fallback}",
            any(|| async move { (StatusCode::NOT_FOUND, "404: Not Found") }),
        )
        .route_layer(middleware::from_fn(headers_and_tracing))
}

async fn headers_and_tracing(req: Request, next: Next) -> Response {
    let span = info_span!("REQUEST", method = %req.method(), uri = %req.uri(), status = field::Empty, elapsed = field::Empty);
    let now = Instant::now();
    async move {
        let mut response = next.run(req).await;
        let took = now.elapsed();
        Span::current()
            .record("status", response.status().as_u16())
            .record("elapsed", format!("{took:?}"));
        tracing::info!("request");

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
    .instrument(span)
    .await
}
