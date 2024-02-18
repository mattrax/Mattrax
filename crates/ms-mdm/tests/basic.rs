use ms_mdm::{
    util::strip_whitespace_from_xml, CmdId, Final, Get, Source, SyncBody, SyncHdr, SyncML, Target,
};
use pretty_assertions::assert_eq;

#[test]
fn test_basic() {
    let payload = r#"<SyncML xmlns="SYNCML:SYNCML1.2">
<SyncHdr>
<VerDTD>1.2</VerDTD>
<VerProto>DM/1.2</VerProto>
<SessionID>1</SessionID>
<MsgID>1</MsgID>
<Target>
    <LocURI>abcdef</LocURI>
</Target>
<Source>
    <LocURI>https://contoso.com/management-server</LocURI>
</Source>
</SyncHdr>
<SyncBody xmlns:msft="http://schemas.microsoft.com/MobileDevice/MDM">
    <Get>
         <CmdID>2</CmdID>
         <Item>
             <Target>
                 <LocURI>./DevDetail/SwV</LocURI>
             </Target>
         </Item>
     </Get>
     <Get>
          <CmdID>3</CmdID>
          <Item>
              <Target>
                  <LocURI>./DevDetail/DevTyp</LocURI>
              </Target>
          </Item>
      </Get>
    <Final />
</SyncBody>
</SyncML>"#;

    let payload = strip_whitespace_from_xml(payload).unwrap();
    let result = easy_xml::de::from_str::<SyncML>(&payload).unwrap();
    assert_eq!(
        result,
        SyncML {
            hdr: SyncHdr {
                version: "1.2".into(),
                version_protocol: "DM/1.2".into(),
                session_id: 1.into(),
                msg_id: 1.to_string(),
                target: Target::new("abcdef"),
                source: Source::new("https://contoso.com/management-server"),
                meta: None
            },
            child: SyncBody {
                // xmlns_msft: Some(MSFT_XMLNS.into()), // TODO: Fix this
                children: vec![
                    Get {
                        cmd_id: CmdId::new(2.to_string()).unwrap(),
                        item: vec![Target {
                            loc_uri: "./DevDetail/SwV".into()
                        }
                        .into()],
                        meta: None,
                    }
                    .into(),
                    Get {
                        cmd_id: CmdId::new(3.to_string()).unwrap(),
                        item: vec![Target {
                            loc_uri: "./DevDetail/DevTyp".into()
                        }
                        .into()],
                        meta: None,
                    }
                    .into()
                ],
                _final: Some(Final)
            }
        }
    );

    assert_eq!(
        easy_xml::se::to_string(&result).unwrap(),
        r#"<?xml version="1.0" encoding="UTF-8"?><SyncML xmlns="SYNCML:SYNCML1.2"><SyncHdr><VerDTD>1.2</VerDTD><VerProto>DM/1.2</VerProto>1<MsgID>1</MsgID><Target><LocURI>abcdef</LocURI></Target><Source><LocURI>https://contoso.com/management-server</LocURI></Source></SyncHdr><SyncBody><Get><CmdID>2</CmdID><Item><Item>Target</Item></Item></Get><Get><CmdID>3</CmdID><Item><Item>Target</Item></Item></Get><Final /></SyncBody></SyncML>"#
    )
}
