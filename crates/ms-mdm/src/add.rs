use yaserde::{YaDeserialize, YaSerialize};

use crate::{CmdId, Item, Meta};

/// The Add element specifies the SyncML command to add data items to a data collection.
#[derive(Debug, Clone, PartialEq, Eq, Hash, YaSerialize, YaDeserialize)]
pub struct Add {
    #[yaserde(rename = "CmdId")]
    pub cmd_id: CmdId,
    #[yaserde(rename = "Meta")]
    pub meta: Option<Meta>,
    #[yaserde(rename = "Item")]
    pub item: Vec<Item>, // TODO: One or more items
}
