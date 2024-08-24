//! Mattrax MDM Platform: An embeddable low-level MDM platform for easily building custom MDM solutions.

use std::{borrow::Cow, error::Error, fmt::Debug, future::Future, sync::Arc};

use axum::{routing::get, Router};
use rcgen::{Certificate, KeyPair};

mod enrollment;
mod manage;

/// Allows the MDM platform to interact with the application embedding it.
pub trait Application: Send + Sync + 'static {
    // TODO: Maybe rename?
    type EnrollmentAuthenticationMetadata: Send + Sync + 'static;
    type Error: Debug; // TODO: : Error;

    /// Retrieve the domain name of the enrollment server in the format `EnterpriseEnrollment.example.com`.
    fn enrollment_domain(&self) -> Cow<'_, str>;

    /// Retrieve the domain name of the management server in the format `manage.example.com`.
    fn manage_domain(&self) -> Cow<'_, str>;

    /// TODO
    // TODO: What if fetched from the network? They can't be borrowed!
    fn identity_keypair(&self) -> (&Certificate, &KeyPair);

    /// Get the method of authentication to use for enrollment
    // TODO: Take in information from the request
    fn determine_authentication_method(&self) -> Authentication;

    /// TODO
    fn verify_authentication(
        &self,
        bst: String,
    ) -> Result<Option<Self::EnrollmentAuthenticationMetadata>, Self::Error>;

    // /// TODO
    // fn certificate_common_name(&self)

    /// TODO
    fn create_device(
        &self,
        auth: Self::EnrollmentAuthenticationMetadata,
        // TODO: A bunch of information about the device
        device: (),
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;

    // TODO: Allow configuring WAP provisioning profile
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Authentication {
    Federated { url: Cow<'static, str> },
}

/// attach the HTTP handlers to an Axum router
pub fn mount(app: impl Application) -> Router {
    Router::new()
        .route("/mattrax", get(|| async move { env!("CARGO_PKG_VERSION") }))
        .nest("/EnrollmentServer", enrollment::mount())
        .nest("/ManagementServer", manage::mount())
        .with_state(Arc::new(app))
}
