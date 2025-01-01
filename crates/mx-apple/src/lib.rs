//! Apple Mobile Device Management implementation for Mattrax.

use serde::Serialize;
use uuid::Uuid;

/// The `enroll.mobileconfig`. This is generated to kick off the enrollment process.
#[derive(Debug, Serialize)]
pub struct EnrollMobileConfig {
    #[serde(rename = "PayloadDescription")]
    pub payload_description: String,
    #[serde(rename = "PayloadDisplayName")]
    pub payload_display_name: String,
    #[serde(rename = "PayloadIdentifier")]
    pub payload_identifier: String,
    #[serde(rename = "PayloadOrganization")]
    pub payload_organization: String,
    #[serde(rename = "PayloadType")]
    pub payload_type: String,
    #[serde(rename = "PayloadUUID")]
    pub payload_uuid: Uuid,
    #[serde(rename = "PayloadVersion")]
    pub payload_version: i32,
    #[serde(rename = "PayloadContent")]
    pub payload_content: Vec<EnrollMobileConfigPayloadContent>,
}

#[derive(Debug, Serialize)]
pub struct EnrollMobileConfigPayloadContent {
    #[serde(rename = "Challenge")]
    pub challenge: String,
    #[serde(rename = "URL")]
    pub url: String,
    #[serde(rename = "DeviceAttributes")]
    pub device_attributes: Vec<String>,
}

impl EnrollMobileConfig {
    pub fn serialize(&self) -> String {
        let mut buf = Vec::new();
        plist::to_writer_xml(&mut buf, self).unwrap();
        String::from_utf8(buf).unwrap()
    }
}
