use std::sync::Arc;

use axum::{
    extract::{ConnectInfo, State},
    response::IntoResponse,
    routing::post,
    Router,
};
use hyper::header;

use crate::api::{ConnectInfoTy, Context};

pub fn mount(_state: Arc<Context>) -> Router<Arc<Context>> {
    Router::new().route(
        "/Manage.svc",
        post(
            |ConnectInfo(info): ConnectInfo<ConnectInfoTy>,
             State(state): State<Arc<Context>>,
             body: String| async move {
                let result = mx_windows::handler(
                    &state.db,
                    &state.identity_cert_x509,
                    body,
                    info.client_cert.and_then(|x| x.into_iter().nth(0)),
                )
                .await;

                (
                    [(header::CONTENT_TYPE, "application/vnd.syncml.dm+xml")],
                    result,
                )
                    .into_response()
            },
        ),
    )
}
