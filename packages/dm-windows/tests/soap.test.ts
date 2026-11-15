import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  deserializeSoapElement,
  DiscoverRequest,
  serializeSoapElement,
  GetPoliciesResponse,
  SyncML,
} from "@mattrax/soap";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

describe("Windows SOAP schemas", () => {
  it("parses discovery requests", async () => {
    const xml = `<Discover xmlns="http://schemas.microsoft.com/windows/management/2012/01/enrollment"><request><RequestVersion>5.0</RequestVersion><DeviceType>CIMClient_Windows</DeviceType><ApplicationVersion>10.0</ApplicationVersion><OSEdition>48</OSEdition><AuthPolicies><AuthPolicy>OnPremise</AuthPolicy></AuthPolicies></request></Discover>`;
    const result = await run(deserializeSoapElement(xml, DiscoverRequest));
    expect(result.request.authPolicies).toEqual(["OnPremise"]);
  });

  it("serializes policy responses", async () => {
    const xml = await run(
      serializeSoapElement(GetPoliciesResponse, {
        response: {
          policyFriendlyName: { xsi: "true" },
          nextUpdateHours: { xsi: "true" },
          policiesNotChanged: { xsi: "true" },
          policies: {
            policy: {
              policyOIDReference: "0",
              cAs: { xsi: "true" },
              attributes: {
                commonName: "Mattrax",
                policySchema: "3",
                hashAlgorithmOIDReference: "0",
                revision: { majorRevision: "101", minorRevision: "0" },
                certificateValidity: {
                  validityPeriodSeconds: "31536000",
                  renewalPeriodSeconds: "2592000",
                },
                permission: { enroll: "true", autoEnroll: "false" },
                privateKeyAttributes: {
                  minimalKeyLength: "2048",
                  cryptoProviders: [{ content: "Microsoft Software Key Storage Provider" }],
                },
              },
            },
          },
        },
        oIDs: { oID: [{ value: "1.2.3", group: "4", oIDReferenceID: "0", defaultName: "test" }] },
      }),
    );

    expect(xml).toContain("GetPoliciesResponse");
    expect(xml).toContain("minimalKeyLength");
  });

  it("parses SyncML", async () => {
    const xml = `<SyncML xmlns="SYNCML:SYNCML1.2"><SyncHdr><VerDTD>1.2</VerDTD><VerProto>DM/1.2</VerProto><SessionID>1</SessionID><MsgID>1</MsgID><Target><LocURI>server</LocURI></Target><Source><LocURI>device-1</LocURI></Source></SyncHdr><SyncBody><Alert><CmdID>2</CmdID><Data>1201</Data></Alert><Final/></SyncBody></SyncML>`;
    const result = await run(deserializeSoapElement(xml, SyncML));
    expect(result.syncHdr.source.locURI).toBe("device-1");
  });

  it("parses SyncML Results returned for a Get", async () => {
    const xml = `<SyncML xmlns="SYNCML:SYNCML1.2"><SyncHdr><VerDTD>1.2</VerDTD><VerProto>DM/1.2</VerProto><SessionID>1</SessionID><MsgID>2</MsgID><Target><LocURI>server</LocURI></Target><Source><LocURI>device-1</LocURI></Source></SyncHdr><SyncBody><Status><CmdID>1</CmdID><MsgRef>1</MsgRef><CmdRef>0</CmdRef><Cmd>SyncHdr</Cmd><Data>200</Data></Status><Results><CmdID>2</CmdID><MsgRef>1</MsgRef><CmdRef>3</CmdRef><Item><Source><LocURI>./DevDetail/SwV</LocURI></Source><Data>10.0.19045.3803</Data></Item><Item><Source><LocURI>./DevDetail/Ext/Microsoft/DeviceName</LocURI></Source><Data>DESKTOP-ABC</Data></Item></Results><Final/></SyncBody></SyncML>`;
    const result = await run(deserializeSoapElement(xml, SyncML));

    expect(result.syncBody.results).toHaveLength(1);
    expect(result.syncBody.results?.[0]?.cmdRef).toBe("3");
    expect(result.syncBody.results?.[0]?.items?.map((item) => item.data)).toEqual([
      "10.0.19045.3803",
      "DESKTOP-ABC",
    ]);
    expect(result.syncBody.results?.[0]?.items?.[0]?.source?.locURI).toBe("./DevDetail/SwV");
    expect(result.syncBody.status?.[0]?.data).toBe("200");
  });
});
