use easy_xml_derive::{XmlDeserialize, XmlSerialize};

use crate::{header::ResponseHeader, RequestHeader};

pub const DISCOVER_ACTION_REQUEST: &str =
    "http://schemas.microsoft.com/windows/management/2012/01/enrollment/IDiscoveryService/Discover";

pub const DISCOVER_ACTION_RESPONSE: &str = "http://schemas.microsoft.com/windows/management/2012/01/enrollment/IDiscoveryService/DiscoverResponse";

pub const DISCOVER_RESPONSE_XMLNS: &str =
    "http://schemas.microsoft.com/windows/management/2012/01/enrollment";

/// DiscoverRequest contains the device and user information to help inform the response
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(root, rename = "Envelope", prefix="s", namespace = {
    "a" : "http://www.w3.org/2005/08/addressing",
    "s" : "http://www.w3.org/2003/05/soap-envelope"
})]
pub struct DiscoverRequest {
    #[easy_xml(rename = "Header", prefix = "s")]
    pub header: RequestHeader,
    #[easy_xml(rename = "Body", prefix = "s")]
    pub body: DiscoverRequestBody,
}

impl DiscoverRequest {
    pub fn from_str(input: &str) -> Result<Self, easy_xml::de::Error> {
        easy_xml::de::from_str(input)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "Body", prefix = "s")]
pub struct DiscoverRequestBody {
    #[easy_xml(rename = "Discover")]
    pub discover: DiscoverRequestBodyDiscover,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "Discover")]
pub struct DiscoverRequestBodyDiscover {
    #[easy_xml(rename = "request")]
    pub request: DiscoverRequestBodyDiscoverRequest,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "request")]
pub struct DiscoverRequestBodyDiscoverRequest {
    #[easy_xml(rename = "EmailAddress")]
    pub email_address: String,
    #[easy_xml(rename = "RequestVersion")]
    pub request_version: String,
    // TODO
    // #[easy_xml(rename = "DeviceType")]
    // pub device_type: String,
    // #[easy_xml(rename = "ApplicationVersion")]
    // pub application_version: String,
    // #[easy_xml(rename = "OSEdition")]
    // pub os_edition: String,
    // #[easy_xml(rename = "AuthPolicies")]
    // pub auth_policies: AuthPolicies,
}

/// contains the enrollment endpoints and authentication type for the device to continue enrollment with
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(root, rename = "Envelope", prefix="s",
    namespace = {
        "a" : "http://www.w3.org/2005/08/addressing",
        "s" : "http://www.w3.org/2003/05/soap-envelope"
    }
)]
pub struct DiscoverResponse {
    #[easy_xml(rename = "Header", prefix = "s")]
    pub header: ResponseHeader,
    #[easy_xml(rename = "Body", prefix = "s")]
    pub body: DiscoverResponseBody,
}

impl DiscoverResponse {
    pub fn to_string(&self) -> Result<String, easy_xml::se::Error> {
        easy_xml::se::to_string(self).map(|v| {
            v.replace(r#"<?xml version="1.0" encoding="UTF-8"?>"#, "") // TODO: Is this needed
                .into()
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "Body", prefix = "s")]
pub struct DiscoverResponseBody {
    #[easy_xml(rename = "DiscoverResponse")]
    pub discover_result: DiscoverResponseDiscoverResponse,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(
    rename = "DiscoverResponse",
    // namespace = "http://schemas.microsoft.com/windows/management/2012/01/enrollment"
)]
pub struct DiscoverResponseDiscoverResponse {
    // TODO: Do this using `easy_xml` on the struct.
    #[easy_xml(rename = "xmlns", attribute)]
    pub xmlns: String,

    #[easy_xml(rename = "DiscoverResult")]
    pub discover_result: DiscoverResponseDiscoverResult,
}

// TODO: Can we make the `authentication_service_url` required when `auth_policy` is `Federated` by making this an enum???
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "DiscoverResult")]
pub struct DiscoverResponseDiscoverResult {
    #[easy_xml(rename = "AuthPolicy")]
    pub auth_policy: String,
    #[easy_xml(rename = "EnrollmentVersion")]
    pub enrollment_version: String,
    #[easy_xml(rename = "EnrollmentPolicyServiceUrl")]
    pub enrollment_policy_service_url: String,
    #[easy_xml(rename = "EnrollmentServiceUrl")]
    pub enrollment_service_url: String,
    #[easy_xml(rename = "AuthenticationServiceUrl")]
    pub authentication_service_url: Option<String>,
}

/// AuthPolicies contains the array of supported AuthPolicies
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
#[easy_xml(rename = "AuthPolicies")]
pub struct AuthPolicies {
    #[easy_xml(rename = "AuthPolicy")]
    pub auth_policies: Vec<String>,
}
