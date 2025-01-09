use chrono::Utc;
use x509_certificate::{rfc5280, CapturedX509Certificate};

use super::{CertificateBuilder, ExtendedKeyUsage, KeyUsage, Subject};

pub struct Certificate(pub(crate) CapturedX509Certificate);

impl Certificate {
    pub fn builder() -> CertificateBuilder {
        Default::default()
    }

    pub fn from_pem(pem: &[u8]) -> Result<Self, ()> {
        CapturedX509Certificate::from_pem(pem)
            .map_err(|_| ())
            .map(Self)
    }

    pub fn from_der(der: &[u8]) -> Result<Self, ()> {
        CapturedX509Certificate::from_ber(der)
            .map_err(|_| ())
            .map(Self)
    }

    pub fn encode_pem(&self) -> String {
        self.0.encode_pem()
    }

    pub fn encode_der(&self) -> Result<Vec<u8>, ()> {
        self.0.encode_ber().map_err(|_| ())
    }

    pub fn subject(&self) -> Subject {
        Subject(self.0.subject_name().clone())
    }

    pub fn issuer_subject(&self) -> Subject {
        Subject(self.0.issuer_name().clone())
    }

    pub fn not_before(&self) -> chrono::DateTime<Utc> {
        self.0.validity_not_before()
    }

    pub fn not_after(&self) -> chrono::DateTime<Utc> {
        self.0.validity_not_after()
    }

    pub fn key_usage(&self) -> KeyUsage {
        todo!();
    }

    pub fn extended_key_usage(&self) -> ExtendedKeyUsage {
        todo!();
    }

    // TODO: Wrap the `x509-certificate` type
    pub fn extensions(&self) -> impl Iterator<Item = &rfc5280::Extension> {
        self.0.iter_extensions()
    }

    // TODO: Accessors

    // TODO: Verify signer chain
}
