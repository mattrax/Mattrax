use serde::Serialize;

use crate::mdm::profiles::CommonPayloadKey;

/// The `enroll.mobileconfig`. This is generated to kick off the enrollment process.
#[derive(Debug, Serialize)]
pub struct EnrollMobileConfig {
    #[serde(flatten)]
    pub common: CommonPayloadKey,
    #[serde(rename = "PayloadContent")]
    pub payload_content: EnrollMobileConfigPayloadContent,
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
