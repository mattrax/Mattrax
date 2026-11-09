import { describe, expect, it } from "vitest";
import { serializeSoapEnvelope, extractSoapBody, extractSoapHeader } from "../src/index.js";

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
});
