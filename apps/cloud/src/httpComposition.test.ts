import { RelayPushTransport } from "@mattrax/apns";
import { AzureGraph, AzureGraphLive } from "@mattrax/azure-graph";
import { AzureOidc, AzureOidcLive } from "@mattrax/azure-oidc";
import { makeEntitlementSync, makeRemoteBillingService } from "@mattrax/enterprise-billing";
import { Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, expect, it } from "vitest";

describe("shared outbound HttpClient composition", () => {
  it("substitutes one client Layer for billing, APNs, Graph and OIDC", async () => {
    const requests: string[] = [];
    const client = HttpClient.make((request) => {
      requests.push(request.url);
      let body: Schema.Json = {};

      if (request.url.includes(".well-known/openid-configuration"))
        body = {
          issuer: "https://login.microsoftonline.com/tenant-1/v2.0",
          jwks_uri: "https://login.microsoftonline.com/tenant/discovery/v2.0/keys",
        };
      else if (request.url.includes("login.microsoftonline.com"))
        body = { access_token: "access-token", expires_in: 3600 };
      else if (request.url.includes("graph.microsoft.com")) body = { value: ["ok"] };

      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(request.url.includes("billing.example.com") ? null : JSON.stringify(body), {
            status: request.url.includes("billing.example.com") ? 204 : 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      );
    });
    const clientLayer = Layer.succeed(HttpClient.HttpClient, client);
    const runtime = Layer.mergeAll(
      clientLayer,
      AzureGraphLive({
        clientId: "client-id",
        clientSecret: "client-secret",
        graphBaseUrl: "https://graph.microsoft.com/v1.0",
        loginBaseUrl: "https://login.microsoftonline.com",
      }).pipe(Layer.provide(clientLayer)),
      AzureOidcLive().pipe(Layer.provide(clientLayer)),
    );
    const billing = makeRemoteBillingService({
      url: "https://billing.example.com",
      licenseKey: "licence-key",
      origin: "https://mattrax.example.com",
    });
    const entitlement = makeEntitlementSync({
      url: "https://cloud.example.com",
      token: "services-token",
    });
    const relay = RelayPushTransport({
      url: "https://services.example.com/v1/apns/push",
      token: "licence-key",
    });
    const GraphResult = Schema.Struct({ value: Schema.Array(Schema.String) });

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* billing.reportUsage({ deviceCount: 1, tenantCount: 1 });
        yield* entitlement({
          organizationId: "tenant-1",
          plan: "device",
          status: "active",
        });
        yield* relay.push({
          pushToken: "token",
          pushMagic: "magic",
          topic: "com.example.mdm",
        });
        const graph = yield* AzureGraph;
        yield* graph.get("tenant-1", "https://graph.microsoft.com/v1.0/test", GraphResult);
        const oidc = yield* AzureOidc;
        yield* oidc.discovery("tenant-1");
      }).pipe(Effect.provide(runtime)),
    );

    expect(requests).toEqual(
      expect.arrayContaining([
        "https://billing.example.com/api/platform/billing/usage",
        "https://cloud.example.com/api/internal/billing/entitlement",
        "https://services.example.com/v1/apns/push",
        "https://graph.microsoft.com/v1.0/test",
        "https://login.microsoftonline.com/tenant-1/v2.0/.well-known/openid-configuration",
      ]),
    );
  });
});
