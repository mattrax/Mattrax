import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseForbidden,
  EnterpriseNotFound,
} from "@mattrax/enterprise-domain";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeEmailTransport } from "@mattrax/enterprise-backend";
import { sendTransactionalEmail } from "../src/emailOutbox.js";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const authSecret = "enterprise-test-secret";

type TestUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
  totpEnabled?: boolean;
  passkeyEnabled?: boolean;
};

type SentEmail = {
  to: string;
  from: { name: string; email: string };
  replyTo?: { name: string; email: string };
  subject: string;
  text?: string;
  html?: string;
};

const userRow = (overrides: Partial<TestUser> = {}): TestUser => {
  const now = new Date();

  return {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

const makeContext = (
  options: {
    db?: any;
    user?: Partial<TestUser>;
    send?: (message: SentEmail) => Promise<void>;
  } = {},
) => {
  const db = options.db ?? makeDb();
  const user = userRow(options.user);
  const sent: SentEmail[] = [];

  if (!db.store.user.some((row: any) => row.id === user.id)) db.store.user.push(user);

  const email = makeEmailTransport(async (message: SentEmail) => {
    if (options.send) await options.send(message);
    sent.push(message);
  });

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return headers.cookie ? Effect.succeed({ user }) : Effect.fail(new Error("Unauthenticated"));
    },
    listApiTokens: () => Effect.succeed({ tokens: [] }),
    createApiToken: () => Effect.die("not used"),
    revokeApiToken: () => Effect.succeed({ status: "ok" }),
    requestEmailChange: () => Effect.succeed({ status: "ok" }),
    verifyEmailChange: () => Effect.succeed({ status: "ok" }),
    requireStepUp: () => Effect.void,
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    stripeClient: makeStripeClient(),
    // SAFETY: these tests never reach R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake implements only the auth methods these tests exercise.
    auth: auth as any,
    authSecret,
    email,
  });

  return { db, service, user, sent, headers: { cookie: "mattrax_session=test" } };
};

const addMember = (
  db: any,
  tenantId: string,
  user: { id: string },
  role: string,
  customRoleId?: string | null,
) => {
  const now = new Date();

  const member = {
    id: `member-${user.id}`,
    organizationId: tenantId,
    userId: user.id,
    role,
    customRoleId: customRoleId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  db.store.member.push(member);

  return member;
};

const createTenant = async (context: ReturnType<typeof makeContext>, slug: string) =>
  runEffect(context.service.createTenant(request(context.headers), { name: slug, slug }));

const createRole = (
  context: ReturnType<typeof makeContext>,
  tenantId: string,
  name: string,
  permissions: ReadonlyArray<string>,
) =>
  runEffect(
    context.service.createTenantRole(request(context.headers), tenantId, { name, permissions }),
  );

const invite = (
  context: ReturnType<typeof makeContext>,
  tenantId: string,
  payload: { email: string; role?: string; roleId?: string | null },
) => runEffect(context.service.inviteTenantUser(request(context.headers), tenantId, payload));

const tokenFrom = (url: string) => {
  const token = new URL(url).searchParams.get("token");
  expect(token, "invite URL must carry a token").toBeTruthy();

  return token!;
};

const addUser = (db: any, overrides: Partial<TestUser>) => {
  const user = userRow(overrides);
  db.store.user.push(user);

  return user;
};

const invitationRow = (db: any, id: string) =>
  db.store.invitation.find((row: any) => row.id === id);

describe("tenant invitations", () => {
  it("creates a pending invitation and returns a one-time link", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    const created = await invite(owner, tenant.id, {
      email: "  NewHire@Example.COM ",
      role: "member",
    });

    expect(created.emailSent).toBe(true);
    expect(created.inviteUrl).toContain(`${origin}/accept-invitation?token=`);
    expect(Date.parse(created.expiresAt)).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);

    expect(owner.db.store.invitation[0]).toMatchObject({
      id: created.id,
      organizationId: tenant.id,
      email: "newhire@example.com",
      role: "member",
      status: "pending",
      sendCount: 1,
    });
    // The message is queued, not sent inline. One row per invitation
    // generation carries the rendered branding and the dedupe key.
    expect(owner.sent).toHaveLength(0);
    expect(owner.db.store.email_outbox).toHaveLength(1);
    expect(owner.db.store.email_outbox[0]).toMatchObject({
      recipient: "newhire@example.com",
      template: "invitation",
      organizationId: tenant.id,
      dedupeKey: `invitation:${created.id}:1`,
      status: "pending",
    });
    expect(owner.db.store.email_outbox[0]!.payload).toMatchObject({
      to: "newhire@example.com",
      subject: "Join acme on Mattrax",
    });
    // The row stores the rendered template, so the drain never re-renders.
    expect(owner.db.store.email_outbox[0]!.payload.html).toContain("Accept invitation");
  });

  it("rejects the legacy builtin:member role syntax", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    await expect(
      invite(owner, tenant.id, { email: "new@example.com", role: "builtin:member" }),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
    expect(owner.db.store.invitation).toEqual([]);
  });

  it("rejects an existing member case-insensitively but invites a non-member user", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    const existing = addUser(owner.db, {
      id: "user-existing",
      name: "Existing",
      email: "existing@example.com",
    });

    addMember(owner.db, tenant.id, existing, "member");

    await expect(
      invite(owner, tenant.id, { email: "Existing@Example.COM", role: "member" }),
    ).rejects.toBeInstanceOf(EnterpriseConflict);

    addUser(owner.db, { id: "user-outsider", name: "Outsider", email: "outsider@example.com" });

    await expect(
      invite(owner, tenant.id, { email: "outsider@example.com", role: "member" }),
    ).resolves.toMatchObject({ emailSent: true });
  });

  it("supersedes a previous pending invitation and invalidates its token", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    const first = await invite(owner, tenant.id, {
      email: "new@example.com",
      role: "member",
    });

    const firstToken = tokenFrom(first.inviteUrl);

    const second = await invite(owner, tenant.id, {
      email: "new@example.com",
      role: "member",
    });

    const old = invitationRow(owner.db, first.id);
    expect(old).toMatchObject({ status: "superseded", tokenHash: null });
    expect(tokenFrom(second.inviteUrl)).not.toBe(firstToken);

    const preview = await runEffect(
      owner.service.previewInvitation(request(), { token: firstToken }),
    );

    expect(preview.state).toBe("unknown");
    await expect(
      runEffect(owner.service.acceptInvitation(request(owner.headers), { token: firstToken })),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("rejects a privileged fallback role with a custom role", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    const custom = await createRole(owner, tenant.id, "Support", ["tenant.read", "devices.read"]);

    for (const role of ["owner", "admin"]) {
      await expect(
        invite(owner, tenant.id, { email: "new@example.com", roleId: custom.id, role }),
      ).rejects.toBeInstanceOf(EnterpriseBadRequest);
    }

    expect(owner.db.store.invitation).toEqual([]);

    const target = addUser(owner.db, {
      id: "user-target",
      name: "Target",
      email: "target@example.com",
    });

    const targetMember = addMember(owner.db, tenant.id, target, "member");

    await expect(
      runEffect(
        owner.service.patchTenantUser(request(owner.headers), tenant.id, targetMember.id, {
          roleId: custom.id,
          role: "admin",
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
    expect(targetMember.role).toBe("member");
  });

  it("enforces the actor's built-in delegation ceiling", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    const actor = makeContext({
      db: owner.db,
      user: { id: "user-actor", name: "Actor", email: "actor@example.com" },
    });

    const memberManager = await createRole(owner, tenant.id, "Member manager", [
      "tenant.read",
      "members.read",
      "members.write",
    ]);

    addMember(owner.db, tenant.id, actor.user, "member", memberManager.id);

    await expect(
      invite(actor, tenant.id, { email: "admin@example.com", role: "admin" }),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
    expect(owner.db.store.invitation).toEqual([]);
  });

  it("accepts an invitation, is idempotent, and enforces the invited email", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    const created = await invite(owner, tenant.id, {
      email: "invited@example.com",
      role: "auditor",
    });

    const token = tokenFrom(created.inviteUrl);

    const invited = makeContext({
      db: owner.db,
      user: { id: "user-invited", name: "Invited", email: "Invited@Example.com" },
    });

    const wrong = makeContext({
      db: owner.db,
      user: { id: "user-wrong", name: "Wrong", email: "wrong@example.com" },
    });

    await expect(
      runEffect(wrong.service.acceptInvitation(request(wrong.headers), { token })),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
    expect(invitationRow(owner.db, created.id)?.status).toBe("pending");

    const accepted = await runEffect(
      invited.service.acceptInvitation(request(invited.headers), { token }),
    );

    expect(accepted).toEqual({ tenantId: tenant.id, alreadyMember: false });
    expect(
      owner.db.store.member.find(
        (row: any) => row.organizationId === tenant.id && row.userId === invited.user.id,
      ),
    ).toMatchObject({ role: "auditor" });
    expect(invitationRow(owner.db, created.id)).toMatchObject({ status: "accepted" });
    expect(invitationRow(owner.db, created.id)?.acceptedAt).toBeInstanceOf(Date);

    await expect(
      runEffect(invited.service.acceptInvitation(request(invited.headers), { token })),
    ).resolves.toEqual({ tenantId: tenant.id, alreadyMember: true });
  });

  it("does not consume an invitation for an unverified account", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    const created = await invite(owner, tenant.id, {
      email: "unverified@example.com",
      role: "member",
    });

    const token = tokenFrom(created.inviteUrl);

    const unverified = makeContext({
      db: owner.db,
      user: {
        id: "user-unverified",
        name: "Unverified",
        email: "unverified@example.com",
        emailVerified: false,
      },
    });

    await expect(
      runEffect(unverified.service.acceptInvitation(request(unverified.headers), { token })),
    ).rejects.toBeInstanceOf(EnterpriseForbidden);
    expect(invitationRow(owner.db, created.id)?.status).toBe("pending");
    expect(invitationRow(owner.db, created.id)?.tokenHash).toBeTruthy();
  });

  it("marks an expired invitation and rejects canceled or superseded tokens", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    const expired = await invite(owner, tenant.id, {
      email: "expired@example.com",
      role: "member",
    });

    const expiredToken = tokenFrom(expired.inviteUrl);
    invitationRow(owner.db, expired.id).expiresAt = new Date(Date.now() - 1_000);

    const expiredUser = makeContext({
      db: owner.db,
      user: { id: "user-expired", name: "Expired", email: "expired@example.com" },
    });

    await expect(
      runEffect(
        expiredUser.service.acceptInvitation(request(expiredUser.headers), {
          token: expiredToken,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
    expect(invitationRow(owner.db, expired.id)?.status).toBe("expired");

    const canceled = await invite(owner, tenant.id, {
      email: "canceled@example.com",
      role: "member",
    });

    const canceledToken = tokenFrom(canceled.inviteUrl);
    const canceledHash = invitationRow(owner.db, canceled.id).tokenHash;
    await runEffect(
      owner.service.cancelTenantInvitation(request(owner.headers), tenant.id, canceled.id),
    );

    const canceledUser = makeContext({
      db: owner.db,
      user: { id: "user-canceled", name: "Canceled", email: "canceled@example.com" },
    });

    // Canceling clears the hash, so a link presented afterwards looks unknown.
    await expect(
      runEffect(
        canceledUser.service.acceptInvitation(request(canceledUser.headers), {
          token: canceledToken,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);

    // A cancellation observed while a link is still in flight is a 409.
    invitationRow(owner.db, canceled.id).status = "canceled";
    invitationRow(owner.db, canceled.id).tokenHash = canceledHash;
    await expect(
      runEffect(
        canceledUser.service.acceptInvitation(request(canceledUser.headers), {
          token: canceledToken,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseConflict);

    const first = await invite(owner, tenant.id, {
      email: "superseded@example.com",
      role: "member",
    });

    const supersededToken = tokenFrom(first.inviteUrl);
    await invite(owner, tenant.id, { email: "superseded@example.com", role: "member" });

    const supersededUser = makeContext({
      db: owner.db,
      user: { id: "user-superseded", name: "Superseded", email: "superseded@example.com" },
    });

    await expect(
      runEffect(
        supersededUser.service.acceptInvitation(request(supersededUser.headers), {
          token: supersededToken,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
  });

  it("falls back to member when the delegated custom role vanished before accept", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    const custom = await createRole(owner, tenant.id, "Devices only", [
      "tenant.read",
      "devices.read",
    ]);

    const created = await invite(owner, tenant.id, {
      email: "deleted-role@example.com",
      roleId: custom.id,
    });

    const token = tokenFrom(created.inviteUrl);

    // Simulate the referenced role disappearing between invite and accept.
    owner.db.store.tenant_role = owner.db.store.tenant_role.filter(
      (row: any) => row.id !== custom.id,
    );

    const invited = makeContext({
      db: owner.db,
      user: {
        id: "user-deleted-role",
        name: "Deleted Role",
        email: "deleted-role@example.com",
      },
    });

    await expect(
      runEffect(invited.service.acceptInvitation(request(invited.headers), { token })),
    ).resolves.toEqual({ tenantId: tenant.id, alreadyMember: false });

    expect(
      owner.db.store.member.find(
        (row: any) => row.organizationId === tenant.id && row.userId === invited.user.id,
      ),
    ).toMatchObject({ role: "member", customRoleId: null });
    expect(
      owner.db.store.audit_log.find(
        (row: any) => row.action === "member.joined" && row.targetId === invited.user.id,
      )?.metadata,
    ).toMatchObject({ roleFallback: "member" });
  });

  it("only cancels pending or expired invitations and audits the action", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    const created = await invite(owner, tenant.id, {
      email: "cancel@example.com",
      role: "member",
    });

    await runEffect(
      owner.service.cancelTenantInvitation(request(owner.headers), tenant.id, created.id),
    );
    expect(invitationRow(owner.db, created.id)).toMatchObject({
      status: "canceled",
      tokenHash: null,
    });
    expect(
      owner.db.store.audit_log.find((row: any) => row.action === "member.invitation_canceled"),
    ).toMatchObject({ targetId: created.id });

    await expect(
      runEffect(
        owner.service.cancelTenantInvitation(request(owner.headers), tenant.id, created.id),
      ),
    ).rejects.toBeInstanceOf(EnterpriseConflict);

    const expired = await invite(owner, tenant.id, {
      email: "expired-cancel@example.com",
      role: "member",
    });

    invitationRow(owner.db, expired.id).status = "expired";

    await expect(
      runEffect(
        owner.service.cancelTenantInvitation(request(owner.headers), tenant.id, expired.id),
      ),
    ).resolves.toEqual({ status: "ok" });
    expect(invitationRow(owner.db, expired.id)?.status).toBe("canceled");
  });

  it("resends with a rotated token, extended expiry and incremented send count", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    const created = await invite(owner, tenant.id, {
      email: "resend@example.com",
      role: "member",
    });

    const oldToken = tokenFrom(created.inviteUrl);
    const oldExpiry = invitationRow(owner.db, created.id).expiresAt;
    invitationRow(owner.db, created.id).expiresAt = new Date(Date.now() - 1_000);

    const resent = await runEffect(
      owner.service.resendTenantInvitation(request(owner.headers), tenant.id, created.id),
    );

    expect(resent.emailSent).toBe(true);
    expect(tokenFrom(resent.inviteUrl)).not.toBe(oldToken);
    expect(Date.parse(resent.expiresAt)).toBeGreaterThanOrEqual(oldExpiry.getTime());
    expect(invitationRow(owner.db, created.id)).toMatchObject({
      status: "pending",
      sendCount: 2,
    });
    // A resend rotates the token, so it is a distinct queue entry.
    expect(
      owner.db.store.email_outbox.map((row: { dedupeKey: string }) => row.dedupeKey).sort(),
    ).toEqual([`invitation:${created.id}:1`, `invitation:${created.id}:2`]);
    expect(invitationRow(owner.db, created.id)?.lastSentAt).toBeInstanceOf(Date);

    const invited = makeContext({
      db: owner.db,
      user: { id: "user-resend", name: "Resend", email: "resend@example.com" },
    });

    await expect(
      runEffect(invited.service.acceptInvitation(request(invited.headers), { token: oldToken })),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);
    await expect(
      runEffect(
        invited.service.acceptInvitation(request(invited.headers), {
          token: tokenFrom(resent.inviteUrl),
        }),
      ),
    ).resolves.toMatchObject({ tenantId: tenant.id });

    await expect(
      runEffect(
        owner.service.resendTenantInvitation(request(owner.headers), tenant.id, created.id),
      ),
    ).rejects.toBeInstanceOf(EnterpriseConflict);
  });

  it("queues the invitation even while the provider is down", async () => {
    const logged: string[] = [];

    const spies = (["log", "warn", "error"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((arg) => String(arg)).join(" "));
      }),
    );

    try {
      const owner = makeContext({
        send: async () => {
          throw new Error("provider down");
        },
      });

      const tenant = await createTenant(owner, "acme");

      const created = await invite(owner, tenant.id, {
        email: "failed@example.com",
        role: "member",
      });

      const token = tokenFrom(created.inviteUrl);

      // Delivery is the cron's job; the request only has to queue the message.
      expect(created.emailSent).toBe(true);
      expect(created.inviteUrl).toContain("token=");
      expect(owner.db.store.email_outbox).toHaveLength(1);
      expect(logged.join("\n")).not.toContain(token);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("does not queue the same invitation generation twice", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    const created = await invite(owner, tenant.id, {
      email: "retry@example.com",
      role: "member",
    });

    // Simulate the same request being replayed after a lost response: the
    // invitation row (and therefore the key) is unchanged.
    const outcome = await runEffect(
      sendTransactionalEmail({
        db: owner.db,
        email: makeEmailTransport(async () => undefined),
        recipient: "retry@example.com",
        template: "invitation",
        organizationId: tenant.id,
        dedupeKey: `invitation:${created.id}:1`,
        message: {
          to: "retry@example.com",
          from: { name: "Acme", email: "hello@mattrax.cloud" },
          subject: "Join acme on Mattrax",
          text: "link",
        },
      }),
    );

    expect(outcome).toBe("duplicate");
    expect(owner.db.store.email_outbox).toHaveLength(1);
  });

  it("keeps the invitation flow when the outbox write fails", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    // The fake store exposes the same row array the insert builder pushes to.
    owner.db.store.email_outbox.push = () => {
      throw new Error("database is down");
    };

    const created = await invite(owner, tenant.id, {
      email: "queued@example.com",
      role: "member",
    });

    // The administrator still gets a working one-time link.
    expect(created.emailSent).toBe(false);
    expect(tokenFrom(created.inviteUrl)).toBeTruthy();
    expect(owner.db.store.invitation[0]).toMatchObject({ status: "pending" });
  });

  it("lists invitations with status filtering, ordering, inviter and expiry", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    const first = await invite(owner, tenant.id, {
      email: "first@example.com",
      role: "member",
    });

    const second = await invite(owner, tenant.id, {
      email: "second@example.com",
      role: "auditor",
    });

    invitationRow(owner.db, first.id).createdAt = new Date("2026-01-01T00:00:00.000Z");
    invitationRow(owner.db, second.id).createdAt = new Date("2026-01-02T00:00:00.000Z");
    invitationRow(owner.db, second.id).expiresAt = new Date(Date.now() - 1_000);

    const all = await runEffect(
      owner.service.listTenantInvitations(request(owner.headers), tenant.id, {}),
    );

    expect(all.invitations.map((item: any) => item.id)).toEqual([second.id, first.id]);
    expect(all.invitations[0]).toMatchObject({
      email: "second@example.com",
      roleName: "Auditor",
      isExpired: true,
      invitedBy: { id: owner.user.id, name: owner.user.name, email: owner.user.email },
    });

    const pending = await runEffect(
      owner.service.listTenantInvitations(request(owner.headers), tenant.id, {
        status: "pending",
      }),
    );

    // Both are still `pending`; `isExpired` is derived from the clock.
    expect(pending.invitations).toHaveLength(2);

    const limited = await runEffect(
      owner.service.listTenantInvitations(request(owner.headers), tenant.id, {
        status: "pending",
        limit: 1,
      }),
    );

    expect(limited.invitations.map((item: any) => item.id)).toEqual([second.id]);
  });

  it("previews an invitation without leaking the token or full email", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    const created = await invite(owner, tenant.id, {
      email: "preview.user@example.com",
      role: "admin",
    });

    const token = tokenFrom(created.inviteUrl);

    const preview = await runEffect(owner.service.previewInvitation(request(), { token }));

    expect(preview).toMatchObject({
      state: "valid",
      tenant: { name: "acme" },
      roleName: "Administrator",
    });
    expect(preview.invitedEmailMasked).toBe("p***@e***.com");
    expect(JSON.stringify(preview)).not.toContain(token);
    expect(JSON.stringify(preview)).not.toContain("preview.user@example.com");

    await expect(
      runEffect(owner.service.previewInvitation(request(), { token: "not-a-token" })),
    ).resolves.toEqual({ state: "unknown" });

    invitationRow(owner.db, created.id).expiresAt = new Date(Date.now() - 1_000);
    await expect(
      runEffect(owner.service.previewInvitation(request(), { token })),
    ).resolves.toMatchObject({ state: "expired" });

    // Canceling clears the token, so simulate a cancellation observed while a
    // link was still in flight rather than reusing the cleared token.
    invitationRow(owner.db, created.id).status = "canceled";
    await expect(runEffect(owner.service.previewInvitation(request(), { token }))).resolves.toEqual(
      { state: "canceled" },
    );
  });

  it("exposes effective permissions from built-in and custom roles", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    const custom = await createRole(owner, tenant.id, "Devices only", [
      "tenant.read",
      "devices.read",
    ]);

    const reader = makeContext({
      db: owner.db,
      user: { id: "user-reader", name: "Reader", email: "reader@example.com" },
    });

    addMember(owner.db, tenant.id, reader.user, "member", custom.id);

    const list = await runEffect(reader.service.listTenants(request(reader.headers)));
    expect(list.tenants).toHaveLength(1);
    expect(list.tenants[0]).toMatchObject({
      id: tenant.id,
      role: "member",
      roleId: custom.id,
      roleName: "Devices only",
      roleKind: "custom",
    });
    expect(list.tenants[0]?.permissions).toEqual(["tenant.read", "devices.read"]);

    const detail = await runEffect(reader.service.getTenant(request(reader.headers), tenant.id));

    expect(detail).toMatchObject({
      roleId: custom.id,
      roleName: "Devices only",
      roleKind: "custom",
      permissions: ["tenant.read", "devices.read"],
    });
  });

  it("returns invitation options using the actor's ceiling", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    const privileged = await createRole(owner, tenant.id, "Lifecycle", [
      "tenant.read",
      "tenant.delete",
    ]);

    const asOwner = await runEffect(
      owner.service.getTenantInvitationOptions(request(owner.headers), tenant.id),
    );

    expect(asOwner.roles.find((option: any) => option.role === "owner")).toMatchObject({
      label: "Owner",
      assignable: true,
    });
    expect(asOwner.roles.find((option: any) => option.roleId === privileged.id)).toMatchObject({
      label: "Lifecycle",
      assignable: true,
    });

    const admin = makeContext({
      db: owner.db,
      user: { id: "user-admin", name: "Admin", email: "admin@example.com" },
    });

    addMember(owner.db, tenant.id, admin.user, "admin");

    const asAdmin = await runEffect(
      admin.service.getTenantInvitationOptions(request(admin.headers), tenant.id),
    );

    expect(asAdmin.roles.find((option: any) => option.role === "owner")).toMatchObject({
      assignable: false,
    });
    expect(asAdmin.roles.find((option: any) => option.roleId === privileged.id)).toMatchObject({
      assignable: false,
    });
  });

  it("blocks deleting a custom role with pending invitations", async () => {
    const owner = makeContext();
    const tenant = await createTenant(owner, "acme");

    const custom = await createRole(owner, tenant.id, "Pending role", [
      "tenant.read",
      "devices.read",
    ]);

    await invite(owner, tenant.id, {
      email: "pending-role@example.com",
      roleId: custom.id,
    });

    await expect(
      runEffect(owner.service.deleteTenantRole(request(owner.headers), tenant.id, custom.id)),
    ).rejects.toBeInstanceOf(EnterpriseConflict);
    expect(owner.db.store.tenant_role.some((row: any) => row.id === custom.id)).toBe(true);
  });
});
