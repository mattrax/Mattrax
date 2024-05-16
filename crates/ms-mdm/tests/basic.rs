use ms_mdm::{
    util::strip_whitespace_from_xml, SyncML,
};


// TODO: Fix basic tests
// #[test]
// fn test_basic() {
//     let payload = r#"<SyncML xmlns="SYNCML:SYNCML1.2">
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
//      <Get>
//           <CmdID>3</CmdID>
//           <Item>
//               <Target>
//                   <LocURI>./DevDetail/DevTyp</LocURI>
//               </Target>
//           </Item>
//       </Get>
//     <Final />
// </SyncBody>
// </SyncML>"#;

//     let payload = strip_whitespace_from_xml(payload).unwrap();
//     let result = easy_xml::de::from_str::<SyncML>(&payload).unwrap();
//     assert_eq!(
//         result,
//         SyncML {
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
//                 children: vec![
//                     Get {
//                         cmd_id: CmdId::new(2.to_string()).unwrap(),
//                         item: vec![Target {
//                             loc_uri: "./DevDetail/SwV".into()
//                         }
//                         .into()],
//                         meta: None,
//                     }
//                     .into(),
//                     Get {
//                         cmd_id: CmdId::new(3.to_string()).unwrap(),
//                         item: vec![Target {
//                             loc_uri: "./DevDetail/DevTyp".into()
//                         }
//                         .into()],
//                         meta: None,
//                     }
//                     .into()
//                 ],
//                 _final: Some(Final)
//             }
//         }
//     );

//     assert_eq!(
//         easy_xml::se::to_string(&result).unwrap(),
//         r#"<?xml version="1.0" encoding="UTF-8"?><SyncML xmlns="SYNCML:SYNCML1.2"><SyncHdr><VerDTD>1.2</VerDTD><VerProto>DM/1.2</VerProto>1<MsgID>1</MsgID><Target><LocURI>abcdef</LocURI></Target><Source><LocURI>https://contoso.com/management-server</LocURI></Source></SyncHdr><SyncBody><Get><CmdID>2</CmdID><Item><Item>Target</Item></Item></Get><Get><CmdID>3</CmdID><Item><Item>Target</Item></Item></Get><Final /></SyncBody></SyncML>"#
//     )
// }

#[test]
fn test_regular_device_checkin_with_status_error() {
    let payload = r#"<SyncML xmlns="SYNCML:SYNCML1.2">
    <SyncHdr><VerDTD>1.2</VerDTD><VerProto>DM/1.2</VerProto><SessionID>D</SessionID><MsgID>2</MsgID><Target><LocURI>https://mdm.mattrax.app/ManagementServer/Manage.svc</LocURI></Target><Source><LocURI>def</LocURI><LocName>dummy</LocName></Source><Cred><Meta><Format xmlns="syncml:metinf">b64</Format><Type xmlns="syncml:metinf">syncml:auth-md5</Type></Meta><Data>EVEkoFZcVgPM+ESnu9IC0g==</Data></Cred></SyncHdr>
    <SyncBody xmlns:msft="http://schemas.microsoft.com/MobileDevice/MDM">
        <Status><CmdID>1</CmdID><MsgRef>0</MsgRef><CmdRef>0</CmdRef><Cmd>SyncHdr</Cmd><Data>500</Data></Status>
        <Alert><CmdID>2</CmdID><Data>1201</Data></Alert>
        <Alert><CmdID>3</CmdID><Data>1224</Data><Item><Meta><Type xmlns="syncml:metinf">com.microsoft/MDM/LoginStatus</Type></Meta><Data>user</Data></Item></Alert>
        <Replace>
            <CmdID>4</CmdID>
            <Item><Source><LocURI>./DevInfo/DevId</LocURI></Source><Data>abc</Data></Item>
            <Item><Source><LocURI>./DevInfo/Man</LocURI></Source><Data>Dell Inc.</Data></Item>
            <Item><Source><LocURI>./DevInfo/Mod</LocURI></Source><Data>XPS 13 9310 2-in-1</Data></Item>
            <Item><Source><LocURI>./DevInfo/DmV</LocURI></Source><Data>1.3</Data></Item>
            <Item><Source><LocURI>./DevInfo/Lang</LocURI></Source><Data>en-US</Data></Item>
            <Item><Source><LocURI>./Vendor/MSFT/DMClient/HWDevID</LocURI></Source><Data>def</Data></Item>
        </Replace>
        <Final/>
    </SyncBody>
    </SyncML>"#;

    let payload = strip_whitespace_from_xml(payload).unwrap();
    let result = easy_xml::de::from_str::<SyncML>(&payload).unwrap();
    println!("{result:#?}");
}
