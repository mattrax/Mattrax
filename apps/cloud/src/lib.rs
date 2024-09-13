use std::{collections::HashMap, sync::Arc, time::Duration};

use axum::{
    extract::{MatchedPath, Query, Request},
    http::HeaderValue,
    middleware::{self, Next},
    response::{Html, Redirect, Response},
    routing::get,
    Router,
};
use rcgen::{Certificate, CertificateParams, KeyPair};
use tower_http::trace::TraceLayer;
use tracing::{info_span, Span};

mod api;
mod mdm;
mod sql;

pub struct Context {
    pub manage_domain: String,
    pub enrollment_domain: String,
    pub cert: Certificate,
    pub key: KeyPair,
    pub client: reqwest::Client,
    pub db: mx_db::Db,
}

impl Context {
    /// Load the Mattrax Cloud context from environment variables
    pub fn from_env() -> Result<Context, String> {
        let key = KeyPair::from_pem(
            &std::env::var("IDENTITY_KEY").map_err(|_| "IDENTITY_KEY must be set")?,
        )
        .map_err(|_| "IDENTITY_KEY must be a valid key")?;

        Ok(Context {
            manage_domain: std::env::var("MANAGE_DOMAIN")
                .map_err(|_| "'MANAGE_DOMAIN' must be set")?,
            enrollment_domain: std::env::var("ENROLLMENT_DOMAIN")
                .map_err(|_| "'ENROLLMENT_DOMAIN' must be set")?,
            cert: CertificateParams::from_ca_cert_pem(
                &std::env::var("IDENTITY_CERT").map_err(|_| "'IDENTITY_CERT' must be set")?,
            )
            .map_err(|err| format!("'IDENTITY_CERT' must be a valid certificate: {err:?}"))?
            // TODO: https://github.com/rustls/rcgen/issues/274
            .self_signed(&key)
            .map_err(|err| format!("'IDENTITY_CERT' could not be self-signed: {err:?}"))?,
            key,
            client: reqwest::Client::builder()
                .user_agent(concat!(
                    env!("CARGO_PKG_NAME"),
                    "/",
                    env!("CARGO_PKG_VERSION")
                ))
                .build()
                .map_err(|err| format!("Could not create HTTP client: {err:?}"))?,
            db: mx_db::Db::new(
                &std::env::var("DATABASE_URL").map_err(|_| "'DATABASE_URL' must be set")?,
            ),
        })
    }

    /// Mount the Mattrax Cloud API onto an Axum router
    pub fn mount(self) -> Router {
        let this = Arc::new(self);
        tracing_subscriber::fmt().init();
        std::panic::set_hook(Box::new(move |panic| tracing::error!("{panic}")));

        Router::new()
            .route(
                "/",
                get(|| async move { Redirect::temporary("https://mattrax.app") }),
            )
            .route(
                "/_/version",
                get(|| async move {
                    format!(
                        "Mattrax MDM {} ({})",
                        env!("CARGO_PKG_VERSION"),
                        env!("GIT_HASH")
                    )
                }),
            )
            .merge(api::mount())
            .nest("/psdb.v1alpha1.Database", sql::mount())
            .merge(todo())
            .with_state(this.clone())
            .merge(mx_manage::mount(mdm::App(this)))
            .layer(
                TraceLayer::new_for_http()
                    .make_span_with(|request: &axum::http::Request<_>| {
                        let matched_path = request
                            .extensions()
                            .get::<MatchedPath>()
                            .map(MatchedPath::as_str);

                        info_span!(
                            "http_request",
                            method = ?request.method(),
                            matched_path,
                            some_other_field = tracing::field::Empty,
                        )
                    })
                    .on_response(|resp: &Response, latency: Duration, _span: &Span| {
                        #[cfg(debug_assertions)]
                        tracing::info!("responded with {} in {:?}", resp.status(), latency);
                    }),
            )
            .route_layer(middleware::from_fn(headers))
        // TODO: 404 handler
    }
}

// TODO: Remove this once auth is all sorted out
fn todo() -> Router<Arc<Context>> {
    Router::new()
        .route("/auth", get(|Query(query): Query<HashMap<String, String>>| async move {
            let appru = query.get("appru").map(String::to_string).unwrap_or_else(|| "".to_string());

            Html(format!(r#"<h3>MDM Federated Login</h3>
                <form method="post" action="{appru}" name="theform">
                    <p><input type="hidden" name="wresult" value="TODOSpecialTokenWhichVerifiesAuth" /></p>
                    <input type="submit" value="Login" />
                </form>
                <script>window.onload = function(){{ document.forms['theform'].submit(); }}</script>"#))
        }))
    .route("/enroll", get(|| async move { Html(r#"<a href="ms-device-enrollment:?mode=mdm&username=oscar@otbeaumont.me&servername=https://playground.otbeaumont.me">Enroll</a>"#) }))
}

async fn headers(request: Request, next: Next) -> Response {
    let (method, uri) = (request.method().clone(), request.uri().clone());
    let mut response = next.run(request).await;

    #[cfg(debug_assertions)]
    tracing::debug!("{method} {uri} - {:?}", response.status());

    let headers = response.headers_mut();
    headers.append("Server", HeaderValue::from_static("Mattrax"));
    // if cgg!(debug_assertions) {
    //     headers.append(
    //         "Strict-Transport-Security",
    //         HeaderValue::from_static("max-age=31536000; preload"),
    //     );
    // }
    headers.append("X-Frame-Options", HeaderValue::from_static("DENY"));
    headers.append(
        "X-Content-Type-Options",
        HeaderValue::from_static("nosniff"),
    );
    headers.append(
        "Referrer-Policy",
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );

    response
}
