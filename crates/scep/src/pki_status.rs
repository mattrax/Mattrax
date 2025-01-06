// This is copy of [cryptographic_message_syntax::asn1::rfc3161::PkiStatus](https://docs.rs/cryptographic-message-syntax/latest/cryptographic_message_syntax/asn1/rfc3161/enum.PkiStatus.html) but with SCEP terminology.

// PKIStatus is a SCEP pkiStatus attribute which holds transaction status information.
// All SCEP responses MUST include a pkiStatus.
//
// The following pkiStatuses are defined:
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PKIStatus {
    Success,
    Failure,
    Pending,
}

impl TryFrom<u8> for PKIStatus {
    type Error = ();

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(PKIStatus::Success),
            2 => Ok(PKIStatus::Failure),
            3 => Ok(PKIStatus::Pending),
            _ => Err(()),
        }
    }
}
