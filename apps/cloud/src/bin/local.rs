use std::error::Error;

use mattrax_platform::{mount, Application, Authentication};

pub struct Local {}

impl Application for Local {
    type EnrollmentAuthenticationMetadata = ();
    type Error = Box<dyn Error>;

    fn enrollment_domain(&self) -> std::borrow::Cow<'_, str> {
        "EnterpriseEnrollment.mattrax.app".into()
    }

    fn manage_domain(&self) -> std::borrow::Cow<'_, str> {
        "mdm.mattrax.app".into()
    }

    fn identity_keypair(&self) -> (&rcgen::Certificate, &rcgen::KeyPair) {
        todo!()
    }

    fn determine_authentication_method(&self) -> Authentication {
        Authentication::Federated {
            url: "https://otbeaumont.me".into(),
        }
    }

    fn verify_authentication(
        &self,
        bst: String,
    ) -> Result<Option<Self::EnrollmentAuthenticationMetadata>, Self::Error> {
        todo!()
    }

    async fn create_device(
        &self,
        auth: Self::EnrollmentAuthenticationMetadata,
        // TODO: A bunch of information about the device
        device: (),
    ) -> Result<(), Self::Error> {
        todo!()
    }
}

#[tokio::main]
async fn main() {
    // tracing::init_default_subscriber();

    let app = mount(Local {});

    println!("Listening http://localhost:3000");
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
