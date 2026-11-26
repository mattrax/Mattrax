import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { serializeSoapElement, deserializeSoapElement } from "@mattrax/soap";
import {
  DiscoverRequest,
  DiscoverResponse,
  SoapFault,
  RequestSecurityToken,
  RequestSecurityTokenResponseCollection,
  GetPolicies,
  GetPoliciesResponse,
  SyncML,
} from "../src/messages.js";

const runPromise = <E, A>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

describe("Windows MDM - Discovery", () => {
  it("should serialize a Discovery request", async () => {
    const request: DiscoverRequest = {
      request: {
        emailAddress: undefined,
        requestVersion: "5.0",
        deviceType: "CIMClient_Windows",
        applicationVersion: "6.2.9200.1",
        osEdition: 48,
        authPolicies: ["OnPremise", "Federated"],
      },
    };

    const xml = await runPromise(serializeSoapElement(DiscoverRequest, request));
    expect(xml).toContain(
      '<Discover xmlns="http://schemas.microsoft.com/windows/management/2012/01/enrollment">',
    );
    expect(xml).toContain("<request>");
    expect(xml).not.toContain("<EmailAddress");
    expect(xml).toContain("<RequestVersion>5.0</RequestVersion>");
    expect(xml).toContain("<DeviceType>CIMClient_Windows</DeviceType>");
    expect(xml).toContain("<AuthPolicies>");
    expect(xml).toContain("<AuthPolicy>OnPremise</AuthPolicy>");
    expect(xml).toContain("<AuthPolicy>Federated</AuthPolicy>");
  });

  it("should deserialize a Discovery request", async () => {
    const xml = `<Discover xmlns="http://schemas.microsoft.com/windows/management/2012/01/enrollment">
      <request xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
        <EmailAddress></EmailAddress>
        <RequestVersion>5.0</RequestVersion>
        <DeviceType>CIMClient_Windows</DeviceType>
        <ApplicationVersion>6.2.9200.1</ApplicationVersion>
        <OSEdition>48</OSEdition>
        <AuthPolicies>
          <AuthPolicy>OnPremise</AuthPolicy>
          <AuthPolicy>Federated</AuthPolicy>
        </AuthPolicies>
      </request>
    </Discover>`;

    const result = await runPromise(deserializeSoapElement(xml, DiscoverRequest));
    expect(result.request.requestVersion).toBe("5.0");
    expect(result.request.deviceType).toBe("CIMClient_Windows");
    expect(result.request.osEdition).toBe(48);
    expect(result.request.authPolicies).toEqual(["OnPremise", "Federated"]);
  });

  it("should serialize a Discovery response", async () => {
    const response: DiscoverResponse = {
      discoverResult: {
        authPolicy: "OnPremise",
        enrollmentVersion: "4.0",
        enrollmentPolicyServiceUrl: "https://example.com/policy",
        enrollmentServiceUrl: "https://example.com/enroll",
        authServiceUrl: undefined,
      },
    };

    const xml = await runPromise(serializeSoapElement(DiscoverResponse, response));
    expect(xml).toContain(
      '<DiscoverResponse xmlns="http://schemas.microsoft.com/windows/management/2012/01/enrollment">',
    );
    expect(xml).toContain("<AuthPolicy>OnPremise</AuthPolicy>");
    expect(xml).toContain("<EnrollmentVersion>4.0</EnrollmentVersion>");
    expect(xml).toContain(
      "<EnrollmentPolicyServiceUrl>https://example.com/policy</EnrollmentPolicyServiceUrl>",
    );
    expect(xml).not.toContain("AuthenticationServiceUrl");
  });

  it("should round-trip Discovery response", async () => {
    const original: DiscoverResponse = {
      discoverResult: {
        authPolicy: "Federated",
        enrollmentVersion: "5.0",
        enrollmentPolicyServiceUrl: "https://mdm.example.com/policy",
        enrollmentServiceUrl: "https://mdm.example.com/enroll",
        authServiceUrl: "https://mdm.example.com/auth",
      },
    };

    const xml = await runPromise(serializeSoapElement(DiscoverResponse, original));
    const result = await runPromise(deserializeSoapElement(xml, DiscoverResponse));
    expect(result).toEqual(original);
  });
});

describe("Windows MDM - GetPolicies", () => {
  it("should serialize a GetPolicies request", async () => {
    const request: GetPolicies = {
      client: {
        lastUpdate: undefined,
        preferredLanguage: undefined,
        tpmManufacturer: "IBM",
        tpmFirmwareVersion: "8217.4131.22.13878",
      },
      requestFilter: undefined,
    };

    const xml = await runPromise(serializeSoapElement(GetPolicies, request));
    expect(xml).toContain(
      '<GetPolicies xmlns="http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy">',
    );
    expect(xml).toContain("<client>");
    expect(xml).toContain('xsi:nil="true"');
    expect(xml).toContain('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
    expect(xml).toContain("<TPMManufacturer>IBM</TPMManufacturer>");
  });

  it("should deserialize a GetPolicies request", async () => {
    const xml = `<GetPolicies xmlns="http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <client>
        <lastUpdate xsi:nil="true"/>
        <preferredLanguage xsi:nil="true"/>
        <TPMManufacturer>IBM</TPMManufacturer>
        <TPMFirmwareVersion>8217.4131.22.13878</TPMFirmwareVersion>
      </client>
      <requestFilter xsi:nil="true"/>
    </GetPolicies>`;

    const result = await runPromise(deserializeSoapElement(xml, GetPolicies));
    expect(result.client.tpmManufacturer).toBe("IBM");
    expect(result.client.lastUpdate).toBeUndefined();
    expect(result.requestFilter).toBeUndefined();
  });

  it("should serialize a GetPolicies response", async () => {
    const xml = await runPromise(
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
});

describe("Windows MDM - RequestSecurityToken", () => {
  it("should serialize RequestSecurityToken with attributes", async () => {
    const request: RequestSecurityToken = {
      tokenType:
        "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken",
      requestType: "http://docs.oasis-open.org/ws-sx/ws-trust/200512/Issue",
      binarySecurityToken: {
        valueType: "http://schemas.microsoft.com/windows/pki/2009/01/enrollment#PKCS10",
        encodingType:
          "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary",
        content: "MIIC5jCCAc4CAQAw",
      },
      additionalContext: {
        contextItems: [
          { name: "DeviceName", value: "DESKTOP-H1T20J1" },
          { name: "Locale", value: "en-US" },
        ],
      },
    };

    const xml = await runPromise(serializeSoapElement(RequestSecurityToken, request));
    expect(xml).toContain(
      '<wst:RequestSecurityToken xmlns:wst="http://docs.oasis-open.org/ws-sx/ws-trust/200512">',
    );
    expect(xml).toContain(
      "<TokenType>http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken</TokenType>",
    );
    expect(xml).toContain(
      'ValueType="http://schemas.microsoft.com/windows/pki/2009/01/enrollment#PKCS10"',
    );
    expect(xml).toContain(
      'EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary"',
    );
    expect(xml).toContain("<ac:AdditionalContext");
    expect(xml).toContain('Name="DeviceName"');
    expect(xml).toContain("<Value>DESKTOP-H1T20J1</Value>");
  });

  it("should round-trip RequestSecurityToken", async () => {
    const original: RequestSecurityToken = {
      tokenType: "http://example.com/token",
      requestType: "http://example.com/issue",
      binarySecurityToken: {
        valueType: "http://example.com/pkcs10",
        encodingType: "http://example.com/base64",
        content: "BASE64DATA",
      },
      additionalContext: {
        contextItems: [{ name: "OSVersion", value: "10.0.22598.1" }],
      },
    };

    const xml = await runPromise(serializeSoapElement(RequestSecurityToken, original));
    const result = await runPromise(deserializeSoapElement(xml, RequestSecurityToken));
    expect(result).toEqual(original);
  });
});

describe("Windows MDM - RequestSecurityTokenResponseCollection", () => {
  it("should serialize enrollment response", async () => {
    const response: RequestSecurityTokenResponseCollection = {
      requestSecurityTokenResponse: {
        tokenType:
          "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken",
        dispositionMessage: "",
        requestedSecurityToken: {
          binarySecurityToken: {
            valueType:
              "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentProvisionDoc",
            encodingType:
              "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary",
            content: "BASE64DOC",
          },
        },
        requestID: "0",
      },
    };

    const xml = await runPromise(
      serializeSoapElement(RequestSecurityTokenResponseCollection, response),
    );

    expect(xml).toContain("<RequestSecurityTokenResponseCollection");
    expect(xml).toContain(
      "<TokenType>http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken</TokenType>",
    );
    expect(xml).toContain("<RequestID>0</RequestID>");
    expect(xml).toContain("BASE64DOC");
  });
});

describe("Windows MDM - SOAP Fault", () => {
  it("should serialize a SOAP fault", async () => {
    const fault: SoapFault = {
      code: {
        value: "s:receiver",
        subcode: {
          value: "s:authentication",
        },
      },
      reason: {
        text: {
          lang: "en-us",
          content: "invalid input request",
        },
      },
    };

    const xml = await runPromise(serializeSoapElement(SoapFault, fault));
    expect(xml).toContain("<s:Fault");
    expect(xml).toContain("<s:Code");
    expect(xml).toContain("s:receiver");
    expect(xml).toContain("<s:Subcode");
    expect(xml).toContain("s:authentication");
    expect(xml).toContain('xml:lang="en-us"');
    expect(xml).toContain("invalid input request");
    await expect(runPromise(deserializeSoapElement(xml, SoapFault))).resolves.toEqual(fault);
  });

  it("should deserialize a SOAP fault", async () => {
    const xml = `<s:Fault xmlns:s="http://www.w3.org/2003/05/soap-envelope">
      <s:Code>
        <s:Value>s:receiver</s:Value>
        <s:Subcode>
          <s:Value>s:authentication</s:Value>
        </s:Subcode>
      </s:Code>
      <s:Reason>
        <s:Text xml:lang="en-us">invalid input request</s:Text>
      </s:Reason>
    </s:Fault>`;

    const result = await runPromise(deserializeSoapElement(xml, SoapFault));
    expect(result.code.value).toBe("s:receiver");
    expect(result.code.subcode?.value).toBe("s:authentication");
    expect(result.reason.text.lang).toBe("en-us");
    expect(result.reason.text.content).toBe("invalid input request");
  });
});

describe("Windows MDM - SyncML", () => {
  it("parses an Alert", async () => {
    const xml = `<SyncML xmlns="SYNCML:SYNCML1.2"><SyncHdr><VerDTD>1.2</VerDTD><VerProto>DM/1.2</VerProto><SessionID>1</SessionID><MsgID>1</MsgID><Target><LocURI>server</LocURI></Target><Source><LocURI>device-1</LocURI></Source></SyncHdr><SyncBody><Alert><CmdID>2</CmdID><Data>1201</Data></Alert><Final/></SyncBody></SyncML>`;
    const result = await runPromise(deserializeSoapElement(xml, SyncML));
    expect(result.syncHdr.source.locURI).toBe("device-1");
  });

  it("parses the Results returned for a Get", async () => {
    const xml = `<SyncML xmlns="SYNCML:SYNCML1.2"><SyncHdr><VerDTD>1.2</VerDTD><VerProto>DM/1.2</VerProto><SessionID>1</SessionID><MsgID>2</MsgID><Target><LocURI>server</LocURI></Target><Source><LocURI>device-1</LocURI></Source></SyncHdr><SyncBody><Status><CmdID>1</CmdID><MsgRef>1</MsgRef><CmdRef>0</CmdRef><Cmd>SyncHdr</Cmd><Data>200</Data></Status><Results><CmdID>2</CmdID><MsgRef>1</MsgRef><CmdRef>3</CmdRef><Item><Source><LocURI>./DevDetail/SwV</LocURI></Source><Data>10.0.19045.3803</Data></Item><Item><Source><LocURI>./DevDetail/Ext/Microsoft/DeviceName</LocURI></Source><Data>DESKTOP-ABC</Data></Item></Results><Final/></SyncBody></SyncML>`;
    const result = await runPromise(deserializeSoapElement(xml, SyncML));

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
