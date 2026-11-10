import { describe, expect, it } from "vitest";
import { checkReadiness } from "./readiness.js";

const base = { version: "1.2.3", deploymentId: "deploy-1" };

describe("readiness probe", () => {
  it("returns 200 when the database check succeeds", async () => {
    let calls = 0;
    const result = await checkReadiness({
      ...base,
      checkDatabase: async () => {
        calls++;
      },
    });
    expect(calls).toBe(1);
    expect(result.httpStatus).toBe(200);
    expect(result.body).toMatchObject({
      status: "ok",
      version: "1.2.3",
      deploymentId: "deploy-1",
      checks: { database: "ok" },
    });
    expect(result.body.reason).toBeUndefined();
  });

  it("returns 503 with a generic reason when the check fails", async () => {
    const result = await checkReadiness({
      ...base,
      checkDatabase: async () => {
        throw new Error("connection refused for user admin@example.com");
      },
    });
    expect(result.httpStatus).toBe(503);
    expect(result.body).toMatchObject({
      status: "unavailable",
      checks: { database: "error" },
      reason: "check_failed",
    });
    // Dependency error text is never echoed to the probe caller.
    expect(JSON.stringify(result.body)).not.toContain("admin@example.com");
  });

  it("returns 503 instead of hanging when the check never settles", async () => {
    const started = Date.now();
    const result = await checkReadiness({
      ...base,
      timeoutMs: 10,
      checkDatabase: () => new Promise<void>(() => {}),
    });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result.httpStatus).toBe(503);
    expect(result.body.reason).toBe("timeout");
  });

  it("omits a missing deployment id", async () => {
    const result = await checkReadiness({
      version: "1.2.3",
      checkDatabase: async () => {},
    });
    expect(result.body.deploymentId).toBeNull();
  });
});
