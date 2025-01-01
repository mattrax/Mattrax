use std::{collections::HashMap, sync::Arc};

use axum::{http::StatusCode, response::Html, routing::get, Json, Router};
use serde::Serialize;
use serde_json::json;

pub(crate) fn mount() -> Router {
    Router::new()
        .route(
            "/",
            get(|| async { Html(include_str!("../static/scalar.html")) }),
        )
        .route(
            "/openapi",
            get({
                let mut spec: HashMap<String, serde_json::Value> =
                    serde_json::from_str(include_str!("../static/openapi.json")).unwrap();
                spec.insert("openapi".into(), "3.1.0".into());
                spec.insert(
                    "info".into(),
                    json!({
                      "title": "Mattrax MDM",
                      "version": mx_core::VERSION,
                    }),
                );
                let spec = Arc::new(spec);

                || async move { Json(spec.clone()) }
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
