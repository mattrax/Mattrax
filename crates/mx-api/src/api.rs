use std::{collections::HashMap, sync::Arc};

use axum::{http::StatusCode, response::Html, routing::get, Json, Router};
use serde::Serialize;
use serde_json::json;

use crate::{
    utils::{include_static, Static},
    Core,
};

mod tenant;

static SCALAR_HTML: Static = include_static!("scalar.html");
static OPENAPI_JSON: Static = include_static!("openapi.json");

pub(crate) fn mount() -> Router<Core> {
    Router::new()
        .route("/", get(|| async { Html(SCALAR_HTML.get()) }))
        .route(
            "/openapi",
            get({
                let spec = OPENAPI_JSON.derive(|s| {
                    let mut spec: HashMap<String, serde_json::Value> =
                        serde_json::from_str(s).unwrap();
                    spec.insert("openapi".into(), "3.1.0".into());
                    spec.insert(
                        "info".into(),
                        json!({
                          "title": "Mattrax MDM",
                          "version": crate::VERSION,
                        }),
                    );
                    Arc::new(spec)
                });

                || async move { Json(spec().clone()) }
            }),
        )
        .nest("/v1", Router::new().nest("/tenant", tenant::mount()))
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
