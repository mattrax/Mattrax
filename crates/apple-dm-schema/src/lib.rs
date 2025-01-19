//! TODO

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Schema {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Payload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payloadkeys: Option<Vec<PayloadKey>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub responsekeys: Option<Vec<PayloadKey>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasons: Option<Vec<Reason>>,
    #[serde(rename = "related-status-items", skip_serializing_if = "Option::is_none")]
    pub related_status_items: Option<Vec<RelatedStatusItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<Vec<Note>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Payload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payloadtype: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requesttype: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub declarationtype: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub statusitemtype: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credentialtype: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supportedOS: Option<SupportedOS>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply: Option<ApplyType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beta: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SupportedOS {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iOS: Option<OSSupport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub macOS: Option<OSSupport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tvOS: Option<OSSupport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visionOS: Option<OSSupport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub watchOS: Option<OSSupport>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OSSupport {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub introduced: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deprecated: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accessrights: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multiple: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub devicechannel: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub userchannel: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supervised: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requiresdep: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub userapprovedmdm: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowmanualinstall: Option<bool>,
    #[serde(rename = "allowed-enrollments", skip_serializing_if = "Option::is_none")]
    pub allowed_enrollments: Option<Vec<String>>,
    #[serde(rename = "allowed-scopes", skip_serializing_if = "Option::is_none")]
    pub allowed_scopes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sharedipad: Option<SharedIpad>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub userenrollment: Option<UserEnrollment>,
    #[serde(rename = "always-skippable", skip_serializing_if = "Option::is_none")]
    pub always_skippable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beta: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SharedIpad {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<SharedIpadMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub devicechannel: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub userchannel: Option<bool>,
    #[serde(rename = "allowed-scopes", skip_serializing_if = "Option::is_none")]
    pub allowed_scopes: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SharedIpadMode {
    Allowed,
    Required,
    Forbidden,
    Ignored,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserEnrollment {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<UserEnrollmentMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub behavior: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserEnrollmentMode {
    Allowed,
    Required,
    Forbidden,
    Ignored,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApplyType {
    Single,
    Multiple,
    Combined,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PayloadKey {
    pub key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supportedOS: Option<SupportedOS>,
    #[serde(rename = "type")]
    pub key_type: PayloadKeyType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtype: Option<SubType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assettypes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presence: Option<Presence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rangelist: Option<Vec<RangeListItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<Range>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<DefaultValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repetition: Option<Repetition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub combinetype: Option<CombineType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subkeytype: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subkeys: Option<Vec<PayloadKey>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PayloadKeyType {
    #[serde(rename = "<string>")]
    String,
    #[serde(rename = "<integer>")]
    Integer,
    #[serde(rename = "<real>")]
    Real,
    #[serde(rename = "<boolean>")]
    Boolean,
    #[serde(rename = "<date>")]
    Date,
    #[serde(rename = "<data>")]
    Data,
    #[serde(rename = "<array>")]
    Array,
    #[serde(rename = "<dictionary>")]
    Dictionary,
    #[serde(rename = "<any>")]
    Any,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SubType {
    #[serde(rename = "<url>")]
    Url,
    #[serde(rename = "<hostname>")]
    Hostname,
    #[serde(rename = "<email>")]
    Email,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Presence {
    Required,
    Optional,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RangeListItem {
    String(String),
    Integer(i64),
    Number(f64),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Range {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<NumberValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<NumberValue>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum NumberValue {
    Integer(i64),
    Float(f64),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DefaultValue {
    String(String),
    Integer(i64),
    Number(f64),
    Boolean(bool),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Repetition {
    pub min: i64,
    pub max: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CombineType {
    BooleanOr,
    BooleanAnd,
    NumberMin,
    NumberMax,
    EnumFirst,
    EnumLast,
    First,
    ArrayAppend,
    SetUnion,
    SetIntersection,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Reason {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Vec<ReasonDetail>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReasonDetail {
    pub key: String,
    pub description: String,
    #[serde(rename = "type")]
    pub detail_type: PayloadKeyType,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RelatedStatusItem {
    #[serde(rename = "status-items")]
    pub status_items: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Note {
    pub title: String,
    pub content: String,
}
