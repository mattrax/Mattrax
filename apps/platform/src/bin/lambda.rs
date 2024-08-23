use axum::{extract::Query, response::Html, routing::get};
use base64::{prelude::BASE64_STANDARD, Engine};
use mattrax_platform::{Application, Authentication};
use rcgen::{CertificateParams, KeyPair, PKCS_ECDSA_P256_SHA256};
use std::{borrow::Cow, collections::HashMap, env::set_var, error::Error};

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
            url: format!("{}/auth", self.enrollment_domain).into(),
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
    // tracing::init_default_subscriber(); // TODO

    // If you use API Gateway stages, the Rust Runtime will include the stage name
    // as part of the path that your application receives. We don't want this!
    set_var("AWS_LAMBDA_HTTP_IGNORE_STAGE_IN_PATH", "true");

    let manage_domain = std::env::var("MANAGE_DOMAIN").expect("'MANAGE_DOMAIN' must be set");
    let enrollment_domain =
        std::env::var("ENROLLMENT_DOMAIN").expect("'ENROLLMENT_DOMAIN' must be set");
    let cert = BASE64_STANDARD
        .decode(std::env::var("IDENTITY_CERT").expect("'IDENTITY_CERT' must be set"))
        .unwrap();
    let key = BASE64_STANDARD
        .decode(std::env::var("IDENTITY_KEY").expect("'IDENTITY_KEY' must be set"))
        .unwrap();

    let key =
        KeyPair::from_der_and_sign_algo(&key.try_into().unwrap(), &PKCS_ECDSA_P256_SHA256).unwrap();

    let cert = CertificateParams::from_ca_cert_der(&cert.into())
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
        .route("/openapi.yaml", get(|| async move { Html(include_str!("../../static/openapi.yaml")) }));

    lambda_http::run(router).await
}
