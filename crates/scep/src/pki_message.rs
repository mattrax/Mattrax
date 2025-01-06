use bcder::{
    decode::{Constructed, DecodeError, Source},
    Oid, Tag,
};
use cryptographic_message_syntax::{
    asn1::rfc5652::{
        CmsVersion, ContentEncryptionAlgorithmIdentifier, EncryptedContentInfo, EncryptedData,
        OID_ID_SIGNED_DATA,
    },
    SignedData,
};

use crate::{MessageType, PKIStatus, OID_SCEP_PKI_STATUS, OID_SCEP_RECIPIENT_NONCE};

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

                // todo!();
            }
            MessageType::GetCRL | MessageType::GetCert | MessageType::CertPoll => unimplemented!(),
        }
    }

    pub fn decrypt_pki_envelope(&self, cert: (), key: ()) {
        let signer = self.p7.signers().into_iter().next().unwrap(); // TODO: The Go code doesn't do this how?

        let content = signer.signed_content(self.p7.signed_content());

        println!(
            "{:?} {:?}",
            SignedData::parse_ber(&self.p7.signed_content().unwrap()),
            SignedData::parse_ber(&content),
            // EncryptedData::parse_ber(&self.p7.signed_content().unwrap()),
            // EncryptedData::parse_ber(&content),
        );

        let a = Constructed::decode(
            self.p7.signed_content().unwrap(),
            bcder::Mode::Ber,
            // EncryptedData::decode, // TODO
            decode,
        )
        .unwrap();

        println!("{:?}", a);
    }
}

pub fn decode<S: Source>(
    cons: &mut Constructed<S>,
) -> Result<EncryptedData, DecodeError<S::Error>> {
    cons.take_sequence(|cons| {
        let oid = Oid::take_from(cons)?;

        // if oid != OID_ID_ENCRYPTED_DATA {
        //     return Err(cons.content_err("expected encrypted data OID"));
        // }

        cons.take_constructed_if(Tag::CTX_0, take_from)
    })
}

// TODO: Contribute back to `cryptographic_message_syntax` crate
pub fn take_from<S: Source>(
    cons: &mut Constructed<S>,
) -> Result<EncryptedData, DecodeError<S::Error>> {
    cons.take_sequence(|cons| {
        let version = CmsVersion::take_from(cons)?;

        // let message_digest = message_digest
        //     .values
        //     .first()
        //     .unwrap()
        //     .deref()
        //     .clone()
        //     .decode(OctetString::take_from)
        //     .map_err(|_| CmsError::MalformedSignedAttributeMessageDigest)?
        //     .to_bytes()
        //     .to_vec();

        Ok(EncryptedData {
            version,
            encrypted_content_info: EncryptedContentInfo {
                content_type: Oid::take_from(cons)?,
                content_encryption_algorithms: ContentEncryptionAlgorithmIdentifier::take_from(
                    cons,
                )?,
                encrypted_content: None, // TODO
            },
            unprotected_attributes: None, // TODO
        })
    })
}

// TODO: BREAK OUT
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct CertRepMessage {
    pub pki_status: PKIStatus,
    pub recipient_nonce: Vec<u8>,
}
