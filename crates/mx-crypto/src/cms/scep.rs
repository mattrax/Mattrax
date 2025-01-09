//! TODO: Turn this into a generalised abstraction and move a bunch of the logic to the `scep` crate.

use std::str::FromStr;

use bcder::{encode::Values, Captured, Mode, OctetString, Oid, PrintableString, Utf8String};
use bytes::Bytes;
use cryptographic_message_syntax::{
    asn1::rfc5652::{
        CertificateChoices, CertificateSet, CmsVersion, DigestAlgorithmIdentifiers,
        EncapsulatedContentInfo, SignedData, SignerInfos, OID_ID_DATA,
    },
    SignedDataBuilder, SignerBuilder,
};
use openssl::{pkcs7::Pkcs7Flags, stack::Stack, symm, x509::X509};
use x509_certificate::{
    rfc5652::AttributeValue, CapturedX509Certificate, InMemorySigningKeyPair, X509Certificate,
};

pub fn scep_success(
    cert_der: Vec<u8>,
    key_der: Vec<u8>,
    csr: Vec<u8>,
    p7_certificates: Vec<Vec<u8>>,
    transaction_id: String,
    sender_nonce: Vec<u8>,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let deg = {
        let mut certs = CertificateSet::default();
        let c = X509Certificate::from_der(&csr).unwrap();
        certs.push(CertificateChoices::Certificate(Box::new(c.into())));
        let sd = SignedData {
            version: CmsVersion::V1,
            digest_algorithms: DigestAlgorithmIdentifiers::default(),
            content_info: EncapsulatedContentInfo {
                content_type: Oid(OID_ID_DATA.as_ref().into()),
                content: None,
            },
            certificates: Some(certs),
            crls: None,
            signer_infos: SignerInfos::default(),
        };

        let mut buf = Vec::new();
        sd.encode_ref().write_encoded(Mode::Der, &mut buf).unwrap();
        buf
    };

    let mut certs = Stack::new().unwrap();
    for cert in p7_certificates.iter() {
        certs.push(X509::from_der(&cert).unwrap()).unwrap();
    }

    let e7 = openssl::pkcs7::Pkcs7::encrypt(
        &certs,
        &deg,
        symm::Cipher::aes_128_cbc(), // TODO: Go uses `des_cbc()` but isn't fully supported by OpenSSL?
        Pkcs7Flags::BINARY,
    )
    .unwrap();
    let encrypted = e7.to_der().unwrap();

    let out = SignedDataBuilder::default()
        // add the certificate into the signed data type
        // this cert must be added before the signedData because the recipient will expect it
        // as the first certificate in the array
        .certificate(CapturedX509Certificate::from_der(csr).unwrap())
        .signer(
            SignerBuilder::new(
                &InMemorySigningKeyPair::from_pkcs8_der(key_der).unwrap(),
                CapturedX509Certificate::from_der(cert_der).unwrap(),
            )
            .signed_attribute(
                OID_SCEP_TRANSACTION_ID,
                vec![AttributeValue::new(Captured::from_values(
                    Mode::Der,
                    Utf8String::from_str(&transaction_id).unwrap().encode_ref(),
                ))],
            )
            .signed_attribute(
                OID_SCEP_PKI_STATUS,
                vec![AttributeValue::new(Captured::from_values(
                    Mode::Der,
                    PrintableString::from_str("0") // PKIStatus::Success
                        .unwrap()
                        .encode_ref(),
                ))],
            )
            .signed_attribute(
                OID_SCEP_MESSAGE_TYPE,
                vec![AttributeValue::new(Captured::from_values(
                    Mode::Der,
                    PrintableString::from_str("3") // MessageType::CertRep
                        .unwrap()
                        .encode_ref(),
                ))],
            )
            .signed_attribute(
                OID_SCEP_SENDER_NONCE,
                vec![AttributeValue::new(Captured::from_values(
                    Mode::Der,
                    OctetString::new(sender_nonce.clone().into()).encode_ref(),
                ))],
            )
            .signed_attribute(
                OID_SCEP_RECIPIENT_NONCE,
                vec![AttributeValue::new(Captured::from_values(
                    Mode::Der,
                    OctetString::new(sender_nonce.clone().into()).encode_ref(),
                ))],
            ),
        )
        .content_type(Oid(OID_ID_DATA.as_ref().into()))
        .content_inline(encrypted)
        .build_der()
        .unwrap();

    Ok(out)
}

// 2.16.840.1.113733.1.9.2
pub const OID_SCEP_MESSAGE_TYPE: Oid =
    Oid(Bytes::from_static(&[96, 134, 72, 1, 134, 248, 69, 1, 9, 2]));

// 2.16.840.1.113733.1.9.3
pub const OID_SCEP_PKI_STATUS: Oid =
    Oid(Bytes::from_static(&[96, 134, 72, 1, 134, 248, 69, 1, 9, 3]));

// 2.16.840.1.113733.1.9.4
pub const OID_SCEP_FAIL_INFO: Oid =
    Oid(Bytes::from_static(&[96, 134, 72, 1, 134, 248, 69, 1, 9, 4]));

// 2.16.840.1.113733.1.9.5
pub const OID_SCEP_SENDER_NONCE: Oid =
    Oid(Bytes::from_static(&[96, 134, 72, 1, 134, 248, 69, 1, 9, 5]));

// 2.16.840.1.113733.1.9.6
pub const OID_SCEP_RECIPIENT_NONCE: Oid =
    Oid(Bytes::from_static(&[96, 134, 72, 1, 134, 248, 69, 1, 9, 6]));

// 2.16.840.1.113733.1.9.7
pub const OID_SCEP_TRANSACTION_ID: Oid =
    Oid(Bytes::from_static(&[96, 134, 72, 1, 134, 248, 69, 1, 9, 7]));
