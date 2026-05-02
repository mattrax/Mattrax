import { Effect, Layer } from "effect";
import {
  ManagementBackend,
  type AppleDeviceEvent,
  type CheckinScope,
  type ManagementManifest,
} from "@mattrax/management-backend";

interface DeviceState {
  udid: string;
  supportsDdm: boolean;
  pushToken?: string;
  pushMagic?: string;
  topic?: string;
  commandQueue: Array<{ commandUUID: string; requestType: string; payload: unknown }>;
}

// keyed by udid for device-initiated ops; keyed by deviceId for server-initiated ops
const byUdid = new Map<string, DeviceState>();
const byDeviceId = new Map<string, DeviceState>();

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
  let state = byUdid.get(udid);
  if (!state) {
    state = { udid, supportsDdm, commandQueue: [] };
    byUdid.set(udid, state);
    byDeviceId.set(`apple-${udid}`, state);
  }
  return state;
}

export const ManagementBackendMemory = Layer.succeed(
  ManagementBackend,
  ManagementBackend.of({
    appleDeviceEvent: (scope: CheckinScope, event: AppleDeviceEvent) =>
      Effect.sync(() => {
        console.log("[ManagementBackend] appleDeviceEvent", { udid: scope.udid, event });
        const state = byUdid.get(scope.udid);
        if (!state) return;

        if (event._tag === "TokenUpdate") {
          state.pushToken = event.pushToken;
          state.pushMagic = event.pushMagic;
          state.topic = event.topic;
        }
      }),

    appleManagementCheckin: (scope: CheckinScope) =>
      Effect.sync((): ManagementManifest => {
        console.log("[ManagementBackend] appleManagementCheckin", { udid: scope.udid });
        const state = getOrCreateDevice(scope.udid);

        const next = state.commandQueue.shift();
        if (next) return { _tag: "Command", ...next };

        if (state.supportsDdm) return { _tag: "DdmSync", serverToken: "demo-camera-disabled-v1" };

        return { _tag: "Idle" };
      }),

    getAppleDeclarationTokens: (scope: CheckinScope) =>
      Effect.sync(() => {
        console.log("[ManagementBackend] getAppleDeclarationTokens", { udid: scope.udid });
        return {
          declarationsToken: "demo-declarations-v1",
          activationsToken: "demo-activation-v1",
          configurationsToken: "demo-disable-camera-v1",
          assetsToken: "empty",
          managementToken: "empty",
        };
      }),

    getAppleDeclarationItems: (scope: CheckinScope) =>
      Effect.sync(() => {
        console.log("[ManagementBackend] getAppleDeclarationItems", { udid: scope.udid });
        return demoDeclarationItems;
      }),

    getAppleDeclaration: (scope: CheckinScope, _type, identifier) =>
      Effect.sync(() => {
        const decl = demoDeclarations[identifier] ?? null;
        console.log("[ManagementBackend] getAppleDeclaration", { udid: scope.udid, identifier, found: !!decl });
        return decl;
      }),

    getApplePushInfo: (deviceId) =>
      Effect.sync(() => {
        const state = byDeviceId.get(deviceId);
        if (!state?.pushToken || !state.pushMagic || !state.topic) return null;
        return { pushToken: state.pushToken, pushMagic: state.pushMagic, topic: state.topic };
      }),

    queueAppleCommand: (deviceId, requestType, payload) =>
      Effect.sync(() => {
        console.log("[ManagementBackend] queueAppleCommand", { deviceId, requestType });
        const state = byDeviceId.get(deviceId);
        if (!state) return;
        state.commandQueue.push({ commandUUID: crypto.randomUUID(), requestType, payload });
      }),
  }),
);
