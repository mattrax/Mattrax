import { describe, expect, it } from "vitest";
import {
  MATTRAX_SCRIPT_PAYLOAD_TYPE,
  buildScriptProfile,
  parseScriptProfile,
  parseScriptResult,
  scriptProfileIdentifier,
} from "../scripts.js";

const input = {
  scriptId: "script-1",
  name: "Rotate logs",
  description: "Nightly log rotation",
  language: "zsh" as const,
  body: "#!/bin/zsh\nlog rotate",
  runAs: "root" as const,
  timeoutSeconds: 600,
  environment: [{ name: "API_TOKEN", value: "secret" }],
  trigger: { type: "interval" as const, intervalSeconds: 3600 },
  runId: "run-1",
  serverUrl: "https://mattrax.test/api",
  deviceToken: "mttx_sa1_device.signature",
};

describe("script profile payload", () => {
  it("encodes a com.mattrax.script payload inside a configuration profile", async () => {
    const bytes = await buildScriptProfile(input);
    const text = new TextDecoder().decode(bytes);

    expect(text).toContain("<plist");
    expect(text).toContain(MATTRAX_SCRIPT_PAYLOAD_TYPE);
    expect(text).toContain(scriptProfileIdentifier("script-1"));
    expect(text).toContain("RunID");
    expect(text).toContain("TimerInterval");
    expect(text).toContain("https://mattrax.test/api");
  });

  it("round-trips the payload the agent executes", async () => {
    const bytes = await buildScriptProfile(input);
    const parsed = await parseScriptProfile(bytes);

    expect(parsed).toEqual([
      {
        scriptId: "script-1",
        name: "Rotate logs",
        language: "zsh",
        body: "#!/bin/zsh\nlog rotate",
        runAs: "root",
        timeoutSeconds: 600,
        runId: "run-1",
      },
    ]);
  });

  it("names the environment values the agent must redact", async () => {
    const text = new TextDecoder().decode(
      await buildScriptProfile({
        ...input,
        environment: [
          { name: "API_TOKEN", value: "super-secret", secret: true },
          { name: "REGION", value: "eu" },
        ],
      }),
    );

    const flagged = /SecretEnvironment[\s\S]*?<\/array>/.exec(text)?.[0] ?? "";

    expect(flagged).toContain("API_TOKEN");
    expect(flagged).not.toContain("REGION");
    expect(flagged).not.toContain("super-secret");
  });

  it("maps cron to the legacy timer trigger and keeps other triggers", async () => {
    for (const [trigger, expected] of [
      [{ type: "cron" as const, cronExpression: "0 3 * * *" }, "CronExpression"],
      [{ type: "network-change" as const }, "networkstatechange"],
      [{ type: "login" as const }, "login"],
      [{ type: "install" as const }, "install"],
      [{ type: "manual" as const }, "manual"],
    ] as const) {
      const text = new TextDecoder().decode(await buildScriptProfile({ ...input, trigger }));

      expect(text).toContain(expected);
    }
  });

  it("gives the same script a stable profile identifier", async () => {
    const one = new TextDecoder().decode(await buildScriptProfile(input));
    const two = new TextDecoder().decode(await buildScriptProfile({ ...input, runId: null }));

    expect(one).toContain("com.mattrax.script.script-1.profile");
    expect(two).toContain("com.mattrax.script.script-1.profile");
    expect(one).not.toBe(two);
  });

  it("ignores a profile without a script payload", async () => {
    const bytes = new TextEncoder().encode(
      '<?xml version="1.0"?><plist version="1.0"><dict><key>PayloadContent</key><array/></dict></plist>',
    );

    expect(await parseScriptProfile(bytes)).toEqual([]);
  });
});

describe("agent result payload", () => {
  const result = {
    runId: "run-1",
    scriptId: "script-1",
    trigger: "manual",
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    durationMs: 12,
    startedAt: "2026-11-16T12:00:00.000Z",
    finishedAt: "2026-11-16T12:00:00.012Z",
  };

  it("accepts the documented result shape", () => {
    expect(parseScriptResult(result)).toEqual(result);
  });

  it("rejects an unknown trigger or missing run identity", () => {
    expect(parseScriptResult({ ...result, trigger: "startup" })).toBeNull();
    expect(parseScriptResult({ ...result, runId: 7 })).toBeNull();
    expect(parseScriptResult(null)).toBeNull();
  });
});
