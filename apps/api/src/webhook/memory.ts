import { Effect, Layer } from "effect";
import { ManagementBackend, type AppleDeviceSession } from "./layer";

const devices = new Map<string, AppleDeviceSession>();

const demoManifest = {
  token: "demo-camera-disabled-v1",
  declarations: [
    {
      identifier: "com.mattrax.demo.activation",
      type: "activation" as const,
      serverToken: "demo-activation-v1",
    },
    {
      identifier: "com.mattrax.demo.disable-camera",
      type: "configuration" as const,
      serverToken: "demo-disable-camera-v1",
    },
  ],
};

const declarations: Record<string, object> = {
  "com.mattrax.demo.activation": {
    Type: "com.apple.activation.simple",
    Identifier: "com.mattrax.demo.activation",
    ServerToken: "demo-activation-v1",
    Payload: {
      StandardConfigurations: ["com.mattrax.demo.disable-camera"],
    },
  },
  "com.mattrax.demo.disable-camera": {
    Type: "com.apple.configuration.restrictions",
    Identifier: "com.mattrax.demo.disable-camera",
    ServerToken: "demo-disable-camera-v1",
    Payload: {
      allowCamera: false,
    },
  },
};

function sessionForUdid(udid: string, supportsDdm = true): AppleDeviceSession {
  const existing = devices.get(udid);
  if (existing) return { ...existing, supportsDdm: existing.supportsDdm || supportsDdm };

  const session = {
    deviceId: `apple-${udid}`,
    udid,
    supportsDdm,
    dcmEnabled: true,
  };
  devices.set(udid, session);
  return session;
}

export const ManagementBackendMemory = Layer.succeed(
  ManagementBackend,
  ManagementBackend.of({
    appleCheckin: (deviceId: string) =>
      Effect.sync(() => {
        console.log("[ManagementBackend] appleCheckin", { deviceId });
      }),
    authenticateAppleDevice: (info) =>
      Effect.sync(() => {
        const session = sessionForUdid(info.udid);
        console.log("[ManagementBackend] authenticateAppleDevice", { info, session });
        return session;
      }),
    updateAppleEnrollment: (update) =>
      Effect.sync(() => {
        const session = sessionForUdid(update.udid, update.supportsDdm);
        devices.set(update.udid, session);
        console.log("[ManagementBackend] updateAppleEnrollment", { update, session });
        return session;
      }),
    getAppleDeviceByUdid: (udid: string) =>
      Effect.sync(() => {
        const session = devices.get(udid) ?? sessionForUdid(udid);
        console.log("[ManagementBackend] getAppleDeviceByUdid", { udid, session });
        return session;
      }),
    getAppleDeclarationManifest: (deviceId: string) =>
      Effect.sync(() => {
        console.log("[ManagementBackend] getAppleDeclarationManifest", { deviceId, manifest: demoManifest });
        return demoManifest;
      }),
    getAppleDeclaration: (deviceId: string, type: string, identifier: string) =>
      Effect.sync(() => {
        const declaration = declarations[identifier] ?? null;
        console.log("[ManagementBackend] getAppleDeclaration", { deviceId, type, identifier, declaration });
        return declaration;
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
        console.log("[ManagementBackend] allDeviceInformation", JSON.stringify(info.queries, null, 2));
      }),
  }),
);
