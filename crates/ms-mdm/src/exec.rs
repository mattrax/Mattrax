use easy_xml_derive::{XmlDeserialize, XmlSerialize};

use crate::{CmdId, Item, Meta};

/// The Exec element specifies the WMI class method to execute on the recipient’s device.
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
pub struct Exec {
    #[easy_xml(rename = "CmdID")]
    pub cmd_id: CmdId,
    #[easy_xml(rename = "Meta")]
    pub meta: Option<Meta>,
    #[easy_xml(rename = "Item")]
    pub item: Item,
}
