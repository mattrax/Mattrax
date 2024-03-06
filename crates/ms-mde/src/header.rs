use std::error::Error;

use base64::prelude::*;
use easy_xml_derive::{XmlDeserialize, XmlSerialize};

pub const ACTIVITY_ID_XMLNS: &str = "http://schemas.microsoft.com/2004/09/ServiceModel/Diagnostics";

/// RequestHeader is a generic SOAP body for requests
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "Header", prefix = "s")]
pub struct RequestHeader {
    #[easy_xml(rename = "Action", prefix = "a")]
    pub action: String,
    #[easy_xml(rename = "MessageID", prefix = "a")]
    pub message_id: String,
    #[easy_xml(rename = "ReplyTo", prefix = "a")]
    pub reply_to: RequestHeaderReplyTo,
    #[easy_xml(rename = "To", prefix = "a")]
    pub to: String,
    #[easy_xml(rename = "Security", prefix = "wsse")]
    pub security: Option<RequestHeaderSecurity>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "ReplyTo", prefix = "a")]
pub struct RequestHeaderReplyTo {
    #[easy_xml(rename = "Address", prefix = "a")]
    pub address: String,
}

// TODO: Probs make this an enum. Username and BST should be mutually exclusive
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "Security", prefix = "wsse")]
pub struct RequestHeaderSecurity {
    #[easy_xml(rename = "mustUnderstand", prefix = "s", attribute)]
    pub must_understand: String,
    #[easy_xml(rename = "UsernameToken", prefix = "wsse")]
    pub username_token: Option<RequestHeaderSecurityUsernameToken>,
    #[easy_xml(rename = "BinarySecurityToken", prefix = "wsse")]
    pub binary_security_token: Option<BinarySecurityToken>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "UsernameToken", prefix = "wsse")]
pub struct RequestHeaderSecurityUsernameToken {
    #[easy_xml(rename = "Username", prefix = "wsse")]
    pub username: String,
    #[easy_xml(rename = "Password", prefix = "wsse")]
    pub password: String,
}

/// BinarySecurityToken contains the CSR for the request and wap-provisioning payload for the response
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "BinarySecurityToken", prefix = "wsse")]
pub struct BinarySecurityToken {
    // TODO: Do this in easy_xml
    #[easy_xml(rename = "xmlns", attribute)]
    pub xmlns: Option<String>,
    #[easy_xml(rename = "ValueType", attribute)]
    pub value_type: String,
    #[easy_xml(rename = "EncodingType", attribute)]
    pub encoding_type: String,
    #[easy_xml(text)]
    pub value: String,
}

impl BinarySecurityToken {
    pub fn decode(&self) -> Result<Vec<u8>, Box<dyn Error>> {
        match &*self.encoding_type {
            "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary" => {
                BASE64_STANDARD.decode(&self.value.replace("\r\n", "")).map_err(Into::into)
            }
            _ => Err("encoding not supported".into()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "Header", prefix = "s")]
pub struct ResponseHeader {
    #[easy_xml(rename = "Action", prefix = "a")]
    pub action: Action,
    #[easy_xml(rename = "ActivityId")]
    pub activity_id: ActivityId,
    // TODO: <ActivityId CorrelationId="8c6060c4-3d78-4d73-ae17-e8bce88426ee" xmlns="http://schemas.microsoft.com/2004/09/ServiceModel/Diagnostics">8c6060c4-3d78-4d73-ae17-e8bce88426ee</ActivityId>
    #[easy_xml(rename = "RelatesTo", prefix = "a")]
    pub relates_to: String,
    // TODO: Should this have any other properties check with Go?
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "ActivityId",
    // namespace = {
    //     "": "http://schemas.microsoft.com/2004/09/ServiceModel/Diagnostics"
    // }
)]
pub struct ActivityId {
    // TODO: Do this using `easy_xml` on the struct.
    #[easy_xml(rename = "xmlns", attribute)]
    pub xmlns: String,

    // TODO: Use `Cow`
    #[easy_xml(rename = "CorrelationId", attribute)]
    pub correlation_id: String,
    #[easy_xml(text)]
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "Action", prefix = "a")]
pub struct Action {
    // TODO: Use `Cow`
    #[easy_xml(rename = "mustUnderstand", prefix = "s", attribute)]
    pub must_understand: Option<String>, // TODO: Must be "1"
    // TODO: Use `Cow`
    #[easy_xml(text)]
    pub value: String,
}

impl From<&'static str> for Action {
    fn from(s: &'static str) -> Self {
        Self {
            must_understand: Some("1".into()),
            value: s.into(),
        }
    }
}
