use bcder::{decode::Constructed, Mode, Oid};
use openssl::x509::{X509Req, X509};
use x509_certificate::{rfc2986::CertificationRequest, rfc5280, X509Certificate};

use super::CertificateBuilder;

/// TODO
///
/// Can be constructed via [`CertificateBuilder::sign_csr`].
#[derive(Clone)]
pub struct CertificateSigningRequest {
    // TODO: Can we store it parsed. Right now it's unclear if you want OpenSSL or not so we don't.
    pub(crate) der: Vec<u8>,
}

impl CertificateSigningRequest {
    // pub fn from_pem(pem: &[u8]) -> Result<Self, ()> {
    //     todo!();
    // }

    pub fn from_der(der: &[u8]) -> Result<Self, ()> {
        // `x509_certificate` doesn't allow parsing

        // TODO: PR this back to `x509-certificate`???
        // let cert =
        //     Constructed::decode(der, Mode::Der, |cons| CertificationRequest::take_from(cons))
        //         .unwrap();

        // println!("LISTING ATTRS");
        // cert.certificate_request_info
        //     .attributes
        //     .iter()
        //     .for_each(|attr| {
        //         println!(
        //             "{:?} {:?} {:?}",
        //             attr.typ,
        //             attr.typ.0.to_vec(),
        //             attr.values.iter().map(|v| v.to_vec()).collect::<Vec<_>>()
        //         );
        //     });

        // Ok(Self(cert))

        Ok(Self { der: der.to_vec() })
    }

    // TODO: Make this work
    pub fn builder(self) -> CertificateBuilder {
        // TODO: We should use a smarter parser to fill in all this information

        // let mut c = CertificateBuilder::default();
        // *c.0.subject() = self.0.certificate_request_info.subject;
        // // *c.0.issuer() = ();
        // // *c.0.extensions() = ();
        // // *c.0.serial_number() = ();
        // // *c.0.not_before() = ();
        // // *c.0.not_after() = ();
        // for attr in self.0.certificate_request_info.attributes.iter() {
        //     c.0.add_csr_attribute(attr.clone());
        // }

        // // TODO: Shouldn't we need to link up the CSR's public key somewhere here???
        // c

        let csr = X509Req::from_der(&self.der).unwrap();
        let mut builder = X509::builder().unwrap();
        builder.set_version(csr.version()).unwrap();
        builder.set_subject_name(csr.subject_name()).unwrap();
        builder.set_pubkey(&*csr.public_key().unwrap()).unwrap();
        // TODO: Go through setting everything -> They should actually be automatic so maybe we don't need to anymore???
        builder
            .set_not_before(&openssl::asn1::Asn1Time::days_from_now(0).unwrap())
            .unwrap();

        CertificateBuilder(super::builder::CertificateBuilderInner::FromCsr(builder))
    }

    pub fn encode_pem(&self) -> Result<String, ()> {
        Constructed::decode(self.der.as_slice(), Mode::Der, |cons| {
            CertificationRequest::take_from(cons)
        })
        .map_err(|_| ())?
        .encode_pem()
        .map_err(|_| ())
    }

    pub fn encode_der(&self) -> Result<Vec<u8>, ()> {
        // println!("A");
        // let r = self.0.encode_der().map_err(|_| ());
        // println!("B {:?}", r.is_ok());
        // r
        todo!();
    }

    pub fn version(&self) -> u8 {
        // self.0.certificate_request_info.version.into()
        todo!();
    }

    // TODO: Rest of accessors

    // TODO: Remove this and do properly
    pub fn get_oid(&self, oid: Oid) -> Option<rfc5280::Extension> {
        X509Req::from_der(&self.der)
            .unwrap()
            .extensions()
            .unwrap()
            .into_iter()
            .find_map(|ext| {
                let ext = ext.to_der().unwrap();
                Constructed::decode(ext.as_slice(), Mode::Der, |cons| {
                    rfc5280::Extension::take_from(cons)
                })
                .ok()
            })
    }
}
