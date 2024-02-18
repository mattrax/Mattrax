use easy_xml_derive::{XmlDeserialize, XmlSerialize};

use crate::{Add, Alert, Atomic, Delete, Exec, Final, Get, Replace, Results, Status};

/// The SyncBody element type serves as the container for the body or contents of the SyncML message.
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
/// This *SHOULD* be set when 'SyncApplicationVersion' is greater than '3.0' in the DMCLient CSP but we just set it regardless.
#[easy_xml(namespace = { "msft": "http://schemas.microsoft.com/MobileDevice/MDM" })]
pub struct SyncBody {
    #[easy_xml(
        rename = "Atomic|Exec|Get|Results|Status|Add|Replace|Delete|Alert",
        enum
    )]
    pub children: Vec<SyncBodyChild>,
    #[easy_xml(rename = "Final")]
    pub _final: Option<Final>, // TODO: `r#final` is not supported by `easy_xml`.
}

/// All the valid children of a [SyncBody] element (minus `Final` which is handled specially).
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
pub enum SyncBodyChild {
    Atomic(#[easy_xml(flatten)] Atomic),
    Exec(#[easy_xml(flatten)] Exec),
    Get(#[easy_xml(flatten)] Get),
    Results(#[easy_xml(flatten)] Results),
    Status(#[easy_xml(flatten)] Status),
    Add(#[easy_xml(flatten)] Add),
    Replace(#[easy_xml(flatten)] Replace),
    Delete(#[easy_xml(flatten)] Delete),
    Alert(#[easy_xml(flatten)] Alert),
}

impl From<Atomic> for SyncBodyChild {
    fn from(value: Atomic) -> Self {
        Self::Atomic(value)
    }
}

impl From<Exec> for SyncBodyChild {
    fn from(value: Exec) -> Self {
        Self::Exec(value)
    }
}

impl From<Get> for SyncBodyChild {
    fn from(value: Get) -> Self {
        Self::Get(value)
    }
}

impl From<Results> for SyncBodyChild {
    fn from(value: Results) -> Self {
        Self::Results(value)
    }
}

impl From<Status> for SyncBodyChild {
    fn from(value: Status) -> Self {
        Self::Status(value)
    }
}

impl From<Add> for SyncBodyChild {
    fn from(value: Add) -> Self {
        Self::Add(value)
    }
}

impl From<Replace> for SyncBodyChild {
    fn from(value: Replace) -> Self {
        Self::Replace(value)
    }
}

impl From<Delete> for SyncBodyChild {
    fn from(value: Delete) -> Self {
        Self::Delete(value)
    }
}

impl From<Alert> for SyncBodyChild {
    fn from(value: Alert) -> Self {
        Self::Alert(value)
    }
}
