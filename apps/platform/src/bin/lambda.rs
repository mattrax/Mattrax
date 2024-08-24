use axum::{
    extract::{MatchedPath, Query, Request},
    response::{Html, Response},
    routing::get,
};
use mattrax_platform::{Application, Authentication};
use rcgen::{CertificateParams, KeyPair};
use std::{borrow::Cow, collections::HashMap, env::set_var, error::Error, time::Duration};
use tower_http::trace::TraceLayer;
use tracing::{info_span, Span};

struct Lambda {
    manage_domain: String,
    enrollment_domain: String,
    cert: rcgen::Certificate,
    key: rcgen::KeyPair,
}

impl Application for Lambda {
    type EnrollmentAuthenticationMetadata = ();
    type Error = Box<dyn Error>;

    fn enrollment_domain(&self) -> Cow<'_, str> {
        Cow::Borrowed(&self.enrollment_domain)
    }

    fn manage_domain(&self) -> Cow<'_, str> {
        Cow::Borrowed(&self.manage_domain)
    }

    fn identity_keypair(&self) -> (&rcgen::Certificate, &rcgen::KeyPair) {
        (&self.cert, &self.key)
    }

    fn determine_authentication_method(&self) -> Authentication {
        Authentication::Federated {
            url: format!("https://{}/auth", self.enrollment_domain).into(),
        }
    }

    fn verify_authentication(
        &self,
        bst: String,
    ) -> Result<Option<Self::EnrollmentAuthenticationMetadata>, Self::Error> {
        // TODO: Make this actually do stuff
        Ok(Some(()))
    }

    async fn create_device(
        &self,
        auth: Self::EnrollmentAuthenticationMetadata,
        // TODO: A bunch of information about the device
        device: (),
    ) -> Result<(), Self::Error> {
        // TODO: Do this

        Ok(())
    }
}

#[tokio::main]
async fn main() -> Result<(), lambda_http::Error> {
    tracing_subscriber::fmt().init();

    // If you use API Gateway stages, the Rust Runtime will include the stage name
    // as part of the path that your application receives. We don't want this!
    set_var("AWS_LAMBDA_HTTP_IGNORE_STAGE_IN_PATH", "true");

    let manage_domain = std::env::var("MANAGE_DOMAIN").expect("'MANAGE_DOMAIN' must be set");
    let enrollment_domain =
        std::env::var("ENROLLMENT_DOMAIN").expect("'ENROLLMENT_DOMAIN' must be set");
    let cert = std::env::var("IDENTITY_CERT").expect("'IDENTITY_CERT' must be set");
    let key = std::env::var("IDENTITY_KEY").expect("'IDENTITY_KEY' must be set");

    let key = KeyPair::from_pem(&key).unwrap();
    let cert = CertificateParams::from_ca_cert_pem(&cert)
        .unwrap()
        // TODO: https://github.com/rustls/rcgen/issues/274
        .self_signed(&key)
        .unwrap();

    let router = mattrax_platform::mount(Lambda { manage_domain, enrollment_domain, cert, key })
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
        // TODO: 404 handler
        .route("/docs", get(|| async move { Html(include_str!("../../static/scalar.html")) }))
        .route("/openapi.yaml", get(|| async move { Html(include_str!("../../static/openapi.yaml")) }))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(|request: &Request<_>| {
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
                })
        );

    lambda_http::run(router).await
}
