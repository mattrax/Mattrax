import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { enterpriseApi } from "@mattrax/enterprise-domain";

export const enterpriseHandlers = (handlers: HttpApiBuilder.Handlers.FromGroup<typeof enterpriseApi>) =>
  handlers.handle("status", () => Effect.succeed({ status: "ok" as const }));
