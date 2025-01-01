use axum::{response::Html, routing::get, Router};

use crate::utils::{include_static, Static};

static INDEX_HTML: Static = include_static!("index.html");

pub fn mount() -> Router {
    Router::new().route("/", get(|| async { Html(INDEX_HTML.get()) }))
}
