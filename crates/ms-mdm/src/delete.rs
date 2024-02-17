use yaserde::{YaDeserialize, YaSerialize};

use crate::{CmdId, Item, Meta};

/// The Delete element specifies the SyncML command to delete data items from a data collection.
#[derive(Debug, Clone, PartialEq, Eq, Hash, YaSerialize, YaDeserialize)]
pub struct Delete {
    #[yaserde(rename = "CmdID")]
    pub cmd_id: CmdId,
    #[yaserde(rename = "Meta")]
    pub meta: Option<Meta>,
    #[yaserde(rename = "Item")]
    pub item: Vec<Item>, // TODO: One or more items
}
