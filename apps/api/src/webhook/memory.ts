import { Effect, Layer } from "effect";
import { ManagementBackend } from "./layer";

export const ManagementBackendMemory = Layer.succeed(
  ManagementBackend,
  ManagementBackend.of({
    appleCheckin: (deviceId: string) =>
      Effect.sync(() => {
        console.log("[ManagementBackend] appleCheckin", { deviceId });
      }),
    reportDeviceEnrolled: (deviceId: string, info: any) =>
      Effect.sync(() => {
        console.log("[ManagementBackend] reportDeviceEnrolled", { deviceId, info });
      }),
    reportCommandResult: (deviceId: string, result: any) =>
      Effect.sync(() => {
        console.log("[ManagementBackend] reportCommandResult", { deviceId, result });
      }),
    reportDeclarationStatus: (deviceId: string, status: any) =>
      Effect.sync(() => {
        console.log("[ManagementBackend] reportDeclarationStatus", { deviceId, status });
      }),
    reportDeviceInfo: (deviceId: string, info: any) =>
      Effect.sync(() => {
        console.log("[ManagementBackend] reportDeviceInfo", { deviceId, info });
      }),
  }),
);
