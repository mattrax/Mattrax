// use pretty_assertions::assert_eq;

// #[test]
// fn test_enrollment_request() {
//     let payload = r#" <s:Envelope xmlns:a="http://www.w3.org/2005/08/addressing"
//     xmlns:s="http://www.w3.org/2003/05/soap-envelope">
//       <s:Header>
//          <a:Action s:mustUnderstand="1">
//             http://schemas.microsoft.com/windows/pki/2009/01/enrollment/RST/wstep
//          </a:Action>
//          <a:MessageID>urn:uuid:b5d1a601-5091-4a7d-b34b-5204c18b5919</a:MessageID>
//          <a:ReplyTo>
//             <a:Address>http://www.w3.org/2005/08/addressing/anonymous</a:Address>
//          </a:ReplyTo>
//          <wsse:Security>
//             <wsse:BinarySecurityToken
//                ValueType=http://schemas.microsoft.com/5.0.0.0/
//     ConfigurationManager/Enrollment/DeviceEnrollmentUserToken
//               EncodingType=""http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary"">
//                <!-- Token Removed -->
//             </wsse:BinarySecurityToken>
//          </wsse:Security>
//       </s:Header>
//       <s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
//     xmlns:xsd="http://www.w3.org/2001/XMLSchema">
//          <wst:RequestSecurityToken xmlns="http://docs.oasis-open.org/ws-sx/ws-trust/200512">
//             <wst:TokenType>
//     "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken"
//             </wst:TokenType>
//             <wst:RequestType>
//                http://docs.oasis-open.org/ws-sx/ws-trust/200512/Issue
//             </wst:RequestType>
//             <wsse:BinarySecurityToken
//                EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary"
//                ValueType="http://schemas.microsoft.com/windows/pki/2009/01/enrollment#PKCS10"
//                xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
//     <!-- Token removed -->
//             </wsse:BinarySecurityToken>
//             <ac:AdditionalContext>
//                <ac:ContextItem Name="DeviceType">
//                   <ac:Value>CIMClient_Windows</ac:Value>
//                </ac:ContextItem>
//             </ac:AdditionalContext>
//           </wst:RequestSecurityToken>
//        </s:Body>
//     </s:Envelope>"#;

//     todo!();
// }

// #[test]
// fn test_enrollment_response() {
//     let payload = r#"<s:Envelope
//     xmlns:s="http://www.w3.org/2003/05/soap-envelope"
//     xmlns:a="http://www.w3.org/2005/08/addressing">
//     <s:Header>
//       <a:Action s:mustUnderstand="1">
//          http://schemas.microsoft.com/windows/pki/2009/01/enrollment/RSTRC/wstep
//       </a:Action>
//     </s:Header>
//     <s:Body>
//        <wst:RequestSecurityTokenResponseCollection
//           xmlns="http://docs.oasis-open.org/ws-sx/ws-trust/200512">
//           <wst:RequestSecurityTokenResponse>
//              <wst:RequestedSecurityToken>
//                 <wst:TokenType>
//  "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken"
//                 </wst:TokenType>
//                 <wsse:BinarySecurityToken
//                    ValueType="http://schemas.microsoft.com/5.0.0.0/Configuration Manager/Enrollment/DeviceEnrollmentProvisionDoc"
//                    EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary">

//                    <!-- base64 encoded provisioning document removed -->
//                 </wsse:BinarySecurityToken>
//              </wst:RequestedSecurityToken>
//           </wst:RequestSecurityTokenResponse>
//        </wst:RequestSecurityTokenResponseCollection>
//     </s:Body>
//  </s:Envelope>"#;

//     todo!();
// }
