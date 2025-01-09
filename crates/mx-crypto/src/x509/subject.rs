use x509_certificate::rfc3280::{AttributeTypeAndValue, Name};

use super::{
    SubjectBuilder, OID_COMMON_NAME, OID_COUNTRY_NAME, OID_EMAIL_ADDRESS, OID_LDAP_USER_ID,
    OID_LOCALITY_NAME, OID_ORGANIZATIONAL_UNIT_NAME, OID_ORGANIZATION_NAME,
    OID_STATE_PROVINCE_NAME,
};

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
            .iter_by_oid(OID_COUNTRY_NAME)
            .map(|v| v.value.to_string().unwrap())
    }

    pub fn state_or_province(&self) -> impl Iterator<Item = String> + '_ {
        self.0
            .iter_by_oid(OID_STATE_PROVINCE_NAME)
            .map(|v| v.value.to_string().unwrap())
    }

    pub fn locality(&self) -> impl Iterator<Item = String> + '_ {
        self.0
            .iter_by_oid(OID_LOCALITY_NAME)
            .map(|v| v.value.to_string().unwrap())
    }

    pub fn organization(&self) -> impl Iterator<Item = String> + '_ {
        self.0
            .iter_by_oid(OID_ORGANIZATION_NAME)
            .map(|v| v.value.to_string().unwrap())
    }

    pub fn organizational_unit(&self) -> impl Iterator<Item = String> + '_ {
        self.0
            .iter_by_oid(OID_ORGANIZATIONAL_UNIT_NAME)
            .map(|v| v.value.to_string().unwrap())
    }

    pub fn common_name(&self) -> impl Iterator<Item = String> + '_ {
        self.0
            .iter_by_oid(OID_COMMON_NAME)
            .map(|v| v.value.to_string().unwrap())
    }

    pub fn email_address(&self) -> impl Iterator<Item = String> + '_ {
        self.0
            .iter_by_oid(OID_EMAIL_ADDRESS)
            .map(|v| v.value.to_string().unwrap())
    }

    pub fn user_id(&self) -> impl Iterator<Item = String> + '_ {
        self.0
            .iter_by_oid(OID_LDAP_USER_ID)
            .map(|v| v.value.to_string().unwrap())
    }
}
