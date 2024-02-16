use std::sync::Arc;

use axum::{
    extract::{Query, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use tracing::error;

use super::Context;

async fn internal_auth(
    State(state): State<Arc<Context>>,
    request: Request,
    next: Next,
) -> Response {
    if request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        == Some(&format!("Bearer {:?}", state.config.get().internal_secret))
    {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    next.run(request).await
}

#[derive(Deserialize)]
struct IssueCertParams {
    domain: String,
}

pub fn mount(state: Arc<Context>) -> Router<Arc<Context>> {
    Router::new()
        .route("/", get(|| async move { "Hello World" }))
        .layer(middleware::from_fn_with_state(state.clone(), internal_auth))
        .route(
            "/issue-cert",
            post(
                |State(state): State<Arc<Context>>, Query(query): Query<IssueCertParams>| async move {
                    // TODO: Rate limit all requests -> The cron job should trigger it again once Let's Encrypt rate limits have been reset
                    // TODO: Rate limit requests for a specific domain

                    match state.acme_tx.send(vec![query.domain]).await {
                        Ok(()) => StatusCode::OK,
                        Err(_) => {
                            error!("The ACME task has been killed. Unable to queue new certificate to be issued.");
                            StatusCode::INTERNAL_SERVER_ERROR
                        }
                    }
                },
            ),
        )
        .with_state(state)
}
