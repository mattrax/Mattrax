//! Type for the [MS-MDE](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-mde/5c841535-042e-489e-913c-9d783d741267) and [MS-MDE2](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-mde2/4d7eadd5-3951-4f1c-8159-c39e07cbe692) protocols.

mod discovery;
mod enrollment;
mod header;

pub mod util;

pub use discovery::{
    DiscoverRequest, DiscoverRequestBody, DiscoverRequestBodyDiscover,
    DiscoverRequestBodyDiscoverRequest, DiscoverResponse, DiscoverResponseBody,
    DiscoverResponseDiscoverResponse, DiscoverResponseDiscoverResult, DISCOVER_ACTION_REQUEST,
    DISCOVER_ACTION_RESPONSE, DISCOVER_RESPONSE_XMLNS,
};
pub use enrollment::{
    AdditionalContext, ContextItem, EnrollmentRequest, EnrollmentRequestBody,
    EnrollmentRequestBodyRequestSecurityToken, EnrollmentResponse, EnrollmentResponseBody,
    RequestSecurityTokenResponse, RequestSecurityTokenResponseCollection, RequestedSecurityToken,
    BINARY_SECURITY_TOKEN_TYPE_PKCS10, BINARY_SECURITY_TOKEN_TYPE_PKCS7, ENROLLMENT_ACTION_REQUEST,
    ENROLLMENT_ACTION_RESPONSE, ENROLLMENT_REQUEST_TYPE_ISSUE, ENROLLMENT_REQUEST_TYPE_RENEW,
    MICROSOFT_DEVICE_ID_EXTENSION, REQUEST_SECURITY_TOKEN_RESPONSE_COLLECTION,
    REQUEST_SECURITY_TOKEN_TYPE, WSSE_NAMESPACE,
};
pub use header::{
    Action, ActivityId, BinarySecurityToken, RequestHeader, RequestHeaderReplyTo,
    RequestHeaderSecurity, RequestHeaderSecurityUsernameToken, ResponseHeader, ACTIVITY_ID_XMLNS,
};

// TODO: Namespaces
// ac http://schemas.microsoft.com/windows/pki/2009/01/enrollment [MS-WSTEP]
// tns http://schemas.microsoft.com/windows/pki/2012/01/enrollment This specification
// wsaw http://www.w3.org/2006/05/addressing/wsdl
// wsdl http://schemas.xmlsoap.org/wsdl/ [WSDL]
// wst http://docs.oasis-open.org/ws-sx/ws-trust/200512 [WSTrust1.3]
// xcep http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy [MS-XCEP]
// xsd http://www.w3.org/2001/XMLSchema [XMLSCHEMA1]
