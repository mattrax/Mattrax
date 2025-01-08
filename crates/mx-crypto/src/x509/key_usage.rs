use bitflags::bitflags;
use bytes::Bytes;

bitflags! {
    /// One of the purposes contained in the [key usage](https://datatracker.ietf.org/doc/html/rfc5280#section-4.2.1.3) extension
    #[derive(Debug, Clone, Copy)]
    #[repr(transparent)]
    pub struct KeyUsage: u16 {
        const DIGITAL_SIGNATURE = 0b1000_0000_0000_0000 >> 0;
        const NON_REPUDIATION   = 0b1000_0000_0000_0000 >> 1;
        const KEY_ENCIPHERMENT  = 0b1000_0000_0000_0000 >> 2;
        const DATA_ENCIPHERMENT = 0b1000_0000_0000_0000 >> 3;
        const KEY_AGREEMENT     = 0b1000_0000_0000_0000 >> 4;
        const KEY_CERT_SIGN     = 0b1000_0000_0000_0000 >> 5;
        const CRL_SIGN          = 0b1000_0000_0000_0000 >> 6;
        const ENCIPHER_ONLY     = 0b1000_0000_0000_0000 >> 7;
        const DECIPHER_ONLY     = 0b1000_0000_0000_0000 >> 8;
    }
}

impl KeyUsage {
    pub fn as_bytes(&self) -> Bytes {
        // RFC 5280 defines 9 key usages, which we detail in our key usage enum
        // We could use std::mem::variant_count here, but it's experimental
        const KEY_USAGE_BITS: usize = 9;

        Bytes::from(yasna::construct_der(|writer| {
            writer.write_bitvec_bytes(&self.bits().to_be_bytes()[..], KEY_USAGE_BITS)
        }))
    }
}

/// One of the purposes contained in the [extended key usage extension](https://tools.ietf.org/html/rfc5280#section-4.2.1.12)
#[derive(Debug, PartialEq, Eq, Hash, Clone)]
pub enum ExtendedKeyUsage {
    /// anyExtendedKeyUsage
    Any,
    /// id-kp-serverAuth
    ServerAuth,
    /// id-kp-clientAuth
    ClientAuth,
    /// id-kp-codeSigning
    CodeSigning,
    /// id-kp-emailProtection
    EmailProtection,
    /// id-kp-timeStamping
    TimeStamping,
    /// id-kp-OCSPSigning
    OcspSigning,
    /// A custom purpose not from the pre-specified list of purposes
    Other(Vec<u64>),
}

impl ExtendedKeyUsage {
    pub fn oid(&self) -> &[u64] {
        match self {
            // anyExtendedKeyUsage
            Self::Any => &[2, 5, 29, 37, 0],
            // id-kp-*
            Self::ServerAuth => &[1, 3, 6, 1, 5, 5, 7, 3, 1],
            Self::ClientAuth => &[1, 3, 6, 1, 5, 5, 7, 3, 2],
            Self::CodeSigning => &[1, 3, 6, 1, 5, 5, 7, 3, 3],
            Self::EmailProtection => &[1, 3, 6, 1, 5, 5, 7, 3, 4],
            Self::TimeStamping => &[1, 3, 6, 1, 5, 5, 7, 3, 8],
            Self::OcspSigning => &[1, 3, 6, 1, 5, 5, 7, 3, 9],
            Self::Other(oid) => oid,
        }
    }
}
