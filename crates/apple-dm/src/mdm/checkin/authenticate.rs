use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthenticateRequest {
    /// The device's name.
    #[serde(rename = "DeviceName")]
    pub device_name: String,

    /// The device's model name.
    #[serde(rename = "ModelName")]
    pub model_name: String,

    /// The device's model.
    #[serde(rename = "Model")]
    pub model: String,

    /// The message type, which must have a value of 'Authenticate'.
    #[serde(rename = "MessageType")]
    pub message_type: String,

    /// The topic to which the device subscribes.
    #[serde(rename = "Topic")]
    pub topic: String,

    /// The device's UDID (Unique Device ID). Required if not user enrollment.
    #[serde(rename = "UDID", skip_serializing_if = "Option::is_none")]
    pub udid: Option<String>,

    /// The per-enrollment identifier for the device. Required for user enrollment.
    #[serde(rename = "EnrollmentID", skip_serializing_if = "Option::is_none")]
    pub enrollment_id: Option<String>,

    /// The device's OS version.
    #[serde(rename = "OSVersion", skip_serializing_if = "Option::is_none")]
    pub os_version: Option<String>,

    /// The device's build version.
    #[serde(rename = "BuildVersion", skip_serializing_if = "Option::is_none")]
    pub build_version: Option<String>,

    /// The device's product name ('iPhone3,1').
    #[serde(rename = "ProductName", skip_serializing_if = "Option::is_none")]
    pub product_name: Option<String>,

    /// The device's serial number.
    #[serde(rename = "SerialNumber", skip_serializing_if = "Option::is_none")]
    pub serial_number: Option<String>,

    /// The device's IMEI (International Mobile Station Equipment Identity).
    #[serde(rename = "IMEI", skip_serializing_if = "Option::is_none")]
    pub imei: Option<String>,

    /// The device's MEID (Mobile Equipment Identifier).
    #[serde(rename = "MEID", skip_serializing_if = "Option::is_none")]
    pub meid: Option<String>,
}

impl AuthenticateRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.message_type != "Authenticate" {
            return Err("MessageType must be 'Authenticate'");
        }
        Ok(())
    }
}
