import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { platformApi } from "@mattrax/platform-api";
import { PlatformService } from "./service.js";

export const platformHandlers = (handlers: HttpApiBuilder.Handlers.FromGroup<typeof platformApi>) =>
  handlers
    .handle("status", () => Effect.succeed({ status: "ok" as const }))
    .handle("listInstances", ({ request }) =>
      Effect.flatMap(PlatformService, (service) => service.list(request)),
    )
    .handle("createInstance", ({ request, payload }) =>
      Effect.flatMap(PlatformService, (service) => service.create(request, payload)),
    )
    .handle("updateInstance", ({ request, params, payload }) =>
      Effect.flatMap(PlatformService, (service) =>
        service.update(request, params.instanceId, payload),
      ),
    )
    .handle("revokeInstance", ({ request, params }) =>
      Effect.flatMap(PlatformService, (service) => service.revoke(request, params.instanceId)),
    )
    .handle("verifyInstance", ({ request, payload }) =>
      Effect.flatMap(PlatformService, (service) => service.verify(request, payload)),
    )
    .handle("signInstanceCsr", ({ request, payload }) =>
      Effect.flatMap(PlatformService, (service) => service.signInstanceCsr(request, payload)),
    );

export { PlatformService, PlatformServiceLive } from "./service.js";
