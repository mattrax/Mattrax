use std::time::Instant;

use axum::{
    extract::{Request, State},
    http::{HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{Html, Response},
    routing::{any, get},
    Json, Router,
};
use serde_json::json;
use sqlx::Executor;
use tracing::{field, info_span, Instrument, Span};

use crate::{
    utils::{include_static, Static},
    Core,
};

static INDEX_HTML: Static = include_static!("index.html");

pub fn mount() -> Router<Core> {
    Router::<Core>::new()
        .route("/", get(|| async { Html(INDEX_HTML.get()) }))
        .route(
            "/health",
            get(|State(core): State<Core>| async move {
                let result = core.db.execute("SELECT 1").await;

                let status = if result.is_ok() {
                    StatusCode::OK
                } else {
                    StatusCode::INTERNAL_SERVER_ERROR
                };

                (
                    status,
                    Json(json!({
                        "db": result.is_ok(),
                    })),
                )
            }),
        )
        .nest("/api", crate::api::mount())
        .merge(crate::dm::mount())
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
