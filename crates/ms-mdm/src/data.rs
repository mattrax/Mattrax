use easy_xml_derive::{XmlDeserialize, XmlSerialize};

/// The Data element type provides a container for discrete SyncML data.
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
pub struct Data {
    // Hexadecimal status codes returned from Windows components that are reporting a failure
    #[easy_xml(attribute, rename = "msft:originalerror")]
    pub msft_originalerror: Option<String>,
    #[easy_xml(text)]
    pub child: String, // TODO: I think might be better as `String` | `serde_json::Value` (but xml version) type beat but this will do for now.
}
