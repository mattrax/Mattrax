use yaserde::{YaDeserialize, YaSerialize};

use crate::{Meta, SessionId, Source, Target};

/// The SyncHdr element type serves as the container for the revisioning routing information in the SyncML message.
#[derive(Debug, Clone, PartialEq, Eq, Hash, YaSerialize, YaDeserialize)]
pub struct SyncHdr {
    /// The VerDTD element type specifies the major and minor version identifier of the SyncML representation protocol specification.
    /// VerDTD MUST be "1.2".
    #[yaserde(rename = "VerDTD")]
    pub version: String,
    /// The VerProto element type specifies the major and minor version identifier of the Device Management representation protocol specification
    /// VerProto MUST be "DM/1.2"
    #[yaserde(rename = "VerProto")]
    pub version_protocol: String,
    /// The SessionID element type specifies the identifier of the SyncML session that is associated with the SyncML message.
    /// SessionID is an opaque string.
    /// The initiator SHOULD use a unique SessionID for each session.
    /// The maximum length of a SessionID is 4 bytes. Note that for practical implementations for a client, using an 8-bit incrementing SessionID counter is sufficient.
    #[yaserde(rename = "SessionID")]
    pub session_id: SessionId,
    /// The MsgID element type specifies a unique SyncML session identifier for the SyncML message.
    /// The MsgID specified in a SyncML request MUST be the content of the MsgRef (section 2.2.3.7) element type specified in the corresponding SyncML Results (section 2.2.7.8) or response Status (section 2.2.6.1).
    #[yaserde(rename = "MsgID")]
    pub msg_id: String,
    /// The Target element type specifies target routing information.
    /// Target specifies the target routing information for the network device that is receiving the SyncML message.
    #[yaserde(rename = "Target")]
    pub target: Target,
    /// The Source element type specifies source routing or mapping information.
    /// Source specifies the source routing information for the network device that originated the SyncML message.
    #[yaserde(rename = "Source")]
    pub source: Source,
    /// The Meta element type provides a container for meta-information about the parent element type.
    #[yaserde(rename = "Meta")]
    pub meta: Option<Meta>,
}

impl SyncHdr {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != "1.2" {
            return Err(format!("Invalid SyncHdr > VerDTD: {}", self.version));
        }
        if self.version_protocol != "DM/1.2" {
            return Err(format!(
                "Invalid SyncHdr > VerProto: {}",
                self.version_protocol
            ));
        }
        // TODO: "The first SyncML Message in each SyncML Package sent from an originator to a recipient MUST include the VerProto element type in the SyncHdr."
        Ok(())
    }
}
