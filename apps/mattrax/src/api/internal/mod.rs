use std::sync::Arc;

use axum::{
    extract::State,
    http::{Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};

use super::Context;

async fn internal_auth<B>(
    State(state): State<Arc<Context>>,
    request: Request<B>,
    next: Next<B>,
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
        .with_state(state)
}
