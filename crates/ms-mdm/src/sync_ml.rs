use easy_xml_derive::{XmlDeserialize, XmlSerialize};

use crate::{SyncBody, SyncHdr};

/// The SyncML element type serves as the container for a SyncML Message.
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(namespace = { "": "SYNCML:SYNCML1.2" })]
pub struct SyncML {
    #[easy_xml(rename = "SyncHdr")]
    pub hdr: SyncHdr,
    #[easy_xml(rename = "SyncBody")]
    pub child: SyncBody,
}

impl SyncML {
    pub fn validate(&self) -> Result<(), String> {
        // if self.xmlns != SYNCML_XMLNS {
        //     return Err(format!("Invalid SyncML > xmlns: {}", self.xmlns));
        // }
        Ok(())
    }
}
