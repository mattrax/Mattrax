use yaserde::{YaDeserialize, YaSerialize};

/// The Data element type provides a container for discrete SyncML data.
#[derive(Debug, Clone, PartialEq, Eq, Hash, YaSerialize, YaDeserialize)]
pub struct Data {
    // Hexadecimal status codes returned from Windows components that are reporting a failure
    #[yaserde(attribute, rename = "msft:originalerror")]
    pub msft_originalerror: Option<String>,
    #[yaserde(child)]
    pub child: String, // TODO: I think might be better as `String` | `serde_json::Value` (but xml version) type beat but this will do for now.
}
