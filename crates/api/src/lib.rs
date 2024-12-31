//! The REST and MDM API for Mattrax.

use axum::{routing::get, Router};

pub fn mount() -> Router {
    Router::new().route("/", get(|| async { "Hello, World!" }))
    // TODO: 404 for API
    // TODO: Health endpoint
}
