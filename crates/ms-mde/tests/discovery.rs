use ms_mde::{util::strip_whitespace_from_xml, DiscoverRequest};


#[test]
fn test_discovery_request() {
    let payload = r#"<s:Envelope xmlns:a=\"http://www.w3.org/2005/08/addressing\"
    xmlns:s=\"http://www.w3.org/2003/05/soap-envelope\">
    <s:Header>
        <a:Action s:mustUnderstand=\"1\">http://schemas.microsoft.com/windows/management/2012/01/enrollment/IDiscoveryService/Discover</a:Action>
        <a:MessageID>urn:uuid:748132ec-a575-4329-b01b-6171a9cf8478</a:MessageID>
        <a:ReplyTo>
            <a:Address>http://www.w3.org/2005/08/addressing/anonymous</a:Address>
        </a:ReplyTo>
        <a:To s:mustUnderstand=\"1\">https://EnterpriseEnrollment.otbeaumont.me:443/EnrollmentServer/Discovery.svc</a:To>
    </s:Header>
    <s:Body>
        <Discover xmlns=\"http://schemas.microsoft.com/windows/management/2012/01/enrollment\">
            <request xmlns:i=\"http://www.w3.org/2001/XMLSchema-instance\">
                <EmailAddress>oscar@otbeaumont.me</EmailAddress>
                <RequestVersion>6.0</RequestVersion>
                <DeviceType>CIMClient_Windows</DeviceType>
                <ApplicationVersion>10.0.22621.3155</ApplicationVersion>
                <OSEdition>101</OSEdition>
                <AuthPolicies>
                    <AuthPolicy>OnPremise</AuthPolicy>
                    <AuthPolicy>Federated</AuthPolicy>
                </AuthPolicies>
            </request>
        </Discover>
    </s:Body>
</s:Envelope>"#;

    let payload = strip_whitespace_from_xml(payload).unwrap();
    println!("{:?}", payload);
    let result = easy_xml::de::from_str::<DiscoverRequest>(&payload).unwrap();

    todo!("{:#?}", result);
    //     DiscoverRequest {
    //       header: RequestHeader {
    //           action: "http://schemas.microsoft.com/windows/management/2012/01/enrollment/IDiscoveryService/Discover\n           ",
    //           message_id: "urn:uuid:748132ec-a575-4329-b01b-6171a9cf8478",
    //           reply_to: RequestHeaderReplyTo {
    //               address: "http://www.w3.org/2005/08/addressing/anonymous",
    //           },
    //           to: "\n              https://manage.contoso.com:443/EnrollmentServer/Discovery.svc\n           ",
    //           security: None,
    //       },
    //       body: DiscoverRequestBody {
    //           discover: DiscoverRequestBodyDiscover {
    //               request: DiscoverRequestBodyDiscoverRequest {
    //                   email_address: "johndoe@contoso.com",
    //               },
    //           },
    //       },
    //   }
}

// #[test]
// fn test_discovery_response() {
//     let payload = r#" <s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing">
//     <s:Header>
//        <a:Action   s:mustUnderstand="1">http://schemas.microsoft.com/windows/management/2012/01/enrollment/IDiscoveryService/DiscoverResponse
//        </a:Action>
//        <ActivityId CorrelationId="48915517-66c6-4ab7-8f77-c8277e45b3cf" xmlns="http://schemas.microsoft.com/2004/09/ServiceModel/Diagnostics">a4067bc9-ce15-446b-a3f7-5ea1006256f5
//        </ActivityId>
//        <a:RelatesTo>
//           urn:uuid:748132ec-a575-4329-b01b-6171a9cf8478
//        </a:RelatesTo>
//     </s:Header>
//     <s:Body>
//        <DiscoverResponse xmlns="http://schemas.microsoft.com/windows/management/2012/01/enrollment">
//           <DiscoverResult xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
//              <AuthPolicy>Federated</AuthPolicy>
//              <AuthenticationServiceUrl>
//                 https://portal.manage.contoso.com/LoginRedirect.aspx
//              </AuthenticationServiceUrl>
//              <EnrollmentPolicyServiceUrl>
//                 https://manage.contoso.com/DeviceEnrollment/WinDeviceEnrollmentService.svc
//              </EnrollmentPolicyServiceUrl>
//              <EnrollmentServiceUrl>
//                 https://manage.contoso.com/DeviceEnrollment/WinDeviceEnrollmentService.svc
//              </EnrollmentServiceUrl>
//           </DiscoverResult>
//        </DiscoverResponse>
//     </s:Body>
//  </s:Envelope>"#;

//     todo!();
// }
