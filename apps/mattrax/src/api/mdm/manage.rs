use std::sync::Arc;

use axum::{routing::post, Router};

use crate::api::Context;

pub fn mount(state: Arc<Context>) -> Router<Arc<Context>> {
    Router::new().route(
        "/Manage.svc",
        post(|| async move {
            // println!("{:?}", body);

            // body: String

            // TODO: Mutual TLS authentication

            // TODO: application/vnd.syncml.dm+xml
            // TODO: application/vnd.syncml.dm+wbxml

            todo!();
        }),
    )
    // TODO: `ManagementServer/ServerList.svc` -> What does this do again???
}
