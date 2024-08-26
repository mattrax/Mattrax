use std::collections::HashMap;

use axum::{
    extract::Query,
    http::request::Parts,
    response::Html,
    routing::{get, post},
    Json, Router,
};
use axum_extra::extract::CookieJar;
use reqwest::StatusCode;
use serde::Deserialize;
use tracing::error;

pub(super) fn mount() -> Router {
    let router = mx_core::mount().build().unwrap();

    let ctx_fn = move |parts: &Parts| {
        // TODO: `CookieJar` should be able to go straight on the closure when Axum extractors are implemented properly in rspc
        let cookies = CookieJar::from_headers(&parts.headers);

        mx_core::Context {
            db: todo!(),
            session_id: cookies
                .get("auth_session")
                .map(|cookie| cookie.value().to_owned()),
        }
    };

    Router::new()
        .route("/", get(|| async move { Html(r#"<pre><h1>Mattrax MDM Platform</h1><a href="https://mattrax.app">Home</a><br /><a href="/docs">Documentation</a></pre>"#) }))
         .route("/", get(|| async move { Html(r#"<pre><h1>Mattrax MDM Platform</h1><a href="https://mattrax.app">Home</a><br /><a href="/docs">Documentation</a></pre>"#) }))
        .route("/auth", get(|Query(query): Query<HashMap<String, String>>| async move {
            let appru = query.get("appru").map(String::to_string).unwrap_or_else(|| "".to_string());

            Html(format!(r#"<h3>MDM Federated Login</h3>
                <form method="post" action="{appru}">
                    <p><input type="hidden" name="wresult" value="TODOSpecialTokenWhichVerifiesAuth" /></p>
                    <input type="submit" value="Login" />
                </form>"#))
        }))
        .route("/enroll", get(|| async move { Html(r#"<a href="ms-device-enrollment:?mode=mdm&username=oscar@otbeaumont.me&servername=https://playground.otbeaumont.me">Enroll</a>"#) }))
        .nest(
            "/rspc",
            rspc_axum::Endpoint::new(router.clone(), ctx_fn.clone()),
        )
        .nest("/api", rspc_openapi::mount(router, ctx_fn))
    // TODO: 404 handler
}

fn openapi() -> Router {
    Router::new()
        .route(
            "/docs",
            get(|| async move { Html(include_str!("../static/scalar.html")) }),
        )
        .route(
            "/openapi.yaml",
            get(|| async move { Html(include_str!("../static/openapi.yaml")) }),
        )
}

#[derive(Deserialize)]
struct FeedbackRequest {
    content: String,
}

fn meta() -> Router {
    let client = reqwest::Client::new(); // TODO: Set user agent
    let feedback_discord_webhook = std::env::var("FEEDBACK_DISCORD_WEBHOOK_URL");

    Router::new().route(
        "/api/feedback",
        post(|body: Json<FeedbackRequest>| async move {
            // TODO: Authentication

            if let Ok(url) = feedback_discord_webhook {
                let body = body
                    .content
                    .split("\n")
                    .map(|l| format!("> {}", l))
                    .collect::<Vec<String>>();
                // body.push(format!("`{}`", ctx.account.email)); // TODO

                match client
                    .post(url)
                    .form(&[("content", body.join("\n"))])
                    .send()
                    .await
                {
                    Ok(r) if !r.status().is_success() => {
                        error!(
                            "Error sending feedback to Discord: Got status {}",
                            r.status()
                        );
                        return (StatusCode::INTERNAL_SERVER_ERROR, "error");
                    }
                    Err(err) => {
                        error!("Error sending feedback to Discord: {err:?}");
                        return (StatusCode::INTERNAL_SERVER_ERROR, "error");
                    }
                    _ => {}
                }
            } else {
                return (StatusCode::CONFLICT, "disabled");
            }

            (StatusCode::OK, "ok")
        }),
    )
}
