use std::sync::Arc;

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};

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

pub fn mount(state: Arc<Context>) -> Router<Arc<Context>> {
    Router::new()
        .route("/", get(|| async move { "Hello World" }))
        .layer(middleware::from_fn_with_state(state.clone(), internal_auth))
        // .post("/issue-cert", post(|| {}))
        .with_state(state)
}
