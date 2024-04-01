use std::{net::SocketAddr, sync::Arc};

use axum::{
    extract::{connect_info::Connected, Request, State},
    http::HeaderValue,
    middleware::{self, Next},
    response::Response,
    routing::get,
    Router,
};
use hmac::Hmac;
use mx_db::Db;
use rcgen::{Certificate, KeyPair};
use rustls::pki_types::CertificateDer;
use sha2::Sha256;
use tokio::sync::mpsc;
use x509_parser::certificate::X509Certificate;

use crate::config::ConfigManager;

mod internal;
mod mdm;

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
    Router::new()
        .route("/", get(|| async move { "Mattrax MDM!".to_string() }))
        .nest("/internal", internal::mount(state.clone()))
        .nest("/EnrollmentServer", mdm::enrollment::mount(state.clone()))
        .nest("/ManagementServer", mdm::manage::mount(state.clone()))
        .layer(middleware::from_fn_with_state(state.clone(), headers))
        .with_state(state)
}
