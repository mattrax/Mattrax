use serde::{Deserialize, Serialize};

use crate::mdm::profiles::CommonPayloadKey;

/// A standard Apple MDM profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile<T> {
    #[serde(flatten)]
    pub common: CommonPayloadKey,
    #[serde(rename = "PayloadContent")]
    pub content: T,
}

/// A Apple MDM profile without a nested `PayloadContent` field.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlatProfile<T> {
    #[serde(flatten)]
    pub common: CommonPayloadKey,
    #[serde(flatten)]
    pub content: T,
}

impl<T> Profile<T> {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, plist::Error>
    where
        T: for<'de> Deserialize<'de>,
    {
        plist::from_bytes(bytes)
    }

    pub fn to_bytes(&self) -> Vec<u8>
    where
        T: Serialize,
    {
        let mut buf = Vec::new();
        plist::to_writer_xml(&mut buf, self).unwrap();
        buf
    }
}
