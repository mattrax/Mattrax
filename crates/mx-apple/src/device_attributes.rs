use serde::{Deserialize, Serialize};

// TODO: Many of the attributes should be optional

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAttributes {
    #[serde(rename = "CHALLENGE")]
    pub challenge: String,
    #[serde(rename = "DEVICE_NAME")]
    pub device_name: String,
    #[serde(rename = "NotOnConsole")]
    pub not_on_console: bool,
    #[serde(rename = "PRODUCT")]
    pub product: String,
    #[serde(rename = "SERIAL")]
    pub serial: String,
    #[serde(rename = "SOFTWARE_UPDATE_DEVICE_ID")]
    pub software_update_device_id: String,
    #[serde(rename = "UDID")]
    pub udid: String,
    #[serde(rename = "UserID")]
    pub user_id: String,
    #[serde(rename = "UserLongName")]
    pub user_long_name: String,
    #[serde(rename = "UserShortName")]
    pub user_short_name: String,
    #[serde(rename = "VERSION")]
    pub version: String,
}

impl DeviceAttributes {
    pub fn from_plist(s: &[u8]) -> Result<Self, plist::Error> {
        plist::from_bytes(s)
    }
}
