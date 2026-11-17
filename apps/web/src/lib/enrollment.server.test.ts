import { afterEach, describe, expect, it } from "vitest";
import { ENROLLMENT_STATUS_HEADER } from "./enrollment-lookup";
import { lookupPublicEnrollment } from "./enrollment.server";

/**
 * `lookupPublicEnrollment` reaches the API through the deployment bindings;
 * replacing the global fetch lets these tests pin the response without a Worker
 * or a loopback API process.
 */
const originalFetch = globalThis.fetch;

const stubApiResponse = (response: Response) => {
  globalThis.fetch = async () => response;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const jsonResponse = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

describe("lookupPublicEnrollment", () => {
  it("honours an explicit expired signal on a gone link", async () => {
    stubApiResponse(
      jsonResponse(404, JSON.stringify({ message: "not found" }), {
        [ENROLLMENT_STATUS_HEADER]: "expired",
      }),
    );

    await expect(lookupPublicEnrollment("missing", "")).resolves.toEqual({ status: "expired" });
  });

  it("does not let a stray header turn a server error into expired", async () => {
    stubApiResponse(
      jsonResponse(503, JSON.stringify({ message: "unavailable" }), {
        [ENROLLMENT_STATUS_HEADER]: "expired",
      }),
    );

    await expect(lookupPublicEnrollment("enrollment", "")).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("ignores the header on a successful response", async () => {
    stubApiResponse(
      jsonResponse(200, JSON.stringify({}), {
        [ENROLLMENT_STATUS_HEADER]: "expired",
      }),
    );

    await expect(lookupPublicEnrollment("enrollment", "")).resolves.toEqual({ status: "invalid" });
  });
});
