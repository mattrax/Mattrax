// <SyncML xmlns='SYNCML:SYNCML1.2'>
//    <SyncHdr>
//       <VerDTD>1.2</VerDTD>
//       <VerProto>DM/1.2</VerProto>
//       <SessionID>1</SessionID>
//       <MsgID>1</MsgID>
//       <Target>
//          <LocURI>{unique device ID}</LocURI>
//       </Target>
//       <Source>
//          <LocURI>https://www.contoso.com/mgmt-server</LocURI>
//       </Source>
//    </SyncHdr>
//    <SyncBody>
//       <!-- query a device OS system version -->
//       <Get>
//          <CmdID>2</CmdID>
//          <Item>
//             <Target>
//                <LocURI>./DevDetail/SwV</LocURI>
//             </Target>
//          </Item>
//       </Get>
//       <!-- Update device policy -->

//       <Final />
//    </SyncBody>
// </SyncML>
