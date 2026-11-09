import { Layer, Effect } from "effect";
import { ManagementBackend } from "@mattrax/management-backend";

type ManagementBackendType = InstanceType<typeof ManagementBackend>;

export function mockManagementBackend(
  overrides?: Partial<{
    appleDeviceEvent: ManagementBackendType["appleDeviceEvent"];
    appleManagementCheckin: ManagementBackendType["appleManagementCheckin"];
    getAppleDeclarationTokens: ManagementBackendType["getAppleDeclarationTokens"];
    getAppleDeclarationItems: ManagementBackendType["getAppleDeclarationItems"];
    getAppleDeclaration: ManagementBackendType["getAppleDeclaration"];
    getAppleAsset: ManagementBackendType["getAppleAsset"];
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
      appleDeviceEvent: overrides?.appleDeviceEvent ?? (() => Effect.void),
      appleManagementCheckin:
        overrides?.appleManagementCheckin ?? (() => Effect.succeed({ _tag: "Idle" } as const)),
      getAppleDeclarationTokens:
        overrides?.getAppleDeclarationTokens ??
        (() =>
          Effect.succeed({
            activationsToken: "act-token",
            configurationsToken: "cfg-token",
            assetsToken: "asset-token",
            managementToken: "mgmt-token",
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
      windowsDiscovery:
        overrides?.windowsDiscovery ??
        (() => Effect.fail(new Error("Windows management not supported") as never)),
      getWindowsEnrollmentPolicy:
        overrides?.getWindowsEnrollmentPolicy ??
        (() => Effect.fail(new Error("Windows management not supported") as never)),
      windowsEnroll:
        overrides?.windowsEnroll ??
        (() => Effect.fail(new Error("Windows management not supported") as never)),
      windowsManagementCheckin:
        overrides?.windowsManagementCheckin ??
        (() => Effect.fail(new Error("Windows management not supported") as never)),
      windowsDeviceEvent:
        overrides?.windowsDeviceEvent ??
        (() => Effect.fail(new Error("Windows management not supported") as never)),
    }),
  );
}
