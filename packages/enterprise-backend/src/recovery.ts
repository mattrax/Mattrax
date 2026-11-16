import { Auth, Schema as AuthSchema, Sessions } from "@yielded/auth";
import { AuthCredentialCommandCollector, type AuthInvocation } from "@yielded/auth/Operations";
import type { StrategyDefinition } from "@yielded/auth/Auth";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  Db,
  type EnterpriseDb,
  authCredentials,
  authRequirementForSubject,
  schema,
} from "@mattrax/enterprise-core";
import { AuthClaims, RecoveryRejected } from "@mattrax/enterprise-domain";
import { ACCOUNT_AUDIT, recordAccountAudit } from "./accountAudit.ts";
import type { EmailTransport } from "./email.ts";
import { hasOwnerRole } from "./rbac.ts";

/**
 * Break-glass account recovery.
 *
 * Passkeys are the only sign-in credential, so an account that loses every
 * device has no way back in. The ceremony is deliberately narrow:
 *
 *  1. the account proves control of its **verified** address with a single-use
 *     proof link (30 minutes);
 *  2. when the account belongs to a shared tenant (a tenant with more than one
 *     owner), a *different* owner approves with their own single-use link;
 *  3. only then is a single-use completion link minted (15 minutes) that signs
 *     the account in so it can enrol a new passkey.
 *
 * Nothing in this path removes, replaces or weakens an existing credential: the
 * "last passkey cannot be removed" rule is untouched. Every request, approval,
 * completion and cancellation is written to the account audit stream.
 */

export const RECOVERY_PROOF_TTL_MILLIS = 30 * 60 * 1000;

export const RECOVERY_COMPLETION_TTL_MILLIS = 15 * 60 * 1000;

/** Bound on live ceremonies per address and per client per hour. */
export const RECOVERY_REQUEST_LIMIT = 3;

export const RECOVERY_WINDOW_MILLIS = 60 * 60 * 1000;

export type RecoveryDeps = {
  readonly db: EnterpriseDb;
  readonly authSecret: string;
  readonly origin: string;
  readonly email?: EmailTransport;
  readonly now?: () => Date;
};

const nowOf = (deps: RecoveryDeps) => (deps.now ? deps.now() : new Date());

export const randomRecoveryToken = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const sha256 = (value: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  });

const tokenHash = (value: string) => sha256(value);

const randomId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

const linkFor = (origin: string, path: string, token: string) =>
  `${origin}${path}?token=${encodeURIComponent(token)}`;

const FROM = { name: "Mattrax", email: "hello@mattrax.cloud" } as const;

const sendEmail = (
  email: EmailTransport | undefined,
  message: { to: string; subject: string; text: string; html: string },
  fallbackLog: string,
) =>
  email === undefined
    ? // A deployment without a mailer cannot complete recovery: the link is
      // the whole proof. Log only that the attempt happened (never the URL,
      // which a log reader could redeem) and point the operator at the manual
      // procedure in docs/admin/operations.md.
      Effect.sync(() => {
        console.log(`${fallbackLog} (not emailed: no mail transport configured)`);
      })
    : email.send({ from: FROM, ...message }).pipe(Effect.catch(() => Effect.void));

/**
 * Whether recovery needs approval. An account is "shared" when at least one
 * tenant it owns has another owner: a colleague can vouch for the person. Solo
 * accounts have nobody to ask, so email control is the whole ceremony.
 */
export const recoveryApprovalTenant = (
  db: EnterpriseDb,
  userId: string,
): Effect.Effect<string | null, unknown> =>
  Effect.gen(function* () {
    const memberships = yield* db
      .select({ organizationId: schema.member.organizationId, role: schema.member.role })
      .from(schema.member)
      .where(eq(schema.member.userId, userId));

    const ownerTenants = memberships
      .filter((membership) => hasOwnerRole(membership.role))
      .map((membership) => membership.organizationId);

    if (ownerTenants.length === 0) return null;

    const colleagues = yield* db
      .select({
        organizationId: schema.member.organizationId,
        userId: schema.member.userId,
        role: schema.member.role,
      })
      .from(schema.member)
      .where(inArray(schema.member.organizationId, ownerTenants));

    const shared = colleagues.find(
      (member) => member.userId !== userId && hasOwnerRole(member.role),
    );

    return shared?.organizationId ?? null;
  });

/** Owners of the tenant who may approve, excluding the account being recovered. */
const ownerRecipients = (db: EnterpriseDb, organizationId: string, excludeUserId: string) =>
  Effect.gen(function* () {
    const rows = yield* db
      .select({
        userId: schema.member.userId,
        email: schema.user.email,
        role: schema.member.role,
        disabled: schema.user.disabled,
        emailVerified: schema.user.emailVerified,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, organizationId));

    return rows
      .filter(
        (row) =>
          row.userId !== excludeUserId &&
          hasOwnerRole(row.role) &&
          !row.disabled &&
          row.emailVerified,
      )
      .map((row) => row.email);
  });

/** Cancel every live ceremony for the account; one live request at a time. */
const cancelLiveCeremonies = (db: EnterpriseDb, userId: string, at: Date) =>
  db
    .update(schema.accountRecovery)
    .set({ status: "cancelled", cancelledAt: at, updatedAt: at })
    .where(
      and(
        eq(schema.accountRecovery.userId, userId),
        inArray(schema.accountRecovery.status, ["pending_proof", "pending_approval", "ready"]),
      ),
    );

export type RecoveryRequestResult = { readonly status: "ok" };

/**
 * Start the ceremony. Unknown, unverified and disabled addresses get the exact
 * same answer so the endpoint cannot be used to enumerate accounts.
 */
export const requestAccountRecovery = (
  deps: RecoveryDeps,
  input: { readonly email: string },
): Effect.Effect<RecoveryRequestResult> =>
  Effect.gen(function* () {
    const email = input.email.trim().toLowerCase();

    if (!email || !email.includes("@")) return { status: "ok" as const };

    const user = yield* deps.db.query.user.findFirst({ where: { email } });

    if (!user || user.disabled || !user.emailVerified) return { status: "ok" as const };

    const now = nowOf(deps);
    const approvalOrganizationId = yield* recoveryApprovalTenant(deps.db, user.id);

    yield* cancelLiveCeremonies(deps.db, user.id, now);

    const proofToken = randomRecoveryToken();
    const approvalToken = approvalOrganizationId ? randomRecoveryToken() : null;

    yield* deps.db.insert(schema.accountRecovery).values({
      id: randomId(),
      userId: user.id,
      email: user.email,
      status: "pending_proof",
      approvalRequired: approvalOrganizationId !== null,
      approvalOrganizationId,
      proofTokenHash: yield* tokenHash(proofToken),
      approvalTokenHash: approvalToken ? yield* tokenHash(approvalToken) : null,
      completionTokenHash: null,
      approvedByUserId: null,
      approvedAt: null,
      completedAt: null,
      cancelledAt: null,
      expiresAt: new Date(now.getTime() + RECOVERY_PROOF_TTL_MILLIS),
      createdAt: now,
      updatedAt: now,
    });

    const proofLink = linkFor(deps.origin, "/recover", proofToken);

    yield* sendEmail(
      deps.email,
      {
        to: user.email,
        subject: "Recover access to your Mattrax account",
        text: `Someone asked to recover access to your Mattrax account. If this was you, open this link to prove you control this address:\n\n${proofLink}\n\nThe link works once and expires in 30 minutes. If it was not you, ignore this email and change your email address from a signed-in session.\n\nNo passkey or account setting has been changed.`,
        html: `<p>Someone asked to recover access to your Mattrax account. If this was you, open this link to prove you control this address:</p><p><a href="${proofLink}">${proofLink}</a></p><p>The link works once and expires in 30 minutes. If it was not you, ignore this email and change your email address from a signed-in session.</p><p>No passkey or account setting has been changed.</p>`,
      },
      `RECOVERY PROOF requested for ${user.email}`,
    );

    if (approvalToken && approvalOrganizationId) {
      // The identity page reads `recoveryToken`; the subject's own links use
      // the generic `token` parameter.
      const approvalLink = `${deps.origin}/t/${approvalOrganizationId}/settings/identity?recoveryToken=${encodeURIComponent(approvalToken)}`;

      const recipients = yield* ownerRecipients(deps.db, approvalOrganizationId, user.id);

      for (const recipient of recipients)
        yield* sendEmail(
          deps.email,
          {
            to: recipient,
            subject: "Account recovery needs your approval",
            text: `${user.name} (${user.email}) asked to recover access to their Mattrax account. Because your tenant has more than one owner, a second owner must approve the request.\n\nOpen your administrators page to approve it: ${approvalLink}\n\nIf you were not expecting this, do not approve it.`,
            html: `<p>${user.name} (${user.email}) asked to recover access to their Mattrax account. Because your tenant has more than one owner, a second owner must approve the request.</p><p><a href="${approvalLink}">Open your administrators page to approve it</a></p><p>If you were not expecting this, do not approve it.</p>`,
          },
          `RECOVERY APPROVAL requested for ${recipient}`,
        );
    }

    yield* recordAccountAudit(deps.db, {
      subjectUserId: user.id,
      subjectEmail: user.email,
      action: ACCOUNT_AUDIT.recoveryRequested,
      targetType: "account_recovery",
      metadata: {
        approvalRequired: approvalOrganizationId !== null,
        approvalOrganizationId,
      },
      at: now,
    });

    return { status: "ok" as const };
  }).pipe(Effect.catchCause(() => Effect.succeed({ status: "ok" as const })));

export type RecoveryVerifyResult =
  | { readonly status: "pending_approval" }
  | { readonly status: "ready"; readonly signInToken: string };

/**
 * Consume the proof link. The conditional update is the single-use guard: a
 * replayed link matches no `pending_proof` row and is rejected.
 */
export const verifyAccountRecoveryProof = (
  deps: RecoveryDeps,
  input: { readonly token: string },
): Effect.Effect<RecoveryVerifyResult, InstanceType<typeof RecoveryRejected>> =>
  Effect.gen(function* () {
    const invalid = new RecoveryRejected({
      message: "This recovery link is invalid or has expired.",
    });

    if (!input.token) return yield* Effect.fail(invalid);

    const now = nowOf(deps);
    const hash = yield* tokenHash(input.token);

    const record = yield* deps.db.query.accountRecovery.findFirst({
      where: { proofTokenHash: hash },
    });

    if (
      !record ||
      record.status !== "pending_proof" ||
      record.cancelledAt != null ||
      new Date(record.expiresAt).getTime() <= now.getTime()
    )
      return yield* Effect.fail(invalid);

    if (record.approvalRequired && record.approvedAt == null) {
      const consumed = yield* deps.db
        .update(schema.accountRecovery)
        .set({ status: "pending_approval", updatedAt: now })
        .where(
          and(
            eq(schema.accountRecovery.id, record.id),
            eq(schema.accountRecovery.status, "pending_proof"),
          ),
        );

      if (!consumed || consumed.affectedRows === 0) return yield* Effect.fail(invalid);

      return { status: "pending_approval" as const };
    }

    const completion = yield* mintCompletion(deps, record, now);

    return completion;
  }).pipe(
    // Every failure — expired, replayed, unknown — reads the same to the
    // caller, so a probe cannot tell which check rejected it.
    Effect.catchCause(() =>
      Effect.fail(
        new RecoveryRejected({ message: "This recovery link is invalid or has expired." }),
      ),
    ),
  );

/** Mint the single-use completion link and mark the ceremony ready. */
const mintCompletion = (
  deps: RecoveryDeps,
  record: {
    readonly id: string;
    readonly userId: string;
    readonly email: string;
  },
  now: Date,
) =>
  Effect.gen(function* () {
    const token = randomRecoveryToken();

    const updated = yield* deps.db
      .update(schema.accountRecovery)
      .set({
        status: "ready",
        completionTokenHash: yield* tokenHash(token),
        expiresAt: new Date(now.getTime() + RECOVERY_COMPLETION_TTL_MILLIS),
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.accountRecovery.id, record.id),
          inArray(schema.accountRecovery.status, ["pending_proof", "pending_approval"]),
        ),
      );

    if (!updated || updated.affectedRows === 0)
      return yield* Effect.fail(
        new RecoveryRejected({ message: "This recovery link is invalid or has expired." }),
      );

    return { status: "ready" as const, signInToken: token };
  });

/**
 * Approve a ceremony from a tenant where the subject is a co-owner. The
 * approval token is delivered to the *other* owners, and the approver must be
 * signed in as a different owner of the same tenant.
 */
export const approveAccountRecovery = (
  deps: RecoveryDeps,
  input: {
    readonly token: string;
    readonly organizationId: string;
    readonly approverUserId: string;
  },
): Effect.Effect<{ readonly status: "ok" }, InstanceType<typeof RecoveryRejected>> =>
  Effect.gen(function* () {
    const invalid = new RecoveryRejected({
      message: "This approval link is invalid or has expired.",
    });

    if (!input.token) return yield* Effect.fail(invalid);

    const now = nowOf(deps);
    const hash = yield* tokenHash(input.token);

    const record = yield* deps.db.query.accountRecovery.findFirst({
      where: { approvalTokenHash: hash },
    });

    if (
      !record ||
      record.approvalOrganizationId !== input.organizationId ||
      record.approvedAt != null ||
      record.cancelledAt != null ||
      (record.status !== "pending_approval" && record.status !== "pending_proof") ||
      new Date(record.expiresAt).getTime() <= now.getTime()
    )
      return yield* Effect.fail(invalid);

    if (record.userId === input.approverUserId) return yield* Effect.fail(invalid);

    const approver = yield* deps.db.query.member.findFirst({
      where: { userId: input.approverUserId, organizationId: input.organizationId },
    });

    if (!approver || !hasOwnerRole(approver.role)) return yield* Effect.fail(invalid);

    const approved = yield* deps.db
      .update(schema.accountRecovery)
      .set({
        approvedByUserId: input.approverUserId,
        approvedAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(schema.accountRecovery.id, record.id), isNull(schema.accountRecovery.approvedAt)),
      );

    if (!approved || approved.affectedRows === 0) return yield* Effect.fail(invalid);

    yield* recordAccountAudit(deps.db, {
      subjectUserId: record.userId,
      subjectEmail: record.email,
      actorUserId: input.approverUserId,
      action: ACCOUNT_AUDIT.recoveryApproved,
      targetType: "account_recovery",
      targetId: record.id,
      metadata: { organizationId: input.organizationId },
      at: now,
    });

    // The proof link has already been used, so the completion link is emailed
    // to the account rather than returned to the approver.
    if (record.status === "pending_approval") {
      const completion = yield* mintCompletion(deps, record, now);
      const link = linkFor(deps.origin, "/recover/complete", completion.signInToken);

      yield* sendEmail(
        deps.email,
        {
          to: record.email,
          subject: "Your Mattrax account recovery was approved",
          text: `Another owner approved your account recovery. Open this link to sign in and add a new passkey:\n\n${link}\n\nThe link works once and expires in 15 minutes.`,
          html: `<p>Another owner approved your account recovery. Open this link to sign in and add a new passkey:</p><p><a href="${link}">${link}</a></p><p>The link works once and expires in 15 minutes.</p>`,
        },
        `RECOVERY COMPLETION requested for ${record.email}`,
      );
    }

    return { status: "ok" as const };
  }).pipe(
    Effect.catchCause(() =>
      Effect.fail(
        new RecoveryRejected({ message: "This approval link is invalid or has expired." }),
      ),
    ),
  );

/** Cancel a ceremony whose proof link is still live. */
export const cancelAccountRecovery = (deps: RecoveryDeps, input: { readonly token: string }) =>
  Effect.gen(function* () {
    const hash = yield* tokenHash(input.token);
    const now = nowOf(deps);

    const record = yield* deps.db.query.accountRecovery.findFirst({
      where: { proofTokenHash: hash },
    });

    if (
      !record ||
      record.status !== "pending_proof" ||
      record.cancelledAt != null ||
      new Date(record.expiresAt).getTime() <= now.getTime()
    )
      return { status: "ok" as const };

    yield* deps.db
      .update(schema.accountRecovery)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(eq(schema.accountRecovery.id, record.id));

    yield* recordAccountAudit(deps.db, {
      subjectUserId: record.userId,
      subjectEmail: record.email,
      action: ACCOUNT_AUDIT.recoveryCancelled,
      targetType: "account_recovery",
      targetId: record.id,
      at: now,
    });

    return { status: "ok" as const };
  }).pipe(Effect.catchCause(() => Effect.succeed({ status: "ok" as const })));

/**
 * Consume a completion token. Returns the subject to sign in, or undefined when
 * the token is expired, already used or cancelled. The security revision is
 * bumped in the same transaction so every session on a lost device is stale.
 */
export const redeemRecoveryToken = (
  db: EnterpriseDb,
  token: string,
): Effect.Effect<{ readonly userId: string } | undefined, unknown> =>
  Effect.gen(function* () {
    if (!token) return undefined;

    const hash = yield* tokenHash(token);
    const now = new Date();

    const record = yield* db.query.accountRecovery.findFirst({
      where: { completionTokenHash: hash },
    });

    if (
      !record ||
      record.status !== "ready" ||
      record.completedAt != null ||
      record.cancelledAt != null ||
      new Date(record.expiresAt).getTime() <= now.getTime()
    )
      return undefined;

    const user = yield* db.query.user.findFirst({ where: { id: record.userId } });

    if (!user || user.disabled) return undefined;

    const revision = randomId();

    const redeemed = yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const consumed = yield* tx
          .update(schema.accountRecovery)
          .set({ status: "completed", completedAt: now, updatedAt: now })
          .where(
            and(
              eq(schema.accountRecovery.id, record.id),
              eq(schema.accountRecovery.status, "ready"),
            ),
          );

        if (!consumed || consumed.affectedRows === 0) return false;

        yield* tx
          .update(schema.user)
          .set({ authRevision: revision, updatedAt: now })
          .where(eq(schema.user.id, user.id));

        return true;
      }),
    );

    if (!redeemed) return undefined;

    yield* recordAccountAudit(db, {
      subjectUserId: user.id,
      subjectEmail: user.email,
      action: ACCOUNT_AUDIT.recoveryCompleted,
      targetType: "account_recovery",
      targetId: record.id,
      metadata: { approvedByUserId: record.approvedByUserId ?? null },
      at: now,
    });

    return { userId: user.id };
  });

/* -------------------------------------------------------------------------- */
/* Auth strategy                                                              */
/* -------------------------------------------------------------------------- */

type RecoveryServices = {
  readonly db: EnterpriseDb;
  /* oxlint-disable-next-line typescript/no-explicit-any -- The completion
   * service is generic over the strategy's claims codec, which only exists
   * inside the library's `bind` callback, so its shape cannot be named here. */
  readonly completion: any;
};

class RecoveryServicesTag extends Context.Service<RecoveryServicesTag, RecoveryServices>()(
  "mattrax/enterprise-backend/RecoveryServices",
) {}

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const digest = (value: string) =>
  Effect.promise(async () => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

    return toBase64Url(new Uint8Array(bytes));
  });

/**
 * The auth strategy for a recovery completion token. It re-reads the subject
 * and its credential vector after the consumption transaction, so the issued
 * session carries the post-recovery security revision.
 */
/* oxlint-disable-next-line typescript/no-explicit-any -- `StrategyDefinition`
 * is generic over the library's claims type lambda, which callers only see
 * through the service it produces. */
export const makeRecoveryStrategy = (): StrategyDefinition<any, string | undefined> => ({
  namespace: undefined,
  bind: ({ sessions }) => {
    const layer = Layer.effect(
      RecoveryServicesTag,
      Effect.gen(function* () {
        const db = yield* Db;

        return RecoveryServicesTag.of({
          db,
          completion: yield* sessions.AuthenticationCompletion,
        });
      }),
    );

    const strategy = Auth.makeStrategy(
      {
        signIn: (_invocation: AuthInvocation, input: { token: string }) =>
          Effect.gen(function* () {
            const services = yield* RecoveryServicesTag;
            const redeemed = yield* redeemRecoveryToken(services.db, input.token);

            if (!redeemed)
              return yield* Effect.fail(
                new RecoveryRejected({
                  message: "This recovery link is invalid or has expired.",
                }),
              );

            const user = yield* services.db.query.user.findFirst({
              where: { id: redeemed.userId },
            });

            if (!user || user.disabled)
              return yield* Effect.fail(
                new RecoveryRejected({ message: "This account can no longer be recovered." }),
              );

            const credentials = yield* services.db
              .select()
              .from(authCredentials)
              .where(eq(authCredentials.subjectId, user.id));

            const active = credentials.filter((credential) => credential.active);

            if (active.length === 0)
              return yield* Effect.fail(
                new RecoveryRejected({ message: "This account has no credential to restore." }),
              );

            const flowId = Sessions.AuthenticationFlowId.make(`recovery:${crypto.randomUUID()}`);

            const bindingDigest = AuthSchema.TokenDigest.make(
              yield* digest(`${input.token}:${flowId}`),
            );

            const revision = yield* Schema.decodeUnknownEffect(Sessions.AuthenticationRevision)({
              subjectId: user.id,
              securityRevision: user.authRevision,
              credentials: active.map((credential) => ({
                credentialId: credential.credentialId,
                revision: credential.revision,
              })),
            });

            const evidence: Sessions.AuthenticationEvidence = {
              flowId,
              bindingDigest,
              revision,
              proofs: [
                {
                  method: "account-recovery",
                  credentialId: active[0]!.credentialId,
                  factors: ["possession"],
                  userVerified: true,
                  phishingResistant: false,
                  verifiedAt: DateTime.nowUnsafe(),
                },
              ],
            };

            const applicationClaims: AuthClaims = {
              name: user.name,
              email: user.email,
              emailVerified: user.emailVerified,
            };

            const prepared = yield* services.completion.prepare({
              evidence,
              requirement: authRequirementForSubject(user),
              claims: applicationClaims,
            });

            const result = yield* prepared.read;
            const collector = yield* AuthCredentialCommandCollector;

            if (result.credentialCommands.length > 0) yield* collector(result.credentialCommands);

            return result.value;
          }).pipe(
            Effect.catch((error) =>
              Effect.fail(
                error instanceof RecoveryRejected
                  ? error
                  : new RecoveryRejected({ message: "Account recovery failed" }),
              ),
            ),
            Effect.catchDefect((defect) =>
              Effect.fail(
                new RecoveryRejected({ message: `Account recovery failed: ${String(defect)}` }),
              ),
            ),
          ),
      },
      layer,
      { completion: true },
    );

    return { strategy };
  },
});

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                              */
/* -------------------------------------------------------------------------- */

export type RecoveryLimiter = {
  /** Record an attempt; false when the window is exhausted. */
  readonly allow: (key: string, now?: number) => boolean;
};

/**
 * Bounded in-memory limiter. Like the enrollment limiter it is per isolate: it
 * stops a scripted ceremony loop, not a distributed flood (that belongs at the
 * edge). Keys live in this map only — they are never persisted or logged.
 */
export const createRecoveryLimiter = (options: {
  readonly limit: number;
  readonly windowMillis: number;
  readonly maximumKeys?: number;
}): RecoveryLimiter => {
  const windows = new Map<string, { count: number; resetAt: number }>();
  const maximumKeys = options.maximumKeys ?? 10_000;

  return {
    allow: (key, now = Date.now()) => {
      const entry = windows.get(key);

      if (!entry || entry.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + options.windowMillis });

        if (windows.size > maximumKeys) {
          for (const [candidate, value] of windows)
            if (value.resetAt <= now) windows.delete(candidate);
        }

        return true;
      }

      entry.count += 1;

      return entry.count <= options.limit;
    },
  };
};
