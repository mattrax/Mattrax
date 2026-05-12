import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { platformApi } from "@mattrax/platform-api";

export const platformHandlers = (handlers: HttpApiBuilder.Handlers.FromGroup<typeof platformApi>) =>
  handlers.handle("status", () => Effect.succeed({ status: "ok" as const }));
