import { describe, expect, it } from "vitest";
import { evaluateDeviceQuery, type DeviceQueryDevice } from "./deviceQuery.ts";

const device = (users: DeviceQueryDevice["users"]): DeviceQueryDevice => ({
  name: "Mac",
  proto: "apple",
  ...(users === undefined ? {} : { users }),
});

const user = (overrides: {
  email?: string;
  name?: string;
  externalId?: string;
  source?: string;
}) => ({
  email: "default@example.com",
  name: "Default",
  externalId: null,
  source: "manual",
  ...overrides,
});

describe("user conditions", () => {
  it("matches a positive condition when any linked user matches", () => {
    const query = {
      version: 1 as const,
      all: [{ field: "userDomain" as const, op: "eq" as const, value: "acme.test" }],
    };

    expect(
      evaluateDeviceQuery(
        query,
        device([
          user({ email: "first@other.test" }),
          user({ email: "second@acme.test", name: "Second" }),
        ]),
      ),
    ).toBe(true);
  });

  it("does not require the same person to satisfy two conditions", () => {
    const query = {
      version: 1 as const,
      all: [
        { field: "userDomain" as const, op: "eq" as const, value: "acme.test" },
        { field: "userSource" as const, op: "eq" as const, value: "entra" as const },
      ],
    };

    // One person supplies the domain and another the identity provider; `all`
    // still matches because each condition is existential.
    expect(
      evaluateDeviceQuery(
        query,
        device([
          user({ email: "ada@acme.test", source: "manual" }),
          user({ email: "grace@other.test", source: "entra" }),
        ]),
      ),
    ).toBe(true);
  });

  it("fails positive conditions on a device with no linked users", () => {
    const query = {
      version: 1 as const,
      all: [{ field: "userEmail" as const, op: "contains" as const, value: "acme" }],
    };

    expect(evaluateDeviceQuery(query, device([]))).toBe(false);
  });

  it("treats `is not` as 'no linked user matches'", () => {
    const excluded = {
      version: 1 as const,
      all: [{ field: "userDomain" as const, op: "ne" as const, value: "contractor.test" }],
    };

    expect(
      evaluateDeviceQuery(
        excluded,
        device([user({ email: "ada@acme.test" }), user({ email: "grace@acme.test" })]),
      ),
    ).toBe(true);

    expect(
      evaluateDeviceQuery(
        excluded,
        device([user({ email: "ada@acme.test" }), user({ email: "temp@contractor.test" })]),
      ),
    ).toBe(false);
  });

  it("matches `none` when any user matches the excluded condition", () => {
    const query = {
      version: 1 as const,
      none: [{ field: "userEmail" as const, op: "contains" as const, value: "contractor" }],
    };

    expect(
      evaluateDeviceQuery(query, device([user({ email: "temp@contractor.test" })])),
    ).toBe(false);
    expect(evaluateDeviceQuery(query, device([user({ email: "ada@acme.test" })]))).toBe(true);
    expect(evaluateDeviceQuery(query, device([]))).toBe(true);
  });

  it("matches display name and external id", () => {
    const named = {
      version: 1 as const,
      all: [{ field: "userName" as const, op: "eq" as const, value: "Ada Lovelace" }],
    };
    const external = {
      version: 1 as const,
      all: [{ field: "userExternalId" as const, op: "eq" as const, value: "entra-1" }],
    };
    const users = [user({ name: "Ada Lovelace", externalId: "entra-1" })];

    expect(evaluateDeviceQuery(named, device(users))).toBe(true);
    expect(evaluateDeviceQuery(external, device(users))).toBe(true);
  });

  it("matches the recorded identity provider", () => {
    const query = {
      version: 1 as const,
      all: [{ field: "userSource" as const, op: "eq" as const, value: "entra" as const }],
    };

    expect(evaluateDeviceQuery(query, device([user({ source: "scim" })]))).toBe(false);
    expect(evaluateDeviceQuery(query, device([user({ source: "entra" })]))).toBe(true);
  });

  it("fails every user condition when linked users were not loaded", () => {
    // A device table has no user data; user conditions must not sweep devices
    // in, and a `ne` rule must not match by accident either.
    const query = {
      version: 1 as const,
      all: [{ field: "userDomain" as const, op: "ne" as const, value: "contractor.test" }],
    };

    expect(evaluateDeviceQuery(query, device(undefined))).toBe(false);
  });
});
