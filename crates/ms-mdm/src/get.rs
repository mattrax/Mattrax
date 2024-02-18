use easy_xml_derive::{XmlDeserialize, XmlSerialize};

use crate::{CmdId, Item, Meta};

/// The Get element specifies the SyncML command to retrieve data from the recipient.
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
pub struct Get {
    #[easy_xml(rename = "CmdID")]
    pub cmd_id: CmdId,
    #[easy_xml(rename = "Meta")]
    pub meta: Option<Meta>,
    #[easy_xml(rename = "Item", container)]
    pub item: Vec<Item>, // TODO: One or more items
}
