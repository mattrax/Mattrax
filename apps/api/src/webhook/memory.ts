import { Effect, Layer } from "effect";
import { ManagementBackend } from "./layer";

export const ManagementBackendMemory = Layer.succeed(
  ManagementBackend,
  ManagementBackend.of({
    appleCheckin: (deviceId) =>
      Effect.sync(() => {
        console.log("[ManagementBackend] appleCheckin", { deviceId });
      }),
  }),
);
