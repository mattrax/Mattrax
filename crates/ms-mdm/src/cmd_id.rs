use yaserde::{YaDeserialize, YaSerialize};

/// The CmdID element type specifies a unique command identifier for the SyncML message.
/// CmdID MUST be unique within the SyncML message and MUST NOT be the string "0".
#[derive(Debug, Clone, PartialEq, Eq, Hash, YaSerialize, YaDeserialize)]
pub struct CmdId {
    // TODO: Tuple structs are broken
    #[yaserde(child)]
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

impl Into<String> for CmdId {
    fn into(self) -> String {
        self.child
    }
}
