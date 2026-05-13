import { describe, expect, it } from "vitest";
import { makeR2Storage, toR2Error } from "../src/policyApplicationStorage.js";
import { EnterpriseR2FileNotFound, EnterpriseR2InternalError } from "@mattrax/enterprise-domain";
import { runEffect } from "./helpers.js";

describe("R2 storage", () => {
  it("maps missing objects to a structured not found error", async () => {
    const storage = makeR2Storage({ get: async () => null });

    await expect(runEffect(storage.get("missing"))).rejects.toMatchObject({ _tag: "EnterpriseR2FileNotFound" });
  });

  it("maps common not found errors", () => {
    expect(toR2Error(Object.assign(new Error("not found"), { code: "NoSuchKey" }))).toBeInstanceOf(EnterpriseR2FileNotFound);
  });

  it("falls back to an internal error for unknown failures", () => {
    expect(toR2Error(new Error("network failed"))).toBeInstanceOf(EnterpriseR2InternalError);
  });
});
