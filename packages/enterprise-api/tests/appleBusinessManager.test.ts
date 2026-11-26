import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { AppleBusinessManagerError, VppError } from "@mattrax/apple-business-manager/errors";
import { makeAppleBusinessManagerAccess } from "../src/appleBusinessManager.ts";
import { makeDb } from "./helpers.js";

/**
 * The Apple Business Manager / VPP accessors load the client on first use. These
 * tests pin the failure contract: a rejected chunk must stay a *typed* failure
 * (the call sites rely on `Effect.catch` and `mapError`, which do not see
 * defects).
 */

const rejectingLoader = async (): Promise<never> => {
  throw new Error("chunk load failed");
};

const db = makeDb();

describe("lazy Apple Business Manager access", () => {
  it("does not load the client until a call is made", async () => {
    let loads = 0;

    const access = makeAppleBusinessManagerAccess(async () => {
      loads += 1;

      return import("@mattrax/apple-business-manager");
    });

    expect(loads).toBe(0);

    const info = await Effect.runPromise(
      access.appleBusinessManagerInfo(db, "org-1", "https://example.com"),
    );

    expect(loads).toBe(1);
    // The call reached the real client: no ABM token is configured for the org.
    expect(info.configured).toBe(false);
  });

  it("reports a rejected chunk as an upstream AppleBusinessManagerError, not a defect", async () => {
    const access = makeAppleBusinessManagerAccess(rejectingLoader);

    const caught = await Effect.runPromise(
      access
        .loadAppleBusinessManager(db, "org-1")
        .pipe(Effect.catch((error: any) => Effect.succeed({ tag: error._tag, kind: error.kind }))),
    );

    // Reaching this assertion proves `Effect.catch` saw a typed failure.
    expect(caught).toEqual({ tag: "AppleBusinessManagerError", kind: "upstream" });

    const failure = await Effect.runPromise(
      Effect.flip(access.loadAppleBusinessManager(db, "org-1")),
    );

    expect(failure).toBeInstanceOf(AppleBusinessManagerError);
    if (!(failure instanceof AppleBusinessManagerError)) throw new Error("Expected ABM error");
    expect(failure.message).toContain("could not be loaded");
    expect(failure.message).toContain("chunk load failed");
  });

  it("reports a rejected chunk as an upstream VppError for the Apps and Books client", async () => {
    const access = makeAppleBusinessManagerAccess(rejectingLoader);

    const failure = await Effect.runPromise(Effect.flip(access.vppInfo(db, "org-1")));

    expect(failure).toBeInstanceOf(VppError);
    if (!(failure instanceof VppError)) throw new Error("Expected VPP error");
    expect(failure.kind).toBe("upstream");
    expect(failure.message).toContain("Apps and Books");
  });
});
