use std::{sync::Arc, time::Duration};

use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::Response,
    routing::{get, post},
    Json, Router,
};
use axum_extra::extract::CookieJar;
use chrono::prelude::*;
use hyper::StatusCode;
use mx_db::GetSessionAndUserResult;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast::{self, error::RecvError};
use tracing::{error, warn};

use super::{internal::with_internal_auth, Context};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvalidationEvent {
    pub org_slug: String,
    pub tenant_slug: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Msg {
    // request
    SetOrg {
        #[serde(rename = "orgSlug")]
        org_slug: String,
    },

    // response
    Error {
        message: String,
    },
    Invalidation(InvalidationEvent),
}

impl Msg {
    pub async fn send(&self, socket: &mut WebSocket) {
        socket
            .send(serde_json::to_string(self).expect("is valid struct").into())
            .await
            .ok();
    }
}

pub fn mount(state: Arc<Context>) -> Router<Arc<Context>> {
    let (tx, rx) = broadcast::channel(512);
    let rx = Arc::new(rx);

    let internal_router = Router::new().route(
        "/invalidate",
        post(|Json(event): Json<InvalidationEvent>| async move {
            tx.send(event).ok();
        }),
    );

    Router::new()
        .merge(with_internal_auth(state.clone(), internal_router))
        .route(
            "/",
            get(
                move |State(state): State<Arc<Context>>,
                      cookies: CookieJar,
                      ws: WebSocketUpgrade| async move {
                    let auth = authenticate(&state, cookies).await?;
                    let mut rx = rx.resubscribe();

                    Ok::<Response, Response>(ws.on_failed_upgrade(|error| {
                            warn!("Error upgrading websocket: {error:?}");
                        })
                        .on_upgrade(move |mut socket| async move {
                        let mut active_org_slug = None;

                        let mut timer = tokio::time::interval(Duration::from_secs(5 * 30));
                        loop {
                            tokio::select! {
                                Some(Ok(msg)) = socket.recv() => {
                                    let msg = match msg {
                                        Message::Text(msg) => serde_json::from_str(&msg),
                                        Message::Binary(msg) => serde_json::from_slice(&msg),
                                        Message::Ping(_) => continue,
                                        Message::Pong(_) => continue,
                                        Message::Close(_) => break,
                                    };
                                    let msg = match msg {
                                        Ok(msg) => msg,
                                        Err(err) => {
                                            Msg::Error { message: format!("{err}") }.send(&mut socket).await;
                                            continue
                                        }
                                    };

                                    match msg {
                                        Msg::SetOrg { org_slug } => {
                                            match state.db.is_org_member(org_slug.clone(), auth.account.pk).await {
                                                Ok(result) if result.len() != 0 => {
                                                    active_org_slug = Some(org_slug);
                                                },
                                                Ok(_) => {
                                                    Msg::Error { message: format!("not a member of org") }.send(&mut socket).await;
                                                    active_org_slug = None;
                                                    continue
                                                },
                                                Err(err) => {
                                                    error!("failed to check if user is a member of org: {err}");
                                                    Msg::Error { message: format!("failed to check org permissions") }.send(&mut socket).await;
                                                    active_org_slug = None;
                                                    continue
                                                }
                                            }
                                            timer.reset_immediately();
                                        }
                                        Msg::Error { .. } => continue,
                                        Msg::Invalidation { .. } => continue,
                                    }
                                }
                                event = rx.recv() => {
                                    let event = match event {
                                        Ok(event) => event,
                                        Err(RecvError::Closed) => break,
                                        Err(RecvError::Lagged(_)) => {
                                            warn!("invalidation broadcast channel lagged");
                                            continue;
                                        },
                                    };

                                    if let Some(active_org) = &active_org_slug {
                                        if event.org_slug == *active_org {
                                            Msg::Invalidation(event).send(&mut socket).await;
                                        }
                                    }
                                }
                                _ = timer.tick() => {
                                    if let Some(org_slug) = active_org_slug {
                                        match state.db.is_org_member(org_slug.clone(), auth.account.pk).await {
                                            Ok(result) if result.len() != 0 => {
                                                active_org_slug = Some(org_slug);
                                            },
                                            Ok(_) => {
                                                Msg::Error { message: format!("not a member of org") }.send(&mut socket).await;
                                                active_org_slug = None;
                                                continue
                                            },
                                            Err(err) => {
                                                error!("failed to check if user is a member of org: {err}");
                                                Msg::Error { message: format!("failed to check org permissions") }.send(&mut socket).await;
                                                active_org_slug = None;
                                                continue
                                            }
                                        }
                                    }
                                }
                                // TODO: Close the connection upon graceful shutdown signal
                            }
                        }
                    }))
                },
            ),
        )
        .with_state(state)
}

/// this function will check and return the session and the user.
///
/// This logic *must* match Lucia Auth's logic as they are in charge of creating the session.
pub async fn authenticate(
    state: &Context,
    cookies: CookieJar,
) -> Result<GetSessionAndUserResult, Response> {
    let session = cookies.get("auth_session").ok_or_else(|| {
        Response::builder()
            .status(StatusCode::UNAUTHORIZED)
            .body("Unauthorized".into())
            .expect("invalid response")
    })?;

    let result = state
        .db
        .get_session_and_user(session.value().into())
        .await
        .map_err(|err| {
            warn!("failed to get session and user from db: {err:?}");
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body("Internal Server Error".into())
                .expect("invalid response")
        })?
        .into_iter()
        .next()
        .ok_or_else(|| {
            Response::builder()
                .status(StatusCode::UNAUTHORIZED)
                .body("Unauthorized".into())
                .expect("invalid response")
        })?;

    if result.session.expires_at < Utc::now().naive_utc() {
        return Err(Response::builder()
            .status(StatusCode::UNAUTHORIZED)
            .body("Unauthorized".into())
            .expect("invalid response"));
    }

    Ok(result)
}
