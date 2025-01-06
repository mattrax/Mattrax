use std::fmt;

// The MessageType attribute specifies the type of operation performed
// by the transaction.  This attribute MUST be included in all PKI
// messages.
//
// The following message types are defined:
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MessageType {
    CertRep,
    RenewalReq,
    UpdateReq,
    PKCSReq,
    CertPoll,
    GetCert,
    GetCRL,
}

impl fmt::Debug for MessageType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl MessageType {
    pub fn as_str(&self) -> &'static str {
        match self {
            MessageType::CertRep => "CertRep (3)",
            MessageType::RenewalReq => "RenewalReq (17)",
            MessageType::UpdateReq => "UpdateReq (18)",
            MessageType::PKCSReq => "PKCSReq (19)",
            MessageType::CertPoll => "CertPoll (20)",
            MessageType::GetCert => "GetCert (21)",
            MessageType::GetCRL => "GetCRL (22)",
        }
    }
}

impl TryFrom<u8> for MessageType {
    type Error = ();

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            3 => Ok(MessageType::CertRep),
            17 => Ok(MessageType::RenewalReq),
            18 => Ok(MessageType::UpdateReq),
            19 => Ok(MessageType::PKCSReq),
            20 => Ok(MessageType::CertPoll),
            21 => Ok(MessageType::GetCert),
            22 => Ok(MessageType::GetCRL),
            _ => Err(()),
        }
    }
}
