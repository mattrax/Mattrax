use cryptographic_message_syntax::{Oid, SignedData};

use crate::{
    message_type, MessageType, PkiMessage, Service, OID_SCEP_MESSAGE_TYPE, OID_SCEP_TRANSACTION_ID,
};

// TODO: rename
pub struct Scep<S> {
    service: S,
}

impl<S: Service> Scep<S> {
    /// Construct a new `Scep` instance.
    pub fn new(service: S) -> Self {
        Scep { service }
    }

    /// `GetCACaps` operation. // TODO: Spec reference
    pub fn get_ca_caps(&self) -> String {
        "Renewal\nSHA-1\nSHA-256\nAES\nDES3\nSCEPStandard\nPOSTPKIOperation".into()
    }

    /// `GetCACert` operation. // TODO: Spec reference
    pub fn get_ca_cert(&self) -> () {
        todo!();
    }

    /// `PKIOperation` operation. // TODO: Spec reference
    pub fn pki_operation(&self, body: &[u8]) -> Result<PkiMessage, ()> {
        let p7 = SignedData::parse_ber(body).unwrap();

        // TODO: Is this check wrong in the original Go code?
        // if cms.certificates().count() > 0 {
        //     // According to RFC #2315 Section 9.1, it is valid that the server sends fewer
        //     // certificates than necessary, if it is expected that those verifying the
        //     // signatures have an alternate means of obtaining necessary certificates.
        //     // In SCEP case, an alternate means is to use GetCaCert request.
        //     // Note: The https://github.com/jscep/jscep implementation logs a warning if
        //     // no certificates were found for signers in the PKCS#7 received from the
        //     // server, but the certificates obtained from GetCaCert request are still
        //     // used for decoding the message.
        //     // p7.Certificates = conf.caCerts
        //     todo!();
        // }

        // TODO
        // if err := p7.Verify(); err != nil {
        // 	return nil, err
        // }

        let (transaction_id, message_type) = p7
            .signers()
            .find_map(|s| {
                if let Some(attributes) = s.signed_attributes() {
                    let transaction_id = attributes.attributes().iter().find_map(|a| {
                        if a.typ == OID_SCEP_TRANSACTION_ID {
                            let value = (&**a.values.first().unwrap()).to_vec();

                            // println!("{:?}", value.get(0).unwrap());
                            // println!(
                            //     "{:?} {:?}",
                            //     u16::from_be_bytes(value[..2].try_into().unwrap()),
                            //     u16::from_le_bytes(value[..2].try_into().unwrap())
                            // );
                            // println!(
                            //     "{:?} {:?}",
                            //     u32::from_be_bytes(value[..4].try_into().unwrap()),
                            //     u32::from_le_bytes(value[..4].try_into().unwrap())
                            // );

                            // println!(
                            //     "TESTING {:?}",
                            //     (&**a.values.first().unwrap()).clone().decode(
                            //         cryptographic_message_syntax::asn1::rfc5652::SignedData::decode
                            //     )
                            // );

                            // TODO: Is this incorrect or is the random data at the start intentional? - https://www.oss.com/asn1/resources/asn1-made-simple/asn1-quick-reference/printablestring.html
                            return Some(String::from_utf8(value).unwrap());
                        }

                        None
                    })?;

                    let message_type = attributes.attributes().iter().find_map(|a| {
                        if a.typ == OID_SCEP_MESSAGE_TYPE {
                            let value = (&**a.values.first().unwrap()).as_slice();
                            return Some(MessageType::try_from(*value.get(0).unwrap()).unwrap());
                        }

                        None
                    })?;

                    return Some((transaction_id, message_type));
                }

                None
            })
            .ok_or(())?;

        let mut msg = PkiMessage {
            transaction_id: transaction_id,
            message_type: message_type,
            // raw: vec![], // TODO
            p7,
            cert_resp_message: None,
        };
        msg.parse_message_type();
        Ok(msg)
    }
}
