import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { PolicyRow } from "@mattrax/enterprise-domain/client";
import {
  type PolicyApplyTarget,
  type PolicyDocumentSource,
  type PortablePolicy,
  applyPolicyDocuments,
  parsePolicyDocument,
} from "./policyDocument.ts";
import { CliFailure } from "./settings.ts";

const row = (overrides: Partial<PolicyRow> = {}): PolicyRow => ({
  id: "p1",
  name: "Baseline",
  notes: null,
  priority: 10,
  configurations: { passcode: { required: true } },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const doc = async (policies: ReadonlyArray<PortablePolicy>) =>
  Effect.runPromise(
    parsePolicyDocument(JSON.stringify({ version: 1, policies }), "test-document.json"),
  );

const makeTarget = (initial: ReadonlyArray<PolicyRow>) => {
  const policies = initial.map((policy) => ({ ...policy }));
  const calls = { create: 0, patch: 0 };

  const patches: Array<{ id: string; payload: Parameters<PolicyApplyTarget["patchPolicy"]>[1] }> =
    [];

  let sequence = policies.length;

  const target: PolicyApplyTarget = {
    listPolicies: () => Effect.succeed({ rows: policies }),
    getPolicy: (id) => {
      const policy = policies.find((item) => item.id === id);

      return policy
        ? Effect.succeed(policy)
        : Effect.fail(new CliFailure({ message: `Policy ${id} not found` }));
    },
    createPolicy: (payload) =>
      Effect.sync(() => {
        calls.create += 1;
        sequence += 1;
        const id = `p${sequence}`;

        policies.push(
          row({
            id,
            name: payload.name,
            notes: payload.notes ?? null,
            priority: payload.priority ?? 0,
            configurations: undefined,
          }),
        );

        return { id };
      }),
    patchPolicy: (id, payload) =>
      Effect.sync(() => {
        calls.patch += 1;
        patches.push({ id, payload });
        const policy = policies.find((item) => item.id === id);

        if (!policy) throw new Error(`Policy ${id} not found`);

        if (payload.name !== undefined) policy.name = payload.name;

        if (payload.notes !== undefined) policy.notes = payload.notes;

        if (payload.priority !== undefined) policy.priority = payload.priority;

        if (payload.configurations !== undefined) {
          const configurations: Record<string, Schema.Json> = {};

          for (const [kind, value] of Object.entries(policy.configurations ?? {}))
            configurations[kind] = Schema.decodeUnknownSync(Schema.Json)(value);

          for (const [kind, value] of Object.entries(payload.configurations)) {
            if (value === null) delete configurations[kind];
            else configurations[kind] = Schema.decodeUnknownSync(Schema.Json)(value);
          }

          policy.configurations = configurations;
        }
      }),
  };

  return { target, policies, calls, patches };
};

const documents = async (
  policies: ReadonlyArray<PortablePolicy>,
): Promise<ReadonlyArray<PolicyDocumentSource>> => [
  { source: "test-document.json", document: await doc(policies) },
];

describe("applyPolicyDocuments", () => {
  it("creates a policy once and reports the second run unchanged", async () => {
    const { target, policies, calls } = makeTarget([]);

    const source = await documents([
      { name: "New policy", priority: 5, configurations: { passcode: { required: true } } },
    ]);

    const first = await Effect.runPromise(
      applyPolicyDocuments(target, source, { dryRun: false, id: undefined }),
    );

    const second = await Effect.runPromise(
      applyPolicyDocuments(target, source, { dryRun: false, id: undefined }),
    );

    expect(first.entries[0]?.action).toBe("created");
    expect(second.entries[0]?.action).toBe("unchanged");
    expect(calls.create).toBe(1);
    expect(calls.patch).toBe(1);
    expect(policies).toHaveLength(1);
    expect(policies[0]?.configurations).toEqual({ passcode: { required: true } });
  });

  it("patches only changed fields and removes configurations missing from the document", async () => {
    const existing = row({
      name: "Baseline",
      configurations: { passcode: { required: true }, wifi: { ssid: "old" } },
    });

    const { target, policies, calls } = makeTarget([existing]);

    const source = await documents([
      { name: "Baseline", priority: 10, configurations: { passcode: { required: false } } },
    ]);

    const report = await Effect.runPromise(
      applyPolicyDocuments(target, source, { dryRun: false, id: undefined }),
    );

    expect(report.entries[0]?.action).toBe("updated");
    expect(report.entries[0]?.fields).toEqual(["configurations"]);
    expect(calls.patch).toBe(1);
    expect(policies[0]?.configurations).toEqual({ passcode: { required: false } });
    expect(policies[0]?.priority).toBe(10);
  });

  it("patches a scope-only change even when every payload is identical", async () => {
    const existing = row({
      name: "Baseline",
      priority: 10,
      configurations: { passcode: { required: true } },
      configurationScopes: {},
    });

    const { target, policies, calls, patches } = makeTarget([existing]);

    const source = await documents([
      {
        name: "Baseline",
        priority: 10,
        configurations: { passcode: { required: true } },
        configurationScopes: { passcode: "user" },
      },
    ]);

    const report = await Effect.runPromise(
      applyPolicyDocuments(target, source, { dryRun: false, id: undefined }),
    );

    expect(report.entries[0]?.action).toBe("updated");
    expect(report.entries[0]?.fields).toEqual(["configurationScopes"]);
    expect(calls.patch).toBe(1);
    expect(patches[0]).toMatchObject({
      id: "p1",
      payload: {
        configurations: { passcode: { required: true } },
        configurationScopes: { passcode: "user" },
      },
    });
    expect(policies[0]?.configurations).toEqual({ passcode: { required: true } });
  });

  it("does not write in dry-run mode", async () => {
    const { target, policies, calls } = makeTarget([]);
    const source = await documents([{ name: "Planned" }]);

    const report = await Effect.runPromise(
      applyPolicyDocuments(target, source, { dryRun: true, id: undefined }),
    );

    expect(report.dryRun).toBe(true);
    expect(report.entries[0]?.action).toBe("created");
    expect(calls).toEqual({ create: 0, patch: 0 });
    expect(policies).toHaveLength(0);
  });

  it("applies a single document to --id even when the name differs", async () => {
    const { target, policies } = makeTarget([row({ id: "p9", name: "Old name" })]);
    const source = await documents([{ name: "New name" }]);

    const report = await Effect.runPromise(
      applyPolicyDocuments(target, source, { dryRun: false, id: "p9" }),
    );

    expect(report.entries[0]?.id).toBe("p9");
    expect(report.entries[0]?.fields).toEqual(["name"]);
    expect(policies[0]?.name).toBe("New name");
  });

  it("refuses --id when several policies are supplied", async () => {
    const { target } = makeTarget([]);
    const source = await documents([{ name: "One" }, { name: "Two" }]);

    const error = await Effect.runPromise(
      Effect.flip(applyPolicyDocuments(target, source, { dryRun: false, id: "p1" })),
    );

    expect(error.message).toContain("single policy");
  });

  it("refuses ambiguous name matches", async () => {
    const { target } = makeTarget([
      row({ id: "p1", name: "Same" }),
      row({ id: "p2", name: "Same" }),
    ]);

    const source = await documents([{ name: "Same" }]);

    const error = await Effect.runPromise(
      Effect.flip(applyPolicyDocuments(target, source, { dryRun: false, id: undefined })),
    );

    expect(error.message).toContain("More than one policy is named");
  });
});
