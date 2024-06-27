use std::collections::HashMap;

use either::Either;
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
    Nested(HashMap<String, WindowsConfigValue>),
}

pub struct MaybeNestedDMValue(pub Either<DmValue, HashMap<String, MaybeNestedDMValue>>);

impl From<WindowsConfigValue> for MaybeNestedDMValue {
    fn from(value: WindowsConfigValue) -> Self {
        Self(Either::Left(match value {
            WindowsConfigValue::Integer(v) => DmValue::Integer(v.try_into().unwrap()),
            WindowsConfigValue::String(v) => DmValue::String(v),
            WindowsConfigValue::Boolean(v) => DmValue::Boolean(v),
            WindowsConfigValue::Nested(v) => {
                return Self(Either::Right(
                    v.into_iter().map(|(k, v)| (k, v.into())).collect(),
                ))
            }
        }))
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
