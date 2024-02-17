use yaserde::{YaDeserialize, YaSerialize};

use crate::{
    routing::{SourceRef, TargetRef},
    Cmd, CmdId, CmdRef, Data, Item, MsgRef,
};

/// The Status element type specifies the request status code for a corresponding SyncML command.
///
/// When returning a single Status for a command, the SourceRef and TargetRef elements MUST NOT be specified in the Status.
#[derive(Debug, Clone, PartialEq, Eq, Hash, YaSerialize, YaDeserialize)]
pub struct Status {
    #[yaserde(rename = "CmdId")]
    pub cmd_id: CmdId,
    #[yaserde(rename = "MsgRef")]
    pub msg_ref: MsgRef,
    #[yaserde(rename = "CmdRef")]
    pub cmd_ref: CmdRef,
    #[yaserde(rename = "Cmd")]
    pub cmd: Cmd,
    #[yaserde(rename = "Data")]
    pub data: Data,
    #[yaserde(rename = "Item")]
    pub item: Vec<Item>, // TODO: This should be `<Item /><Item />` not `<Item>...</Item>`, check that is the case!
    #[yaserde(rename = "TargetRef")]
    pub target_ref: Option<TargetRef>,
    #[yaserde(rename = "SourceRef")]
    pub source_ref: Option<SourceRef>,
}
