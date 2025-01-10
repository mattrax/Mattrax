use easy_xml_derive::{XmlDeserialize, XmlSerialize};

/// The CmdID element type specifies a unique command identifier for the SyncML message.
/// CmdID MUST be unique within the SyncML message and MUST NOT be the string "0".
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
pub struct CmdId {
    #[easy_xml(flatten)]
    child: String,
}

impl CmdId {
    pub fn new(s: impl Into<String>) -> Option<Self> {
        let s = s.into();
        match &*s {
            "0" => None,
            _ => Some(Self { child: s }),
        }
    }

    pub fn as_str(&self) -> &str {
        &self.child
    }
}

impl From<CmdId> for String {
    fn from(val: CmdId) -> Self {
        val.child
    }
}
