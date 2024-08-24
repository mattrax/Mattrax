use std::sync::Arc;

use axum::{
    extract::{Request, State},
    routing::post,
    Router,
};
use http::request::Parts;
use lambda_http::{request::RequestContext, RequestExt};

use crate::Application;

pub fn mount<T: Application>() -> Router<Arc<T>> {
    Router::new().route(
        "/Manage.svc",
        post(
            |State(app): State<Arc<T>>, req: Parts, body: String| async move {
                // TODO: Abstract this onto `Application` so it can work locally or with Lambda
                let ctx = match req.request_context_ref() {
                    Some(RequestContext::ApiGatewayV2(ctx)) => ctx.authentication.clone(),
                    _ => todo!(),
                };

                println!("{req:?} {ctx:?}"); // TODO

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
