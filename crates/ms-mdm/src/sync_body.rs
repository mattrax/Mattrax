use yaserde::{YaDeserialize, YaSerialize};

use crate::{Add, Alert, Atomic, Delete, Exec, Final, Get, Replace, Results, Status};

/// Namespace for the 'xmlns:msft' attribute of the [SyncBody] element.
pub const MSFT_XMLNS: &str = "http://schemas.microsoft.com/MobileDevice/MDM";

/// The SyncBody element type serves as the container for the body or contents of the SyncML message.
#[derive(Debug, Clone, PartialEq, Eq, Hash, YaSerialize, YaDeserialize)]
#[yaserde(namespace = "msft: http://schemas.microsoft.com/MobileDevice/MDM")]
pub struct SyncBody {
    // /// This should be set to [MSFT_XMLNS].
    // /// This *SHOULD* be set when 'SyncApplicationVersion' is greater than '3.0' in the DMCLient CSP but we just require it regardless.
    // #[yaserde(attribute, rename = "xmlns:msft")]
    // pub xmlns_msft: Option<String>, // TODO: Use a `Cow` so this can be `MSFT_XMLNS` without an allocation. Yaserde doesn't suppot COWs yet.
    #[yaserde(flatten)]
    pub children: Vec<SyncBodyChild>,
    #[yaserde(rename = "Final")]
    pub r#final: Option<Final>,
}

/// All the valid children of a [SyncBody] element (minus `Final` which is handled specially).
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, YaSerialize, YaDeserialize)]
#[yaserde(flatten)]
pub enum SyncBodyChild {
    Atomic(Atomic),
    Exec(Exec),
    Get(Get),
    Results(Results),
    Status(Status),
    Add(Add),
    Replace(Replace),
    Delete(Delete),
    Alert(Alert),
    #[default] // TODO: Remove this variant. I think it's a limitation of `yaserde`.
    _Unreachable,
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
