use easy_xml_derive::{XmlDeserialize, XmlSerialize};

// TODO: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-mdm/b6272c46-f152-481f-afa9-e05b96baf661

// TODO: Parent Elements: Add (section 2.2.7.1), Atomic (section 2.2.7.3), Delete (section 2.2.7.4), Get (section 2.2.7.6), Item (section 2.2.5.2), Replace (section 2.2.7.7), Results (section 2.2.7.8)

// TODO: Windows MDM extensions. I think `Meta` should probs be a HashMap????
// - Format
// - NextNonce
// - MaxMsgSize
// - Type

// is the recommended maximum amount of data that is allowed in a single request.
pub const MAX_REQUEST_BODY_SIZE: usize = 524288;

/// The Meta element type provides a container for meta-information about the parent element type.
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
pub struct Meta {
    // TODO: Does this namespace work correctly???
    // #[easy_xml(prefix = "a", rename = "MaxRequestBodySize")]
    // pub max_request_body_size: Option<usize>, // TODO: Should this be a `usize`. It's no in the MS spec but check the OMA spec.

    // For `Exec` commands
    #[easy_xml(rename = "Format")]
    pub format: Option<Format>,
    #[easy_xml(rename = "Type")]
    pub ttype: Option<String>, // TODO: r# not supported by `easy_xml`
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
pub struct Format {
    // TODO: Do this with easy_xml???
    #[easy_xml(rename = "xmlns", attribute)]
    pub xmlns: String,

    #[easy_xml(text)]
    pub value: String,
}
