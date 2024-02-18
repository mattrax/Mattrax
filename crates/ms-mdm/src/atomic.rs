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
    children: Vec<AtomicChild>, // TODO: One or more items
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
