//! Verifying PKCS7 (CMS) is a bit of a mess in Rust and that isn't helped by Apple's usage of a super old CA.
//!
//! The device-signed PKCS7 message is signed by an Apple CA that expired in 2017 so we need to override the not_after checking.
//! It also BER encoded and makes use of indefinite length which causes issues with many libraries that support DER as it forbids indefinite length encoding.
//!
//! Crates:
//!  - `cms` - Doesn't work due to: https://github.com/RustCrypto/formats/issues/779
//!  - `cryptographic_message_syntax` is able to parse the message but all of it's verification methods are broken.
//!
//! Due to this we use `cryptographic_message_syntax` to parse the PKCS7.
//! We then reparse the certificate with `x509_verify` to verify the integrity of the certificate chain. (Tracked as https://github.com/indygreg/cryptography-rs/issues/1)
//! We then convert the public key to `rsa` to verify the signature matches the signed content.
//!

use std::cell::LazyCell;

use cryptographic_message_syntax::SignedData;
use rsa::signature::Verifier;
use rsa::{pkcs1v15, RsaPublicKey};
use rsa::{pkcs1v15::Signature, BigUint};
use thiserror::Error;
use x509_certificate::SignatureAlgorithm;
use x509_verify::{
    der::{Decode, DecodePem},
    x509_cert::Certificate,
    VerifyingKey,
};

pub const APPLE_IPHONE_DEVICE_CA: LazyCell<Certificate> = LazyCell::new(|| {
    // CN=Apple iPhone Device CA, OU=Apple iPhone, O=Apple Inc., C=US
    // This certificate expired in 2014 but Apple still use it, lol
    Certificate::from_pem(
        b"-----BEGIN CERTIFICATE-----
MIIDaTCCAlGgAwIBAgIBATANBgkqhkiG9w0BAQUFADB5MQswCQYDVQQGEwJVUzET
MBEGA1UEChMKQXBwbGUgSW5jLjEmMCQGA1UECxMdQXBwbGUgQ2VydGlmaWNhdGlv
biBBdXRob3JpdHkxLTArBgNVBAMTJEFwcGxlIGlQaG9uZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTAeFw0wNzA0MTYyMjU0NDZaFw0xNDA0MTYyMjU0NDZaMFoxCzAJ
BgNVBAYTAlVTMRMwEQYDVQQKEwpBcHBsZSBJbmMuMRUwEwYDVQQLEwxBcHBsZSBp
UGhvbmUxHzAdBgNVBAMTFkFwcGxlIGlQaG9uZSBEZXZpY2UgQ0EwgZ8wDQYJKoZI
hvcNAQEBBQADgY0AMIGJAoGBAPGUSsnquloYYK3Lok1NTlQZaRdZB2bLl+hmmkdf
Rq5nerVKc1SxywT2vTa4DFU4ioSDMVJl+TPhl3ecK0wmsCU/6TKqewh0lOzBSzgd
Z04IUpRai1mjXNeT9KD+VYW7TEaXXm6yd0UvZ1y8Cxi/WblshvcqdXbSGXH0KWO5
JQuvAgMBAAGjgZ4wgZswDgYDVR0PAQH/BAQDAgGGMA8GA1UdEwEB/wQFMAMBAf8w
HQYDVR0OBBYEFLL+ISNEhpVqedWBJo5zENinTI50MB8GA1UdIwQYMBaAFOc0Ki4i
3jlga7SUzneDYS8xoHw1MDgGA1UdHwQxMC8wLaAroCmGJ2h0dHA6Ly93d3cuYXBw
bGUuY29tL2FwcGxlY2EvaXBob25lLmNybDANBgkqhkiG9w0BAQUFAAOCAQEAd13P
Z3pMViukVHe9WUg8Hum+0I/0kHKvjhwVd/IMwGlXyU7DhUYWdja2X/zqj7W24Aq5
7dEKm3fqqxK5XCFVGY5HI0cRsdENyTP7lxSiiTRYj2mlPedheCn+k6T5y0U4Xr40
FXwWb2nWqCF1AgIudhgvVbxlvqcxUm8Zz7yDeJ0JFovXQhyO5fLUHRLCQFssAbf8
B4i8rYYsBUhYTspVJcxVpIIltkYpdIRSIARA49HNvKK4hzjzMS/OhKQpVKw+OCEZ
xptCVeN2pjbdt9uzi175oVo/u6B2ArKAW17u6XEHIdDMOe7cb33peVI6TD15W4MI
pyQPbp8orlXe+tA8JA==
-----END CERTIFICATE-----",
    )
    .expect("Failed to parse APPLE_IPHONE_DEVICE_CA")
});

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
    #[error("no payload was found in the PKCS7 message")]
    MissingPayload,
}

/// Parse a PKCS7 message to get the signed content and verify the signature and signer.
///
/// Providing an empty list of `expected_ca` will skip the verification of the signer.
///
/// This code is adapted from: https://github.com/smallstep/pkcs7/blob/896672eee96663987221f890d7f950619e76e629/verify.go#L27
pub fn parse_and_verify_pkcs7<'a>(
    data: &[u8],
    truststore: &[&'a Certificate],
) -> Result<Vec<u8>, PkcsVerificationError> {
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
        let certificate2 = Certificate::from_der(
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
            let key = VerifyingKey::try_from(*ca)?;
            if let Err(err) = key.verify(&certificate2) {
                todo!();
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

    d.signed_content()
        .ok_or(PkcsVerificationError::MissingPayload)
        .map(|v| v.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apple_iphone_device_ca() {
        // Check it didn't panic
        let _ = &*APPLE_IPHONE_DEVICE_CA;
    }
}
