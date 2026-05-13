import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { WindowsMdmServiceLive } from "../src/service.js";
import { windowsMdmRoutes } from "../src/handlers.js";
import { mockManagementBackend, soapEnvelope } from "./helpers.js";

const config = { origin: "https://test.mattrax.app", providerId: "Mattrax" };

async function handler(overrides?: Parameters<typeof mockManagementBackend>[0]) {
  const layer = windowsMdmRoutes.pipe(Layer.provideMerge(WindowsMdmServiceLive(config).pipe(Layer.provideMerge(mockManagementBackend(overrides)))));
  return HttpRouter.toWebHandler(layer).handler;
}

describe("Windows MDM handlers", () => {
  it("handles discovery", async () => {
    const h = await handler({ windowsDiscovery: () => Effect.succeed({ authPolicy: "OnPremise", enrollmentVersion: "4.0", enrollmentPolicyServiceUrl: `${config.origin}/mdm/windows/policy`, enrollmentServiceUrl: `${config.origin}/mdm/windows/enroll` }) });
    const body = soapEnvelope(`<Discover xmlns="http://schemas.microsoft.com/windows/management/2012/01/enrollment"><request><RequestVersion>5.0</RequestVersion><DeviceType>CIMClient_Windows</DeviceType><ApplicationVersion>10.0</ApplicationVersion><OSEdition>48</OSEdition><AuthPolicies><AuthPolicy>OnPremise</AuthPolicy></AuthPolicies></request></Discover>`);
    const res = await h(new Request("http://localhost/mdm/windows/discovery", { method: "POST", body }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("EnrollmentServiceUrl");
  });

  it("handles policy", async () => {
    const h = await handler({ getWindowsEnrollmentPolicy: () => Effect.succeed({ authToken: "token-123", minimalKeyLength: "2048", certificateValidityPeriodSeconds: "31536000", renewalPeriodSeconds: "2592000" }) });
    const body = soapEnvelope(`<GetPolicies xmlns="http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy"><client><lastUpdate xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/><preferredLanguage xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/></client><requestFilter xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/></GetPolicies>`);
    const res = await h(new Request("http://localhost/mdm/windows/policy", { method: "POST", body }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("GetPoliciesResponse");
  });

  it("handles enroll", async () => {
    const h = await handler({ windowsEnroll: () => Effect.succeed({ deviceId: "device-1", signedCertificate: "signed", identityCertificate: "identity", username: "device-1", secret: "secret", providerId: "Mattrax" }) });
    const body = soapEnvelope(`<wst:RequestSecurityToken xmlns:wst="http://docs.oasis-open.org/ws-sx/ws-trust/200512"><TokenType>token</TokenType><RequestType>issue</RequestType><BinarySecurityToken ValueType="pkcs10" EncodingType="base64">csr</BinarySecurityToken><ac:AdditionalContext xmlns:ac="http://schemas.xmlsoap.org/ws/2006/12/authorization"><ContextItem Name="DeviceID"><Value>device-1</Value></ContextItem><ContextItem Name="DeviceName"><Value>DESKTOP</Value></ContextItem></ac:AdditionalContext></wst:RequestSecurityToken>`);
    const res = await h(new Request("http://localhost/mdm/windows/enroll", { method: "POST", body }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("RequestSecurityTokenResponseCollection");
  });

  it("handles management SyncML", async () => {
    const h = await handler({ windowsManagementCheckin: () => Effect.succeed({ commands: [{ kind: "Get", cmdID: "2", locURI: "./DevInfo/DevId" }] }) });
    const body = `<SyncML xmlns="SYNCML:SYNCML1.2"><SyncHdr><VerDTD>1.2</VerDTD><VerProto>DM/1.2</VerProto><SessionID>1</SessionID><MsgID>1</MsgID><Target><LocURI>server</LocURI></Target><Source><LocURI>device-1</LocURI></Source></SyncHdr><SyncBody><Alert><CmdID>2</CmdID><Data>1201</Data></Alert><Final/></SyncBody></SyncML>`;
    const res = await h(new Request("http://localhost/mdm/windows/management", { method: "POST", body }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("./DevInfo/DevId");
  });
});
