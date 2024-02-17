use yaserde::{YaDeserialize, YaSerialize};

use crate::{CmdId, Data, Item};

/// The supported alert types.
pub enum AlertType {
    /// 1200 - SERVER-INITIATED MGMT - Server-initiated device management session.
    ServerInitiatedMgmt,
    /// 1201 - CLIENT-INITIATED MGMT - Client-initiated device management session.
    ClientInitiatedMgmt,
    /// 1222 - NEXT MESSAGE - Request for the next message of a large object package.
    /// Alert type 1222 for sending large objects to the server is not supported in Windows 8.1 or Windows 10 v1507
    NextMessage,
    /// 1223 - SESSION ABORT - Informs recipient that the sender wishes to abort the DM session.
    SessionAbort,
    /// 1224 - CLIENT EVENT - Informs server that an event has occurred on the client.
    ClientEvent,
    /// 1225 - NO END OF DATA - End of Data for chunked object not received.
    NoEndOfData,
    /// 1226 - GENERIC ALERT - Generic client generated alert with or without a reference to a Management Object.
    GenericAlert,
}

impl AlertType {
    pub fn from_status(status: u16) -> Option<Self> {
        match status {
            1200 => Some(Self::ServerInitiatedMgmt),
            1201 => Some(Self::ClientInitiatedMgmt),
            1222 => Some(Self::NextMessage),
            1223 => Some(Self::SessionAbort),
            1224 => Some(Self::ClientEvent),
            1225 => Some(Self::NoEndOfData),
            1226 => Some(Self::GenericAlert),
            _ => None,
        }
    }

    pub fn into_status(&self) -> u16 {
        match self {
            Self::ServerInitiatedMgmt => 1200,
            Self::ClientInitiatedMgmt => 1201,
            Self::NextMessage => 1222,
            Self::SessionAbort => 1223,
            Self::ClientEvent => 1224,
            Self::NoEndOfData => 1225,
            Self::GenericAlert => 1226,
        }
    }
}

/// The Alert element specifies the SyncML command to send custom content information to the recipient.
///
/// Alert provides a mechanism for communicating content information, such as state
/// information or notifications to an application on the recipient device.
#[derive(Debug, Clone, PartialEq, Eq, Hash, YaSerialize, YaDeserialize)]
pub struct Alert {
    #[yaserde(rename = "CmdID")]
    cmd_id: CmdId,
    #[yaserde(rename = "Data")]
    data: Data,
    #[yaserde(rename = "Item")]
    item: Item,
}

// TODO: What the fuck is the 'Type' element Microsoft. It's not documented and it's not in the Open Mobile Alliance spec either.
// The Type element in the Alert element supports a custom type: com.microsoft/MDM/LoginStatus. See [MSDN-OMA-LOGSTAT] for more details.
