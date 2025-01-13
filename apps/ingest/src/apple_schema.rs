//! TODO: Should this end up as it's own crate and we run the build in tests???

use serde::Deserialize;

/// The schema used for parsing files in schemas in https://github.com/apple/device-management
#[derive(Debug, Deserialize)]
pub struct DMClientSchema {
    pub title: String,
    pub description: Option<String>,
    pub payload: PayloadObject,
    // pub payloadkeys: Vec<_>,
    // pub responsekeys: Vec<_>,
    // pub reasons: Vec<_>,
    // pub notes: Vec<_>,
}

#[derive(Debug, Deserialize)]
pub struct PayloadObject {
    pub payloadtype: Option<String>,
    pub requesttype: Option<String>,
    pub declarationtype: Option<String>,
    pub statusitemtype: Option<String>,
    pub credentialtype: Option<String>,
    #[serde(rename = "supportedOS")]
    pub supported_os: SchemaSupportedOSes,
    pub apply: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SchemaSupportedOSes {
    #[serde(rename = "iOS")]
    pub ios: Option<SchemaSupportedOS>,
    #[serde(rename = "macOS")]
    pub macos: Option<SchemaSupportedOS>,
    #[serde(rename = "tvOS")]
    pub tvos: Option<SchemaSupportedOS>,
    #[serde(rename = "visionOS")]
    pub visionos: Option<SchemaSupportedOS>,
    #[serde(rename = "watchOS")]
    pub watchos: Option<SchemaSupportedOS>,
}

#[derive(Debug, Deserialize)]
pub struct SchemaSupportedOS {
    pub introduced: String,
    pub deprecated: String,
    pub removed: String,
    pub accessrights: String,
    pub multiple: bool,
    pub devicechannel: bool,
    pub userchannel: bool,
    pub supervised: bool,
    pub requiresdep: bool,
    pub userapprovedmdm: bool,
    pub allowmanualinstall: bool,
    pub sharedipad: SharediPad,
    pub userenrollment: UserEnrollment,
    #[serde(rename = "always-skippable")]
    pub always_skippable: bool,
    #[serde(rename = "allowed-enrollments")]
    pub allowed_enrollments: String,
    #[serde(rename = "allowed-scopes")]
    pub allowed_scopes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SharediPad {
    pub mode: String,
    pub devicechannel: bool,
    pub userchannel: bool,
    #[serde(rename = "allowed-scopes")]
    pub allowed_scopes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UserEnrollment {
    pub mode: String,
    pub behavior: Option<String>,
}
