import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  serializeSoapEnvelope,
  extractSoapBody,
  extractSoapHeader,
  parseSoapEnvelope,
} from "../src/index.js";

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
        action:
          "http://schemas.microsoft.com/windows/management/2012/01/enrollment/IDiscoveryService/Discover",
        messageId: "urn:uuid:748132ec-a575-4329-b01b-6171a9cf8478",
        replyTo: "http://www.w3.org/2005/08/addressing/anonymous",
        to: "https://fleetserver.example.com/api/mdm/microsoft/discovery",
      },
      body: bodyXml,
    });

    expect(envelope).toContain('<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"');
    expect(envelope).toContain("<s:Header>");
    expect(envelope).toContain('<a:Action s:mustUnderstand="1">');
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
      'xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"',
    );
  });

  it("returns typed failures for malformed and wrong-namespace envelopes", async () => {
    const malformed = await Effect.runPromise(parseSoapEnvelope("<invalid").pipe(Effect.result));
    const doctype = await Effect.runPromise(
      parseSoapEnvelope(
        '<!DOCTYPE Envelope [<!ENTITY value "expanded">]><Envelope xmlns="http://www.w3.org/2003/05/soap-envelope"><Body><Value>&value;</Value></Body></Envelope>',
      ).pipe(Effect.result),
    );
    const wrongNamespace = await Effect.runPromise(
      parseSoapEnvelope("<Envelope><Body><Value/></Body></Envelope>").pipe(Effect.result),
    );

    expect(malformed).toMatchObject({
      _tag: "Failure",
      failure: { reason: "invalid_xml" },
    });
    expect(wrongNamespace).toMatchObject({
      _tag: "Failure",
      failure: { reason: "invalid_envelope" },
    });
    expect(doctype).toMatchObject({ _tag: "Failure", failure: { reason: "invalid_xml" } });
  });

  it("rejects oversized requests and security headers before DOM parsing", async () => {
    const request = await Effect.runPromise(
      parseSoapEnvelope("x".repeat(100), { maxRequestBytes: 10 }).pipe(Effect.result),
    );
    const tags = Array.from({ length: 5_000 }, () => "<wsse:BinarySecurityToken/>").join("");
    const header = `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Header>${tags}</s:Header><s:Body><Value/></s:Body></s:Envelope>`;
    const oversizedHeader = await Effect.runPromise(
      parseSoapEnvelope(header, { maxHeaderBytes: 1024 }).pipe(Effect.result),
    );

    expect(request).toMatchObject({
      _tag: "Failure",
      failure: { reason: "request_too_large" },
    });
    expect(oversizedHeader).toMatchObject({
      _tag: "Failure",
      failure: { reason: "header_too_large" },
    });
  });
});
