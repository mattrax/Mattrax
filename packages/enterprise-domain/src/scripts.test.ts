import { describe, expect, it } from "vitest";
import {
  SCRIPT_BODY_MAX_BYTES,
  SCRIPT_OUTPUT_MAX_BYTES,
  SCRIPT_OUTPUT_TRUNCATED_MARKER,
  capScriptOutput,
  cronExpressionProblem,
  manualRunDedupeSource,
  normalizeScriptTrigger,
  planScriptRunQueue,
  redactScriptText,
  resolveAssignedScriptIds,
  scriptAgentToken,
  scriptExecutionIsExpired,
  scriptProblem,
  scriptTriggerLabel,
  verifyScriptAgentToken,
} from "./scripts.ts";
import type { ScriptDraft, ScriptAssignmentRow } from "./scripts.ts";

const now = new Date("2026-11-16T12:00:00.000Z");

const draft = (overrides: Partial<ScriptDraft> = {}): ScriptDraft => ({
  name: "Rotate logs",
  language: "bash",
  body: "#!/bin/bash\nlog rotate",
  runAs: "user",
  timeoutSeconds: 300,
  environment: [],
  trigger: { type: "manual" },
  ...overrides,
});

describe("script validation", () => {
  it("accepts a valid script", () => {
    expect(scriptProblem(draft())).toBeNull();
  });

  it("rejects an empty or oversized body", () => {
    expect(scriptProblem(draft({ body: "   " }))).toMatch(/body is required/i);
    expect(scriptProblem(draft({ body: "x".repeat(SCRIPT_BODY_MAX_BYTES + 1) }))).toMatch(/32 KiB/);
  });

  it("bounds timeout, language and run-as", () => {
    expect(scriptProblem(draft({ timeoutSeconds: 0 }))).toMatch(/Timeout/);
    expect(scriptProblem(draft({ timeoutSeconds: 86_401 }))).toMatch(/Timeout/);
    expect(scriptProblem(draft({ language: "fish" }))).toMatch(/bash, zsh, sh or pwsh/);
    expect(scriptProblem(draft({ runAs: "daemon" }))).toMatch(/root or user/);
  });

  it("validates environment names and duplicates", () => {
    expect(
      scriptProblem(
        draft({
          environment: [
            { name: "API_TOKEN", value: "x", secret: true },
            { name: "API_TOKEN", value: "y", secret: false },
          ],
        }),
      ),
    ).toMatch(/defined twice/);

    expect(
      scriptProblem(draft({ environment: [{ name: "1BAD", value: "x", secret: false }] })),
    ).toMatch(/not a valid name/);
  });

  it("requires interval and cron fields only for their trigger", () => {
    expect(scriptProblem(draft({ trigger: { type: "interval" } }))).toMatch(/Interval/);
    expect(scriptProblem(draft({ trigger: { type: "interval", intervalSeconds: 60 } }))).toBeNull();
    expect(scriptProblem(draft({ trigger: { type: "cron" } }))).toMatch(/cron expression/);
    expect(
      scriptProblem(draft({ trigger: { type: "cron", cronExpression: "0 3 * * *" } })),
    ).toBeNull();
    expect(scriptProblem(draft({ trigger: { type: "manual" } }))).toBeNull();
  });

  it("rejects cron fields outside their ranges", () => {
    expect(cronExpressionProblem("0 3 * * *")).toBeUndefined();
    expect(cronExpressionProblem("*/15 * * * *")).toBeUndefined();
    expect(cronExpressionProblem("0 3 * *")).toMatch(/five fields/);
    expect(cronExpressionProblem("61 3 * * *")).toMatch(/Minute/);
    expect(cronExpressionProblem("0 24 * * *")).toMatch(/Hour/);
    expect(cronExpressionProblem("0 3 * JAN *")).toMatch(/Minute|Hour|Day|Month|Weekday/);
  });

  it("drops trigger-specific columns for other triggers", () => {
    expect(
      normalizeScriptTrigger({ type: "manual", intervalSeconds: 60, cronExpression: "0 * * * *" }),
    ).toEqual({ type: "manual", intervalSeconds: null, cronExpression: null });

    expect(normalizeScriptTrigger({ type: "cron", cronExpression: " 0 3 * * * " })).toEqual({
      type: "cron",
      intervalSeconds: null,
      cronExpression: "0 3 * * *",
    });
  });

  it("labels every trigger", () => {
    expect(scriptTriggerLabel("network-change")).toBe("Network change");
    expect(scriptTriggerLabel("install")).toBe("On install");
  });
});

describe("output redaction and capping", () => {
  it("redacts secret environment values and credential patterns", () => {
    const text =
      "token=supersecret\nAuthorization: Bearer abc.def.ghi\nkey AKIAIOSFODNN7EXAMPLE\nvalue: hunter2";

    expect(redactScriptText(text, ["hunter2"])).not.toContain("hunter2");
    expect(redactScriptText(text)).not.toContain("abc.def.ghi");
    expect(redactScriptText(text)).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(redactScriptText(text)).toContain("[redacted]");
  });

  it("caps output in bytes and marks truncation", () => {
    const result = capScriptOutput(
      "é".repeat(SCRIPT_OUTPUT_MAX_BYTES),
      [],
      SCRIPT_OUTPUT_MAX_BYTES,
    );

    expect(result.truncated).toBe(true);
    expect(result.text.endsWith(SCRIPT_OUTPUT_TRUNCATED_MARKER)).toBe(true);
    expect(new TextEncoder().encode(result.text).length).toBeGreaterThan(SCRIPT_OUTPUT_MAX_BYTES);
    expect(capScriptOutput("ok").truncated).toBe(false);
  });

  it("redacts before capping, so a secret cannot survive at the cut", () => {
    const result = capScriptOutput("secret", ["secret"]);

    expect(result.text).toBe("[redacted]");
  });
});

describe("assignment resolution", () => {
  const assignments: ScriptAssignmentRow[] = [
    { scriptId: "direct", targetType: "device", targetId: "device-1" },
    { scriptId: "group", targetType: "group", targetId: "group-a" },
    { scriptId: "other", targetType: "group", targetId: "group-b" },
    { scriptId: "unrelated", targetType: "device", targetId: "device-2" },
  ];

  it("unions direct and group assignments once per script", () => {
    const resolved = resolveAssignedScriptIds(assignments, {
      deviceId: "device-1",
      groupIds: new Set(["group-a"]),
    });

    expect([...resolved].sort()).toEqual(["direct", "group"]);
  });

  it("returns nothing for a device outside every assignment", () => {
    expect(
      resolveAssignedScriptIds(assignments, {
        deviceId: "device-9",
        groupIds: new Set(),
      }).size,
    ).toBe(0);
  });
});

describe("run queue planning", () => {
  const queued = {
    id: "run-1",
    scriptId: "script-1",
    deviceId: "device-1",
    status: "queued",
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
  };

  it("reuses an unexpired queued run instead of creating another", () => {
    const plan = planScriptRunQueue([queued], {
      scriptId: "script-1",
      deviceId: "device-1",
      now,
    });

    expect(plan.duplicate?.id).toBe("run-1");
    expect(plan.expireIds).toEqual([]);
  });

  it("expires a queued run past its deadline", () => {
    const plan = planScriptRunQueue([{ ...queued, expiresAt: new Date(now.getTime() - 1) }], {
      scriptId: "script-1",
      deviceId: "device-1",
      now,
    });

    expect(plan.duplicate).toBeNull();
    expect(plan.expireIds).toEqual(["run-1"]);
  });

  it("ignores another device's run", () => {
    const plan = planScriptRunQueue([queued], {
      scriptId: "script-1",
      deviceId: "device-2",
      now,
    });

    expect(plan.duplicate).toBeNull();
  });

  it("treats queued runs with no deadline as never expiring", () => {
    const row = { ...queued, expiresAt: null };

    expect(scriptExecutionIsExpired(row, new Date(now.getTime() + 10 ** 12))).toBe(false);
  });

  it("names one manual dedupe source per script", () => {
    expect(manualRunDedupeSource("a")).not.toBe(manualRunDedupeSource("b"));
  });
});

describe("agent identity", () => {
  it("round-trips a device id and rejects a forged signature", async () => {
    const token = await scriptAgentToken("device-1", "secret");
    const [encoded] = token.split(".");

    expect(await verifyScriptAgentToken(token, "secret")).toBe("device-1");
    expect(await verifyScriptAgentToken(token, "other-secret")).toBeNull();
    expect(await verifyScriptAgentToken(`${encoded}.forged`, "secret")).toBeNull();
    expect(await verifyScriptAgentToken("mttx_sa1_not-a-token", "secret")).toBeNull();
  });

  it("binds the token to the device id", async () => {
    const one = await scriptAgentToken("device-1", "secret");
    const two = await scriptAgentToken("device-2", "secret");

    expect(one).not.toBe(two);
    expect(
      await verifyScriptAgentToken(one.replace("ZGV2aWNlLTE", "ZGV2aWNlLTI"), "secret"),
    ).toBeNull();
  });
});
