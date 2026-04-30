import { Effect, Layer } from "effect";
import { HttpApiClient } from "effect/unstable/httpapi";
import { ManagementBackend, ManagementNotSupported } from "./layer";
import { managementApi } from "./domain/http";

export const ManagementBackendHttp = (baseUrl: string) =>
  Layer.effect(
    ManagementBackend,
    Effect.gen(function* () {
      const client = yield* HttpApiClient.make(managementApi, { baseUrl });

      return ManagementBackend.of({
        appleCheckin: (deviceId) =>
          client.ManagementWebhook.appleCheckin({ payload: { deviceId } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),
      });
    }),
  );
