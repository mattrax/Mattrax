import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { EnterpriseBadRequest } from "@mattrax/enterprise-domain";
import { preconditionFromRequest, requestHeader } from "./preconditions.js";

describe("requestHeader", () => {
  it("reads platform and Effect Headers through get", () => {
    const headers = {
      get: (name: string) =>
        name === "if-unmodified-since" ? "Wed, 20 Nov 2026 10:15:30 GMT" : null,
    };

    expect(requestHeader({ headers }, "if-unmodified-since")).toBe("Wed, 20 Nov 2026 10:15:30 GMT");
  });

  it("reads a plain record case-insensitively", () => {
    expect(
      requestHeader(
        { headers: { "If-Unmodified-Since": "2026-11-20T10:15:30.123Z" } },
        "if-unmodified-since",
      ),
    ).toBe("2026-11-20T10:15:30.123Z");
    expect(
      requestHeader(
        { headers: { "if-unmodified-since": ["first", "second"] } },
        "if-unmodified-since",
      ),
    ).toBe("first");
  });

  it("returns undefined when there are no headers", () => {
    expect(requestHeader({}, "if-unmodified-since")).toBeUndefined();
  });
});

describe("preconditionFromRequest", () => {
  it("uses the header as the coarse fallback", async () => {
    const precondition = await Effect.runPromise(
      preconditionFromRequest(
        { headers: { get: () => "Wed, 20 Nov 2026 10:15:30 GMT" } },
        undefined,
      ),
    );

    expect(precondition).toMatchObject({ _tag: "At", timestamp: { precision: "second" } });
  });

  it("rejects a malformed precondition instead of writing unconditionally", async () => {
    const failure = await Effect.runPromise(
      preconditionFromRequest({ headers: {} }, "yesterday").pipe(
        Effect.catchTag("EnterpriseBadRequest", (error) => Effect.succeed(error)),
      ),
    );

    expect(failure).toBeInstanceOf(EnterpriseBadRequest);
  });
});
