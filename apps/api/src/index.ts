import { Context, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { waitUntil } from "cloudflare:workers";
import { HttpApi, HttpApiGroup } from "effect/unstable/httpapi";
import { appleMdmApi } from "./mdm/apple";
import { mattraxApi } from "./domain";

// HTTP API for the MDM (Mobile Device Management).
// This is accessed by the native device's management clients.
export const mdmApi = HttpApiGroup.make("MattraxMDM")
  .add(appleMdmApi);

export const apiRoot = HttpApi.make("MattraxApi")
  .add(mattraxApi)
  .add(mdmApi)
  .prefix("/api");

export default {
	async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
  	const { handler, dispose } = HttpRouter.toWebHandler(appLayerLive);
    const response = await handler(request, Context.empty());
    waitUntil(dispose().catch((cause) => console.error("OTEL shutdown failed", cause)));
    return response;
	},
} satisfies ExportedHandler<Env>;
