use bcder::{Integer, Oid};
use bytes::Bytes;
use cryptographic_message_syntax::{SignedData, SignedDataBuilder};
use oid_registry::OID_PKCS7_ID_DATA;
use x509_certificate::{rfc5280, CapturedX509Certificate, X509Certificate};
use x509_parser::prelude::*;

// TODO: Explain why the two libraries and how we could maybe drop `x509_parser` in the future.
pub fn csr_to_cert(csr: X509CertificationRequest) -> Result<X509Certificate, ()> {
    if let Some(extensions) = csr.requested_extensions() {
        for ext in extensions {
            println!("{:?}", ext);
            //     match ext {
            //         ParsedExtension::UnsupportedExtension { oid } => todo!(),
            //         ParsedExtension::ParseError { error } => todo!(),
            //         ParsedExtension::AuthorityKeyIdentifier(authority_key_identifier) => todo!(),
            //         ParsedExtension::SubjectKeyIdentifier(key_identifier) => todo!(),
            //         ParsedExtension::KeyUsage(key_usage) => todo!(),
            //         ParsedExtension::CertificatePolicies(vec) => todo!(),
            //         ParsedExtension::PolicyMappings(policy_mappings) => todo!(),
            //         ParsedExtension::SubjectAlternativeName(subject_alternative_name) => todo!(),
            //         ParsedExtension::IssuerAlternativeName(issuer_alternative_name) => todo!(),
            //         ParsedExtension::BasicConstraints(basic_constraints) => todo!(),
            //         ParsedExtension::NameConstraints(name_constraints) => todo!(),
            //         ParsedExtension::PolicyConstraints(policy_constraints) => todo!(),
            //         ParsedExtension::ExtendedKeyUsage(extended_key_usage) => todo!(),
            //         ParsedExtension::CRLDistributionPoints(crldistribution_points) => todo!(),
            //         ParsedExtension::InhibitAnyPolicy(inhibit_any_policy) => todo!(),
            //         ParsedExtension::AuthorityInfoAccess(authority_info_access) => todo!(),
            //         ParsedExtension::NSCertType(nscert_type) => todo!(),
            //         ParsedExtension::NsCertComment(_) => todo!(),
            //         ParsedExtension::IssuingDistributionPoint(issuing_distribution_point) => todo!(),
            //         ParsedExtension::CRLNumber(big_uint) => todo!(),
            //         ParsedExtension::ReasonCode(reason_code) => todo!(),
            //         ParsedExtension::InvalidityDate(asn1_time) => todo!(),
            //         ParsedExtension::SCT(vec) => todo!(),
            //         ParsedExtension::Unparsed => todo!(),
            //     }
        }
    }

    // TODO: I think part of the CSR to Cert conversion is to sign the cert with the CA's private key.

    Ok(rfc5280::Certificate {
        tbs_certificate: rfc5280::TbsCertificate {
            version: Some(match csr.certification_request_info.version {
                X509Version(1) => rfc5280::Version::V1,
                X509Version(2) => rfc5280::Version::V2,
                X509Version(3) => rfc5280::Version::V3,
                _ => todo!(),
            }),
            serial_number: Integer::from(0), // TODO: This should come from the CSR??? // TODO: csr2.params.serial_number.unwrap().to_bytes()
            signature: todo!(),
            // rfc5280::AlgorithmIdentifier {
            //     algorithm: csr2.public_key.algorithm().
            //     parameters: (),
            // },
            issuer: todo!(),
            validity: todo!(),
            // rfc5280::Validity {
            //     // TODO: Can we avoid multiple date libraries being used
            //     not_before: x509_certificate::asn1time::Time::UtcTime(
            //         DateTime::parse_from_rfc3339(
            //             &csr2.params.not_before.format(&Rfc3339).unwrap(),
            //         )
            //         .unwrap()
            //         .to_utc()
            //         .into(),
            //     ),
            //     not_after: x509_certificate::asn1time::Time::UtcTime(
            //         DateTime::parse_from_rfc3339(
            //             &csr2.params.not_before.format(&Rfc3339).unwrap(),
            //         )
            //         .unwrap()
            //         .to_utc()
            //         .into(),
            //     ),
            // },
            subject: todo!(), // Name:: // csr.info.subject.0.into_iter().map(|v| todo!()).collect(),
            subject_public_key_info: todo!(),
            issuer_unique_id: None,  // TODO
            subject_unique_id: None, // TODO
            extensions: None,        // TODO
            raw_data: None,          // TODO
        },
        signature_algorithm: rfc5280::AlgorithmIdentifier {
            algorithm: todo!(), //Oid(csr.algorithm.oid.as_bytes().to_vec().into())),
            parameters: todo!(),
            // csr
            //     .algorithm
            //     .parameters
            //     .map(|p| rfc5280::AlgorithmParameter::from_oid(Oid(p.value().to_vec().into())))),
        },
        signature: todo!(),
        // bcder::BitString::new(
        //     csr.signature.unused_bits(),
        //     csr.signature.as_bytes().unwrap().into(),
        // ),
    }
    .into())
}

// TODO: is this correct: https://github.com/smallstep/pkcs7/blob/896672eee96663987221f890d7f950619e76e629/sign.go#L408
// TODO: Take in `CapturedX509Certificate`?
pub fn degenerate_certificate(cert: Vec<u8>) -> Vec<u8> {
    SignedDataBuilder::default()
        .certificate(CapturedX509Certificate::from_der(cert).unwrap())
        .build_der()
        .unwrap()
}
