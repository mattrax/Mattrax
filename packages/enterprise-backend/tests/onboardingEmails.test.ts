import { Effect, Ref } from "effect";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ONBOARDING_REPLY_TO,
  ONBOARDING_EMAIL_FROM,
  ONBOARDING_FOLLOW_UP_AUDIT_ACTION,
  OnboardingEmailWarnings,
  runOnboardingEmails,
  runWelcomeEmailSweep,
  sendWelcomeEmailOnce,
} from "../src/Tenant/onboardingEmails.ts";
import { makeEmailTransport } from "@mattrax/enterprise-backend";
import type { OutboundEmailMessage } from "@mattrax/email";
import { makeDb, runEffect } from "./helpers.js";

const origin = "https://mattrax.test";

const now = new Date("2026-11-14T12:00:00.000Z");

const DAY = 24 * 60 * 60 * 1000;

const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

const makeTransport = (
  behaviour: "ok" | "fail" = "ok",
  failFor?: (message: OutboundEmailMessage) => boolean,
) => {
  const sent: OutboundEmailMessage[] = [];
  const attempts: OutboundEmailMessage[] = [];

  return {
    sent,
    attempts,
    ...makeEmailTransport(async (message: OutboundEmailMessage) => {
      attempts.push(message);

      if (behaviour === "fail" || failFor?.(message))
        throw new Error("provider rejected the message");

      sent.push(message);
    }),
  };
};

/** The single address a message was addressed to, without hiding a leak. */
const recipientsOf = (message: OutboundEmailMessage): string[] =>
  typeof message.to === "string" ? [message.to] : [...message.to];

type AccountSeed = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly disabled: boolean;
  readonly source: "manual" | "scim" | "graph";
  readonly welcomeEmailSentAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type OrganizationSeed = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly displayName: string | null;
  readonly logo: string | null;
  readonly supportEmail: string | null;
  readonly brandColor: string | null;
  readonly onboardingFollowUpSentAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type MemberSeed = {
  readonly id: string;
  readonly organizationId: string;
  readonly accountId: string;
  readonly role: string;
  readonly customRoleId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type FollowUpOverrides = {
  readonly followUpDays?: number;
  readonly windowDays?: number;
  readonly since?: Date | null;
  readonly concurrency?: number;
};

const seedAccount = (overrides: Partial<AccountSeed> = {}): AccountSeed => ({
  id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  emailVerified: true,
  disabled: false,
  source: "manual",
  welcomeEmailSentAt: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const seedTenant = (
  id: string,
  createdAt: Date,
  options: Partial<
    Pick<
      OrganizationSeed,
      "name" | "displayName" | "logo" | "supportEmail" | "brandColor" | "onboardingFollowUpSentAt"
    >
  > = {},
): OrganizationSeed => ({
  id,
  name: options.name ?? `Tenant ${id}`,
  slug: id,
  displayName: options.displayName ?? null,
  logo: options.logo ?? null,
  supportEmail: options.supportEmail ?? null,
  brandColor: options.brandColor ?? null,
  onboardingFollowUpSentAt: options.onboardingFollowUpSentAt ?? null,
  createdAt,
  updatedAt: createdAt,
});

const seedMember = (
  id: string,
  organizationId: string,
  overrides: Partial<MemberSeed> = {},
): MemberSeed => ({
  id,
  organizationId,
  accountId: "user-1",
  role: "owner",
  customRoleId: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const tenantContext = (organization: OrganizationSeed) => {
  const db = makeDb({
    account: [seedAccount()],
    organization: [organization],
    member: [seedMember("member-1", organization.id)],
  });

  return db;
};

const runFollowUp = (
  db: any,
  transport: ReturnType<typeof makeTransport> | undefined,
  overrides: FollowUpOverrides = {},
) =>
  runEffect(
    runOnboardingEmails({
      db,
      now,
      email: transport,
      origin,
      ...overrides,
    }),
  );

describe("welcome email", () => {
  it("keeps invalid-address warning suppression in the provided Layer", async () => {
    const db = makeDb();
    const transport = makeTransport();

    const reported = await runEffect(
      Effect.gen(function* () {
        yield* runWelcomeEmailSweep({
          db,
          email: transport,
          origin,
          replyTo: "not-an-address",
        });
        yield* runWelcomeEmailSweep({
          db,
          email: transport,
          origin,
          replyTo: "still-not-an-address",
        });

        return yield* Ref.get(yield* OnboardingEmailWarnings);
      }).pipe(Effect.provide(OnboardingEmailWarnings.layer)),
    );

    expect([...reported]).toEqual(["MATTRAX_ONBOARDING_REPLY_TO"]);
  });

  it("claims and sends exactly once", async () => {
    const db = makeDb({ account: [seedAccount()] });
    const transport = makeTransport();

    const first = await runEffect(
      sendWelcomeEmailOnce({
        db,
        user: seedAccount(),
        email: transport,
        origin,
        now,
      }),
    );

    expect(first).toBe("sent");
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({
      to: "ada@example.com",
      from: ONBOARDING_EMAIL_FROM,
      replyTo: DEFAULT_ONBOARDING_REPLY_TO,
      subject: "Welcome to Mattrax",
    });
    expect(transport.sent[0].text).toContain("Hey Ada,");
    expect(transport.sent[0].text).toContain(`${origin}/dashboard`);
    expect(db.store.account[0]!.welcomeEmailSentAt).toEqual(now);

    const second = await runEffect(
      sendWelcomeEmailOnce({
        db,
        user: seedAccount(),
        email: transport,
        origin,
        now,
      }),
    );

    expect(second).toBe("skipped");
    expect(transport.sent).toHaveLength(1);
  });

  it("threads deployment branding and the account context into the message", async () => {
    const db = makeDb({ account: [seedAccount()] });
    const transport = makeTransport();

    const outcome = await runEffect(
      sendWelcomeEmailOnce({
        db,
        user: seedAccount(),
        email: transport,
        origin,
        now,
        branding: {
          brandName: "Acme Device Management",
          brandColor: "#2563eb",
          logoUrl: "https://cdn.acme.test/logo.png",
        },
      }),
    );

    expect(outcome).toBe("sent");
    expect(transport.sent[0].subject).toBe("Welcome to Acme Device Management");
    expect(transport.sent[0].text).toContain("Acme Device Management");
    expect(transport.sent[0].text).toContain("ada@example.com");
    expect(transport.sent[0].html).toContain("background:#2563eb;");
    expect(transport.sent[0].html).toContain('aria-hidden="true" class="email-mark"');
    expect(transport.sent[0].html).toContain("Acme Device Management</td>");
    expect(transport.sent[0].html).toContain("ada@example.com");
  });

  it("sends a tenantless account to tenant creation and the quick start", async () => {
    const db = makeDb({ account: [seedAccount()] });
    const transport = makeTransport();

    const outcome = await runEffect(
      sendWelcomeEmailOnce({
        db,
        user: seedAccount(),
        email: transport,
        origin,
        now,
      }),
    );

    expect(outcome).toBe("sent");
    const [message] = transport.sent;

    expect(message.text).toContain(`Create your tenant: ${origin}/tenants/new`);
    expect(message.html).toContain(`href="${origin}/tenants/new"`);
    expect(message.text).toContain(
      `Read the quick start: ${origin}/docs/getting-started/quick-start`,
    );
    expect(message.html).toContain(`href="${origin}/docs/getting-started/quick-start"`);
    expect(message.text).not.toContain("/enrollment");
    expect(message.html).not.toContain("/enrollment");
  });

  it("lets exactly one concurrent claim win", async () => {
    const db = makeDb({ account: [seedAccount()] });
    const transport = makeTransport();

    const outcomes = await Promise.all([
      runEffect(sendWelcomeEmailOnce({ db, user: seedAccount(), email: transport, origin, now })),
      runEffect(sendWelcomeEmailOnce({ db, user: seedAccount(), email: transport, origin, now })),
    ]);

    expect(outcomes.filter((outcome) => outcome === "sent")).toHaveLength(1);
    expect(transport.sent).toHaveLength(1);
  });

  it("clears the claim after a provider failure so a retry sends", async () => {
    const db = makeDb({ account: [seedAccount()] });
    const failing = makeTransport("fail");

    const failed = await runEffect(
      sendWelcomeEmailOnce({
        db,
        user: seedAccount(),
        email: failing,
        origin,
        now,
      }),
    );

    expect(failed).toBe("failed");
    expect(db.store.account[0]!.welcomeEmailSentAt).toBeNull();

    const transport = makeTransport();

    const retried = await runEffect(
      sendWelcomeEmailOnce({
        db,
        user: seedAccount(),
        email: transport,
        origin,
        now,
      }),
    );

    expect(retried).toBe("sent");
    expect(transport.sent).toHaveLength(1);
  });

  it("leaves the marker unset when no transport is configured", async () => {
    const db = makeDb({ account: [seedAccount()] });

    const outcome = await runEffect(
      sendWelcomeEmailOnce({ db, user: seedAccount(), email: undefined, origin, now }),
    );

    expect(outcome).toBe("skipped");
    expect(db.store.account[0]!.welcomeEmailSentAt).toBeNull();
  });

  it.each(["scim", "graph"] as const)("never emails a %s account", async (source) => {
    const user = seedAccount({ source });
    const db = makeDb({ account: [user] });
    const transport = makeTransport();

    const outcome = await runEffect(
      sendWelcomeEmailOnce({ db, user, email: transport, origin, now }),
    );

    expect(outcome).toBe("skipped");
    expect(transport.sent).toHaveLength(0);
    expect(db.store.account[0]!.welcomeEmailSentAt).toBeNull();
  });

  it("never emails an unverified account", async () => {
    const user = seedAccount({ emailVerified: false });
    const db = makeDb({ account: [user] });
    const transport = makeTransport();

    const outcome = await runEffect(
      sendWelcomeEmailOnce({ db, user, email: transport, origin, now }),
    );

    expect(outcome).toBe("skipped");
    expect(transport.attempts).toHaveLength(0);
    expect(db.store.account[0]!.welcomeEmailSentAt).toBeNull();
  });

  it("falls back to the default Reply-To when it is malformed", async () => {
    const db = makeDb({ account: [seedAccount()] });
    const transport = makeTransport();

    const outcome = await runEffect(
      sendWelcomeEmailOnce({
        db,
        user: seedAccount(),
        email: transport,
        origin,
        now,
        replyTo: "not-an-address",
      }),
    );

    expect(outcome).toBe("sent");
    expect(transport.sent[0].replyTo).toBe(DEFAULT_ONBOARDING_REPLY_TO);
    expect(transport.sent[0].text).not.toContain("not-an-address");
  });

  it("sweeps recent verified manual accounts with no marker", async () => {
    const db = makeDb({
      account: [
        seedAccount({ id: "user-1", email: "recent@example.com" }),
        seedAccount({ id: "user-2", email: "old@example.com", createdAt: daysAgo(3) }),
        seedAccount({ id: "user-3", email: "scim@example.com", source: "scim" }),
        seedAccount({ id: "user-4", email: "unverified@example.com", emailVerified: false }),
      ],
    });

    const transport = makeTransport();

    const result = await runEffect(runWelcomeEmailSweep({ db, now, email: transport, origin }));

    expect(result).toMatchObject({ candidates: 1, sent: 1, failed: 0, skipped: 0 });
    expect(transport.sent.map((message) => message.to)).toEqual(["recent@example.com"]);
  });

  it("uses the same deployment branding in the delayed sweep", async () => {
    const db = makeDb({ account: [seedAccount()] });
    const transport = makeTransport();

    const result = await runEffect(
      runWelcomeEmailSweep({
        db,
        now,
        email: transport,
        origin,
        branding: {
          brandName: "Acme Device Management",
          brandColor: "#16a34a",
          logoUrl: "/assets/acme.png",
        },
      }),
    );

    expect(result).toMatchObject({ candidates: 1, sent: 1 });
    expect(transport.sent[0].subject).toBe("Welcome to Acme Device Management");
    expect(transport.sent[0].html).toContain('src="https://mattrax.test/assets/acme.png"');
    expect(transport.sent[0].html).toContain("background:#16a34a;");
  });
});

describe("one-week onboarding follow-up", () => {
  it("does not send before the follow-up threshold", async () => {
    const db = tenantContext(seedTenant("tenant-1", daysAgo(6)));
    const transport = makeTransport();

    const result = await runFollowUp(db, transport);

    expect(result).toMatchObject({ candidates: 0, sent: 0 });
    expect(transport.sent).toHaveLength(0);
    expect(db.store.organization[0]!.onboardingFollowUpSentAt).toBeNull();
  });

  it("sends once at eight days when no device exists", async () => {
    const organization = seedTenant("tenant-1", daysAgo(8), {
      name: "Acme",
      displayName: "Acme Devices",
    });

    const db = tenantContext(organization);
    const transport = makeTransport();

    const result = await runFollowUp(db, transport);

    expect(result).toMatchObject({ candidates: 1, sent: 1 });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({
      to: "ada@example.com",
      from: ONBOARDING_EMAIL_FROM,
      replyTo: DEFAULT_ONBOARDING_REPLY_TO,
    });
    expect(transport.sent[0].text).toContain("It's been 8 days");
    expect(transport.sent[0].text).toContain("Acme Devices");
    expect(transport.sent[0].text).toContain(`${origin}/t/tenant-1/enrollment`);
    expect(db.store.organization[0]!.onboardingFollowUpSentAt).toEqual(now);
  });

  it("uses the tenant brand name, logo and colour in the follow-up", async () => {
    const organization = seedTenant("tenant-1", daysAgo(8), {
      name: "Acme",
      displayName: "Acme Devices",
      logo: "https://cdn.acme.test/logo.png",
      brandColor: "#16a34a",
      supportEmail: "help@acme.test",
    });

    const db = tenantContext(organization);
    const transport = makeTransport();

    const result = await runFollowUp(db, transport);

    expect(result).toMatchObject({ candidates: 1, sent: 1 });
    expect(transport.sent[0].html).toContain("Acme Devices</td>");
    expect(transport.sent[0].html).toContain("background:#16a34a;");
    expect(transport.sent[0].html).toContain("color:#1c1917;");
    expect(transport.sent[0].html).toContain('href="mailto:help@acme.test"');
    expect(transport.sent[0].text).toContain("help@acme.test");
  });

  it("uses the dashboard default colour for a tenant with no brand colour", async () => {
    const organization = seedTenant("tenant-1", daysAgo(8), {
      name: "Acme",
      displayName: "Acme Devices",
    });

    const db = tenantContext(organization);
    const transport = makeTransport();

    await runFollowUp(db, transport);

    expect(transport.sent[0].html).toContain("background:#1c1917;");
    expect(transport.sent[0].html).not.toContain("background:#6e56cf;");
  });

  it("skips a tenant with an enrolled device", async () => {
    const db = tenantContext(seedTenant("tenant-1", daysAgo(8)));
    db.store.device.push({
      id: "device-1",
      organizationId: "tenant-1",
      status: "enrolled",
      enrolledAt: daysAgo(7),
      lastSeenAt: now,
    });

    const transport = makeTransport();

    const result = await runFollowUp(db, transport);

    expect(result).toMatchObject({ candidates: 1, sent: 0, suppressed: 1 });
    expect(transport.sent).toHaveLength(0);
    expect(db.store.organization[0]!.onboardingFollowUpSentAt).toBeNull();
  });

  it("skips a tenant with a device created in the last day", async () => {
    const db = tenantContext(seedTenant("tenant-1", daysAgo(8)));
    db.store.device.push({
      id: "device-1",
      organizationId: "tenant-1",
      status: "enrolling",
      enrolledAt: new Date(now.getTime() - 60 * 60 * 1000),
      lastSeenAt: now,
    });

    const transport = makeTransport();

    const result = await runFollowUp(db, transport);

    expect(result).toMatchObject({ sent: 0, suppressed: 1 });
    expect(transport.sent).toHaveLength(0);
  });

  it("does not treat an old pre-registration as an enrollment", async () => {
    const db = tenantContext(seedTenant("tenant-1", daysAgo(8)));
    db.store.device.push({
      id: "device-1",
      organizationId: "tenant-1",
      status: "enrolling",
      enrolledAt: daysAgo(5),
      lastSeenAt: daysAgo(5),
    });

    const transport = makeTransport();

    const result = await runFollowUp(db, transport);

    expect(result).toMatchObject({ sent: 1 });
    expect(transport.sent).toHaveLength(1);
  });

  it("skips a tenant with a successful enrollment attempt", async () => {
    const db = tenantContext(seedTenant("tenant-1", daysAgo(8)));
    db.store.enrollment_attempt.push({
      id: "attempt-1",
      organizationId: "tenant-1",
      enrollmentId: "enrollment-1",
      platform: "apple",
      outcome: "ok",
      createdAt: daysAgo(6),
    });

    const transport = makeTransport();

    const result = await runFollowUp(db, transport);

    expect(result).toMatchObject({ sent: 0, suppressed: 1 });
    expect(transport.sent).toHaveLength(0);
  });

  it("skips a tenant already marked as sent", async () => {
    const db = tenantContext(
      seedTenant("tenant-1", daysAgo(8), { onboardingFollowUpSentAt: daysAgo(1) }),
    );

    const transport = makeTransport();

    const result = await runFollowUp(db, transport);

    expect(result).toMatchObject({ candidates: 0, sent: 0 });
    expect(transport.sent).toHaveLength(0);
  });

  it("is idempotent across repeated sweeps", async () => {
    const db = tenantContext(seedTenant("tenant-1", daysAgo(8)));
    const transport = makeTransport();

    const first = await runFollowUp(db, transport);
    const second = await runFollowUp(db, transport);

    expect(first.sent).toBe(1);
    expect(second).toMatchObject({ candidates: 0, sent: 0 });
    expect(transport.sent).toHaveLength(1);
  });

  it("leaves a tenant unmarked when no verified owner/admin exists", async () => {
    const db = makeDb({
      account: [seedAccount({ emailVerified: false })],
      organization: [seedTenant("tenant-1", daysAgo(8))],
      member: [seedMember("member-1", "tenant-1")],
    });

    const transport = makeTransport();

    const result = await runFollowUp(db, transport);

    expect(result).toMatchObject({ sent: 0, noRecipients: 1 });
    expect(db.store.organization[0]!.onboardingFollowUpSentAt).toBeNull();
  });

  it("leaves a tenant unmarked when it has no members", async () => {
    const db = makeDb({ organization: [seedTenant("tenant-1", daysAgo(8))] });
    const transport = makeTransport();

    const result = await runFollowUp(db, transport);

    expect(result).toMatchObject({ sent: 0, noRecipients: 1 });
    expect(db.store.organization[0]!.onboardingFollowUpSentAt).toBeNull();
  });

  it("does not claim when no transport is configured", async () => {
    const db = tenantContext(seedTenant("tenant-1", daysAgo(8)));

    const result = await runFollowUp(db, undefined);

    expect(result).toMatchObject({ candidates: 0, sent: 0 });
    expect(db.store.organization[0]!.onboardingFollowUpSentAt).toBeNull();
  });

  it("clears the claim after a provider failure so a later sweep retries", async () => {
    const db = tenantContext(seedTenant("tenant-1", daysAgo(8)));

    const failed = await runFollowUp(db, makeTransport("fail"));

    expect(failed).toMatchObject({ sent: 0, failed: 1 });
    expect(db.store.organization[0]!.onboardingFollowUpSentAt).toBeNull();

    const transport = makeTransport();
    const retried = await runFollowUp(db, transport);

    expect(retried).toMatchObject({ sent: 1 });
    expect(transport.sent).toHaveLength(1);
  });

  it("excludes tenants older than the feature `since` floor", async () => {
    const db = tenantContext(seedTenant("tenant-1", daysAgo(8)));
    const transport = makeTransport();

    const result = await runFollowUp(db, transport, { since: daysAgo(2) });

    expect(result).toMatchObject({ candidates: 0, sent: 0 });
    expect(transport.sent).toHaveLength(0);
  });

  it("honours the configured follow-up window", async () => {
    const db = tenantContext(seedTenant("tenant-1", daysAgo(20)));
    const transport = makeTransport();

    const result = await runFollowUp(db, transport, { followUpDays: 7, windowDays: 7 });

    expect(result).toMatchObject({ candidates: 0, sent: 0 });
    expect(transport.sent).toHaveLength(0);
  });

  it("applies the per-recipient cooldown across tenants", async () => {
    const db = makeDb({
      account: [seedAccount()],
      organization: [seedTenant("tenant-1", daysAgo(9)), seedTenant("tenant-2", daysAgo(8))],
      member: [
        seedMember("member-1", "tenant-1"),
        seedMember("member-2", "tenant-2", { id: "member-2" }),
      ],
    });

    const transport = makeTransport();

    const result = await runFollowUp(db, transport, { concurrency: 1 });

    expect(result).toMatchObject({ candidates: 2, sent: 1, noRecipients: 1 });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].text).toContain("Tenant tenant-1");
    expect(
      db.store.audit_log.filter((row) => row.action === ONBOARDING_FOLLOW_UP_AUDIT_ACTION),
    ).toHaveLength(1);
    expect(db.store.organization[1]!.onboardingFollowUpSentAt).toBeNull();
  });

  it("sends at most once when concurrent tenants share an owner", async () => {
    const db = makeDb({
      account: [seedAccount()],
      organization: [seedTenant("tenant-1", daysAgo(9)), seedTenant("tenant-2", daysAgo(8))],
      member: [
        seedMember("member-1", "tenant-1"),
        seedMember("member-2", "tenant-2", { id: "member-2" }),
      ],
    });

    const transport = makeTransport();

    const result = await runFollowUp(db, transport, { concurrency: 4 });

    expect(result).toMatchObject({ candidates: 2, sent: 1, noRecipients: 1 });
    expect(transport.sent).toHaveLength(1);
    expect(
      db.store.audit_log.filter((row) => row.action === ONBOARDING_FOLLOW_UP_AUDIT_ACTION),
    ).toHaveLength(1);
    expect(
      db.store.organization.filter((row) => row.onboardingFollowUpSentAt != null),
    ).toHaveLength(1);
  });

  it("honours a cooldown row written by an earlier run", async () => {
    const db = makeDb({
      account: [seedAccount()],
      organization: [seedTenant("tenant-1", daysAgo(8))],
      member: [seedMember("member-1", "tenant-1")],
      audit_log: [
        {
          id: "audit-1",
          organizationId: "tenant-0",
          actorAccountId: "user-1",
          actorEmail: "ada@example.com",
          action: ONBOARDING_FOLLOW_UP_AUDIT_ACTION,
          targetType: "organization",
          targetId: "tenant-0",
          metadata: {},
          createdAt: daysAgo(2),
        },
      ],
    });

    const transport = makeTransport();

    const result = await runFollowUp(db, transport);

    expect(result).toMatchObject({ sent: 0, noRecipients: 1 });
    expect(transport.attempts).toHaveLength(0);
    expect(db.store.organization[0]!.onboardingFollowUpSentAt).toBeNull();
  });

  it("sends one private message per verified admin", async () => {
    const db = makeDb({
      account: [
        seedAccount({ id: "user-1", name: "Ada Lovelace", email: "ada@example.com" }),
        seedAccount({ id: "user-2", name: "Grace Hopper", email: "grace@example.com" }),
      ],
      organization: [seedTenant("tenant-1", daysAgo(8))],
      member: [
        seedMember("member-1", "tenant-1", { accountId: "user-1" }),
        seedMember("member-2", "tenant-1", { accountId: "user-2", role: "admin" }),
      ],
    });

    const transport = makeTransport();

    const result = await runFollowUp(db, transport);

    expect(result).toMatchObject({ candidates: 1, sent: 1 });
    expect(transport.sent).toHaveLength(2);

    const byAddress = new Map(transport.sent.map((message) => [recipientsOf(message)[0], message]));

    expect([...byAddress.keys()].sort()).toEqual(["ada@example.com", "grace@example.com"]);

    for (const [address, message] of byAddress) expect(recipientsOf(message)).toEqual([address]);

    expect(byAddress.get("ada@example.com")!.text).toContain("Hey Ada,");
    expect(byAddress.get("grace@example.com")!.text).toContain("Hey Grace,");
    expect(
      db.store.audit_log.filter((row) => row.action === ONBOARDING_FOLLOW_UP_AUDIT_ACTION),
    ).toHaveLength(2);
  });

  it("keeps sending to the other admins when one recipient fails", async () => {
    const db = makeDb({
      account: [
        seedAccount({ id: "user-1", name: "Ada Lovelace", email: "ada@example.com" }),
        seedAccount({ id: "user-2", name: "Grace Hopper", email: "grace@example.com" }),
      ],
      organization: [seedTenant("tenant-1", daysAgo(8))],
      member: [
        seedMember("member-1", "tenant-1", { accountId: "user-1" }),
        seedMember("member-2", "tenant-1", { accountId: "user-2", role: "admin" }),
      ],
    });

    const transport = makeTransport(
      "ok",
      (message) => recipientsOf(message)[0] === "grace@example.com",
    );

    const result = await runFollowUp(db, transport);

    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(transport.attempts).toHaveLength(2);
    expect(transport.sent).toHaveLength(1);
    expect(recipientsOf(transport.sent[0])).toEqual(["ada@example.com"]);
    expect(db.store.organization[0]!.onboardingFollowUpSentAt).toEqual(now);
    expect(
      db.store.audit_log.filter((row) => row.action === ONBOARDING_FOLLOW_UP_AUDIT_ACTION),
    ).toEqual([
      expect.objectContaining({ actorAccountId: "user-1", actorEmail: "ada@example.com" }),
    ]);
  });

  it("excludes a disabled owner", async () => {
    const db = makeDb({
      account: [seedAccount({ disabled: true })],
      organization: [seedTenant("tenant-1", daysAgo(8))],
      member: [seedMember("member-1", "tenant-1")],
    });

    const transport = makeTransport();

    const result = await runFollowUp(db, transport);

    expect(result).toMatchObject({ sent: 0, noRecipients: 1 });
    expect(transport.attempts).toHaveLength(0);
    expect(db.store.organization[0]!.onboardingFollowUpSentAt).toBeNull();
  });

  it.each(["owner", "admin"] as const)(
    "never emails a custom-role member with a legacy %s role",
    async (role) => {
      const db = makeDb({
        account: [seedAccount()],
        organization: [seedTenant("tenant-1", daysAgo(8))],
        member: [seedMember("member-1", "tenant-1", { role, customRoleId: "custom-role-1" })],
      });

      const transport = makeTransport();

      const result = await runFollowUp(db, transport);

      expect(result).toMatchObject({ sent: 0, noRecipients: 1 });
      expect(transport.attempts).toHaveLength(0);
      expect(db.store.organization[0]!.onboardingFollowUpSentAt).toBeNull();
    },
  );

  it("deduplicates recipients case-insensitively", async () => {
    const db = makeDb({
      account: [
        seedAccount({ id: "user-1", email: "ada@example.com" }),
        seedAccount({ id: "user-2", email: "ADA@Example.com" }),
      ],
      organization: [seedTenant("tenant-1", daysAgo(8))],
      member: [
        seedMember("member-1", "tenant-1", { accountId: "user-1" }),
        seedMember("member-2", "tenant-1", { accountId: "user-2", role: "admin" }),
      ],
    });

    const transport = makeTransport();

    const result = await runFollowUp(db, transport);

    expect(result).toMatchObject({ sent: 1 });
    expect(transport.sent).toHaveLength(1);
    expect(recipientsOf(transport.sent[0])).toEqual(["ada@example.com"]);
  });
});
