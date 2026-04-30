import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

export class ManagementNotSupportedError extends Schema.TaggedErrorClass<ManagementNotSupportedError>()(
  "ManagementNotSupported",
  {},
) {}

export const managementWebhookGroup = HttpApiGroup.make("ManagementWebhook")
  .add(
    HttpApiEndpoint.post("appleCheckin", "/apple/checkin", {
      payload: Schema.Struct({ deviceId: Schema.String }),
      error: ManagementNotSupportedError,
    }),
  )
  .prefix("/webhook")
  .annotateMerge(OpenApi.annotations({ exclude: true }));

export const managementApi = HttpApi.make("ManagementApi").add(managementWebhookGroup);
