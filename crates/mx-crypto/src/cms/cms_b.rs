use ::rsa::signature::Verifier;
use ::rsa::{pkcs1v15, RsaPublicKey};
use ::rsa::{pkcs1v15::Signature, BigUint};
use cryptographic_message_syntax::{SignedData, SignerInfo};
use thiserror::Error;
use x509_certificate::SignatureAlgorithm;
use x509_verify::x509_cert;
use x509_verify::{der::Decode, VerifyingKey};

use crate::x509::Certificate;

#[derive(Error, Debug)]
pub enum PkcsVerificationError {
    #[error("cms error: {0}")]
    CmsError(#[from] cryptographic_message_syntax::CmsError),
    #[error("no signer found")]
    NoSignerFound,
    #[error("x509 verification key error: {0}")]
    X509Verify(#[from] x509_verify::Error),
    #[error("no certificate for signer")]
    NoCertificateForSigner,
    // This is yielded after verifying the signature so it's safe to assume everything is valid if this is returned.
    // #[error("no payload was found in the PKCS7 message")]
    // MissingPayload,
}

#[derive(Debug, Clone)]
pub struct Pkcs7B(SignedData);

impl Pkcs7B {
    pub fn from_der(der: &[u8]) -> Result<Self, ()> {
        Ok(Self(SignedData::parse_ber(der).unwrap()))
    }

    // TODO: Merge into parsing function???
    /// Parse a PKCS7 message to get the signed content and verify the signature and signer.
    ///
    /// Providing an empty list of `expected_ca` will skip the verification of the signer.
    ///
    /// This code is adapted from: https://github.com/smallstep/pkcs7/blob/896672eee96663987221f890d7f950619e76e629/verify.go#L27
    pub fn parse_and_verify_pkcs7<'a>(
        data: &[u8],
        truststore: &[&'a Certificate],
    ) -> Result<Self, PkcsVerificationError> {
        let d = SignedData::parse_ber(data)?;
        (d.signers().count() != 0)
            .then_some(())
            .ok_or(PkcsVerificationError::NoSignerFound)?;

        for s in d.signers() {
            let (issuer, serial) = s
                .certificate_issuer_and_serial()
                .ok_or(PkcsVerificationError::NoCertificateForSigner)?;
            let certificate = d
                .certificates()
                .find(|c| c.issuer_name() == issuer && c.serial_number_asn1() == serial)
                .ok_or(PkcsVerificationError::NoCertificateForSigner)?;
            let certificate2 = x509_cert::Certificate::from_der(
                &certificate
                    .encode_ber()
                    .expect("re-encoding BER hould be infallible"),
            )
            .expect("re-parsing DER should be infallible");

            // These are not included by the macOS client.
            if s.signed_attributes().is_some() {
                // Some(SignedAttributes { content_type: 1.2.840.113549.1.7.1, message_digest: de7088bdfa25623094b977b07a5a0b24498b9638, signing_time: Some(2025-01-02T15:06:57Z) })
                println!("{:?}", s.signed_attributes());

                // TODO: Does this cover everything the Go implementation does???
                // TODO: This could be susceptible to timing attacks
                if let Err(err) = s.verify_message_digest_with_signed_data(&d) {
                    todo!();
                }
            }

            // If the truststore is empty we skip the verification of the signer.
            // In a perfect world this would be handled by ` // TODO
            for ca in truststore.iter() {
                let ca = x509_cert::Certificate::from_der(&ca.encode_der().unwrap()).unwrap();
                let key = VerifyingKey::try_from(ca)?;
                if let Err(err) = key.verify(&certificate2) {
                    // todo!();
                    // TODO: This is wrong error but is temporary

                    println!(
                        "ACTUAL ERROR: {err:?} {:?}",
                        d.certificates()
                            .map(|v| v.subject_common_name().unwrap())
                            .collect::<Vec<_>>()
                    );
                    return Err(PkcsVerificationError::NoCertificateForSigner);
                }
                // TODO: verify time
                // TODO: Verify extended key usage
            }

            // In a perfect would we would just use `verify_message_digest_with_signed_data` but it's broken :(
            let verifying_key = match s.signature_algorithm() {
                SignatureAlgorithm::RsaSha1 => {
                    let a = certificate.rsa_public_key_data().unwrap();
                    let b = BigUint::from_bytes_be(a.modulus.as_slice());
                    let c = BigUint::from_bytes_be(a.public_exponent.as_slice());
                    let a = RsaPublicKey::new(b, c).unwrap();
                    pkcs1v15::VerifyingKey::<sha1::Sha1>::new(a)
                }
                SignatureAlgorithm::RsaSha256 => todo!(),
                SignatureAlgorithm::RsaSha384 => todo!(),
                SignatureAlgorithm::RsaSha512 => todo!(),
                SignatureAlgorithm::EcdsaSha256 => todo!(),
                SignatureAlgorithm::EcdsaSha384 => todo!(),
                SignatureAlgorithm::Ed25519 => todo!(),
                SignatureAlgorithm::NoSignature(_) => todo!(),
            };

            if let Err(err) = verifying_key.verify(
                &s.signed_content_with_signed_data(&d),
                &Signature::try_from(s.signature()).unwrap(),
            ) {
                todo!();
            }
        }

        // d.signed_content()
        //     .ok_or(PkcsVerificationError::MissingPayload)
        //     .map(|v| v.to_vec())
        //     .map(|v| {
        //         (
        //             v, // TODO: Kinda hate this being in the return type
        //             d,
        //         )
        //     })
        Ok(Self(d))
    }

    pub fn signed_content(&self) -> &[u8] {
        self.0.signed_content().unwrap_or_default() // TODO: `unwrap_or_default` or error out?
    }

    // TODO: Hide the `x509-certificate` crate from the public API.
    pub fn signers(&self) -> impl Iterator<Item = &SignerInfo> {
        self.0.signers()
    }

    pub fn certificates(&self) -> impl Iterator<Item = Certificate> + use<'_> {
        self.0
            .certificates()
            .map(|c| Certificate::from_der(&c.encode_ber().unwrap()).unwrap())
    }

    // // pub fn decrypt(&self, cert: &Certificate, key: &PrivateKey) -> Result<Vec<u8>, ()> {
    // //     // We use `openssl` for pkcs7 decryption as `cryptographic_message_syntax` doesn't support it.
    // //     let cert = X509::from_der(&cert.encode_der().unwrap()).unwrap();
    // //     let key = PKey::private_key_from_pkcs8(&key.encode_pkcs8_der().unwrap()).unwrap();

    // //     Ok(self
    // //         .p7
    // //         .decrypt(
    // //             &key,
    // //             &cert,
    // //             // TODO: Configure these
    // //             Pkcs7Flags::BINARY | Pkcs7Flags::NOCHAIN | Pkcs7Flags::NOINTERN,
    // //         )
    // //         .unwrap())
    // // }

    // pub fn decrypt(&self, cert: &Certificate, key: &PrivateKey) -> Result<Vec<u8>, ()> {
    //     // We use `openssl` for pkcs7 decryption as `cryptographic_message_syntax` doesn't support it.
    //     let cert = X509::from_der(&cert.encode_der().unwrap()).unwrap();
    //     let key = PKey::private_key_from_pkcs8(&key.encode_pkcs8_der().unwrap()).unwrap();

    //     Ok(self
    //         .p7
    //         .decrypt(
    //             &key,
    //             &cert,
    //             // TODO: Configure these
    //             Pkcs7Flags::BINARY | Pkcs7Flags::NOCHAIN | Pkcs7Flags::NOINTERN,
    //         )
    //         .unwrap())
    // }

    // TODO: Decrypt signed + verify signature

    // TODO: Sign
    // TODO: Encrypt

    // TODO: Verify signer certificate chain
}
