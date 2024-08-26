use axum::http::request::Parts;
use lambda_http::{request::RequestContext, RequestExt};
use mx_manage::{Application, Authentication, DeviceInformation};
use std::{borrow::Cow, error::Error};

pub(super) struct App {
    pub(super) manage_domain: String,
    pub(super) enrollment_domain: String,
    pub(super) cert: rcgen::Certificate,
    pub(super) key: rcgen::KeyPair,
}

impl Application for App {
    type EnrollmentAuthenticationMetadata = ();
    type ManagementAuthenticationMetadata = ();
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
        device: DeviceInformation,
    ) -> Result<(), Self::Error> {
        // TODO: Do this

        Ok(())
    }

    fn authenticate_management_session(
        &self,
        req: &Parts,
    ) -> Result<Option<Self::ManagementAuthenticationMetadata>, Self::Error> {
        let ctx = match req.request_context_ref() {
            Some(RequestContext::ApiGatewayV2(ctx)) => ctx.authentication.clone(),
            _ => todo!(),
        };

        // TODO
        println!("{req:?} {ctx:?}");

        Ok(Some(()))
    }

    async fn manage(
        &self,
        auth: Self::ManagementAuthenticationMetadata,
        body: String,
    ) -> Result<String, Self::Error> {
        unimplemented!();
    }
}
