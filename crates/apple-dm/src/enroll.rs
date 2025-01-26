use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct EnrollMobileConfigPayloadContent {
    #[serde(rename = "Challenge")]
    pub challenge: String,
    #[serde(rename = "URL")]
    pub url: String,
    #[serde(rename = "DeviceAttributes")]
    pub device_attributes: Vec<String>,
}
