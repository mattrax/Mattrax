import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { parsePolicyImportText, planPolicyImport } from "~/lib/policy-import";

describe("new-policy import mode", () => {
  it("plans the source and metadata without an existing target", async () => {
    const policy = await Effect.runPromise(
      parsePolicyImportText(
        JSON.stringify({
          version: 1,
          policies: [
            {
              name: "Cold import",
              notes: "Created without a merge target",
              priority: 25,
              configurations: { "mttx.apple.device": { camera: false } },
            },
          ],
        }),
        "cold-import.json",
      ),
    );

    const plan = planPolicyImport({ policy });

    expect(plan.blocked).toBe(false);
    expect(plan.name).toBe("Cold import");
    expect(plan.notes).toBe("Created without a merge target");
    expect(plan.priority).toBe(25);
    expect(plan.payload.configurations).toEqual({ "mttx.apple.device": { camera: false } });
    expect(plan.payload.configurationScopes).toEqual({ "mttx.apple.device": "device" });
  });
});
