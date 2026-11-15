import { OpenApi } from "effect/http-api";
import { managementApi } from "./http.ts";

let cached: OpenApi.OpenAPISpec | undefined;

/**
 * OpenAPI 3.1 document for the management webhook contract.
 *
 * The document is static for a build, so it is generated once per process.
 * `OpenApi.fromApi` clones its cached result on every call; keeping our own
 * reference avoids repeating that work for every request.
 */
export const managementWebhookOpenApi = (): OpenApi.OpenAPISpec =>
  (cached ??= OpenApi.fromApi(managementApi));
