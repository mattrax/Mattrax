use bcder::Oid;
use bytes::Bytes;

/// Email Address
///
/// 1.2.840.113549.1.9.1
pub const OID_EMAIL_ADDRESS: Oid = Oid(Bytes::from_static(&[42, 134, 72, 134, 247, 13, 1, 9, 1]));

/// Basic Constraints X.509 extension.
///
/// 2.5.29.19
pub const OID_EXTENSION_BASIC_CONSTRAINTS: Oid = Oid(Bytes::from_static(&[85, 29, 19]));

/// Key Usage extension.
///
/// 2.5.29.15
pub const OID_KEY_USAGE: Oid = Oid(Bytes::from_static(&[85, 29, 15]));

/// Extended Key Usage extension.
///
/// 2.5.29.37
pub const OID_EXT_KEY_USAGE: Oid = Oid(Bytes::from_static(&[85, 29, 37]));

// 0.9.2342.19200300.100.1.1
pub const OID_LDAP_USER_ID: Oid = Oid(Bytes::from_static(&[
    9, 146, 38, 137, 147, 242, 44, 100, 1, 1,
]));

/// Common Name (CN)
///
/// 2.5.4.3
pub const OID_COMMON_NAME: Oid = Oid(Bytes::from_static(&[85, 4, 3]));

/// Country Name (C)
///
/// 2.5.4.6
pub const OID_COUNTRY_NAME: Oid = Oid(Bytes::from_static(&[85, 4, 6]));

/// Locality Name (L)
///
/// 2.5.4.7
pub const OID_LOCALITY_NAME: Oid = Oid(Bytes::from_static(&[85, 4, 7]));

/// State or Province Name
///
/// 2.5.4.8
pub const OID_STATE_PROVINCE_NAME: Oid = Oid(Bytes::from_static(&[85, 4, 8]));

/// Organization Name (O)
///
/// 2.5.4.10
pub const OID_ORGANIZATION_NAME: Oid = Oid(Bytes::from_static(&[85, 4, 10]));

/// Organizational Unit Name (OU)
///
/// 2.5.4.11
pub const OID_ORGANIZATIONAL_UNIT_NAME: Oid = Oid(Bytes::from_static(&[85, 4, 11]));

/// The data content type.
///
/// `id-data` in the specification.
///
/// 1.2.840.113549.1.7.1
pub const OID_ID_DATA: Oid = Oid(Bytes::from_static(&[42, 134, 72, 134, 247, 13, 1, 7, 1]));
