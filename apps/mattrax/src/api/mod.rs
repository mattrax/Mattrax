use std::{net::SocketAddr, sync::Arc};

use axum::{
    extract::{connect_info::Connected, Request, State},
    http::HeaderValue,
    middleware::{self, Next},
    response::Response,
    routing::{any, get},
    Router,
};
use hmac::Hmac;
use hyper::HeaderMap;
use mx_db::Db;
use rcgen::{Certificate, KeyPair};
use rustls::pki_types::CertificateDer;
use sha2::Sha256;
use tokio::sync::mpsc;
use x509_parser::certificate::X509Certificate;

use crate::config::ConfigManager;

mod internal;
mod mdm;
mod realtime;

#[derive(Clone, Debug)]
pub struct ConnectInfoTy {
    pub remote_addr: SocketAddr,
    pub client_cert: Option<Vec<CertificateDer<'static>>>,
}

impl Connected<Self> for ConnectInfoTy {
    fn connect_info(this: Self) -> Self {
        this
    }
}

pub struct Context {
    pub config: ConfigManager,
    pub server_port: u16,
    pub is_dev: bool,
    pub db: Db,

    pub shared_secret: Hmac<Sha256>,

    pub identity_cert_rcgen: Certificate,
    pub identity_cert_x509: X509Certificate<'static>,
    pub identity_key: KeyPair,

    pub acme_tx: mpsc::Sender<Vec<String>>,
}

impl Context {
    pub fn public_url(&self) -> String {
        let (scheme, default_port) = if self.is_dev {
            ("http", 80)
        } else {
            ("https", 443)
        };

        let mut url = format!("{scheme}://{}", self.config.get().domain);
        if self.server_port != default_port {
            url.push(':');
            url.push_str(&self.server_port.to_string());
        }
        url
    }
}

async fn headers(State(state): State<Arc<Context>>, request: Request, next: Next) -> Response {
    let (method, uri) = (request.method().clone(), request.uri().clone());
    let mut response = next.run(request).await;

    #[cfg(debug_assertions)]
    tracing::debug!("{method} {uri} - {:?}", response.status());

    let headers = response.headers_mut();
    headers.append("Server", HeaderValue::from_static("Mattrax"));
    if !state.is_dev {
        headers.append(
            "Strict-Transport-Security",
            HeaderValue::from_static("max-age=31536000; preload"),
        );
    }
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

pub fn mount(state: Arc<Context>) -> Router {
    // TODO: Limit body size
    let router = Router::new()
        .nest("/internal", internal::mount(state.clone()))
        .nest("/realtime", realtime::mount(state.clone()))
        .nest(
            "/psdb.v1alpha1.Database",
            internal::sql::mount(state.clone()),
        )
        .nest("/EnrollmentServer", mdm::enrollment::mount(state.clone()))
        .nest("/ManagementServer", mdm::manage::mount(state.clone()));

    #[cfg(feature = "serve-web")]
    let router = router.fallback(|r: axum::extract::Request| async move {
        let mut req = reqwest::Request::new(
            r.method().clone(),
            reqwest::Url::parse("http://localhost:12345")
                .expect("failed to parse localhost url")
                .join(r.uri().path())
                .expect("failed to join path to localhost url"),
        );

        *req.headers_mut() = r.headers().clone();
        *req.body_mut() = Some(
            axum::body::to_bytes(r.into_body(), usize::MAX)
                .await
                .expect("failed to read body")
                .into(),
        );

        let client = reqwest::Client::new();
        let resp = client
            .execute(req)
            .await
            .expect("failed to make request to node");

        (
            resp.status(),
            resp.headers().clone(),
            resp.extensions().clone(),
            axum::body::Body::from_stream(resp.bytes_stream()),
        )
    });

    router
        .layer(middleware::from_fn_with_state(state.clone(), headers))
        .with_state(state)
}
