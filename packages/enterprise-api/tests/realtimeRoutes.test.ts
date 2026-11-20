import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { EnterpriseUnauthorized, type EnterpriseAuth } from "@mattrax/enterprise-domain";
import {
  authorizeRealtimeTenant,
  latestRealtimeSeq,
  readRealtimeBatch,
  realtimeEventStream,
} from "../src/realtimeRoutes.js";
import { makeDb } from "./helpers.js";

const now = new Date("2026-06-01T12:00:00.000Z");

type TestAccount = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: null;
  createdAt: Date;
  updatedAt: Date;
  totpEnabled: boolean;
  passkeyEnabled: boolean;
  disabled: boolean;
};

const account = (overrides: Partial<TestAccount> = {}): TestAccount => ({
  id: "account-1",
  name: "Owner",
  email: "owner@example.com",
  emailVerified: true,
  image: null,
  createdAt: now,
  updatedAt: now,
  totpEnabled: false,
  passkeyEnabled: false,
  disabled: false,
  ...overrides,
});

const organization = (id: string, requireMfa = false) => ({
  id,
  name: `Tenant ${id}`,
  slug: id,
  logo: null,
  displayName: null,
  supportEmail: null,
  brandColor: null,
  metadata: null,
  requireMfa,
  scriptsEnabled: true,
  stripeCustomerId: null,
  onboardingFollowUpSentAt: null,
  createdAt: now,
  updatedAt: now,
});

const member = (
  accountId: string,
  organizationId: string,
  role = "owner",
  customRoleId: string | null = null,
) => ({
  id: `member-${accountId}-${organizationId}`,
  organizationId,
  accountId,
  role,
  customRoleId,
  createdAt: now,
  updatedAt: now,
});

type RealtimeTestSession = {
  readonly user: TestAccount;
  readonly apiToken?: { readonly tenantId?: string | null; readonly scopes?: string[] | null };
  readonly oauth?: { readonly scopes?: string[] };
};

const authFor = (
  resolved: RealtimeTestSession | undefined,
  failure?: EnterpriseUnauthorized,
): EnterpriseAuth["Service"] => {
  // SAFETY: these boundary tests drive only requireUser; the authorisation
  // helper never calls the remaining auth methods.
  return {
    requireUser: () => (failure === undefined ? Effect.succeed(resolved) : Effect.fail(failure)),
  } as EnterpriseAuth["Service"];
};

const authorize = (
  db: ReturnType<typeof makeDb>,
  auth: EnterpriseAuth["Service"],
  tenantId = "tenant-1",
) => Effect.runPromise(authorizeRealtimeTenant({ db, auth, tenantId, headers: {} }));

const seedTenant = (
  db: ReturnType<typeof makeDb>,
  options: { account?: Partial<TestAccount>; requireMfa?: boolean; role?: string } = {},
) => {
  const user = account(options.account);

  db.store.account.push(user);
  db.store.organization.push(organization("tenant-1", options.requireMfa ?? false));
  db.store.member.push(member(user.id, "tenant-1", options.role ?? "owner"));

  return user;
};

describe("authorizeRealtimeTenant", () => {
  it("allows a verified owner", async () => {
    const db = makeDb();
    const user = seedTenant(db);

    await expect(authorize(db, authFor({ user }))).resolves.toEqual({
      allowed: true,
      accountId: user.id,
    });
  });

  it("rejects an unauthenticated caller with 401", async () => {
    const db = makeDb();

    await expect(
      authorize(db, authFor(undefined, new EnterpriseUnauthorized({ message: "no session" }))),
    ).resolves.toMatchObject({ allowed: false, status: 401 });
  });

  it("rejects an unverified account with 403", async () => {
    const db = makeDb();
    const user = seedTenant(db, { account: { emailVerified: false } });

    await expect(authorize(db, authFor({ user }))).resolves.toMatchObject({
      allowed: false,
      status: 403,
    });
  });

  it("reports a missing membership as 404 so tenants cannot be probed", async () => {
    const db = makeDb();
    const user = account();

    db.store.account.push(user);
    db.store.organization.push(organization("tenant-1"));

    await expect(authorize(db, authFor({ user }))).resolves.toMatchObject({
      allowed: false,
      status: 404,
    });
  });

  it("reports a tenant-bound token used on another tenant as 404", async () => {
    const db = makeDb();
    const user = seedTenant(db);

    await expect(
      authorize(db, authFor({ user, apiToken: { tenantId: "tenant-2", scopes: null } })),
    ).resolves.toMatchObject({ allowed: false, status: 404 });
  });

  it("denies a role without devices.read", async () => {
    const db = makeDb();
    const user = seedTenant(db);

    db.store.tenant_role.push({
      id: "role-read",
      organizationId: "tenant-1",
      name: "Read only tenant",
      description: null,
      permissions: ["tenant.read"],
      createdByAccountId: null,
      createdAt: now,
      updatedAt: now,
    });
    db.store.member[0]!.customRoleId = "role-read";

    await expect(authorize(db, authFor({ user }))).resolves.toMatchObject({
      allowed: false,
      status: 403,
    });
  });

  it("denies a narrowed token without devices.read", async () => {
    const db = makeDb();
    const user = seedTenant(db);

    await expect(
      authorize(db, authFor({ user, apiToken: { tenantId: "tenant-1", scopes: ["tenant.read"] } })),
    ).resolves.toMatchObject({ allowed: false, status: 403 });
  });

  it("allows a token scoped to devices.read for its own tenant", async () => {
    const db = makeDb();
    const user = seedTenant(db, { role: "auditor" });

    await expect(
      authorize(
        db,
        authFor({ user, apiToken: { tenantId: "tenant-1", scopes: ["devices.read"] } }),
      ),
    ).resolves.toMatchObject({ allowed: true });
  });

  it("enforces a tenant-wide MFA requirement", async () => {
    const db = makeDb();
    const user = seedTenant(db, { requireMfa: true });

    await expect(authorize(db, authFor({ user }))).resolves.toMatchObject({
      allowed: false,
      status: 403,
    });
  });

  it("allows an MFA-enrolled member of an MFA tenant", async () => {
    const db = makeDb();
    const user = seedTenant(db, { requireMfa: true, account: { totpEnabled: true } });

    await expect(authorize(db, authFor({ user }))).resolves.toMatchObject({ allowed: true });
  });
});

describe("readRealtimeBatch", () => {
  const eventRow = (seq: number, organizationId: string, kind = "device.checkin") => ({
    seq,
    organizationId,
    kind,
    deviceId: `device-${organizationId}`,
    protocol: "apple",
    createdAt: new Date(now.getTime() + seq * 1_000),
  });

  it("never returns another tenant's events", async () => {
    const db = makeDb();

    db.store.realtime_event.push(
      eventRow(1, "tenant-1"),
      eventRow(2, "tenant-2"),
      eventRow(3, "tenant-1", "device.command"),
    );

    const batch = await Effect.runPromise(readRealtimeBatch(db, "tenant-1", 0));

    expect(batch.events.map((event) => event.seq)).toEqual([1, 3]);
    expect(batch.lastSeq).toBe(3);

    for (const event of batch.events) expect(event.deviceId).toBe("device-tenant-1");
  });

  it("honours the exclusive cursor and limit", async () => {
    const db = makeDb();

    for (let seq = 1; seq <= 5; seq++) db.store.realtime_event.push(eventRow(seq, "tenant-1"));

    const batch = await Effect.runPromise(readRealtimeBatch(db, "tenant-1", 2, 2));

    expect(batch.events.map((event) => event.seq)).toEqual([3, 4]);
    expect(batch.lastSeq).toBe(4);
  });

  it("streams bounded SSE frames for one tenant only", async () => {
    const db = makeDb();

    db.store.realtime_event.push(
      eventRow(1, "tenant-2"),
      eventRow(2, "tenant-1"),
      eventRow(3, "tenant-1", "device.command"),
      eventRow(4, "tenant-1"),
    );

    const stream = realtimeEventStream({
      db,
      tenantId: "tenant-1",
      after: 0,
      sleep: () => Effect.void,
      batchSize: 1,
      maxEvents: 2,
    });

    const chunks = await Effect.runPromise(Stream.runCollect(stream));
    const bytes = Array.from(chunks).flatMap((chunk) => Array.from(chunk));
    const body = new TextDecoder().decode(Uint8Array.from(bytes));

    // Two frames, oldest first, with the cursor as the SSE id.
    expect(body.match(/id: /g)).toHaveLength(2);
    expect(body).toContain("id: 2");
    expect(body).toContain("id: 3");
    // The other tenant's event never appears, even at a lower sequence.
    expect(body).not.toContain("id: 1\n");
    expect(body).not.toContain("device-tenant-2");
    expect(body.endsWith("\n\n")).toBe(true);
  });

  it("reports the tenant's head cursor", async () => {
    const db = makeDb();

    db.store.realtime_event.push(eventRow(4, "tenant-1"), eventRow(9, "tenant-2"));

    await expect(Effect.runPromise(latestRealtimeSeq(db, "tenant-1"))).resolves.toBe(4);
    await expect(Effect.runPromise(latestRealtimeSeq(db, "tenant-3"))).resolves.toBe(0);
  });
});
