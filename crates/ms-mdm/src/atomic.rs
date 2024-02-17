use yaserde::{YaDeserialize, YaSerialize};

use crate::{Add, CmdId, Delete, Exec, Get, Replace};

/// The Atomic element specifies the SyncML command to request that subordinate commands be executed as a set or not at all.
#[derive(Debug, Clone, PartialEq, Eq, Hash, YaSerialize, YaDeserialize)]
pub struct Atomic {
    #[yaserde(rename = "CmdID")]
    pub cmd_id: CmdId,
    #[yaserde(rename = "Meta")]
    pub meta: Option<crate::Meta>,
    #[yaserde(child)]
    children: Vec<AtomicChild>, // TODO: One or more items
}

/// All the valid children of a [Atomic] element.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, YaSerialize, YaDeserialize)]
pub enum AtomicChild {
    Add(Add),
    Delete(Delete),
    Atomic(Atomic),
    Replace(Replace),
    Get(Get),
    Exec(Exec),
    #[default] // TODO: Remove this variant. I think it's a limitation of `yaserde`.
    _Unreachable,
}
