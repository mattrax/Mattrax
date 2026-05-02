import { Effect, Layer } from "effect";
import {
  ManagementBackend,
  type AppleDeviceEvent,
  type ManagementManifest,
} from "@mattrax/management-backend";

interface DeviceState {
  deviceId: string;
  udid: string;
  supportsDdm: boolean;
  pushToken?: string;
  pushMagic?: string;
  topic?: string;
  commandQueue: Array<{ commandUUID: string; requestType: string; payload: unknown }>;
}

const devices = new Map<string, DeviceState>(); // udid → state

const demoDeclarationItems = {
  activations: [{ identifier: "com.mattrax.demo.activation", serverToken: "demo-activation-v1" }],
  configurations: [{ identifier: "com.mattrax.demo.disable-camera", serverToken: "demo-disable-camera-v1" }],
  assets: [],
  management: [],
};

const demoDeclarations: Record<string, Record<string, unknown>> = {
  "com.mattrax.demo.activation": {
    Type: "com.apple.activation.simple",
    Identifier: "com.mattrax.demo.activation",
    ServerToken: "demo-activation-v1",
    Payload: { StandardConfigurations: ["com.mattrax.demo.disable-camera"] },
  },
  "com.mattrax.demo.disable-camera": {
    Type: "com.apple.configuration.restrictions",
    Identifier: "com.mattrax.demo.disable-camera",
    ServerToken: "demo-disable-camera-v1",
    Payload: { allowCamera: false },
  },
};

function getOrCreateDevice(udid: string, supportsDdm = true): DeviceState {
  let state = devices.get(udid);
  if (!state) {
    state = { deviceId: `apple-${udid}`, udid, supportsDdm, commandQueue: [] };
    devices.set(udid, state);
  }
  return state;
}

function deviceById(deviceId: string): DeviceState | undefined {
  for (const state of devices.values()) {
    if (state.deviceId === deviceId) return state;
  }
}

export const ManagementBackendMemory = Layer.succeed(
  ManagementBackend,
  ManagementBackend.of({
    authenticateAppleDevice: (udid) =>
      Effect.sync(() => {
        const state = getOrCreateDevice(udid);
        console.log("[ManagementBackend] authenticateAppleDevice", { udid, deviceId: state.deviceId });
        return { deviceId: state.deviceId, supportsDdm: state.supportsDdm };
      }),

    appleDeviceEvent: (deviceId, event: AppleDeviceEvent) =>
      Effect.sync(() => {
        console.log("[ManagementBackend] appleDeviceEvent", { deviceId, event });
        const state = deviceById(deviceId);
        if (!state) return;

        if (event._tag === "TokenUpdate") {
          state.pushToken = event.pushToken;
          state.pushMagic = event.pushMagic;
          state.topic = event.topic;
        }
      }),

    appleManagementCheckin: (deviceId) =>
      Effect.sync((): ManagementManifest => {
        console.log("[ManagementBackend] appleManagementCheckin", { deviceId });
        const state = deviceById(deviceId);
        if (!state) return { _tag: "Idle" };

        const next = state.commandQueue.shift();
        if (next) return { _tag: "Command", ...next };

        if (state.supportsDdm) return { _tag: "DdmSync", serverToken: "demo-camera-disabled-v1" };

        return { _tag: "Idle" };
      }),

    getAppleDeclarationTokens: (deviceId) =>
      Effect.sync(() => {
        console.log("[ManagementBackend] getAppleDeclarationTokens", { deviceId });
        return {
          declarationsToken: "demo-declarations-v1",
          activationsToken: "demo-activation-v1",
          configurationsToken: "demo-disable-camera-v1",
          assetsToken: "empty",
          managementToken: "empty",
        };
      }),

    getAppleDeclarationItems: (deviceId) =>
      Effect.sync(() => {
        console.log("[ManagementBackend] getAppleDeclarationItems", { deviceId });
        return demoDeclarationItems;
      }),

    getAppleDeclaration: (deviceId, _type, identifier) =>
      Effect.sync(() => {
        const decl = demoDeclarations[identifier] ?? null;
        console.log("[ManagementBackend] getAppleDeclaration", { deviceId, identifier, found: !!decl });
        return decl;
      }),

    getApplePushInfo: (deviceId) =>
      Effect.sync(() => {
        const state = deviceById(deviceId);
        if (!state?.pushToken || !state.pushMagic || !state.topic) return null;
        return { pushToken: state.pushToken, pushMagic: state.pushMagic, topic: state.topic };
      }),

    queueAppleCommand: (deviceId, requestType, payload) =>
      Effect.sync(() => {
        console.log("[ManagementBackend] queueAppleCommand", { deviceId, requestType });
        const state = deviceById(deviceId);
        if (!state) return;
        state.commandQueue.push({ commandUUID: crypto.randomUUID(), requestType, payload });
      }),
  }),
);
