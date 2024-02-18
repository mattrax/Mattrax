use easy_xml_derive::{XmlDeserialize, XmlSerialize};

use crate::{CmdId, Item, Meta};

/// The Add element specifies the SyncML command to add data items to a data collection.
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlSerialize, XmlDeserialize)]
pub struct Add {
    #[easy_xml(rename = "CmdId")]
    pub cmd_id: CmdId,
    #[easy_xml(rename = "Meta")]
    pub meta: Option<Meta>,
    #[easy_xml(rename = "Item")]
    pub item: Vec<Item>, // TODO: One or more items
}
