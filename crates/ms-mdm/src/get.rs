use yaserde::{YaDeserialize, YaSerialize};

use crate::{CmdId, Item, Meta};

/// The Get element specifies the SyncML command to retrieve data from the recipient.
#[derive(Debug, Clone, PartialEq, Eq, Hash, YaSerialize, YaDeserialize)]
pub struct Get {
    #[yaserde(rename = "CmdID")]
    pub cmd_id: CmdId,
    #[yaserde(rename = "Meta")]
    pub meta: Option<Meta>,
    #[yaserde(rename = "Item")]
    pub item: Vec<Item>, // TODO: One or more items
}
