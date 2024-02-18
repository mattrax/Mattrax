use easy_xml_derive::{XmlDeserialize, XmlSerialize};

use crate::CmdId;

/// The CmdRef element type specifies a reference to a CmdID that is used by the Status (section 2.2.6.1) element type.
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
pub struct CmdRef {
    #[easy_xml(flatten)]
    child: String,
}

impl CmdRef {
    // TODO: Remove this and have a special function on the 'SyncHdr' to ensure it's valid

    // When CmdRef is zero, Status is a status code for the SyncHdr of the
    // SyncML message referenced by the command corresponding to the Status.
    pub fn zero() -> Self {
        Self { child: "0".into() }
    }

    pub fn from(cmd_id: &CmdId) -> Self {
        Self {
            child: cmd_id.as_str().into(),
        }
    }
}
