use bcder::{ConstOid, Oid};

/// Email Address
///
/// 1.2.840.113549.1.9.1
pub const OID_EMAIL_ADDRESS: ConstOid = Oid(&[42, 134, 72, 134, 247, 13, 1, 9, 1]);

/// Basic Constraints X.509 extension.
///
/// 2.5.29.19
pub const OID_EXTENSION_BASIC_CONSTRAINTS: ConstOid = Oid(&[85, 29, 19]);

/// Key Usage extension.
///
/// 2.5.29.15
pub const OID_KEY_USAGE: ConstOid = Oid(&[85, 29, 15]);

/// Extended Key Usage extension.
///
/// 2.5.29.37
pub const OID_EXT_KEY_USAGE: ConstOid = Oid(&[85, 29, 37]);

// 0.9.2342.19200300.100.1.1
pub const OID_LDAP_USER_ID: ConstOid = Oid(&[9, 146, 38, 137, 147, 242, 44, 100, 1, 1]);
