import { Effect, Layer } from "effect";
import { ManagementBackend, ManagementNotSupported } from "@mattrax/management-backend";

type ManagementBackendType = InstanceType<typeof ManagementBackend>;

export function mockManagementBackend(overrides?: Partial<ManagementBackendType>) {
  return Layer.succeed(ManagementBackend, ManagementBackend.of({
    appleDeviceEvent: overrides?.appleDeviceEvent ?? (() => Effect.void),
    appleManagementCheckin: overrides?.appleManagementCheckin ?? (() => Effect.succeed({ _tag: "Idle" } as const)),
    getAppleDeclarationTokens: overrides?.getAppleDeclarationTokens ?? (() => Effect.succeed({ activationsToken: "a", configurationsToken: "c", assetsToken: "as", managementToken: "m" })),
    getAppleDeclarationItems: overrides?.getAppleDeclarationItems ?? (() => Effect.succeed({ activations: [], configurations: [], assets: [], management: [] })),
    getAppleDeclaration: overrides?.getAppleDeclaration ?? (() => Effect.succeed(null)),
    getAppleAsset: overrides?.getAppleAsset ?? (() => Effect.succeed(null)),
    windowsDiscovery: overrides?.windowsDiscovery ?? (() => Effect.fail(new ManagementNotSupported())),
    getWindowsEnrollmentPolicy: overrides?.getWindowsEnrollmentPolicy ?? (() => Effect.fail(new ManagementNotSupported())),
    windowsEnroll: overrides?.windowsEnroll ?? (() => Effect.fail(new ManagementNotSupported())),
    windowsManagementCheckin: overrides?.windowsManagementCheckin ?? (() => Effect.fail(new ManagementNotSupported())),
    windowsDeviceEvent: overrides?.windowsDeviceEvent ?? (() => Effect.void),
  }));
}

export function soapEnvelope(body: string, security = "token-123") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing">
  <s:Header>
    <a:MessageID>urn:uuid:test-message</a:MessageID>
    <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <wsse:BinarySecurityToken>${security}</wsse:BinarySecurityToken>
    </wsse:Security>
  </s:Header>
  <s:Body>${body}</s:Body>
</s:Envelope>`;
}
