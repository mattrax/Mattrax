import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { schema } from "@mattrax/enterprise-core";
import { MdmOrigin } from "@mattrax/management-backend";
import type { DdmDeclarationItems } from "@mattrax/management-backend";
import {
  ManagementBackendEnterpriseLive,
  OS_UPDATE_ENFORCEMENT_ACTIVATION_ID,
  OS_UPDATE_ENFORCEMENT_CONFIGURATION_ID,
} from "@mattrax/mdm-apple";
import { makeDb, tableName } from "./fake-db.js";

const origin = "https://policies.test";

const authSecret = "os-update-enforcement-secret";

const mdmOrigin = new MdmOrigin({ url: origin });

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const organization = (id: string) => ({
  id,
  name: id,
  slug: id,
  logo: null,
  metadata: null,
  stripeCustomerId: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const device = (overrides: { osEdition?: string; osVersion?: string } = {}) => ({
  id: "device-1",
  organizationId: "org-1",
  proto: "apple",
  status: "enrolled",
  name: "device-1",
  dmIdentifier: "udid-1",
  osEdition: overrides.osEdition ?? "iOS",
  osVersion: overrides.osVersion ?? "18.1",
  enrolledAt: new Date("2026-01-01T00:00:00Z"),
  lastSeenAt: new Date("2026-01-01T00:00:00Z"),
});

const appleRow = (
  overrides: { declarationMode?: "ddm" | "legacy"; enrollmentMode?: "device" | "user" } = {},
) => ({
  deviceId: "device-1",
  declarationMode: overrides.declarationMode ?? "ddm",
  enrollmentMode: overrides.enrollmentMode ?? "device",
});

const policy = (
  overrides: {
    platform?: string;
    minimumVersion?: string | null;
    enforcement?: "off" | "warn" | "enforce";
    deferralDays?: number;
    updatedAt?: Date;
    organizationId?: string;
  } = {},
) => ({
  organizationId: overrides.organizationId ?? "org-1",
  platform: overrides.platform ?? "ios",
  minimumVersion: overrides.minimumVersion === undefined ? "18.2" : overrides.minimumVersion,
  enforcement: overrides.enforcement ?? "enforce",
  deferralDays: overrides.deferralDays ?? 7,
  updatedAt: overrides.updatedAt ?? new Date("2026-11-15T12:00:00.000Z"),
});

const appleScope = {
  _tag: "device" as const,
  udid: "udid-1",
  identityCertificate: "CN=Device,OU=org-1",
  mdmOrigin,
};

const makeBackend = (
  options: {
    device?: ReturnType<typeof device>;
    apple?: ReturnType<typeof appleRow>;
    policy?: ReturnType<typeof policy> | null;
  } = {},
) => {
  const db = makeDb({
    [tableName(schema.organization)]: [organization("org-1")],
    [tableName(schema.device)]: [options.device ?? device()],
    [tableName(schema.deviceApple)]: [options.apple ?? appleRow()],
    ...(options.policy === null
      ? {}
      : { [tableName(schema.tenantOsPolicy)]: [options.policy ?? policy()] }),
  });

  // SAFETY: The fake store implements only the query chains these tests exercise.
  const backend = ManagementBackendEnterpriseLive.make({
    db: db as any,
    origin,
    authSecret,
  });

  return { backend, db };
};

const systemItems = (items: DdmDeclarationItems) => ({
  activation: items.activations.find(
    (item) => item.identifier === OS_UPDATE_ENFORCEMENT_ACTIVATION_ID,
  ),
  configuration: items.configurations.find(
    (item) => item.identifier === OS_UPDATE_ENFORCEMENT_CONFIGURATION_ID,
  ),
});

describe("Apple DDM software-update enforcement delivery", () => {
  it("injects the tenant rule as an activation and declaration", async () => {
    const { backend } = makeBackend();

    const items = await run(backend.getAppleDeclarationItems(appleScope));
    const system = systemItems(items);

    expect(system.activation).toBeTruthy();
    expect(system.configuration).toBeTruthy();

    const activation = await run(
      backend.getAppleDeclaration(appleScope, "activation", OS_UPDATE_ENFORCEMENT_ACTIVATION_ID),
    );

    expect(activation).toEqual({
      Type: "com.apple.activation.simple",
      Identifier: OS_UPDATE_ENFORCEMENT_ACTIVATION_ID,
      ServerToken: expect.any(String),
      Payload: { StandardConfigurations: [OS_UPDATE_ENFORCEMENT_CONFIGURATION_ID] },
    });

    const declaration = await run(
      backend.getAppleDeclaration(
        appleScope,
        "configuration",
        OS_UPDATE_ENFORCEMENT_CONFIGURATION_ID,
      ),
    );

    expect(declaration).toEqual({
      Type: "com.apple.configuration.softwareupdate.enforcement.specific",
      Identifier: OS_UPDATE_ENFORCEMENT_CONFIGURATION_ID,
      ServerToken: system.configuration!.serverToken,
      Payload: {
        TargetOSVersion: "18.2",
        TargetLocalDateTime: "2026-11-22T12:00:00",
      },
    });
  });

  it("rotates the server token when the rule changes", async () => {
    const first = makeBackend();
    const second = makeBackend({
      policy: policy({ updatedAt: new Date("2026-11-16T12:00:00.000Z") }),
    });

    const firstItems = await run(first.backend.getAppleDeclarationItems(appleScope));
    const secondItems = await run(second.backend.getAppleDeclarationItems(appleScope));

    expect(systemItems(firstItems).configuration?.serverToken).not.toBe(
      systemItems(secondItems).configuration?.serverToken,
    );
  });

  it("delivers nothing for warn, off, or a missing minimum", async () => {
    for (const rule of [
      policy({ enforcement: "warn" }),
      policy({ enforcement: "off" }),
      policy({ minimumVersion: null }),
    ]) {
      const { backend } = makeBackend({ policy: rule });
      const items = await run(backend.getAppleDeclarationItems(appleScope));

      expect(systemItems(items).configuration).toBeUndefined();
    }
  });

  it("delivers nothing when the OS or delivery mode cannot apply DDM", async () => {
    const cases = [
      { device: device({ osVersion: "16.7" }) },
      { device: device({ osEdition: "macOS", osVersion: "13.6" }) },
      { apple: appleRow({ declarationMode: "legacy" }) },
      { apple: appleRow({ enrollmentMode: "user" }) },
      { policy: null },
    ];

    for (const input of cases) {
      const { backend } = makeBackend(input);
      const items = await run(backend.getAppleDeclarationItems(appleScope));

      expect(systemItems(items).configuration).toBeUndefined();
      expect(
        await run(
          backend.getAppleDeclaration(
            appleScope,
            "configuration",
            OS_UPDATE_ENFORCEMENT_CONFIGURATION_ID,
          ),
        ),
      ).toBeNull();
    }
  });

  it("keeps iOS and iPadOS rules separate", async () => {
    const { backend } = makeBackend({
      device: device({ osEdition: "iPadOS", osVersion: "18.1" }),
      policy: policy({ platform: "ios", minimumVersion: "18.2" }),
    });

    const items = await run(backend.getAppleDeclarationItems(appleScope));

    expect(systemItems(items).configuration).toBeUndefined();
  });
});
