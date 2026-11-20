/**
 * Telemetry wiring for the API Worker.
 *
 * The tracer/registry live in `@mattrax/cloud-services`; this module only
 * reads the deployment's configuration and renders the Prometheus endpoint.
 * `app.ts` imports the singleton so the tracer provided to Effect's layers is
 * the same instance the web handler uses for the root request span.
 */

import {
  makeTelemetry,
  metricsRequestAuthorised,
  resolveMetricsExposure,
  type MetricsExposure,
} from "@mattrax/cloud-services";
import { env as apiEnv } from "./env.js";

const enabled = apiEnv.MATTRAX_TELEMETRY?.trim().toLowerCase() !== "off";

export const telemetry = makeTelemetry({ enabled });

/**
 * `off` (default) answers 404, `public` serves the aggregate payload, and
 * `token` requires `Authorization: Bearer $MATTRAX_METRICS_TOKEN`. `token`
 * without a token fails closed to `off`.
 */
export const metricsExposure: MetricsExposure = resolveMetricsExposure({
  mode: apiEnv.MATTRAX_METRICS,
  token: apiEnv.MATTRAX_METRICS_TOKEN,
  telemetryEnabled: enabled,
});

const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

export const metricsResponse = (request: Request): Response => {
  if (!metricsExposure.enabled)
    return new Response("Not Found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });

  if (!metricsRequestAuthorised(metricsExposure, request.headers.get("authorization")))
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "www-authenticate": 'Bearer realm="metrics"',
        "cache-control": "no-store",
      },
    });

  return new Response(telemetry.renderMetrics(), {
    status: 200,
    headers: {
      "content-type": METRICS_CONTENT_TYPE,
      "cache-control": "no-store",
    },
  });
};
