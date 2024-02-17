// use ms_mdm::{CmdId, Final, Get, Source, SyncBody, SyncHdr, SyncML, Target, MSFT_XMLNS};
// use pretty_assertions::assert_eq;

// #[test]
// fn test_basic() {
//     // TODO: xmlns="SYNCML:SYNCML1.2"
//     //     let payload = r#"<SyncML>
//     // <SyncHdr>
//     //     <VerDTD>1.2</VerDTD>
//     //     <VerProto>DM/1.2</VerProto>
//     //     <SessionID>1</SessionID>
//     //     <MsgID>1</MsgID>
//     //     <Target>
//     //         <LocURI>abcdef</LocURI>
//     //     </Target>
//     //     <Source>
//     //         <LocURI>https://contoso.com/management-server</LocURI>
//     //     </Source>
//     // </SyncHdr>
//     // <SyncBody xmlns:msft="http://schemas.microsoft.com/MobileDevice/MDM">
//     //     <Get>
//     //         <CmdID>2</CmdID>
//     //         <Item>
//     //             <Target>
//     //                 <LocURI>./DevDetail/SwV</LocURI>
//     //             </Target>
//     //         </Item>
//     //     </Get>
//     //     <Final />
//     // </SyncBody>
//     // </SyncML>"#;

//     let payload = r#"<SyncML>
// <SyncHdr>
// <VerDTD>1.2</VerDTD>
// <VerProto>DM/1.2</VerProto>
// <SessionID>1</SessionID>
// <MsgID>1</MsgID>
// <Target>
//     <LocURI>abcdef</LocURI>
// </Target>
// <Source>
//     <LocURI>https://contoso.com/management-server</LocURI>
// </Source>
// </SyncHdr>
// <SyncBody xmlns:msft="http://schemas.microsoft.com/MobileDevice/MDM">
//     <Get>
//          <CmdID>2</CmdID>
//          <Item>
//              <Target>
//                  <LocURI>./DevDetail/SwV</LocURI>
//              </Target>
//          </Item>
//      </Get>
//     <Final>todo</Final>
// </SyncBody>
// </SyncML>"#;
//     //TOOD: Fix `Final`

//     let result = yaserde::de::from_str::<ms_mdm::SyncML>(payload);
//     assert_eq!(
//         result,
//         Ok(SyncML {
//             hdr: SyncHdr {
//                 version: "1.2".into(),
//                 version_protocol: "DM/1.2".into(),
//                 session_id: 1.into(),
//                 msg_id: 1.to_string(),
//                 target: Target::new("abcdef"),
//                 source: Source::new("https://contoso.com/management-server"),
//                 meta: None
//             },
//             child: SyncBody {
//                 // xmlns_msft: Some(MSFT_XMLNS.into()), // TODO: Fix this
//                 children: vec![Get {
//                     cmd_id: CmdId::new(2.to_string()).unwrap(),
//                     item: vec![Target {
//                         loc_uri: "./DevDetail/SwV".into()
//                     }
//                     .into()],
//                     meta: None,
//                 }
//                 .into()],
//                 r#final: Some(Final)
//             }
//         })
//     )
// }
