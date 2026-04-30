import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { apiRoot } from "../../domain";

export const appleMdmApiLayer = HttpApiBuilder.group(apiRoot, "MattraxAppleMDM", (handlers) =>
  handlers.handle("checkin", () => Effect.void)
);
