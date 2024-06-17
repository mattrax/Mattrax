use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::{DmValue, Script};

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Policy {
    pub id: String,
    pub name: String,
    pub data: PolicyData,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(untagged)]
pub enum AppleConfigValue {
    Integer(i32),
    String(String),
    Boolean(bool),
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(untagged)]
pub enum WindowsConfigValue {
    Integer(i32),
    String(String),
    Boolean(bool),
}

impl Into<DmValue> for WindowsConfigValue {
    fn into(self) -> DmValue {
        match self {
            WindowsConfigValue::Integer(v) => DmValue::Integer(v.try_into().unwrap()),
            WindowsConfigValue::String(v) => DmValue::String(v),
            WindowsConfigValue::Boolean(v) => DmValue::Boolean(v),
        }
    }
}

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PolicyData {
    /// SyncML nodes
    // #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub windows: HashMap<String, HashMap<String, WindowsConfigValue>>,
    /// inner part of the `.mobileconfig`
    // #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub macos: HashMap<String, Vec<HashMap<String, AppleConfigValue>>>,
    /// Android configuration
    // #[serde(default, skip_serializing_if = "is_unit")]
    pub android: (),
    /// Linux configuration
    // #[serde(default, skip_serializing_if = "is_unit")]
    pub linux: (),
    /// Scripts
    // #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scripts: Vec<Script>,
}

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct OMANode {
    pub oma_uri: String,
    pub value: DmValue,
}
