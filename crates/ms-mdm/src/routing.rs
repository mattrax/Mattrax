use easy_xml_derive::{XmlDeserialize, XmlSerialize};

/// The Source element type specifies source routing or mapping information.
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
pub struct Source {
    #[easy_xml(rename = "LocURI")]
    pub loc_uri: String,
}

impl Source {
    pub fn new(loc_uri: impl Into<String>) -> Self {
        Self {
            loc_uri: loc_uri.into(),
        }
    }
}

/// The Target element type specifies target routing information.
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
pub struct Target {
    #[easy_xml(rename = "LocURI")]
    pub loc_uri: String,
}

impl Target {
    pub fn new(loc_uri: impl Into<String>) -> Self {
        Self {
            loc_uri: loc_uri.into(),
        }
    }
}

/// The SourceRef element type specifies the Source (section 2.2.3.9) referenced by a Status (section 2.2.6.1) element type.
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
pub struct SourceRef {
    #[easy_xml(rename = "LocURI")]
    loc_uri: String,
}

impl SourceRef {
    pub fn new(source: &Source) -> Self {
        Self {
            loc_uri: source.loc_uri.clone(),
        }
    }
}

/// The TargetRef element type specifies the Target (section 2.2.3.11) referenced by a Status (section 2.2.6.1) element type.
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
pub struct TargetRef {
    #[easy_xml(rename = "LocURI")]
    loc_uri: String,
}

impl TargetRef {
    pub fn new(target: &Target) -> Self {
        Self {
            loc_uri: target.loc_uri.clone(),
        }
    }
}

// TODO: Validate is a valid URI (absolute/relative) or URN.
// pub struct LocUri {
//     // TODO: Tuple structs broken
//     pub body: String,
// }
