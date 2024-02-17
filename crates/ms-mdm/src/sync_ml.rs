use yaserde::{YaDeserialize, YaSerialize};

use crate::{SyncBody, SyncHdr};

/// Namespace for the 'xmlns' attribute of the [SyncML] element.
pub const SYNCML_XMLNS: &str = "SYNCML:SYNCML1.2";

/// The SyncML element type serves as the container for a SyncML Message.
#[derive(Debug, Clone, PartialEq, Eq, Hash, YaSerialize, YaDeserialize)]
#[yaserde(namespace = SYNCML_XMLNS)]
pub struct SyncML {
    #[yaserde(rename = "SyncHdr")]
    pub hdr: SyncHdr,
    #[yaserde(rename = "SyncBody")]
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
