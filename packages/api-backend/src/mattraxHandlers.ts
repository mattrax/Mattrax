import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { mattraxApi } from "@mattrax/api-domain";

export const mattraxHandlers = (handlers: HttpApiBuilder.Handlers.FromGroup<typeof mattraxApi>) =>
  handlers.handle("health", () => Effect.succeed({ status: "ok" as const }));
