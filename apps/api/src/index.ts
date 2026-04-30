import { Context } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { waitUntil } from "cloudflare:workers";
import { appLayerLive } from "./backend";

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { handler, dispose } = HttpRouter.toWebHandler(appLayerLive);
    const response = await handler(request, Context.empty());
    waitUntil(dispose().catch((cause) => console.error("OTEL shutdown failed", cause)));
    return response;
  },
} satisfies ExportedHandler<Env>;
