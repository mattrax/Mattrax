use std::sync::Arc;

use axum::{extract::State, response::IntoResponse, routing::post, Router};
use http::{header, request::Parts};

use crate::Application;

pub fn mount<T: Application>() -> Router<Arc<T>> {
    Router::new().route(
        "/Manage.svc",
        post(
            |State(app): State<Arc<T>>, req: Parts, body: String| async move {
                let auth = app.authenticate_management_session(&req).unwrap(); // TODO: error handling
                let Some(auth) = auth else {
                    return todo!();
                };

                let result = app.manage(auth, body).await.unwrap(); // TODO: error handling

                (
                    [(header::CONTENT_TYPE, "application/vnd.syncml.dm+xml")],
                    result,
                )
                    .into_response()
            },
        ),
    )
}
