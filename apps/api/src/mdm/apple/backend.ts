import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { appleMdmApi } from "./domain";

export const appleMdmHandlers = (handlers: HttpApiBuilder.Handlers.FromGroup<typeof appleMdmApi>) =>
  handlers.handle("checkin", () => Effect.void);
