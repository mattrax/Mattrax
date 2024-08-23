use std::sync::Arc;

use axum::{routing::post, Router};

use crate::Application;

pub fn mount<T: Application>() -> Router<Arc<T>> {
    Router::new().route(
        "/Manage.svc",
        post(
            //ConnectInfo(info): ConnectInfo<ConnectInfoTy>,
            // State(state): State<Arc<Context>>,
            |body: String| async move {
                // TODO: Mutual TLS authentication

                // TODO: Hook back up management stuff
                // let result = mx_windows::handler(
                //     &state.db,
                //     &state.identity_cert_x509,
                //     body,
                //     info.client_cert.and_then(|x| x.into_iter().next()),
                // )
                // .await;

                // (
                //     [(header::CONTENT_TYPE, "application/vnd.syncml.dm+xml")],
                //     result,
                // )
                //     .into_response()
                unimplemented!()
            },
        ),
    )
}
