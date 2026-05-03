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
  }>,
) {
  return Layer.succeed(
    ManagementBackend,
    ManagementBackend.of({
      appleDeviceEvent: overrides?.appleDeviceEvent ?? (() => Effect.void),
      appleManagementCheckin:
        overrides?.appleManagementCheckin ??
        (() => Effect.succeed({ _tag: "Idle" } as const)),
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
      getAppleDeclaration:
        overrides?.getAppleDeclaration ?? (() => Effect.succeed(null)),
    }),
  );
}
