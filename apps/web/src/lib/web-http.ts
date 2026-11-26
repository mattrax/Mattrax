import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { analyticsHeaders } from "~/lib/posthog-context";

export const WEB_HTTP_TIMEOUT_MILLIS = 15_000;

export const withApplicationAnalytics = (
  request: HttpClientRequest.HttpClientRequest,
): HttpClientRequest.HttpClientRequest => {
  let pathname: string;

  try {
    pathname = new URL(request.url, globalThis.location?.href ?? "https://mattrax.invalid")
      .pathname;
  } catch {
    return request;
  }

  if (pathname !== "/api" && !pathname.startsWith("/api/")) return request;

  return HttpClientRequest.setHeaders(request, analyticsHeaders());
};

const withAnalyticsHeaders = HttpClient.mapRequest(withApplicationAnalytics);

/** The single browser FetchHttpClient boundary for application requests. */
export const webHttpClientLayer = Layer.effect(
  HttpClient.HttpClient,
  Effect.map(HttpClient.HttpClient, (client) =>
    client.pipe(withAnalyticsHeaders, HttpClient.timeout(WEB_HTTP_TIMEOUT_MILLIS)),
  ),
).pipe(Layer.provide(FetchHttpClient.layer));
