use bcder::Oid;
use x509_certificate::{
    rfc3280::{AttributeTypeAndValue, Name},
    rfc4519::{
        OID_COMMON_NAME, OID_COUNTRY_NAME, OID_LOCALITY_NAME, OID_ORGANIZATIONAL_UNIT_NAME,
        OID_ORGANIZATION_NAME, OID_STATE_PROVINCE_NAME,
    },
};

use super::{SubjectBuilder, OID_EMAIL_ADDRESS, OID_LDAP_USER_ID};

pub struct Subject(pub(crate) Name);

impl Subject {
    pub fn builder() -> SubjectBuilder {
        Default::default()
    }

    // TODO: Don't expose `x509-certificate` type?
    pub fn iter(&self) -> impl Iterator<Item = &AttributeTypeAndValue> {
        self.0.iter_attributes()
    }

    pub fn country(&self) -> impl Iterator<Item = String> + '_ {
        self.0
            .iter_by_oid(Oid(OID_COUNTRY_NAME.as_ref().into()))
            .map(|v| v.value.to_string().unwrap())
    }

    pub fn state_or_province(&self) -> impl Iterator<Item = String> + '_ {
        self.0
            .iter_by_oid(Oid(OID_STATE_PROVINCE_NAME.as_ref().into()))
            .map(|v| v.value.to_string().unwrap())
    }

    pub fn locality(&self) -> impl Iterator<Item = String> + '_ {
        self.0
            .iter_by_oid(Oid(OID_LOCALITY_NAME.as_ref().into()))
            .map(|v| v.value.to_string().unwrap())
    }

    pub fn organization(&self) -> impl Iterator<Item = String> + '_ {
        self.0
            .iter_by_oid(Oid(OID_ORGANIZATION_NAME.as_ref().into()))
            .map(|v| v.value.to_string().unwrap())
    }

    pub fn organizational_unit(&self) -> impl Iterator<Item = String> + '_ {
        self.0
            .iter_by_oid(Oid(OID_ORGANIZATIONAL_UNIT_NAME.as_ref().into()))
            .map(|v| v.value.to_string().unwrap())
    }

    pub fn common_name(&self) -> impl Iterator<Item = String> + '_ {
        self.0
            .iter_by_oid(Oid(OID_COMMON_NAME.as_ref().into()))
            .map(|v| v.value.to_string().unwrap())
    }

    pub fn email_address(&self) -> impl Iterator<Item = String> + '_ {
        self.0
            .iter_by_oid(Oid(OID_EMAIL_ADDRESS.as_ref().into()))
            .map(|v| v.value.to_string().unwrap())
    }

    pub fn user_id(&self) -> impl Iterator<Item = String> + '_ {
        use std::str::FromStr;
        println!(
            "{:?}",
            Oid::<bytes::Bytes>::from_str("0.9.2342.19200300.100.1.1")
                .unwrap()
                .0
                .to_vec()
        );

        self.0
            .iter_by_oid(Oid(OID_LDAP_USER_ID.as_ref().into()))
            .map(|v| v.value.to_string().unwrap())
    }
}
