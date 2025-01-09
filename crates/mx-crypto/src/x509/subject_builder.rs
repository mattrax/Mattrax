use x509_certificate::rfc3280::Name;

use crate::x509::{
    OID_COMMON_NAME, OID_COUNTRY_NAME, OID_EMAIL_ADDRESS, OID_LOCALITY_NAME,
    OID_ORGANIZATIONAL_UNIT_NAME, OID_ORGANIZATION_NAME, OID_STATE_PROVINCE_NAME,
};

use super::Subject;

#[derive(Default)]
pub struct SubjectBuilder(Name);

impl SubjectBuilder {
    pub fn country(mut self, country_name: &str) -> Self {
        self.0
            .append_printable_string(OID_COUNTRY_NAME, country_name)
            .unwrap();
        self
    }

    pub fn state_or_province(mut self, state_or_province: &str) -> Self {
        self.0
            .append_utf8_string(OID_STATE_PROVINCE_NAME, state_or_province)
            .unwrap();
        self
    }

    pub fn locality(mut self, locality: &str) -> Self {
        self.0
            .append_utf8_string(OID_LOCALITY_NAME, locality)
            .unwrap();
        self
    }

    pub fn organization(mut self, organization: &str) -> Self {
        self.0
            .append_utf8_string(OID_ORGANIZATION_NAME, organization)
            .unwrap();
        self
    }

    pub fn organizational_unit(mut self, organizational_unit: &str) -> Self {
        self.0
            .append_utf8_string(OID_ORGANIZATIONAL_UNIT_NAME, organizational_unit)
            .unwrap();
        self
    }

    pub fn common_name(mut self, common_name: &str) -> Self {
        self.0
            .append_utf8_string(OID_COMMON_NAME, common_name)
            .unwrap();
        self
    }

    pub fn email_address(mut self, email: &str) -> Self {
        self.0.append_utf8_string(OID_EMAIL_ADDRESS, email).unwrap();
        self
    }

    // TODO: Custom OID type???

    // pub fn append_subject_printable_string(mut self, oid: Oid, value: &str) -> Self {
    //     self.inner
    //         .subject()
    //         .append_printable_string(oid, value)
    //         .unwrap();
    //     self
    // }

    // pub fn append_subject_utf8_string(mut self, oid: Oid, value: &str) -> Self {
    //     self.inner
    //         .subject()
    //         .append_printable_string(oid, value)
    //         .unwrap();
    //     self
    // }

    pub fn build(self) -> Subject {
        self.into()
    }
}

impl From<SubjectBuilder> for Subject {
    fn from(value: SubjectBuilder) -> Self {
        Self(value.0)
    }
}
