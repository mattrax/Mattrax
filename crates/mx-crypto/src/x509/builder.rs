use std::time::Duration;

use bcder::{OctetString, Oid};
use bytes::Bytes;
use x509_certificate::{rfc5280, InMemorySigningKeyPair};
use yasna::models::ObjectIdentifier;

use super::{
    Certificate, CertificateSigningRequest, ExtendedKeyUsage, KeyUsage, PrivateKey, Subject,
    OID_EXTENSION_BASIC_CONSTRAINTS, OID_EXT_KEY_USAGE, OID_KEY_USAGE,
};

#[derive(Default)]
pub struct CertificateBuilder(x509_certificate::X509CertificateBuilder);

impl CertificateBuilder {
    pub fn version(self, version: i32) -> Self {
        todo!("x509-certificate lacks a way to set this");
    }

    pub fn serial_number(mut self, serial_number: i64) -> Self {
        self.0.serial_number(serial_number);
        self
    }

    pub fn subject(mut self, subject_name: impl Into<Subject>) -> Self {
        *self.0.subject() = subject_name.into().0;
        self
    }

    pub fn not_before(mut self, time: ()) -> Self {
        todo!("x509-certificate lacks a way to set this");
    }

    pub fn not_after(mut self, time: ()) -> Self {
        todo!("x509-certificate lacks a way to set this");
    }

    // TODO: Deprecated this and replace it with `Self::not_after`
    pub fn validity(mut self, duration: Duration) -> Self {
        self.0
            .validity_duration(chrono::Duration::from_std(duration).unwrap());
        self
    }

    /// Add a basic constraint extension for whether this certificate is a CA certificate.
    pub fn is_ca(mut self, ca: bool) -> Self {
        self.0.extensions_mut().push(rfc5280::Extension {
            id: Oid(OID_EXTENSION_BASIC_CONSTRAINTS.as_ref().into()),
            critical: Some(true),
            value: OctetString::new(Bytes::copy_from_slice(if ca {
                &[48, 3, 1, 1, 255]
            } else {
                &[48, 0]
            })),
        });
        self
    }

    pub fn key_usage(mut self, key_usage: KeyUsage) -> Self {
        self.0.extensions_mut().push(rfc5280::Extension {
            id: Oid(OID_KEY_USAGE.as_ref().into()),
            // "When present, conforming CAs SHOULD mark this extension as critical."
            critical: Some(true),
            value: OctetString::new(key_usage.as_bytes()),
        });
        self
    }

    pub fn extended_key_usage(
        mut self,
        extended_key_usages: impl IntoIterator<Item = ExtendedKeyUsage>,
    ) -> Self {
        let bytes = Bytes::from(yasna::construct_der(|writer| {
            writer.write_sequence(|writer| {
                for usage in extended_key_usages {
                    writer
                        .next()
                        .write_oid(&ObjectIdentifier::from_slice(usage.oid()));
                }
            });
        }));

        println!("{:?}", bytes.to_vec());

        self.0.extensions_mut().push(rfc5280::Extension {
            id: Oid(OID_EXT_KEY_USAGE.as_ref().into()),
            critical: Some(false),
            value: OctetString::new(bytes),
        });
        println!("{:?}", self.0.extensions()); // TODO
        self
    }

    // TODO:
    // pub fn add_csr_attribute(&mut self, attribute: Attribute)
    // pub fn extensions_mut(&mut self) -> &mut Extensions
    // pub fn add_extension_der_data
    // TODO: `set_*` variants which take `&mut self`???

    /// TODO
    pub fn self_sign(mut self, key: &PrivateKey) -> Result<Certificate, ()> {
        *self.0.issuer() = self.0.subject().clone();

        let k = InMemorySigningKeyPair::from_pkcs8_der(&key.to_pkcs8_der().unwrap()).unwrap();
        let cert = self.0.create_with_key_pair(&k).unwrap();
        Ok(Certificate(cert))
    }

    /// TODO
    pub fn sign(mut self, cert: Certificate, key: &PrivateKey) -> Result<Certificate, ()> {
        *self.0.issuer() = cert.0.subject_name().clone();

        let k = InMemorySigningKeyPair::from_pkcs8_der(&key.to_pkcs8_der().unwrap()).unwrap();
        let cert = self.0.create_with_key_pair(&k).unwrap();
        Ok(Certificate(cert))
    }

    /// TODO
    pub fn sign_csr(self, key: &PrivateKey) -> Result<CertificateSigningRequest, ()> {
        let k = InMemorySigningKeyPair::from_pkcs8_der(&key.to_pkcs8_der().unwrap()).unwrap();
        let csr = self.0.create_certificate_signing_request(&k).unwrap();
        Ok(CertificateSigningRequest(csr))
    }
}
