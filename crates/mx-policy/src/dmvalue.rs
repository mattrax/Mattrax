use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use specta::Type;

/// The abstract representation of a value that can be applied via an MDM protocol.
///
/// This is an approximation so all variants may not be valid on all platforms.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
pub enum DmValue {
    String(String),
    Xml(String),
    Base64(String),
    DateAndTime(DateTime<Utc>),
    Integer(u64),
    Float(Decimal),
    Boolean(bool),
}
