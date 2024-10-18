// use easy_xml_derive::{XmlDeserialize, XmlSerialize};

// use crate::{
//     routing::{SourceRef, TargetRef},
//     CmdId, CmdRef, Item, MsgRef,
// };

// /// The Status element type specifies the request status code for a corresponding SyncML command.
// ///
// /// When returning a single Status for a command, the SourceRef and TargetRef elements MUST NOT be specified in the Status.
// #[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
// pub struct Status {
//     #[easy_xml(rename = "CmdID")]
//     pub cmd_id: CmdId,
//     #[easy_xml(rename = "MsgRef")]
//     pub msg_ref: MsgRef,
//     #[easy_xml(rename = "CmdRef")]
//     pub cmd_ref: CmdRef,
//     #[easy_xml(rename = "Cmd")]
//     pub cmd: String, // TODO: Cmd,
//     #[easy_xml(rename = "Data")]
//     pub data: String, // TODO: Data,
//     #[easy_xml(rename = "Item")]
//     pub item: Vec<Item>, // TODO: This should be `<Item /><Item />` not `<Item>...</Item>`, check that is the case!
//     #[easy_xml(rename = "TargetRef")]
//     pub target_ref: Option<TargetRef>,
//     #[easy_xml(rename = "SourceRef")]
//     pub source_ref: Option<SourceRef>,
// }
