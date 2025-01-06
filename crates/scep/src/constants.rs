use bytes::Bytes;
use cryptographic_message_syntax::Oid;

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
