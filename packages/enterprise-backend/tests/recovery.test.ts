import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { RecoveryRejected } from "@mattrax/enterprise-domain";
import type { OutboundEmailMessage } from "@mattrax/email";
import {
  approveAccountRecovery,
  cancelAccountRecovery,
  createRecoveryLimiter,
  RECOVERY_PROOF_TTL_MILLIS,
  RECOVERY_REQUEST_LIMIT,
  redeemRecoveryToken,
  RECOVERY_WINDOW_MILLIS,
  requestAccountRecovery,
  verifyAccountRecoveryProof,
} from "../src/Account/recovery.ts";
import { makeEmailTransport } from "@mattrax/enterprise-backend";
import { makeDb, runEffect } from "./helpers.js";

const origin = "https://enterprise.test";

const authSecret = "enterprise-recovery-test-secret";

const start = Date.UTC(2026, 10, 16, 12, 0, 0);

type Sent = { to: string; subject: string; text: string; html: string };

const emailTransport = (sent: Sent[]) =>
  makeEmailTransport(async (message: OutboundEmailMessage) => {
    sent.push({
      to: Schema.is(Schema.String)(message.to) ? message.to : message.to.join(", "),
      subject: message.subject,
      text: message.text ?? "",
      html: message.html ?? "",
    });
  });

type AccountSeed = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  disabled: boolean;
  source: string;
  totpEnabled: boolean;
  passkeyEnabled: boolean;
  authRevision: string;
  welcomeEmailSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const account = (overrides: Partial<AccountSeed> = {}): AccountSeed => ({
  id: "user-1",
  name: "Owner",
  email: "owner@example.com",
  emailVerified: true,
  disabled: false,
  source: "manual",
  totpEnabled: false,
  passkeyEnabled: true,
  authRevision: "revision-1",
  welcomeEmailSentAt: null,
  createdAt: new Date(start),
  updatedAt: new Date(start),
  ...overrides,
});

const member = (organizationId: string, accountId: string, role = "owner") => ({
  id: `member-${organizationId}-${accountId}`,
  organizationId,
  accountId,
  role,
  customRoleId: null,
  createdAt: new Date(start),
  updatedAt: new Date(start),
});

const organization = (id: string) => ({
  id,
  name: id,
  slug: id,
  requireMfa: false,
  createdAt: new Date(start),
  updatedAt: new Date(start),
});

const makeDeps = (
  initial: Record<string, any[]> = { account: [account()] },
  now: () => Date = () => new Date(start),
  branding?: {
    readonly brandName?: string;
    readonly logoUrl?: string;
    readonly brandColor?: string;
  },
) => {
  const db = makeDb(initial);
  const sent: Sent[] = [];

  return {
    db,
    sent,
    deps: {
      db,
      authSecret,
      origin,
      email: emailTransport(sent),
      branding,
      now,
    },
  };
};

const tokenFrom = (sent: Sent[], to: string, param = "token") => {
  const text = sent.find((message) => message.to === to)?.text ?? "";
  const match = text.match(new RegExp(`${param}=([^\\s]+)`));

  return match ? decodeURIComponent(match[1]) : "";
};

/** A solo account completes on email proof alone. */
describe("break-glass recovery on a solo account", () => {
  it("mints a single-use completion link after the proof and bumps the revision", async () => {
    const { db, sent, deps } = makeDeps();

    await runEffect(requestAccountRecovery(deps, { email: "Owner@Example.com" }));

    expect(db.store.account_recovery).toMatchObject([
      { accountId: "user-1", status: "pending_proof", approvalRequired: false },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "owner@example.com" });
    expect(db.store.account_audit_log.map((row: any) => row.action)).toEqual([
      "account.recovery_requested",
    ]);

    const proof = tokenFrom(sent, "owner@example.com");
    const verified = await runEffect(verifyAccountRecoveryProof(deps, { token: proof }));

    expect(verified.status).toBe("ready");

    if (verified.status !== "ready") throw new Error("expected a completion token");

    // Single use: the proof link cannot be replayed.
    await expect(
      runEffect(verifyAccountRecoveryProof(deps, { token: proof })),
    ).rejects.toBeInstanceOf(RecoveryRejected);

    await expect(
      runEffect(redeemRecoveryToken(db, verified.signInToken, new Date(start))),
    ).resolves.toEqual({
      accountId: "user-1",
    });
    expect(db.store.account_recovery[0]!.status).toBe("completed");
    expect(db.store.account[0]!.authRevision).not.toBe("revision-1");
    expect(db.store.account_audit_log.map((row: any) => row.action)).toContain(
      "account.recovery_completed",
    );

    // The completion link is consumed exactly once.
    await expect(
      runEffect(redeemRecoveryToken(db, verified.signInToken, new Date(start))),
    ).resolves.toBeUndefined();
  });

  it("uses deployment branding for the recovery proof", async () => {
    const { sent, deps } = makeDeps(undefined, undefined, {
      brandName: "Acme Device Management",
      brandColor: "#16a34a",
      logoUrl: "/assets/acme.png",
    });

    await runEffect(requestAccountRecovery(deps, { email: "owner@example.com" }));

    expect(sent[0].html).toContain("Acme Device Management</td>");
    expect(sent[0].html).toContain('src="https://enterprise.test/assets/acme.png"');
    expect(sent[0].html).toContain("background:#16a34a;");
  });

  it("answers identically for an address that does not exist", async () => {
    const { db, sent, deps } = makeDeps();

    await expect(
      runEffect(requestAccountRecovery(deps, { email: "nobody@example.com" })),
    ).resolves.toEqual({ status: "ok" });
    expect(sent).toHaveLength(0);
    expect(db.store.account_recovery).toHaveLength(0);
  });

  it("does not recover an unverified or disabled account", async () => {
    const { sent, deps } = makeDeps({ account: [account({ emailVerified: false })] });

    await expect(
      runEffect(requestAccountRecovery(deps, { email: "owner@example.com" })),
    ).resolves.toEqual({ status: "ok" });
    expect(sent).toHaveLength(0);
  });

  it("rejects a proof link after the thirty-minute window", async () => {
    const { sent, deps, db } = makeDeps();

    await runEffect(requestAccountRecovery(deps, { email: "owner@example.com" }));
    const proof = tokenFrom(sent, "owner@example.com");

    const later = makeDeps(undefined, () => new Date(start + RECOVERY_PROOF_TTL_MILLIS + 1));
    // Same store, later clock.
    later.db.store.account_recovery = db.store.account_recovery;

    await expect(
      runEffect(verifyAccountRecoveryProof(later.deps, { token: proof })),
    ).rejects.toBeInstanceOf(RecoveryRejected);
  });

  it("cancels a live ceremony and records it", async () => {
    const { db, sent, deps } = makeDeps();

    await runEffect(requestAccountRecovery(deps, { email: "owner@example.com" }));
    const proof = tokenFrom(sent, "owner@example.com");

    await expect(runEffect(cancelAccountRecovery(deps, { token: proof }))).resolves.toEqual({
      status: "ok",
    });
    expect(db.store.account_recovery[0]!.status).toBe("cancelled");
    await expect(
      runEffect(verifyAccountRecoveryProof(deps, { token: proof })),
    ).rejects.toBeInstanceOf(RecoveryRejected);
    expect(db.store.account_audit_log.map((row: any) => row.action)).toContain(
      "account.recovery_cancelled",
    );
  });
});

/** A shared tenant requires a different owner to approve. */
describe("break-glass recovery approval", () => {
  it("renders branded notices and escapes the account name", async () => {
    const initial = shared();
    initial.account[0] = { ...initial.account[0]!, name: "<img src=x onerror=alert(1)>" };
    const { sent, deps } = makeDeps(initial);

    await runEffect(requestAccountRecovery(deps, { email: "owner@example.com" }));

    const proof = sent.find((message) => message.to === "owner@example.com");
    const approval = sent.find((message) => message.subject.includes("approval"));

    expect(proof?.html).toContain('role="presentation"');
    expect(proof?.html).toContain('name="color-scheme"');
    expect(proof?.html).toContain("Recover access");
    // The footer tells the recipient what to do when it was not them, matching
    // the body rather than contradicting it with "no action needed".
    expect(proof?.text).toContain(
      "If it wasn't you, ignore this email and change your email address",
    );
    expect(proof?.html).toContain(
      "If it wasn't you, ignore this email and change your email address",
    );
    expect(approval?.html).toContain('role="presentation"');
    expect(approval?.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(approval?.html).not.toContain("<img");
  });

  const shared = () => ({
    account: [
      account(),
      account({ id: "user-2", name: "Colleague", email: "colleague@example.com" }),
      account({ id: "user-3", name: "Member", email: "member@example.com" }),
    ],
    organization: [organization("tenant-1")],
    member: [
      member("tenant-1", "user-1"),
      member("tenant-1", "user-2"),
      member("tenant-1", "user-3", "member"),
    ],
  });

  it("waits for another owner and refuses self or non-owner approval", async () => {
    const { db, sent, deps } = makeDeps(shared());

    await runEffect(requestAccountRecovery(deps, { email: "owner@example.com" }));

    expect(db.store.account_recovery[0]).toMatchObject({
      approvalRequired: true,
      approvalOrganizationId: "tenant-1",
    });
    // The approver is asked, the subject is not.
    expect(sent.filter((message) => message.subject.includes("approval"))).toMatchObject([
      { to: "colleague@example.com" },
    ]);

    const proof = tokenFrom(sent, "owner@example.com");
    await expect(runEffect(verifyAccountRecoveryProof(deps, { token: proof }))).resolves.toEqual({
      status: "pending_approval",
    });

    const approval = tokenFrom(sent, "colleague@example.com", "recoveryToken");

    // The subject cannot approve their own recovery.
    await expect(
      runEffect(
        approveAccountRecovery(deps, {
          token: approval,
          organizationId: "tenant-1",
          approverAccountId: "user-1",
        }),
      ),
    ).rejects.toBeInstanceOf(RecoveryRejected);

    // A read-only member of the tenant cannot approve either.
    await expect(
      runEffect(
        approveAccountRecovery(deps, {
          token: approval,
          organizationId: "tenant-1",
          approverAccountId: "user-3",
        }),
      ),
    ).rejects.toBeInstanceOf(RecoveryRejected);

    await expect(
      runEffect(
        approveAccountRecovery(deps, {
          token: approval,
          organizationId: "tenant-1",
          approverAccountId: "user-2",
        }),
      ),
    ).resolves.toEqual({ status: "ok" });

    expect(db.store.account_recovery[0]).toMatchObject({
      status: "ready",
      approvedByAccountId: "user-2",
    });
    expect(db.store.account_audit_log.map((row: any) => row.action)).toContain(
      "account.recovery_approved",
    );

    // Approval emails the completion link to the account, not the approver.
    const link = sent.filter((message) => message.to === "owner@example.com").at(-1)!.text;

    const completionToken = decodeURIComponent(
      link.match(/recover\/complete\?token=([^\s]+)/)?.[1] ?? "",
    );

    expect(completionToken).toEqual(expect.any(String));
    expect(completionToken).not.toBe("");

    await expect(
      runEffect(redeemRecoveryToken(db, completionToken, new Date(start))),
    ).resolves.toEqual({
      accountId: "user-1",
    });
  });

  it("rejects an approval token for a different tenant", async () => {
    const initial = shared();
    initial.organization.push(organization("tenant-2"));
    initial.member.push(member("tenant-2", "user-2"));

    const { sent, deps } = makeDeps(initial);

    await runEffect(requestAccountRecovery(deps, { email: "owner@example.com" }));
    const proof = tokenFrom(sent, "owner@example.com");
    await runEffect(verifyAccountRecoveryProof(deps, { token: proof }));

    const approval = tokenFrom(sent, "colleague@example.com", "recoveryToken");

    await expect(
      runEffect(
        approveAccountRecovery(deps, {
          token: approval,
          organizationId: "tenant-2",
          approverAccountId: "user-2",
        }),
      ),
    ).rejects.toBeInstanceOf(RecoveryRejected);
  });
});

describe("recovery rate limiting", () => {
  it("bounds attempts per key inside the window", () => {
    const limiter = createRecoveryLimiter({
      limit: RECOVERY_REQUEST_LIMIT,
      windowMillis: RECOVERY_WINDOW_MILLIS,
    });

    for (let attempt = 0; attempt < RECOVERY_REQUEST_LIMIT; attempt++)
      expect(limiter.allow("account:owner@example.com", start)).toBe(true);

    expect(limiter.allow("account:owner@example.com", start)).toBe(false);
    // Another key keeps its own budget.
    expect(limiter.allow("client:203.0.113.9", start)).toBe(true);
    // The window resets.
    expect(limiter.allow("account:owner@example.com", start + RECOVERY_WINDOW_MILLIS)).toBe(true);
  });
});
