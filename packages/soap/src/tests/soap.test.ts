import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import {
  serializeSoapElement,
  deserializeSoapElement,
  serializeSoapEnvelope,
  extractSoapBody,
  extractSoapHeader,
} from "../index.js";
import {
  DiscoverRequest,
  DiscoverResponse,
  SoapFault,
  RequestSecurityToken,
  RequestSecurityTokenResponseCollection,
  GetPolicies,
} from "../windows-mdm.js";

const runPromise = <E, A>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect);

describe("SOAP Serializer", () => {
  it("should serialize a simple struct with annotations", async () => {
    const Person = Schema.Struct({
      name: Schema.String.pipe(Schema.annotateKey({ soapElementName: "Name" })),
      age: Schema.Number.pipe(Schema.annotateKey({ soapElementName: "Age" })),
    }).pipe(Schema.annotate({ identifier: "Person" }));

    const xml = await runPromise(serializeSoapElement(Person, { name: "Alice", age: 30 }));
    expect(xml).toContain("<Person>");
    expect(xml).toContain("<Name>Alice</Name>");
    expect(xml).toContain("<Age>30</Age>");
  });

  it("should serialize with namespaces", async () => {
    const Person = Schema.Struct({
      name: Schema.String,
    }).pipe(
      Schema.annotate({
        identifier: "Person",
        soapNamespace: "http://example.com/ns",
        soapNamespacePrefix: "ex",
      })
    );

    const xml = await runPromise(serializeSoapElement(Person, { name: "Bob" }));
    expect(xml).toContain('xmlns:ex="http://example.com/ns"');
    expect(xml).toContain("<ex:Person");
  });

  it("should serialize XML attributes", async () => {
    const Item = Schema.Struct({
      id: Schema.Number.pipe(
        Schema.annotateKey({ soapAttribute: true, soapAttributeName: "ID" })
      ),
      name: Schema.String,
    }).pipe(Schema.annotate({ identifier: "Item" }));

    const xml = await runPromise(serializeSoapElement(Item, { id: 42, name: "Widget" }));
    expect(xml).toContain('<Item ID="42">');
    expect(xml).toContain("<name>Widget</name>");
  });

  it("should serialize arrays with custom item names", async () => {
    const List = Schema.Struct({
      items: Schema.Array(Schema.String.pipe(Schema.annotateKey({ soapElementName: "Item" }))).pipe(
        Schema.annotateKey({ soapElementName: "Items" })
      ),
    }).pipe(Schema.annotate({ identifier: "List" }));

    const xml = await runPromise(serializeSoapElement(List, { items: ["a", "b"] }));
    expect(xml).toContain("<Items>");
    expect(xml).toContain("<Item>a</Item>");
    expect(xml).toContain("<Item>b</Item>");
  });

  it("should skip optional fields when undefined", async () => {
    const Config = Schema.Struct({
      required: Schema.String,
      optional: Schema.optional(Schema.String).pipe(
        Schema.annotateKey({ soapElementName: "Optional" })
      ),
    }).pipe(Schema.annotate({ identifier: "Config" }));

    const xml = await runPromise(serializeSoapElement(Config, { required: "yes" }));
    expect(xml).toContain("<required>yes</required>");
    expect(xml).not.toContain("Optional");
  });

  it("should render xsi:nil for optional nil fields", async () => {
    const Config = Schema.Struct({
      required: Schema.String,
      optional: Schema.optional(Schema.String).pipe(
        Schema.annotateKey({ soapElementName: "Optional", soapOptionalNil: true })
      ),
    }).pipe(Schema.annotate({ identifier: "Config" }));

    const xml = await runPromise(serializeSoapElement(Config, { required: "yes" }));
    expect(xml).toContain('<Optional xsi:nil="true"/>');
  });

  it("should escape XML special characters", async () => {
    const Message = Schema.Struct({
      text: Schema.String,
    }).pipe(Schema.annotate({ identifier: "Message" }));

    const xml = await runPromise(serializeSoapElement(Message, { text: '<hello> & "world"' }));
    expect(xml).toContain("&lt;hello&gt; &amp; \"world\"");
  });

  it("should serialize nested structures", async () => {
    const Address = Schema.Struct({
      city: Schema.String,
      zip: Schema.String,
    }).pipe(Schema.annotate({ identifier: "Address" }));

    const Person = Schema.Struct({
      name: Schema.String,
      address: Address.pipe(Schema.annotateKey({ soapElementName: "Address" })),
    }).pipe(Schema.annotate({ identifier: "Person" }));

    const xml = await runPromise(
      serializeSoapElement(Person, { name: "Alice", address: { city: "NYC", zip: "10001" } })
    );
    expect(xml).toContain("<Person>");
    expect(xml).toContain("<Address>");
    expect(xml).toContain("<city>NYC</city>");
  });

  it("should serialize with pretty: false", async () => {
    const Simple = Schema.Struct({
      a: Schema.String,
    }).pipe(Schema.annotate({ identifier: "Simple" }));

    const xml = await runPromise(serializeSoapElement(Simple, { a: "test" }, { pretty: false }));
    expect(xml).toBe("<Simple><a>test</a></Simple>");
  });

  it("should handle BigInt values", async () => {
    const Data = Schema.Struct({
      count: Schema.BigInt.pipe(Schema.annotateKey({ soapElementName: "Count" })),
    }).pipe(Schema.annotate({ identifier: "Data" }));

    const xml = await runPromise(serializeSoapElement(Data, { count: 9007199254740993n }));
    expect(xml).toContain("<Count>9007199254740993</Count>");
  });

  it("should handle null values", async () => {
    const Data = Schema.Struct({
      value: Schema.Null.pipe(Schema.annotateKey({ soapElementName: "Value" })),
    }).pipe(Schema.annotate({ identifier: "Data" }));

    const xml = await runPromise(serializeSoapElement(Data, { value: null }));
    expect(xml).toContain("<Data>");
    expect(xml).toContain("<Value/>");
  });
});

describe("SOAP Deserializer", () => {
  it("should deserialize a simple struct", async () => {
    const Person = Schema.Struct({
      name: Schema.String.pipe(Schema.annotateKey({ soapElementName: "Name" })),
      age: Schema.Number.pipe(Schema.annotateKey({ soapElementName: "Age" })),
    }).pipe(Schema.annotate({ identifier: "Person" }));

    const xml = `<Person><Name>Bob</Name><Age>25</Age></Person>`;
    const result = await runPromise(deserializeSoapElement(xml, Person));
    expect(result).toEqual({ name: "Bob", age: 25 });
  });

  it("should deserialize with attributes", async () => {
    const Item = Schema.Struct({
      id: Schema.Number.pipe(
        Schema.annotateKey({ soapAttribute: true, soapAttributeName: "ID" })
      ),
      name: Schema.String,
    }).pipe(Schema.annotate({ identifier: "Item" }));

    const xml = `<Item ID="99"><name>Gadget</name></Item>`;
    const result = await runPromise(deserializeSoapElement(xml, Item));
    expect(result).toEqual({ id: 99, name: "Gadget" });
  });

  it("should deserialize arrays", async () => {
    const List = Schema.Struct({
      items: Schema.Array(Schema.String.pipe(Schema.annotateKey({ soapElementName: "Item" }))).pipe(
        Schema.annotateKey({ soapElementName: "Items" })
      ),
    }).pipe(Schema.annotate({ identifier: "List" }));

    const xml = `<List><Items><Item>x</Item><Item>y</Item></Items></List>`;
    const result = await runPromise(deserializeSoapElement(xml, List));
    expect(result).toEqual({ items: ["x", "y"] });
  });

  it("should deserialize optional missing fields as undefined", async () => {
    const Config = Schema.Struct({
      required: Schema.String,
      optional: Schema.optional(Schema.String).pipe(
        Schema.annotateKey({ soapElementName: "Optional" })
      ),
    }).pipe(Schema.annotate({ identifier: "Config" }));

    const xml = `<Config><required>yes</required></Config>`;
    const result = await runPromise(deserializeSoapElement(xml, Config));
    expect(result).toEqual({ required: "yes", optional: undefined });
  });

  it("should deserialize xsi:nil as undefined", async () => {
    const Config = Schema.Struct({
      required: Schema.String,
      optional: Schema.optional(Schema.String).pipe(
        Schema.annotateKey({ soapElementName: "Optional", soapOptionalNil: true })
      ),
    }).pipe(Schema.annotate({ identifier: "Config" }));

    const xml = `<Config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><required>yes</required><Optional xsi:nil="true"/></Config>`;
    const result = await runPromise(deserializeSoapElement(xml, Config));
    expect(result).toEqual({ required: "yes", optional: undefined });
  });

  it("should deserialize BigInt from string", async () => {
    const Data = Schema.Struct({
      count: Schema.BigInt.pipe(Schema.annotateKey({ soapElementName: "Count" })),
    }).pipe(Schema.annotate({ identifier: "Data" }));

    const xml = `<Data><Count>123456789012345</Count></Data>`;
    const result = await runPromise(deserializeSoapElement(xml, Data));
    expect(result).toEqual({ count: 123456789012345n });
  });

  it("should handle special numbers", async () => {
    const Data = Schema.Struct({
      inf: Schema.Number,
      negInf: Schema.Number,
      nan: Schema.Number,
    }).pipe(Schema.annotate({ identifier: "Data" }));

    const xml = `<Data><inf>Infinity</inf><negInf>-Infinity</negInf><nan>NaN</nan></Data>`;
    const result = await runPromise(deserializeSoapElement(xml, Data));
    expect(result.inf).toBe(Infinity);
    expect(result.negInf).toBe(-Infinity);
    expect(Number.isNaN(result.nan)).toBe(true);
  });

  it("should fail on invalid XML", async () => {
    const Simple = Schema.Struct({ a: Schema.String }).pipe(
      Schema.annotate({ identifier: "Simple" })
    );

    const result = await Effect.runPromise(
      deserializeSoapElement("<invalid", Simple).pipe(Effect.result)
    );
    expect(result._tag).toBe("Failure");
  });

  it("should fail on missing required element", async () => {
    const Strict = Schema.Struct({
      required: Schema.String,
    }).pipe(Schema.annotate({ identifier: "Strict" }));

    const result = await Effect.runPromise(
      deserializeSoapElement("<Strict></Strict>", Strict).pipe(Effect.result)
    );
    expect(result._tag).toBe("Failure");
  });
});

describe("SOAP Envelope", () => {
  it("should serialize and extract a full envelope", () => {
    const bodyXml = `<Discover xmlns="http://schemas.microsoft.com/windows/management/2012/01/enrollment">
  <request xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
    <EmailAddress></EmailAddress>
    <RequestVersion>5.0</RequestVersion>
  </request>
</Discover>`;

    const envelope = serializeSoapEnvelope({
      header: {
        action: "http://schemas.microsoft.com/windows/management/2012/01/enrollment/IDiscoveryService/Discover",
        messageId: "urn:uuid:748132ec-a575-4329-b01b-6171a9cf8478",
        replyTo: "http://www.w3.org/2005/08/addressing/anonymous",
        to: "https://fleetserver.example.com/api/mdm/microsoft/discovery",
      },
      body: bodyXml,
    });

    expect(envelope).toContain('<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"');
    expect(envelope).toContain("<s:Header>");
    expect(envelope).toContain("<a:Action s:mustUnderstand=\"1\">");
    expect(envelope).toContain("<s:Body>");
    expect(envelope).toContain("<Discover");

    const extractedBody = extractSoapBody(envelope);
    expect(extractedBody).toContain("<Discover");

    const header = extractSoapHeader(envelope);
    expect(header.action).toContain("Discover");
    expect(header.messageId).toBe("urn:uuid:748132ec-a575-4329-b01b-6171a9cf8478");
    expect(header.to).toBe("https://fleetserver.example.com/api/mdm/microsoft/discovery");
  });

  it("should support custom namespaces in envelope", () => {
    const bodyXml = `<wst:RequestSecurityToken></wst:RequestSecurityToken>`;
    const envelope = serializeSoapEnvelope({
      body: bodyXml,
      namespaces: {
        wst: "http://docs.oasis-open.org/ws-sx/ws-trust/200512",
        wsse: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd",
      },
    });

    expect(envelope).toContain('xmlns:wst="http://docs.oasis-open.org/ws-sx/ws-trust/200512"');
    expect(envelope).toContain(
      'xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"'
    );
  });
});

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
    expect(xml).toContain('<Discover xmlns="http://schemas.microsoft.com/windows/management/2012/01/enrollment">');
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
    expect(xml).toContain('<DiscoverResponse xmlns="http://schemas.microsoft.com/windows/management/2012/01/enrollment">');
    expect(xml).toContain("<AuthPolicy>OnPremise</AuthPolicy>");
    expect(xml).toContain("<EnrollmentVersion>4.0</EnrollmentVersion>");
    expect(xml).toContain("<EnrollmentPolicyServiceUrl>https://example.com/policy</EnrollmentPolicyServiceUrl>");
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
    expect(xml).toContain('<GetPolicies xmlns="http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy">');
    expect(xml).toContain("<client>");
    expect(xml).toContain('<lastUpdate xsi:nil="true"/>');
    expect(xml).toContain('<preferredLanguage xsi:nil="true"/>');
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
});

describe("Windows MDM - RequestSecurityToken", () => {
  it("should serialize RequestSecurityToken with attributes", async () => {
    const request: RequestSecurityToken = {
      tokenType: "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken",
      requestType: "http://docs.oasis-open.org/ws-sx/ws-trust/200512/Issue",
      binarySecurityToken: {
        valueType: "http://schemas.microsoft.com/windows/pki/2009/01/enrollment#PKCS10",
        encodingType: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary",
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
    expect(xml).toContain('<wst:RequestSecurityToken xmlns:wst="http://docs.oasis-open.org/ws-sx/ws-trust/200512">');
    expect(xml).toContain("<TokenType>http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken</TokenType>");
    expect(xml).toContain('ValueType="http://schemas.microsoft.com/windows/pki/2009/01/enrollment#PKCS10"');
    expect(xml).toContain('EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary"');
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
        tokenType: "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken",
        dispositionMessage: "",
        requestedSecurityToken: {
          binarySecurityToken: {
            valueType: "http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentProvisionDoc",
            encodingType: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary",
            content: "BASE64DOC",
          },
        },
        requestID: "0",
      },
    };

    const xml = await runPromise(serializeSoapElement(RequestSecurityTokenResponseCollection, response));
    expect(xml).toContain("<RequestSecurityTokenResponseCollection");
    expect(xml).toContain("<TokenType>http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken</TokenType>");
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
    expect(xml).toContain("<s:Fault>");
    expect(xml).toContain("<s:Code>");
    expect(xml).toContain("<s:Value>s:receiver</s:Value>");
    expect(xml).toContain("<s:Subcode>");
    expect(xml).toContain("<s:Value>s:authentication</s:Value>");
    expect(xml).toContain('xml:lang="en-us"');
    expect(xml).toContain("invalid input request");
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

describe("Round-trip tests", () => {
  it("should round-trip a complex nested structure", async () => {
    const Inner = Schema.Struct({
      id: Schema.Number,
      label: Schema.String.pipe(Schema.annotateKey({ soapElementName: "Label" })),
    }).pipe(Schema.annotate({ identifier: "Inner" }));

    const Outer = Schema.Struct({
      name: Schema.String,
      inners: Schema.Array(Inner.pipe(Schema.annotateKey({ soapElementName: "Inner" }))).pipe(
        Schema.annotateKey({ soapElementName: "Inners" })
      ),
      meta: Schema.Struct({
        version: Schema.String.pipe(Schema.annotateKey({ soapElementName: "Version" })),
        count: Schema.optional(Schema.Number).pipe(Schema.annotateKey({ soapElementName: "Count" })),
      }).pipe(Schema.annotate({ identifier: "Meta" })),
    }).pipe(Schema.annotate({ identifier: "Outer" }));

    const original = {
      name: "test",
      inners: [
        { id: 1, label: "a" },
        { id: 2, label: "b" },
      ],
      meta: { version: "1.0", count: undefined },
    };

    const xml = await runPromise(serializeSoapElement(Outer, original));
    const result = await runPromise(deserializeSoapElement(xml, Outer));
    expect(result).toEqual(original);
  });

  it("should round-trip through a SOAP envelope", async () => {
    const body = await runPromise(
      serializeSoapElement(DiscoverRequest, {
        request: {
          emailAddress: undefined,
          requestVersion: "5.0",
          deviceType: "CIMClient_Windows",
          applicationVersion: "6.2.9200.1",
          osEdition: 48,
          authPolicies: ["OnPremise"],
        },
      })
    );

    const envelope = serializeSoapEnvelope({
      header: {
        action: "http://example.com/Discover",
        messageId: "urn:uuid:test",
        to: "https://example.com",
      },
      body,
    });

    const extractedBody = extractSoapBody(envelope);
    const result = await runPromise(deserializeSoapElement(extractedBody, DiscoverRequest));
    expect(result.request.requestVersion).toBe("5.0");
    expect(result.request.authPolicies).toEqual(["OnPremise"]);
  });
});

describe("Error handling", () => {
  it("should return SoapSerializeError on invalid input", async () => {
    const Strict = Schema.Struct({
      required: Schema.String,
    }).pipe(Schema.annotate({ identifier: "Strict" }));

    const result = await Effect.runPromise(
      serializeSoapElement(Strict, { required: undefined as unknown as string }).pipe(Effect.result)
    );
    expect(result._tag).toBe("Failure");
  });

  it("should return SoapParseError on malformed XML", async () => {
    const Simple = Schema.Struct({ a: Schema.String }).pipe(
      Schema.annotate({ identifier: "Simple" })
    );

    const result = await Effect.runPromise(
      deserializeSoapElement("<<<not xml>>>", Simple).pipe(Effect.result)
    );
    expect(result._tag).toBe("Failure");
  });
});
