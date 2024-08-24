use std::{collections::BTreeMap, error::Error, sync::Arc};

use axum::extract::ConnectInfo;
use http::request::Parts;
use jwt::VerifyWithKey;
use mx_manage::{Application, Authentication, DeviceInformation};
use tracing::debug;

use super::{ConnectInfoTy, Context};

pub(super) struct App {
    pub(super) state: Arc<Context>,
}

pub(super) struct AuthInformation {
    upn: Option<String>,
    owner_pk: Option<i64>,
    tenant_pk: u64,
    enrolled_by: Option<i64>,
}

impl Application for App {
    type EnrollmentAuthenticationMetadata = AuthInformation;
    type ManagementAuthenticationMetadata = ConnectInfo<ConnectInfoTy>;
    type Error = Box<dyn Error>;

    fn enrollment_domain(&self) -> std::borrow::Cow<'_, str> {
        self.state.config.get().enrollment_domain.clone().into()
    }

    fn manage_domain(&self) -> std::borrow::Cow<'_, str> {
        self.state.config.get().domain.clone().into()
    }

    fn identity_keypair(&self) -> (&rcgen::Certificate, &rcgen::KeyPair) {
        (&self.state.identity_cert_rcgen, &self.state.identity_key)
    }

    fn determine_authentication_method(&self) -> Authentication {
        let config = self.state.config.get();
        Authentication::Federated {
            url: format!(
                "{}/enroll/",
                config
                    .cloud
                    .as_ref()
                    .and_then(|c| c.frontend.as_ref())
                    .unwrap_or(&config.domain)
            )
            .into(),
        }
    }

    fn verify_authentication(
        &self,
        bst: String,
    ) -> Result<Option<Self::EnrollmentAuthenticationMetadata>, Self::Error> {
        // TODO: Does this validate the token has not expired???
        let claims: BTreeMap<String, serde_json::Value> =
            match bst.verify_with_key(&self.state.shared_secret) {
                Ok(claims) => claims,
                Err(err) => {
                    return Ok(None);
                    // fault.Fault(err, "the users authenticity could not be verified", soap.FaultCodeAuthentication)
                    // error!("todo: proper soap fault. error verifying token: '{err:?}'");
                    // return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                }
            };

        if claims.get("aud") != Some(&serde_json::Value::String("mdm.mattrax.app".into())) {
            // fault.Fault(err, "the users authenticity could not be verified", soap.FaultCodeAuthentication)
            // error!(
            //     "todo: proper soap fault. error verifying token: invalid aud '{:?}'",
            //     claims.get("aud")
            // );
            // return StatusCode::INTERNAL_SERVER_ERROR.into_response();

            return Ok(None);
        }

        let tenant = claims
            .get("tid")
            .unwrap()
            .as_i64()
            .unwrap()
            .try_into()
            .unwrap(); // TODO: Error handling
        let enrolled_by = claims
            .get("aid")
            .map(|v| v.as_i64().unwrap().try_into().unwrap()); // TODO: Error handling
        let upn = claims.get("upn").map(|v| v.as_str().unwrap().to_string()); // TODO: Error handling
        let owner_pk = claims
            .get("uid")
            .map(|v| v.as_i64().unwrap().try_into().unwrap()); // TODO: Error handling

        Ok(Some(AuthInformation {
            upn,
            owner_pk,
            tenant_pk: tenant,
            enrolled_by,
        }))
    }

    async fn create_device(
        &self,
        auth: Self::EnrollmentAuthenticationMetadata,
        device: DeviceInformation,
    ) -> Result<(), Self::Error> {
        let mdm_device_id = cuid2::create_id();
        let device_id = match self
            .state
            .db
            .get_device_by_serial(device.hw_device_id)
            .await
            .unwrap()
            .into_iter()
            .next()
        {
            Some(device) => {
                // TODO: Could this functionality be used to forcefully unenroll a device if you know it's serial number?
                if device.tenant_pk != auth.tenant_pk {
                    debug!(
                        "Detect device enrolling from tenant {} to {}!",
                        device.tenant_pk, auth.tenant_pk
                    );

                    // TODO: Wipe out all relations - https://github.com/mattrax/Mattrax/issues/362
                }

                device.id
            }
            None => cuid2::create_id(),
        };

        Ok(())
    }

    fn authenticate_management_session(
        &self,
        req: &Parts,
    ) -> Result<Option<Self::ManagementAuthenticationMetadata>, Self::Error> {
        Ok(req.extensions.get::<ConnectInfo<ConnectInfoTy>>().cloned())
    }

    async fn manage(
        &self,
        auth: Self::ManagementAuthenticationMetadata,
        body: String,
    ) -> Result<String, Self::Error> {
        Ok(mx_windows::handler(
            &self.state.db,
            &self.state.identity_cert_x509,
            body,
            auth.client_cert.clone().and_then(|x| x.into_iter().next()),
        )
        .await)
    }
}
