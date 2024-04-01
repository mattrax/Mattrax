use chrono::{DateTime, Utc};
use mx_dmvalue::DmValue;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use specta::Type;

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(untagged)]
pub enum WindowsConfiguration {
    // TODO: Proper nested enums
    PolicyConfigBrowserHomePages { homepages: Vec<String> },
    PolicyEducationAllowGraphingCalculator { allow_graphing_calculator: bool },

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
    pub value: WindowsValue,
}

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(untagged)]
pub enum WindowsValue {
    String(String),
    Xml(String),
    Base64(String),
    DateAndTime(DateTime<Utc>),
    Integer(u64),
    Float(Decimal),
    Boolean(bool),
}

impl From<WindowsValue> for DmValue {
    fn from(value: WindowsValue) -> Self {
        match value {
            WindowsValue::String(value) => DmValue::String(value),
            WindowsValue::Xml(value) => DmValue::Xml(value),
            WindowsValue::Base64(value) => DmValue::Base64(value),
            WindowsValue::DateAndTime(value) => DmValue::DateAndTime(value),
            WindowsValue::Integer(value) => DmValue::Integer(value),
            WindowsValue::Float(value) => DmValue::Float(value),
            WindowsValue::Boolean(value) => DmValue::Boolean(value),
        }
    }
}
