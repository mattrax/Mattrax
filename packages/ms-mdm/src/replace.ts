// use easy_xml_derive::{XmlDeserialize, XmlSerialize};

// use crate::{CmdId, Item, Meta};

// /// The Replace element specifies the SyncML command to replace data items.
// #[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
// pub struct Replace {
//     #[easy_xml(rename = "CmdID")]
//     pub cmd_id: CmdId,
//     #[easy_xml(rename = "Meta")]
//     pub meta: Option<Meta>,
//     #[easy_xml(rename = "Item")]
//     pub item: Vec<Item>, // TODO: One or more items
// }
