use easy_xml_derive::{XmlDeserialize, XmlSerialize};

use crate::{Add, CmdId, Delete, Exec, Get, Replace};

/// The Atomic element specifies the SyncML command to request that subordinate commands be executed as a set or not at all.
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlSerialize, XmlDeserialize)]
pub struct Atomic {
    #[easy_xml(rename = "CmdID")]
    pub cmd_id: CmdId,
    #[easy_xml(rename = "Meta")]
    pub meta: Option<crate::Meta>,
    #[easy_xml(rename = "Add|Delete|Atomic|Replace|Get|Exec", enum)]
    pub children: Vec<AtomicChild>, // TODO: One or more items
}

/// All the valid children of a [Atomic] element.
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlSerialize, XmlDeserialize)]
pub enum AtomicChild {
    Add(#[easy_xml(flatten)] Add),
    Delete(#[easy_xml(flatten)] Delete),
    Atomic(#[easy_xml(flatten)] Atomic),
    Replace(#[easy_xml(flatten)] Replace),
    Get(#[easy_xml(flatten)] Get),
    Exec(#[easy_xml(flatten)] Exec),
}

impl From<Add> for AtomicChild {
    fn from(value: Add) -> Self {
        Self::Add(value)
    }
}

impl From<Delete> for AtomicChild {
    fn from(value: Delete) -> Self {
        Self::Delete(value)
    }
}

impl From<Atomic> for AtomicChild {
    fn from(value: Atomic) -> Self {
        Self::Atomic(value)
    }
}

impl From<Replace> for AtomicChild {
    fn from(value: Replace) -> Self {
        Self::Replace(value)
    }
}

impl From<Get> for AtomicChild {
    fn from(value: Get) -> Self {
        Self::Get(value)
    }
}

impl From<Exec> for AtomicChild {
    fn from(value: Exec) -> Self {
        Self::Exec(value)
    }
}
