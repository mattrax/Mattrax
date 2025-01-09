//! Temporary bindings to Go due to Rust's lack of good crypto libraries.
//!
//! Long term we will remove this and replace it with Rust code.
#![allow(non_upper_case_globals)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]

use std::{io::Write, process::Stdio, str::FromStr};

use bcder::{
    encode::{self, Constructed, PrimitiveContent, Values},
    Captured, Mode, OctetString, Oid, PrintableString, Tag, Utf8String,
};
use bytes::Bytes;
use cryptographic_message_syntax::{
    asn1::rfc5652::{
        CertificateChoices, CertificateSet, CmsVersion, ContentInfo, DigestAlgorithmIdentifiers,
        EncapsulatedContentInfo, SignedData, SignerInfos, OID_ID_DATA, OID_ID_SIGNED_DATA,
    },
    SignedDataBuilder, SignerBuilder,
};
use openssl::{pkcs7::Pkcs7Flags, pkey::PKey, stack::Stack, symm, x509::X509};
use x509_certificate::{
    rfc5652::AttributeValue, CapturedX509Certificate, InMemorySigningKeyPair, X509Certificate,
};

const BINARY: &[u8] = include_bytes!("../out/mxgolang");

fn run(args: &[&str], input: Vec<u8>) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    // TODO: Cache these calls
    {
        std::fs::write("./_mttx_golang", BINARY).unwrap();
        std::process::Command::new("chmod")
            .arg("+x")
            .arg("./_mttx_golang")
            .output()?;
    }

    // TODO: Checking process exit status

    let mut child = std::process::Command::new("./_mttx_golang")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;

    let stdin = child.stdin.as_mut().unwrap();
    stdin.write_all(&input)?;

    let output = child.wait_with_output()?;

    // TODO: Checking process exit status

    Ok(output.stdout)
}

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
        // for cert in p7_certificates.iter() {
        //     let c = X509Certificate::from_der(cert).unwrap();
        //     certs.push(CertificateChoices::Certificate(Box::new(c.into())));
        // }
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
        // std::fs::write("./pending_stage_1", &buf).unwrap();
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
    std::fs::write("./pending_stage_2", &encrypted).unwrap(); // TODO

    let out2 = run(
        &["pkcs_encrypt"],
        format!(
            "{}\n{}\n{}\n{}\n{}\n{}\n",
            serde_json::to_string(&cert_der).unwrap(),
            serde_json::to_string(&key_der).unwrap(),
            serde_json::to_string(&csr).unwrap(),
            serde_json::to_string(&p7_certificates).unwrap(),
            serde_json::to_string(&transaction_id).unwrap(),
            serde_json::to_string(&sender_nonce).unwrap(),
        )
        .as_bytes()
        .to_vec(),
    )?
    .trim_ascii_end()
    .to_vec();

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
            ), //
               // .signed_attribute_octet_string(OID_SCEP_TRANSACTION_ID, transaction_id.as_bytes())
               // .signed_attribute_octet_string(OID_SCEP_PKI_STATUS, "0".as_bytes()) // PKIStatus::Success
               // .signed_attribute_octet_string(OID_SCEP_MESSAGE_TYPE, "3".as_bytes()) // MessageType::CertRep
               // .signed_attribute_octet_string(OID_SCEP_SENDER_NONCE, sender_nonce.as_slice())
               // .signed_attribute_octet_string(OID_SCEP_RECIPIENT_NONCE, sender_nonce.as_slice()),
        )
        .content_type(Oid(OID_ID_DATA.as_ref().into()))
        .content_inline(encrypted)
        .build_der()
        .unwrap();

    std::fs::write("./end", &out2).unwrap();
    std::fs::write("./end-rs", &out).unwrap();

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
