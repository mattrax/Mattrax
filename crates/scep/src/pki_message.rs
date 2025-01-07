// use bcder::{
//     decode::{Constructed, DecodeError, Source},
//     Integer, Mode, Oid, Tag,
// };
// use chrono::{DateTime, Utc};
use cryptographic_message_syntax::{
    asn1::rfc5652::{
        CmsVersion, ContentEncryptionAlgorithmIdentifier, EncryptedContentInfo, EncryptedData,
        OID_ID_SIGNED_DATA,
    },
    SignedData,
};
use der_parser::asn1_rs::{Integer, ToDer};
use foreign_types_shared::ForeignType;
use openssl::{
    cipher::Cipher,
    hash::MessageDigest,
    nid::Nid,
    pkcs7::{Pkcs7, Pkcs7Flags},
    pkey::PKey,
    stack::{Stack, StackRef},
    symm,
    x509::{X509Req, X509},
};
use x509_parser::prelude::*;
// use rsa::pkcs1::DecodeRsaPublicKey;
// use rustls_pki_types::CertificateSigningRequestDer;
// use time::format_description::well_known::Rfc3339;
use x509_certificate::{
    asn1time::UtcTime,
    rfc2986,
    rfc5280::{self, TbsCertificate},
    X509Certificate,
};
// use x509_verify::{
//     der::{Decode, Reader, SliceReader},
//     x509_cert::request::CertReq,
// };

use crate::{
    crypto, MessageType, PKIStatus, OID_SCEP_PKI_STATUS, OID_SCEP_RECIPIENT_NONCE,
    OID_SCEP_SENDER_NONCE,
};

/// PKIMessage defines the possible SCEP message types
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct PkiMessage {
    pub transaction_id: String,
    pub message_type: MessageType,
    // pub raw: Vec<u8>, // TODO
    pub p7: SignedData, // TODO: Making this public causes `cryptographic_message_syntax` to be a public dependency. Do we want that?
    // TODO: Enum for this or force the user to call `parse_message_type`???
    pub cert_resp_message: Option<CertRepMessage>,
    pub sender_nonce: Option<Vec<u8>>,
}

impl PkiMessage {
    pub fn parse_message_type(&mut self) {
        match self.message_type {
            MessageType::CertRep => {
                let signer = self.p7.signers().into_iter().next().unwrap(); // TODO: The Go code doesn't do this how?

                let pki_status = signer
                    .signed_attributes()
                    .unwrap()
                    .attributes()
                    .iter()
                    .find_map(|a| {
                        if a.typ == OID_SCEP_PKI_STATUS {
                            let value = (&**a.values.first().unwrap()).as_slice();
                            return Some(PKIStatus::try_from(*value.get(0).unwrap()).unwrap());
                        }

                        None
                    })
                    .unwrap();

                let recipient_nonce = signer
                    .signed_attributes()
                    .unwrap()
                    .attributes()
                    .iter()
                    .find_map(|a| {
                        if a.typ == OID_SCEP_RECIPIENT_NONCE {
                            let value = (&**a.values.first().unwrap()).to_vec();
                            return Some(value);
                        }

                        None
                    })
                    .unwrap();
                if recipient_nonce.len() == 0 {
                    todo!();
                    // return errors.New("scep: pkiMessage must include recipientNonce attribute")
                }

                let cr = CertRepMessage {
                    pki_status,
                    recipient_nonce,
                };

                match pki_status {
                    PKIStatus::Success | PKIStatus::Pending => {}
                    PKIStatus::Failure => {
                        // https://github.com/smallstep/scep/blob/a37a330173bcdfa87c08f364a46eef8db65715be/scep.go#L305

                        todo!();
                    }
                }
                self.cert_resp_message = Some(cr);
            }
            MessageType::PKCSReq | MessageType::UpdateReq | MessageType::RenewalReq => {
                // https://github.com/smallstep/scep/blob/a37a330173bcdfa87c08f364a46eef8db65715be/scep.go#L321

                let signer = self.p7.signers().into_iter().next().unwrap(); // TODO: The Go code doesn't do this how?

                let sender_nonce = signer
                    .signed_attributes()
                    .unwrap()
                    .attributes()
                    .iter()
                    .find_map(|a| {
                        if a.typ == OID_SCEP_SENDER_NONCE {
                            let value = (&**a.values.first().unwrap()).to_vec();
                            return Some(value);
                        }

                        None
                    })
                    .unwrap();
                if sender_nonce.len() == 0 {
                    todo!();
                    // return errors.New("scep: pkiMessage must include senderNonce attribute")
                }
                self.sender_nonce = Some(sender_nonce);

                // todo!();
            }
            MessageType::GetCRL | MessageType::GetCert | MessageType::CertPoll => unimplemented!(),
        }
    }

    // TODO: Taking pre-parsed identity? Maybe get from `Scep`/`Service`?
    // TODO: `smallstep/scep` parses the x509 cert back the user to let them sign it? We should do that to give way more control.
    pub fn decrypt_pki_envelope(&self, cert_der: Vec<u8>, key_der: Vec<u8>) -> Result<Vec<u8>, ()> {
        // let signer = self.p7.signers().into_iter().next().unwrap(); // TODO: The Go code doesn't do this how?

        // let content = signer.signed_content(self.p7.signed_content());

        let p7 = openssl::pkcs7::Pkcs7::from_der(self.p7.signed_content().unwrap()).unwrap();

        let cert = X509::from_der(&cert_der).unwrap();
        let key = PKey::private_key_from_pkcs8(&key_der).unwrap();

        let csr = p7
            .decrypt(
                &key,
                &cert,
                // TODO: Configure these
                Pkcs7Flags::BINARY | Pkcs7Flags::NOCHAIN | Pkcs7Flags::NOINTERN,
            )
            .unwrap();
        println!("RAW: {:?}", csr);

        let csr = X509Req::from_der(&csr).unwrap();
        // TODO: Validate the certificate. Eg. can't be CA, can't have certain key usages, etc.

        let mut cert = X509::builder().unwrap();
        cert.set_version(csr.version()).unwrap();
        cert.set_subject_name(csr.subject_name()).unwrap();
        cert.set_pubkey(&*csr.public_key().unwrap()).unwrap();
        cert.set_not_after(&openssl::asn1::Asn1Time::days_from_now(365).unwrap()) // TODO: Tune this value
            .unwrap();
        cert.set_not_before(&openssl::asn1::Asn1Time::days_from_now(0).unwrap()) // TODO: Tune this value
            .unwrap();
        // TODO: Go through setting everything

        cert.sign(&key, MessageDigest::sha256()).unwrap(); // TODO: Which hash?
        let cert = cert.build();

        return Ok(cert.to_der().unwrap());

        // {
        //     let (_, csr) = X509CertificationRequest::from_der(&csr).unwrap();
        //     csr.verify_signature().unwrap();

        //     let cert = crypto::csr_to_cert(csr).unwrap();
        //     // TODO: Validate the certificate. Eg. can't be CA, can't have certain key usages, etc.

        //     // TODO: We need to work out how to actually sign it???

        //     println!("{:?}", cert);
        // }
    }

    pub fn success(
        &self,
        cert_der: Vec<u8>,
        key_der: Vec<u8>,
        csr: Vec<u8>,
    ) -> Result<Vec<u8>, ()> {
        let p7_certificates = self
            .p7
            .certificates()
            .map(|c| c.encode_ber().unwrap())
            .collect::<Vec<_>>();

        let result = mx_golang::scep_success(
            cert_der,
            key_der,
            csr,
            p7_certificates,
            self.transaction_id.clone(),
            self.sender_nonce.clone().unwrap(),
        )
        .unwrap();
        println!("GO OUTPUT: {:?}", result);
        // todo!();
        return Ok(result);

        // let cert = X509::from_der(&cert_der).unwrap();
        // let key = PKey::private_key_from_pkcs8(&key_der).unwrap();

        // let csr = crypto::degenerate_certificate(csr);

        // TODO: None of the Rust libraries have a `EncryptedDataBuilder`. Bruh.

        // let mut certs = Stack::new().unwrap();
        // certs.push(cert).unwrap();

        // let pkcs = Pkcs7::encrypt(
        //     &certs,
        //     &csr,
        //     // TODO: Is this good?
        //     symm::Cipher::aes_128_ecb(),
        //     // TODO: Which flags do we want?
        //     Pkcs7Flags::PARTIAL,
        // )
        // .unwrap();

        // TODO: Reusing this?
        // let nid = Nid::create("1.2.3.4.5", "OID_example", "Our example OID").unwrap();

        // let data = openssl::asn1::Asn1OctetString::new_from_bytes(b"Testing").unwrap();

        // unsafe {
        //     let signer = openssl_sys::PKCS7_get_signer_info(pkcs.as_ptr()); // TODO: Do we need to drop this structure?

        //     openssl_sys::PKCS7_add_signed_attribute(
        //         signer,
        //         nid.as_raw(),
        //         openssl_sys::V_ASN1_OCTET_STRING,
        //         data.as_ptr() as *mut _,
        //     );

        //     // let todo = openssl_sys::PKCS7_final(pkcs.as_ptr(), key.as_ptr(), cert.as_ptr(), 0);
        // };

        // The normal way to use PKCS7_add_signed_attribute() is to first create a SignedInfo object with PKCS7_sign(3) using the PKCS7_PARTIAL or PKCS7_STREAM flag, retrieve the PKCS7_SIGNER_INFO object with PKCS7_get_signer_info(3) or add an additional one with PKCS7_sign_add_signer(3), call PKCS7_add_signed_attribute() for each desired additional attribute, then do the signing with PKCS7_final(3) or with another finalizing function.

        // TODO: https://github.com/sfackler/rust-openssl/issues/1772

        // pkcs.signers(certs, flags)

        // return Ok(pkcs.to_der().unwrap());

        // Encrypt::default();

        // todo!();
    }
}

// csr.verify(key) // TODO

// let cert = rfc5280::Certificate {
//     tbs_certificate: rfc5280::TbsCertificate {
//         version: Some(match csr.certification_request_info.version {
//             X509Version(1) => rfc5280::Version::V1,
//             X509Version(2) => rfc5280::Version::V2,
//             X509Version(3) => rfc5280::Version::V3,
//             _ => todo!(),
//         }),
//         serial_number: Integer::from(0), // TODO: This should come from the CSR??? // TODO: csr2.params.serial_number.unwrap().to_bytes()
//         signature: rfc5280::AlgorithmIdentifier {
//             algorithm: csr2.public_key.algorithm().
//             parameters: (),
//         },
//         issuer: todo!(),
//         validity: rfc5280::Validity {
//             // TODO: Can we avoid multiple date libraries being used
//             not_before: x509_certificate::asn1time::Time::UtcTime(
//                 DateTime::parse_from_rfc3339(
//                     &csr2.params.not_before.format(&Rfc3339).unwrap(),
//                 )
//                 .unwrap()
//                 .to_utc()
//                 .into(),
//             ),
//             not_after: x509_certificate::asn1time::Time::UtcTime(
//                 DateTime::parse_from_rfc3339(
//                     &csr2.params.not_before.format(&Rfc3339).unwrap(),
//                 )
//                 .unwrap()
//                 .to_utc()
//                 .into(),
//             ),
//         },
//         subject: todo!(), // Name:: // csr.info.subject.0.into_iter().map(|v| todo!()).collect(),
//         subject_public_key_info: todo!(),
//         issuer_unique_id: None,  // TODO
//         subject_unique_id: None, // TODO
//         extensions: None,        // TODO
//         raw_data: None,          // TODO
//     },
//     signature_algorithm: rfc5280::AlgorithmIdentifier {
//         algorithm: Oid(csr.algorithm.oid.as_bytes().to_vec().into()),
//         parameters: csr
//             .algorithm
//             .parameters
//             .map(|p| rfc5280::AlgorithmParameter::from_oid(Oid(p.value().to_vec().into()))),
//     },
//     signature: bcder::BitString::new(
//         csr.signature.unused_bits(),
//         csr.signature.as_bytes().unwrap().into(),
//     ),
// };

// println!("{:?}", csr);

// csr.certification_request_info.

// csr.requested_extensions() // TODO: Prevent the cert being issued as a CA or with not required key usages, etc
// TODO: https://docs.rs/rcgen/latest/src/rcgen/csr.rs.html#97-188

// let csr2: CertificateSigningRequestDer<'_> = csr.clone().into();
// let csr2 = rcgen::CertificateSigningRequestParams::from_der(&csr2).unwrap();
// println!("RCGEN: {:?}\n\n", csr2.params);

// let csr3 = Constructed::decode(&*csr, Mode::Der, |cons| {
//     rfc2986::CertificationRequest::take_from(cons)
// })
// .unwrap();
// csr3.certificate_request_info
//     .attributes
//     .iter()
//     .for_each(|a| {
//         println!("\t CSR ATTR: {:?}", a);
//     });
// println!("CSR3: {:?}", csr3.certificate_request_info.attributes);

// let csr2 = x509_cert::CertReq::try_from(csr);
// println!("x509-cert: {:?}", csr2);

// `x509-certificate` is missing CSR parsing.
//      `x509_certificate::rfc2986::CertificationRequest` has no parse method and seems to match `x509-cert` in terms of missing information.
// `rcgen` makes importing the certificate and private key impossible.
// `x509-cert` is missing important information on the CSR.

// let csr = CertReq::from_der(&csr).unwrap();
// println!("{:?}", csr.info);

// csr.info.attributes.iter().for_each(|a| {
// println!("ATTR: {:?}", a);
// });

// println!("{:?}", csr.info.public_key.algorithm);
// let pk = rsa::RsaPublicKey::from_pkcs1_der(
//     csr.info.public_key.subject_public_key.as_bytes().unwrap(),
// )
// .unwrap();
// println!("{:?}", pk);

// let cert =
//     X509Certificate::from_der(csr.info.public_key.subject_public_key.as_bytes().unwrap())
//         .unwrap();

// println!("{:?}", cert.subject_common_name());

// let header = Header::decode(reader)?;
// header.tag.assert_eq(T::TAG)?;
// T::decode_value(reader, header)

// let mut reader =
//     SliceReader::new(csr.info.public_key.subject_public_key.as_bytes().unwrap())?;
// let result = rfc5280::TbsCertificate::decode(&mut reader).unwrap();
// let todo = reader.finish(result);

// let todo =
//     rfc5280::TbsCertificate::parse_ber(&csr.info.certification_request_info).unwrap();

// let todo = csr2.params.not_after

// println!(
//     "{:?} {:?}",
//     SignedData::parse_ber(&self.p7.signed_content().unwrap()),
//     SignedData::parse_ber(&content),
//     // EncryptedData::parse_ber(&self.p7.signed_content().unwrap()),
//     // EncryptedData::parse_ber(&content),
// );

// let a = Constructed::decode(
//     self.p7.signed_content().unwrap(),
//     bcder::Mode::Ber,
//     // EncryptedData::decode, // TODO
//     decode,
// )
// .unwrap();

// println!("{:?}", a);

// pub fn decode<S: Source>(
//     cons: &mut Constructed<S>,
// ) -> Result<EncryptedData, DecodeError<S::Error>> {
//     cons.take_sequence(|cons| {
//         let oid = Oid::take_from(cons)?;

//         // if oid != OID_ID_ENCRYPTED_DATA {
//         //     return Err(cons.content_err("expected encrypted data OID"));
//         // }

//         cons.take_constructed_if(Tag::CTX_0, take_from)
//     })
// }

// // TODO: Contribute back to `cryptographic_message_syntax` crate
// pub fn take_from<S: Source>(
//     cons: &mut Constructed<S>,
// ) -> Result<EncryptedData, DecodeError<S::Error>> {
//     cons.take_sequence(|cons| {
//         let version = CmsVersion::take_from(cons)?;

//         // let message_digest = message_digest
//         //     .values
//         //     .first()
//         //     .unwrap()
//         //     .deref()
//         //     .clone()
//         //     .decode(OctetString::take_from)
//         //     .map_err(|_| CmsError::MalformedSignedAttributeMessageDigest)?
//         //     .to_bytes()
//         //     .to_vec();

//         Ok(EncryptedData {
//             version,
//             encrypted_content_info: EncryptedContentInfo {
//                 content_type: Oid::take_from(cons)?,
//                 content_encryption_algorithms: ContentEncryptionAlgorithmIdentifier::take_from(
//                     cons,
//                 )?,
//                 encrypted_content: None, // TODO
//             },
//             unprotected_attributes: None, // TODO
//         })
//     })
// }

// TODO: BREAK OUT
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct CertRepMessage {
    pub pki_status: PKIStatus,
    pub recipient_nonce: Vec<u8>,
}
