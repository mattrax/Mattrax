use yaserde::{YaDeserialize, YaSerialize};

use crate::{Cmd, CmdId, CmdRef, Item, Meta, MsgRef};

/// The Results element specifies the SyncML command to return the results of a Get (section 2.2.7.6) command.
#[derive(Debug, Clone, PartialEq, Eq, Hash, YaSerialize, YaDeserialize)]
pub struct Results {
    #[yaserde(rename = "CmdID")]
    pub cmd_id: CmdId,
    /// When MsgRef is not present in a Results element type, MsgRef MUST be processed as having a value of "1".
    #[yaserde(rename = "MsgRef")]
    pub msg_ref: Option<MsgRef>,
    #[yaserde(rename = "CmdRef")]
    pub cmd_ref: CmdRef, // TODO: It's ambiguous whether this is required or not. The definition says required, but the restrctions imply it's optional.
    #[yaserde(rename = "Cmd")]
    pub cmd: Cmd,
    #[yaserde(rename = "Meta")]
    pub meta: Option<Meta>,
    #[yaserde(rename = "Item")]
    pub item: Vec<Item>, // TODO: One or more items

                         // TODO: `Source` property? It's ambiguous as it's not in the definition but referenced in the restrictions.
                         // TODO: `Data` property? It's ambiguous as it's not in the definition but referenced in the restrictions.
}
