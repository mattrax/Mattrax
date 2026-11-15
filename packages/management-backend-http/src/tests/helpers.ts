import { Layer, Effect, Schema } from "effect";
import { ManagementBackend } from "@mattrax/management-backend";

type ManagementBackendType = InstanceType<typeof ManagementBackend>;

const IdleManifest = Schema.TaggedStruct("Idle", {}).make({});

function unsupportedWindowsOperation<A>(): Effect.Effect<A, never> {
  // SAFETY: The management service contract has no failure channel for this local
  // "not supported" stub, so the stub error is surfaced as its failure value.
  return Effect.fail(new Error("Windows management not supported") as never);
}

export function mockManagementBackend(
  overrides?: Partial<{
    appleDeviceEvent: ManagementBackendType["appleDeviceEvent"];
    appleManagementCheckin: ManagementBackendType["appleManagementCheckin"];
    getAppleDeclarationTokens: ManagementBackendType["getAppleDeclarationTokens"];
    getAppleDeclarationItems: ManagementBackendType["getAppleDeclarationItems"];
    getAppleDeclaration: ManagementBackendType["getAppleDeclaration"];
    getAppleAsset: ManagementBackendType["getAppleAsset"];
    getAppleProfile: ManagementBackendType["getAppleProfile"];
    windowsDiscovery: ManagementBackendType["windowsDiscovery"];
    getWindowsEnrollmentPolicy: ManagementBackendType["getWindowsEnrollmentPolicy"];
    windowsEnroll: ManagementBackendType["windowsEnroll"];
    windowsManagementCheckin: ManagementBackendType["windowsManagementCheckin"];
    windowsDeviceEvent: ManagementBackendType["windowsDeviceEvent"];
  }>,
) {
  return Layer.succeed(
    ManagementBackend,
    ManagementBackend.of({
      getAppleBootstrapToken: () => Effect.succeed(null),
      appleDeviceEvent: overrides?.appleDeviceEvent ?? (() => Effect.void),
      appleManagementCheckin:
        overrides?.appleManagementCheckin ?? (() => Effect.succeed(IdleManifest)),
      getAppleDeclarationTokens:
        overrides?.getAppleDeclarationTokens ??
        (() =>
          Effect.succeed({
            activationsToken: "act-token",
            configurationsToken: "cfg-token",
            assetsToken: "asset-token",
            managementToken: "mgmt-token",
            declarationsToken: "decl-token",
          })),
      getAppleDeclarationItems:
        overrides?.getAppleDeclarationItems ??
        (() =>
          Effect.succeed({
            activations: [],
            configurations: [],
            assets: [],
            management: [],
          })),
      getAppleDeclaration: overrides?.getAppleDeclaration ?? (() => Effect.succeed(null)),
      getAppleAsset: overrides?.getAppleAsset ?? (() => Effect.succeed(null)),
      getAppleProfile: overrides?.getAppleProfile ?? (() => Effect.succeed(null)),
      windowsDiscovery:
        overrides?.windowsDiscovery ??
        (() => unsupportedWindowsOperation()),
      getWindowsEnrollmentPolicy:
        overrides?.getWindowsEnrollmentPolicy ??
        (() => unsupportedWindowsOperation()),
      windowsEnroll:
        overrides?.windowsEnroll ??
        (() => unsupportedWindowsOperation()),
      windowsManagementCheckin:
        overrides?.windowsManagementCheckin ??
        (() => unsupportedWindowsOperation()),
      windowsDeviceEvent:
        overrides?.windowsDeviceEvent ??
        (() => unsupportedWindowsOperation()),
    }),
  );
}
