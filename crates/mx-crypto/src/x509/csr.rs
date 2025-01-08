use bcder::Oid;
use x509_certificate::rfc2986::CertificationRequest;

use super::CertificateBuilder;

/// TODO
///
/// Can be constructed via [`CertificateBuilder::sign_csr`].
pub struct CertificateSigningRequest(pub(crate) CertificationRequest);

impl CertificateSigningRequest {
    pub fn from_pem(pem: &[u8]) -> Result<Self, ()> {
        todo!();
    }

    pub fn from_der(der: &[u8]) -> Result<Self, ()> {
        todo!();
    }

    pub fn builder(&self) -> CertificateBuilder {
        Default::default()
    }

    pub fn encode_pem(&self) -> Result<String, ()> {
        self.0.encode_pem().map_err(|_| ())
    }

    pub fn encode_der(&self) -> Result<Vec<u8>, ()> {
        self.0.encode_der().map_err(|_| ())
    }
}
