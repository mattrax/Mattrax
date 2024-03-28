use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::Configuration;

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Policy {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    // The key can be anything and is used to properly diff the policy between versions.
    #[serde(default)]
    pub configurations: HashMap<String, Configuration>,
}
