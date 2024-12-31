//! The REST and MDM API for Mattrax.

use axum::{http::StatusCode, response::Html, routing::get, Json, Router};
use serde::Serialize;
use serde_json::json;

pub fn mount() -> Router {
    Router::new()
        .route("/", get(|| async { "Mattrax MDM!" }))
        .route(
            "/health",
            get(|| async {
                // TODO: Check with the database
                StatusCode::NO_CONTENT
            }),
        )
        .nest("/api", api())
}

fn api() -> Router {
    Router::new()
        .route(
            "/",
            get(|| async { Html(include_str!("../static/scalar.html")) }),
        )
        .route(
            "/openapi",
            get(|| async {
                Json(json!({
                  "openapi": "3.1.0",
                  "info": {
                    "title": "Mattrax MDM",
                    "version": mx_core::VERSION,
                  },
                  "paths": {}
                }))
            }),
        )
        .fallback(|| async move {
            (
                StatusCode::NOT_FOUND,
                Json(Error {
                    message: "Not Found".to_string(),
                }),
            )
        })
}

#[derive(Serialize)]
struct Error {
    message: String,
}
