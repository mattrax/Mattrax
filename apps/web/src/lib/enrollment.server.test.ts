import { Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/server/api-client";
import { ENROLLMENT_STATUS_HEADER } from "./enrollment-lookup";
import { lookupPublicEnrollmentEffect } from "./enrollment.server";

const jsonResponse = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const run = (response: Response) =>
  Effect.runPromise(
    lookupPublicEnrollmentEffect("enrollment", "").pipe(
      Effect.provide(
        ApiClient.fromClient(
          HttpClient.make((request) =>
            Effect.succeed(HttpClientResponse.fromWeb(request, response)),
          ),
        ),
      ),
    ),
  );

describe("lookupPublicEnrollment", () => {
  it("honours an explicit expired signal on a gone link", async () => {
    await expect(
      run(
        jsonResponse(404, JSON.stringify({ message: "not found" }), {
          [ENROLLMENT_STATUS_HEADER]: "expired",
        }),
      ),
    ).resolves.toEqual({ status: "expired" });
  });

  it("does not let a stray header turn a server error into expired", async () => {
    await expect(
      run(
        jsonResponse(503, JSON.stringify({ message: "unavailable" }), {
          [ENROLLMENT_STATUS_HEADER]: "expired",
        }),
      ),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("ignores the header on a successful response", async () => {
    await expect(run(jsonResponse(200, JSON.stringify({})))).resolves.toEqual({
      status: "invalid",
    });
  });

  it("rejects malformed JSON without publishing an enrollment", async () => {
    await expect(run(jsonResponse(200, "not json"))).resolves.toEqual({ status: "invalid" });
  });
});
