use std::str::FromStr;

use easy_xml_derive::{XmlDeserialize, XmlSerialize};

use crate::{SyncBody, SyncHdr};

/// The SyncML element type serves as the container for a SyncML Message.
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(namespace = {
    "": "SYNCML:SYNCML1.2"
    // This isn't strictly in the spec but it's what my Go code does. I suspect I copied it from intercepting Intune.
    // "a": "syncml:metinf"
})]
pub struct SyncML {
    #[easy_xml(rename = "SyncHdr")]
    pub hdr: SyncHdr,
    #[easy_xml(rename = "SyncBody")]
    pub child: SyncBody,
}

impl SyncML {
    pub fn to_string(&self) -> Result<String, easy_xml::se::Error> {
        easy_xml::se::to_string(self)
    }
}

impl FromStr for SyncML {
    type Err = easy_xml::de::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        easy_xml::de::from_str(s)
    }
}
