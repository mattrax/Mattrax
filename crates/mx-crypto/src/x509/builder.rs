use std::time::{Duration, SystemTime};

use bcder::{OctetString, Oid};
use bytes::Bytes;
use openssl::{hash::MessageDigest, pkey::PKey, x509::X509Builder};
use x509_certificate::{rfc5280, InMemorySigningKeyPair, X509CertificateBuilder};
use yasna::models::ObjectIdentifier;

use super::{
    Certificate, CertificateSigningRequest, ExtendedKeyUsage, KeyUsage, PrivateKey, Subject,
    OID_EXTENSION_BASIC_CONSTRAINTS, OID_EXT_KEY_USAGE, OID_KEY_USAGE,
};

// TODO: Merge into one implementation, preferably a Rust-based one
pub(crate) enum CertificateBuilderInner {
    New(X509CertificateBuilder),
    FromCsr(X509Builder),
}

// #[derive(Default)]
pub struct CertificateBuilder(pub(crate) CertificateBuilderInner);

impl Default for CertificateBuilder {
    fn default() -> Self {
        Self(CertificateBuilderInner::New(
            X509CertificateBuilder::default(),
        ))
    }
}

impl CertificateBuilder {
    pub fn version(self, _version: u8) -> Self {
        todo!("x509-certificate lacks a way to set this");
    }

    pub fn serial_number(mut self, serial_number: i64) -> Self {
        match &mut self.0 {
            CertificateBuilderInner::New(b) => b.serial_number(serial_number),
            CertificateBuilderInner::FromCsr(_) => todo!(),
        }
        self
    }

    pub fn subject(mut self, subject_name: impl Into<Subject>) -> Self {
        match &mut self.0 {
            CertificateBuilderInner::New(b) => *b.subject() = subject_name.into().0,
            CertificateBuilderInner::FromCsr(_) => todo!(),
        }
        self
    }

    pub fn not_before(self, _time: ()) -> Self {
        todo!("x509-certificate lacks a way to set this");
    }

    pub fn not_after(self, _time: ()) -> Self {
        todo!("x509-certificate lacks a way to set this");
    }

    // TODO: Deprecated this and replace it with `Self::not_after`
    pub fn validity(mut self, duration: Duration) -> Self {
        match &mut self.0 {
            CertificateBuilderInner::New(b) => {
                b.validity_duration(chrono::Duration::from_std(duration).unwrap())
            }
            CertificateBuilderInner::FromCsr(b) => {
                let unix = SystemTime::now() + duration;
                let unix = unix
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_secs() as i64;

                b.set_not_after(&openssl::asn1::Asn1Time::from_unix(unix).unwrap())
                    .unwrap();
            }
        }
        self
    }

    /// Add a basic constraint extension for whether this certificate is a CA certificate.
    pub fn is_ca(mut self, ca: bool) -> Self {
        match &mut self.0 {
            CertificateBuilderInner::New(b) => {
                b.extensions_mut().push(rfc5280::Extension {
                    id: OID_EXTENSION_BASIC_CONSTRAINTS,
                    critical: Some(true),
                    value: OctetString::new(Bytes::copy_from_slice(if ca {
                        &[48, 3, 1, 1, 255]
                    } else {
                        &[48, 0]
                    })),
                });
            }
            CertificateBuilderInner::FromCsr(_) => todo!(),
        }

        self
    }

    pub fn key_usage(mut self, key_usage: KeyUsage) -> Self {
        match &mut self.0 {
            CertificateBuilderInner::New(b) => {
                b.extensions_mut().push(rfc5280::Extension {
                    id: OID_KEY_USAGE,
                    // "When present, conforming CAs SHOULD mark this extension as critical."
                    critical: Some(true),
                    value: OctetString::new(key_usage.as_bytes()),
                });
            }
            CertificateBuilderInner::FromCsr(_) => todo!(),
        }
        self
    }

    pub fn extended_key_usage(
        mut self,
        extended_key_usages: impl IntoIterator<Item = ExtendedKeyUsage>,
    ) -> Self {
        match &mut self.0 {
            CertificateBuilderInner::New(b) => {
                let bytes = Bytes::from(yasna::construct_der(|writer| {
                    writer.write_sequence(|writer| {
                        for usage in extended_key_usages {
                            writer
                                .next()
                                .write_oid(&ObjectIdentifier::from_slice(usage.oid()));
                        }
                    });
                }));

                b.extensions_mut().push(rfc5280::Extension {
                    id: OID_EXT_KEY_USAGE,
                    critical: Some(false),
                    value: OctetString::new(bytes),
                });
            }
            CertificateBuilderInner::FromCsr(_) => todo!(),
        }
        self
    }

    // TODO:
    // pub fn add_csr_attribute(&mut self, attribute: Attribute)
    // pub fn extensions_mut(&mut self) -> &mut Extensions
    // pub fn add_extension_der_data
    // TODO: `set_*` variants which take `&mut self`???

    /// TODO
    pub fn self_sign(self, key: &PrivateKey) -> Result<Certificate, ()> {
        match self.0 {
            CertificateBuilderInner::New(mut b) => {
                *b.issuer() = b.subject().clone();

                let k = InMemorySigningKeyPair::from_pkcs8_der(&key.encode_pkcs8_der().unwrap())
                    .unwrap();
                let cert = b.create_with_key_pair(&k).unwrap();
                Ok(Certificate(cert))
            }
            CertificateBuilderInner::FromCsr(_) => todo!(),
        }
    }

    /// TODO
    pub fn sign(self, cert: &Certificate, key: &PrivateKey) -> Result<Certificate, ()> {
        match self.0 {
            CertificateBuilderInner::New(mut b) => {
                *b.issuer() = cert.0.subject_name().clone();

                let k = InMemorySigningKeyPair::from_pkcs8_der(&key.encode_pkcs8_der().unwrap())
                    .unwrap();
                let cert = b.create_with_key_pair(&k).unwrap();
                Ok(Certificate(cert))
            }
            CertificateBuilderInner::FromCsr(mut b) => {
                // issuer.set_issuer_name(issuer).unwrap(); // TODO: Do this

                let key = PKey::private_key_from_pkcs8(&key.encode_pkcs8_der().unwrap()).unwrap();

                b.sign(&key, MessageDigest::sha256()).unwrap(); // TODO: Which hash?
                let cert = b.build();

                Ok(Certificate::from_der(&cert.to_der().unwrap()).unwrap())
            }
        }
    }

    /// TODO
    pub fn sign_csr(self, key: &PrivateKey) -> Result<CertificateSigningRequest, ()> {
        match self.0 {
            CertificateBuilderInner::New(b) => {
                let k = InMemorySigningKeyPair::from_pkcs8_der(&key.encode_pkcs8_der().unwrap())
                    .unwrap();
                let csr = b.create_certificate_signing_request(&k).unwrap();
                Ok(CertificateSigningRequest {
                    der: csr.encode_der().unwrap(),
                })
            }
            CertificateBuilderInner::FromCsr(_) => todo!(),
        }
    }
}
