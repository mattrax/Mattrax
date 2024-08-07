use std::sync::Arc;

use axum::{
    extract::{Query, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use tracing::error;

use super::Context;

pub mod sql;

async fn internal_auth(
    State(state): State<Arc<Context>>,
    request: Request,
    next: Next,
) -> Response {
    let authorization = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok());

    if authorization
        != Some(&format!(
            "Basic {}",
            STANDARD.encode(format!(":{}", &state.config.get().internal_secret))
        ))
        && authorization != Some(&format!("Bearer {}", state.config.get().internal_secret))
    {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    next.run(request).await
}

#[derive(Deserialize)]
struct IssueCertParams {
    domain: String,
}

#[derive(Deserialize)]
struct CaddyParams {
    domain: String,
    auth: String,
}

pub fn mount(state: Arc<Context>) -> Router<Arc<Context>> {
    Router::new()
        .route("/", get(|| async move { "Hello World" }))
        .route(
            "/issue-cert",
            post(
                |State(_state): State<Arc<Context>>, Query(_query): Query<IssueCertParams>| async move {
                    // TODO: Rate limit all requests -> The cron job should trigger it again once Let's Encrypt rate limits have been reset
                    // TODO: Rate limit requests for a specific domain

                    // match state.acme_tx.send(vec![query.domain]).await {
                    //     Ok(()) => StatusCode::OK,
                    //     Err(_) => {
                    //         error!("The ACME task has been killed. Unable to queue new certificate to be issued.");
                    //         StatusCode::INTERNAL_SERVER_ERROR
                    //     }
                    // }

                    // TODO: Not implemented as we are using Caddy On-Demand TLS for now. This will come back later though for self-hosting!
                    StatusCode::OK
                },
            ),
        )
        .route("/caddy", get(
            |State(state): State<Arc<Context>>, params: Query<CaddyParams>| async move {
                if state.config.get().internal_secret != params.auth {
                    return StatusCode::UNAUTHORIZED;
                }

                match state.db.get_domain(params.domain.clone()).await.map(|d| d.into_iter().next()) {
                    Ok(Some(_)) => StatusCode::OK,
                    Ok(None) => StatusCode::FORBIDDEN,
                    Err(err) => {
                        error!("Error checking domain {:?}: {err}", params.domain);
                        StatusCode::INTERNAL_SERVER_ERROR
                    }
                }
            }
        ))
        .layer(middleware::from_fn_with_state(state.clone(), internal_auth))
        // .route("/redeploy", get({
        //     #[derive(Deserialize)]
        //     struct RedeployArgs {
        //         secret: String,
        //     }

        //     |State(state): State<Arc<Context>>, Query(query): Query<RedeployArgs>| async move {
        //         if state.config.get().internal_secret != query.secret {
        //             return (StatusCode::UNAUTHORIZED, "Unauthorized");
        //         }

        //         // We delay slightly so the response is sent before the redeploy
        //         tokio::spawn(async move {
        //             tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        //             warn!("Mattrax redeploy triggered by user...");

        //             Command::new("systemctl")
        //             .arg("restart")
        //             .arg("mattrax")
        //             .output()
        //             .await
        //             .map_or_else(
        //                 |e| {
        //                     error!("Failed to restart the service: {}", e);
        //                     StatusCode::INTERNAL_SERVER_ERROR
        //                 },
        //                 |_| StatusCode::OK,
        //             );
        //         });

        //         return (StatusCode::OK, "ok!");
        //     }
        // })
        // )
        .with_state(state)
}

pub fn with_internal_auth<T>(state: Arc<Context>, router: Router<Arc<Context>>) -> Router<T> {
    router
        .layer(middleware::from_fn_with_state(state.clone(), internal_auth))
        .with_state(state)
}
