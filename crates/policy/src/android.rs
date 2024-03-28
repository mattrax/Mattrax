use serde::{Deserialize, Serialize};
use specta::Type;

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(untagged)]
pub enum AndroidConfiguration {}
