use serde::{Deserialize, Serialize};
use specta::Type;

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(untagged)]
pub enum WindowsConfiguration {
    // TODO: Proper nested enums
    PolicyConfigBrowserHomePages(String),
    PolicyEducationAllowGraphingCalculator(bool),

    // A set of raw OMA-URI configurations
    Custom { custom: Vec<CustomConfiguration> },
}

impl From<Vec<CustomConfiguration>> for WindowsConfiguration {
    fn from(value: Vec<CustomConfiguration>) -> Self {
        Self::Custom { custom: value }
    }
}

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
pub struct CustomConfiguration {
    pub oma_uri: String,
    // TODO: Handle datatype's exactly like Intune
    pub value: AnyValue,
}

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(untagged)]
pub enum AnyValue {
    String(String),
    Int(i32),
    Bool(bool),
    // Float(f32),
}
