// use pretty_assertions::assert_eq;

// #[test]
// fn test_policy_request() {
//     let payload = r#"<s:Envelope
//     xmlns:s="http://www.w3.org/2003/05/soap-envelope"
//     xmlns:a="http://www.w3.org/2005/08/addressing"
//     xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
//     <s:Header>
//       <a:Action s:mustUnderstand="1">
//   http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy/IPolicy/GetPolicies
//       </a:Action>
//       <a:MessageID>
//          urn:uuid:5fb5f6fd-4709-414b-8afa-0c05f6686d1c
//       </a:MessageID>
//       <a:ReplyTo>
//          <a:Address>
//             http://www.w3.org/2005/08/addressing/anonymous
//          </a:Address>
//       </a:ReplyTo>
//       <a:To s:mustUnderstand="1">
//          https://sts.contoso.com/service.svc/cep
//       </a:To>
//       <wsse:Security
//         s:mustUnderstand="1"
//         xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
//          <wsse:BinarySecurityToken
//             ValueType="http://schemas.microsoft.com/5.0.0.0/
//   ConfigurationManager/Enrollment/DeviceEnrollmentUserToken"
//            EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary">
//             <!-- Security token removed -->
//          </wsse:BinarySecurityToken>
//       </wsse:Security>
//     </s:Header>
//     <s:Body
//       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
//       xmlns:xsd="http://www.w3.org/2001/XMLSchema">
//       <GetPolicies xmlns="http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy">
//          <Client>
//             <lastUpdate>0001-01-01T00:00:00</lastUpdate>
//             <preferredLanguage xsi:nil="true"></preferredLanguage>
//          </Client>
//          <requestFilter xsi:nil="true"></requestFilter>
//       </GetPolicies>
//     </s:Body>
//    </s:Envelope>"#;

//     todo!();
// }

// #[test]
// fn test_policy_response() {
//     let payload = r#"<s:Envelope
//     xmlns:a="http://www.w3.org/2005/08/addressing"
//     xmlns:s="http://www.w3.org/2003/05/soap-envelope">
//     <s:Header>
//       <a:Action s:mustUnderstand="1">
//   http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy/IPolicy/GetPoliciesResponse
//       </a:Action>
//     </s:Header>
//     <s:Body
//       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
//       xmlns:xsd="http://www.w3.org/2001/XMLSchema">
//       <GetPoliciesResponse   xmlns="http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy">
//         <response>
//           <policies>
//             <policy>
//               <attributes>
//                 <policySchema>3</policySchema>
//                 <privateKeyAttributes>
//                   <minimalKeyLength>2048</minimalKeyLength>
//                   <algorithmOIDReferencexsi:nil="true"/>
//                 </privateKeyAttributes>
//                 <hashAlgorithmOIDReference xsi:nil="true"></hashAlgorithmOIDReference>
//               </attributes>
//             </policy>
//           </policies>
//         </response>
//         <oIDs>
//           <oID>
//             <value>1.3.6.1.4.1.311.20.2</value>
//             <group>1</group>
//             <oIDReferenceID>5</oIDReferenceID>
//             <defaultName>Certificate Template Name</defaultName>
//           </oID>
//         </oIDs>
//       </GetPoliciesResponse>
//     </s:Body>
//   </s:Envelope>"#;

//     todo!();
// }
