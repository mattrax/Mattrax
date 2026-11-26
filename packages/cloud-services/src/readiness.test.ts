import { describe, expect, it } from "vitest";
import { checkReadiness } from "./readiness.js";
import type { ReadinessScheduler } from "./readiness.js";

const base = { version: "1.2.3", deploymentId: "deploy-1" };

/** A scheduler that records deadlines instead of starting real timers. */
const manualScheduler = () => {
  const deadlines: Array<() => void> = [];
  const schedule: ReadinessScheduler = (task) => {
    deadlines.push(task);

    return { cancel: () => {} };
  };

  return { schedule, deadlines };
};

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
    const { schedule, deadlines } = manualScheduler();

    const pending = checkReadiness({
      ...base,
      timeoutMs: 10,
      checkDatabase: () => new Promise<void>(() => {}),
      schedule,
    });

    expect(deadlines).toHaveLength(1);
    deadlines[0]!();

    const result = await pending;
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

  it("reports storage and mailer as ok when both probes pass", async () => {
    const result = await checkReadiness({
      ...base,
      checkDatabase: async () => {},
      checkStorage: async () => "ok",
      checkMailer: async () => "ok",
    });

    expect(result.httpStatus).toBe(200);
    expect(result.body).toMatchObject({
      status: "ok",
      checks: { database: "ok", storage: "ok", mailer: "ok" },
    });
  });

  it("stays ready but degraded when email is intentionally disabled", async () => {
    const result = await checkReadiness({
      ...base,
      checkDatabase: async () => {},
      checkStorage: async () => "ok",
      checkMailer: async () => "skipped",
    });

    expect(result.httpStatus).toBe(200);
    expect(result.body).toMatchObject({
      status: "degraded",
      checks: { database: "ok", storage: "ok", mailer: "skipped" },
    });
    expect(result.body.reason).toBeUndefined();
  });

  it("returns 503 when object storage fails", async () => {
    const result = await checkReadiness({
      ...base,
      checkDatabase: async () => {},
      checkStorage: async () => {
        throw new Error("R2 put failed for token secret");
      },
      checkMailer: async () => "ok",
    });

    expect(result.httpStatus).toBe(503);
    expect(result.body).toMatchObject({
      status: "unavailable",
      checks: { database: "ok", storage: "error", mailer: "ok" },
      reason: "check_failed",
    });
    expect(JSON.stringify(result.body)).not.toContain("secret");
  });

  it("returns 503 when the mailer is missing rather than silently skipping", async () => {
    const result = await checkReadiness({
      ...base,
      checkDatabase: async () => {},
      checkStorage: async () => "ok",
      checkMailer: async () => {
        throw new Error("no outbound email binding is configured");
      },
    });

    expect(result.httpStatus).toBe(503);
    expect(result.body.checks.mailer).toBe("error");
  });

  it("bounds each check independently", async () => {
    const { schedule, deadlines } = manualScheduler();

    const pending = checkReadiness({
      ...base,
      timeoutMs: 10,
      checkDatabase: async () => {},
      checkStorage: async () => "ok",
      checkMailer: () => new Promise<"ok">(() => {}),
      schedule,
    });

    // Only the mailer's deadline expires; the other two checks still settle
    // normally, so they must not be reported as failures.
    expect(deadlines).toHaveLength(3);
    deadlines[2]!();

    const result = await pending;
    expect(result.httpStatus).toBe(503);
    expect(result.body.reason).toBe("timeout");
    expect(result.body.checks).toMatchObject({ database: "ok", storage: "ok", mailer: "error" });
  });
});
