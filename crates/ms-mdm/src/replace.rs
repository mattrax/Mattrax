use yaserde::{YaDeserialize, YaSerialize};

use crate::{CmdId, Item, Meta};

/// The Replace element specifies the SyncML command to replace data items.
#[derive(Debug, Clone, PartialEq, Eq, Hash, YaSerialize, YaDeserialize)]
pub struct Replace {
    #[yaserde(rename = "CmdID")]
    pub cmd_id: CmdId,
    #[yaserde(rename = "Meta")]
    pub meta: Option<Meta>,
    #[yaserde(rename = "Item")]
    pub item: Vec<Item>, // TODO: One or more items
}
