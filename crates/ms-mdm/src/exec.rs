use yaserde::{YaDeserialize, YaSerialize};

use crate::{CmdId, Item, Meta};

/// The Exec element specifies the WMI class method to execute on the recipient’s device.
#[derive(Debug, Clone, PartialEq, Eq, Hash, YaSerialize, YaDeserialize)]
pub struct Exec {
    #[yaserde(rename = "CmdID")]
    pub cmd_id: CmdId,
    #[yaserde(rename = "Meta")]
    pub meta: Option<Meta>,
    #[yaserde(rename = "Item")]
    pub item: Item,
}
