use std::error::Error;

use base64::prelude::*;
use easy_xml_derive::{XmlDeserialize, XmlSerialize};

use crate::RequestHeader;

pub const ENROLLMENT_ACTION_REQUEST: &str =
    "http://schemas.microsoft.com/windows/pki/2009/01/enrollment/RST/wstep";
pub const ENROLLMENT_ACTION_RESPONSE: &str =
    "http://schemas.microsoft.com/windows/pki/2009/01/enrollment/RSTRC/wstep";

// contains the OID for the Microsoft certificate extension which includes the MDM DeviceID
pub const MICROSOFT_DEVICE_ID_EXTENSION: &[u64] = &[1, 3, 6, 1, 4, 1, 311, 66, 1, 0];

// is the RequestType for the Enrollment request body used to issue a new certificate
pub const ENROLLMENT_REQUEST_TYPE_ISSUE: &str =
    "http://docs.oasis-open.org/ws-sx/ws-trust/200512/Issue";

/// is the RequestType for the Certificate Renewal request body to renew an existing certificate
pub const ENROLLMENT_REQUEST_TYPE_RENEW: &str =
    "http://docs.oasis-open.org/ws-sx/ws-trust/200512/Renew";

/// is the BinarySecurityToken ValueType for a PKCS7 which is used for the Renew request type
pub const BINARY_SECURITY_TOKEN_TYPE_PKCS7: &str =
    "http://schemas.microsoft.com/windows/pki/2009/01/enrollment#PKCS7";

/// is the BinarySecurityToken ValueType for a PKCS10 which is used for the Issue request type
pub const BINARY_SECURITY_TOKEN_TYPE_PKCS10: &str =
    "http://schemas.microsoft.com/windows/pki/2009/01/enrollment#PKCS10";

///  contains the device information and identity certificate CSR
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(root, rename = "Envelope", prefix="s", namespace = {
    "a" : "http://www.w3.org/2005/08/addressing",
    "s" : "http://www.w3.org/2003/05/soap-envelope",
    "u": "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd",
    "wsse": "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd",
    "wst": "http://docs.oasis-open.org/ws-sx/ws-trust/200512",
    "ac": "http://schemas.microsoft.com/windows/pki/2009/01/enrollment",
})]
pub struct EnrollmentRequest {
    #[easy_xml(rename = "Header", prefix = "s")]
    pub header: RequestHeader,
    #[easy_xml(rename = "Body", prefix = "s")]
    pub body: EnrollmentRequestBody,
}

impl EnrollmentRequest {
    pub fn from_str(input: &str) -> Result<Self, easy_xml::de::Error> {
        easy_xml::de::from_str(input)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "Body", prefix = "s")]
pub struct EnrollmentRequestBody {
    #[easy_xml(rename = "RequestSecurityToken", prefix = "wst")]
    pub request_security_token: EnrollmentRequestBodyRequestSecurityToken,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "Body", prefix = "s")]
pub struct EnrollmentRequestBodyRequestSecurityToken {
    #[easy_xml(rename = "TokenType", prefix = "wst")]
    pub token_type: String,
    #[easy_xml(rename = "RequestType", prefix = "wst")]
    pub request_type: String,
    #[easy_xml(rename = "BinarySecurityToken", prefix = "wsse")]
    pub binary_security_token: BinarySecurityToken,
    #[easy_xml(rename = "AdditionalContext", prefix = "ac")]
    pub additional_context: AdditionalContext,
}
/// are key value pairs which contains information about the device being enrolled
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "AdditionalContext", prefix = "ac")]
pub struct AdditionalContext {
    #[easy_xml(rename = "ContextItem", prefix = "ac")]
    pub context_item: Vec<ContextItem>,
}

impl AdditionalContext {
    /// get the value of a context item by name.
    ///
    /// If multiple items with the same name exist, the first one is returned.
    pub fn get(&self, name: &str) -> Option<&str> {
        self.context_item
            .iter()
            .find(|item| item.name == name)
            .map(|item| item.value.as_str())
    }
}

/// are key value pairs which contains information about the device being enrolled
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "ContextItem", prefix = "ac")]
pub struct ContextItem {
    #[easy_xml(rename = "Name", attribute)]
    pub name: String,
    #[easy_xml(rename = "Value", prefix = "ac")]
    pub value: String,
}

// contains the CSR for the request and wap-provisioning payload for the response
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "BinarySecurityToken", prefix = "wsse")]
pub struct BinarySecurityToken {
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

// contains the management client configuration and signed identity certificate
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(root, rename = "Envelope", prefix="s",
    namespace = {
        // TODO: Any other ones???
        "a" : "http://www.w3.org/2005/08/addressing",
        "s" : "http://www.w3.org/2003/05/soap-envelope"
    }
)]
pub struct EnrollmentResponse {
    // #[easy_xml(rename = "Header", prefix = "s")]
    // pub header: ResponseHeader,
    // #[easy_xml(rename = "Body", prefix = "s")]
    // pub body: DiscoverResponseBody,
}

impl EnrollmentResponse {
    pub fn to_string(&self) -> Result<String, easy_xml::se::Error> {
        easy_xml::se::to_string(self).map(|v| {
            v.replace(r#"<?xml version="1.0" encoding="UTF-8"?>"#, "")
                .into()
        })
    }
}

// type EnrollmentResponse struct {
// 	XMLName                      xml.Name            `xml:"http://docs.oasis-open.org/ws-sx/ws-trust/200512 RequestSecurityTokenResponseCollection"`
// 	TokenType                    string              `xml:"RequestSecurityTokenResponse>TokenType"`
// 	DispositionMessage           DispositionMessage  `xml:"http://schemas.microsoft.com/windows/pki/2009/01/enrollment RequestSecurityTokenResponse>DispositionMessage"`
// 	RequestedBinarySecurityToken BinarySecurityToken `xml:"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd RequestSecurityTokenResponse>RequestedSecurityToken>BinarySecurityToken"`
// 	RequestID                    int                 `xml:"http://schemas.microsoft.com/windows/pki/2009/01/enrollment RequestSecurityTokenResponse>RequestID"`
// }

// // DispositionMessage is an extension to the string type that allows an attribute definition of the language
// type DispositionMessage struct {
// 	Lang  string `xml:"xml:lang,attr"`
// 	Value string `xml:",innerxml"`
// }
