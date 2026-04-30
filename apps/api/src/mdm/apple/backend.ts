import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { ManagementBackend } from "../../webhook/layer";
import { appleMdmApi } from "./domain";

export const appleMdmHandlers = (handlers: HttpApiBuilder.Handlers.FromGroup<typeof appleMdmApi>) =>
  handlers.handle("checkin", () =>
    ManagementBackend.use((backend) =>
      backend.appleCheckin("TODO: extract device ID from request").pipe(
        Effect.catchTag("ManagementNotSupported", () => Effect.void),
        Effect.as(""),
      ),
    ),
  );
