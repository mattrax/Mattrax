import { Context, Data, Effect } from "effect";

export class ManagementNotSupported extends Data.TaggedError("ManagementNotSupported") {}

export class ManagementBackend extends Context.Service<
  ManagementBackend,
  {
    readonly appleCheckin: (deviceId: string) => Effect.Effect<void, ManagementNotSupported>;
  }
>()("ManagementBackend") {}
