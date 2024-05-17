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

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PolicyData {
    /// SyncML nodes
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub windows: HashMap<String, OMANode>,
    /// inner part of the `.mobileconfig`
    #[serde(default, skip_serializing_if = "is_null")]
    pub macos: serde_json::Value,
    /// Android configuration
    #[serde(default, skip_serializing_if = "is_unit")]
    pub android: (),
    /// Linux configuration
    #[serde(default, skip_serializing_if = "is_unit")]
    pub linux: (),
    /// Scripts
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scripts: Vec<Script>,
}

fn is_null(value: &serde_json::Value) -> bool {
    value.is_null()
}

fn is_unit(_: &()) -> bool {
    true
}

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct OMANode {
    pub oma_uri: String,
    pub value: DmValue,
}
