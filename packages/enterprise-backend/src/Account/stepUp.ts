import { Passkey, Totp } from "@yielded/auth";
import {
  PASSKEY_MODULE_ID,
  STEP_UP_ACTIONS,
  STEP_UP_WINDOW_MILLIS,
  StepUpService,
  StepUpUnavailable,
  TOTP_MODULE_ID,
  TOTP_POLICY,
} from "@mattrax/enterprise-domain";
import type { StepUpAction, StepUpMethod } from "@mattrax/enterprise-domain";
import { Data, DateTime, Effect, Layer, Option, Predicate, Redacted, Schema } from "effect";
import { Schema as AuthSchema } from "@yielded/auth";
import { and, eq, lt } from "drizzle-orm";
import { Db } from "@mattrax/enterprise-core";
import { schema } from "../schema.ts";
import { signToken, verifyToken } from "@mattrax/enterprise-tokens";

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const randomBytes = (length: number) => base64Url(crypto.getRandomValues(new Uint8Array(length)));

class StepUpPasskeyContext extends Data.TaggedClass("StepUp")<{
  readonly target: Schema.Schema.Type<typeof Passkey.PasskeyTarget>;
}> {}

/**
 * Sign a step-up grant. Grants are bound to the account, the exact session and
 * one action, and expire quickly; they are not a substitute for the session
 * cookie and never contain credential material.
 */
export const signStepUpGrant = (
  secret: string,
  input: {
    readonly subjectId: string;
    readonly email: string;
    readonly sessionId: string;
    readonly action: StepUpAction;
    readonly method: StepUpMethod;
    readonly credentialId?: string;
    readonly expiresAtMillis: number;
  },
) =>
  signToken(secret, {
    sub: input.subjectId,
    email: input.email,
    sid: input.sessionId,
    action: input.action,
    method: input.method,
    credentialId: input.credentialId,
    exp: input.expiresAtMillis,
    purpose: "step-up-grant",
  });

/**
 * Read a grant without trusting request input. Returns the verified method and
 * credential so callers can require a specific factor instead of a bare
 * boolean.
 */
export const readStepUpGrant = (
  secret: string,
  token: string,
  expected: {
    readonly subjectId: string;
    readonly sessionId: string;
    readonly action: StepUpAction;
  },
) =>
  verifyToken(secret, token).pipe(
    Effect.map((payload) =>
      payload.purpose === "step-up-grant" &&
      payload.sub === expected.subjectId &&
      payload.sid === expected.sessionId &&
      payload.action === expected.action &&
      payload.exp > Date.now()
        ? {
            method: payload.method,
            credentialId: payload.credentialId,
          }
        : undefined,
    ),
    Effect.catch(() => Effect.succeed(undefined)),
  );

/** Verify a grant for this exact account, session and action. */
export const verifyStepUpGrant = (
  secret: string,
  token: string,
  expected: {
    readonly subjectId: string;
    readonly sessionId: string;
    readonly action: StepUpAction;
    readonly method?: StepUpMethod;
  },
) =>
  readStepUpGrant(secret, token, expected).pipe(
    Effect.map(
      (grant) =>
        grant !== undefined && (expected.method === undefined || grant.method === expected.method),
    ),
  );

/** Sign the binding token for an in-flight WebAuthn step-up ceremony. */
export const signStepUpFlow = (
  secret: string,
  input: {
    readonly subjectId: string;
    readonly email: string;
    readonly sessionId: string;
    readonly action: StepUpAction;
    readonly flowId: string;
    readonly requestBindingVerifier: string;
    readonly requestBindingExpiresAtMillis: number;
  },
) =>
  signToken(secret, {
    sub: input.subjectId,
    email: input.email,
    sid: input.sessionId,
    action: input.action,
    flowId: input.flowId,
    verifier: input.requestBindingVerifier,
    requestBindingExpiresAtMillis: input.requestBindingExpiresAtMillis,
    exp: input.requestBindingExpiresAtMillis,
    purpose: "step-up-flow",
  });

const PasskeyAssertionResponse = Schema.Struct({
  rawId: Schema.optional(Schema.String),
});

export const verifyStepUpFlow = (
  secret: string,
  token: string,
  expected: {
    readonly subjectId: string;
    readonly sessionId: string;
    readonly action: StepUpAction;
  },
) =>
  verifyToken(secret, token).pipe(
    Effect.map((payload) => {
      if (
        payload.purpose !== "step-up-flow" ||
        payload.sub !== expected.subjectId ||
        payload.sid !== expected.sessionId ||
        payload.action !== expected.action ||
        payload.exp <= Date.now() ||
        payload.flowId === undefined ||
        payload.verifier === undefined ||
        payload.requestBindingExpiresAtMillis === undefined
      )
        return undefined;

      return {
        flowId: payload.flowId,
        requestBindingVerifier: payload.verifier,
        requestBindingExpiresAtMillis: payload.requestBindingExpiresAtMillis,
      };
    }),
    Effect.catch(() => Effect.succeed(undefined)),
  );

/**
 * Verify a flow token without knowing which action it was issued for. The
 * action is read from the signed payload, never from the request body.
 */
export const verifyAnyStepUpFlow = (
  secret: string,
  token: string,
  expected: { readonly subjectId: string; readonly sessionId: string },
) =>
  Effect.gen(function* () {
    for (const action of STEP_UP_ACTIONS) {
      const flow = yield* verifyStepUpFlow(secret, token, { ...expected, action });

      if (flow) return { ...flow, action };
    }

    return undefined;
  });

/**
 * Factor verification for step-up. Implemented beside the auth Layers because
 * password verifiers, TOTP secrets and passkey ceremonies are private to them.
 * It deliberately exposes no "issue grant" operation: the grant is a signature
 * over a verified result, not another credential store.
 */
export const stepUpServiceLayer = () =>
  Layer.effect(
    StepUpService,
    Effect.gen(function* () {
      const db = yield* Db;
      const totpPersistence = yield* Totp.TotpPersistence;
      const totpCryptography = yield* Totp.TotpCryptography;
      const passkeyConfig = yield* Passkey.PasskeyConfig;
      const passkeyCredentials = yield* Passkey.PasskeyCredentials;
      const passkeyPersistence = yield* Passkey.PasskeyPersistence;
      const passkeyProtocol = yield* Passkey.PasskeyProtocol;

      const profile = passkeyConfig.profiles[0];

      const subject = (subjectId: string) => AuthSchema.SubjectId.make(subjectId);

      const passkeyCount = (subjectId: string) =>
        profile === undefined
          ? Effect.succeed(0)
          : passkeyCredentials
              .listForSubject({
                moduleId: PASSKEY_MODULE_ID,
                rpId: profile.rpId,
                subjectId: subject(subjectId),
              })
              .pipe(
                Effect.map((snapshot) => snapshot?.credentials.length ?? 0),
                Effect.catch(() => Effect.succeed(0)),
              );

      const hasTotp = (subjectId: string) =>
        totpPersistence.snapshot({ moduleId: TOTP_MODULE_ID, subjectId: subject(subjectId) }).pipe(
          Effect.map((snapshot) => Boolean(snapshot?.record?.secret)),
          Effect.catch(() => Effect.succeed(false)),
        );

      return StepUpService.of({
        methods: (subjectId) =>
          Effect.gen(function* () {
            return {
              totp: yield* hasTotp(subjectId),
              passkey: (yield* passkeyCount(subjectId)) > 0,
            };
          }),

        verifyTotp: (subjectId, code) =>
          Effect.gen(function* () {
            if (!/^[0-9]{6}$/.test(code.trim())) return false;

            const snapshot = yield* totpPersistence
              .snapshot({ moduleId: TOTP_MODULE_ID, subjectId: subject(subjectId) })
              .pipe(Effect.catch(() => Effect.succeed(undefined)));

            const record = snapshot?.record;

            if (!record?.secret) return false;

            const now = yield* DateTime.now;

            const nowMillis = DateTime.toEpochMillis(now);
            const nowDate = DateTime.toDate(now);

            const [state] = yield* db
              .select()
              .from(schema.stepUpTotpState)
              .where(eq(schema.stepUpTotpState.subjectId, subjectId))
              .limit(1);

            if (state?.lockedUntil && state.lockedUntil.getTime() > nowDate.getTime()) return false;

            const step = yield* Effect.acquireUseRelease(
              totpCryptography.decryptSecret(
                {
                  moduleId: TOTP_MODULE_ID,
                  subjectId: record.subjectId,
                  credentialId: record.credentialId,
                  revision: record.revision,
                },
                record.secret,
              ),
              (secret) =>
                totpCryptography.matchCode(
                  secret,
                  code.trim(),
                  nowMillis,
                  TOTP_POLICY.clockSkewSteps,
                ),
              (secret) => Effect.sync(() => secret.fill(0)),
            ).pipe(Effect.catch(() => Effect.succeed(null)));

            const failed = () =>
              Effect.gen(function* () {
                const failures = (state?.failures ?? 0) + 1;

                const lockedUntil =
                  failures >= 5 ? new Date(nowDate.getTime() + 15 * 60 * 1000) : null;

                yield* db
                  .insert(schema.stepUpTotpState)
                  .values({
                    subjectId,
                    lastAcceptedStep: 0,
                    failures,
                    lockedUntil,
                    updatedAt: nowDate,
                  })
                  .onDuplicateKeyUpdate({ set: { failures, lockedUntil, updatedAt: nowDate } });

                return false;
              });

            if (step === null) return yield* failed();

            // Accept each time-step once per account. The conditional update
            // makes two concurrent guesses at the same step resolve to one
            // winner.
            const claimed = yield* db
              .update(schema.stepUpTotpState)
              .set({ lastAcceptedStep: step, failures: 0, lockedUntil: null, updatedAt: nowDate })
              .where(
                and(
                  eq(schema.stepUpTotpState.subjectId, subjectId),
                  lt(schema.stepUpTotpState.lastAcceptedStep, step),
                ),
              );

            if (claimed.affectedRows === 0) {
              // No row existed when it was read; claim the first step by
              // inserting. A concurrent request that inserted first makes this
              // a no-op, which is a replay.
              const inserted = yield* db.insert(schema.stepUpTotpState).ignore().values({
                subjectId,
                lastAcceptedStep: step,
                failures: 0,
                lockedUntil: null,
                updatedAt: nowDate,
              });

              if (inserted.affectedRows === 0) return false;
            }

            return true;
          }).pipe(Effect.catch(() => Effect.succeed(false))),

        beginPasskey: (subjectId) =>
          Effect.gen(function* () {
            if (profile === undefined)
              return yield* StepUpUnavailable.make({
                message: "Passkeys are not configured on this deployment",
              });

            const snapshot = yield* passkeyCredentials
              .listForSubject({
                moduleId: PASSKEY_MODULE_ID,
                rpId: profile.rpId,
                subjectId: subject(subjectId),
              })
              .pipe(
                Effect.catch(() =>
                  Effect.fail(
                    StepUpUnavailable.make({ message: "Passkeys are unavailable right now" }),
                  ),
                ),
              );

            if (!snapshot || snapshot.credentials.length === 0)
              return yield* StepUpUnavailable.make({
                message: "Add a passkey to this account before using it to confirm actions",
              });

            const flowId = crypto.randomUUID();
            const challenge = randomBytes(32);
            const verifier = randomBytes(32);
            const issuedAtMillis = Date.now();
            const expiresAtMillis = issuedAtMillis + STEP_UP_WINDOW_MILLIS;

            const target = yield* Schema.decodeUnknownEffect(Passkey.PasskeyTarget)({
              moduleId: PASSKEY_MODULE_ID,
              kind: "step-up",
              commandId: flowId,
              flowId,
              bindingDigest: verifier,
              revision: snapshot.revision,
              expiresAtMillis,
            }).pipe(
              Effect.catch(() =>
                Effect.fail(
                  StepUpUnavailable.make({ message: "Could not start a passkey ceremony" }),
                ),
              ),
            );

            const ceremony = yield* Schema.decodeUnknownEffect(Passkey.PasskeyCeremony)({
              moduleId: PASSKEY_MODULE_ID,
              flowId,
              commandId: flowId,
              purpose: "step-up",
              profile,
              challenge,
              requestBindingVerifier: verifier,
              requestBindingExpiresAtMillis: expiresAtMillis,
              issuedAtMillis,
              expiresAtMillis,
              allowedCredentials: snapshot.credentials,
              context: new StepUpPasskeyContext({ target }),
            }).pipe(
              Effect.catch(() =>
                Effect.fail(
                  StepUpUnavailable.make({ message: "Could not start a passkey ceremony" }),
                ),
              ),
            );

            const receipt = yield* passkeyPersistence
              .issue({ ceremony }, (value, journal) => journal.prepare(value))
              .pipe(
                Effect.catch(() =>
                  Effect.fail(
                    StepUpUnavailable.make({ message: "Could not start a passkey ceremony" }),
                  ),
                ),
              );

            const decision = yield* receipt.read.pipe(
              Effect.catch(() =>
                Effect.fail(
                  StepUpUnavailable.make({ message: "Could not start a passkey ceremony" }),
                ),
              ),
            );

            if (!Predicate.isTagged(decision, "Issued"))
              return yield* StepUpUnavailable.make({
                message: "Could not start a passkey ceremony",
              });

            const prepared = yield* passkeyProtocol
              .prepareAuthentication({
                profile,
                challenge,
                timeoutMillis: STEP_UP_WINDOW_MILLIS,
                allowedCredentials: snapshot.credentials,
              })
              .pipe(
                Effect.catch(() =>
                  Effect.fail(
                    StepUpUnavailable.make({ message: "Could not start a passkey ceremony" }),
                  ),
                ),
              );

            return {
              flowId,
              requestBindingVerifier: verifier,
              requestBindingExpiresAtMillis: expiresAtMillis,
              expiresAtMillis,
              options: prepared,
            };
          }),

        completePasskey: (input) =>
          Effect.gen(function* () {
            if (profile === undefined) return undefined;

            const access = yield* Schema.decodeUnknownEffect(Passkey.PasskeyAccess)({
              moduleId: PASSKEY_MODULE_ID,
              purpose: "step-up",
              flowId: input.flowId,
              requestBindingVerifier: input.requestBindingVerifier,
              requestBindingExpiresAtMillis: input.requestBindingExpiresAtMillis,
            }).pipe(Effect.catch(() => Effect.succeed(undefined)));

            if (access === undefined) return undefined;

            const ceremony = yield* passkeyPersistence
              .context(access)
              .pipe(Effect.catch(() => Effect.succeed(undefined)));

            if (ceremony === undefined || ceremony.purpose !== "step-up") return undefined;

            // The assertion's `rawId` is the base64url protocol credential id.
            const rawId = yield* Effect.sync(() => {
              try {
                const parsed: Schema.Schema.Type<typeof PasskeyAssertionResponse> =
                  Schema.decodeUnknownSync(PasskeyAssertionResponse)(JSON.parse(input.response));

                return parsed.rawId;
              } catch {
                return undefined;
              }
            });

            if (rawId === undefined) return undefined;

            const protocolCredentialId = Option.getOrUndefined(
              Schema.decodeUnknownOption(Passkey.PasskeyProtocolCredentialId)(rawId),
            );

            if (protocolCredentialId === undefined) return undefined;

            const credential = yield* passkeyCredentials
              .lookup({
                rpId: ceremony.profile.rpId,
                protocolCredentialId,
              })
              .pipe(Effect.catch(() => Effect.succeed(undefined)));

            if (!credential || !credential.active) return undefined;

            if (credential.revision.subjectId !== input.subjectId) return undefined;

            const assertion = yield* passkeyProtocol
              .verifyAuthentication({
                ceremony,
                credential,
                response: Redacted.make(input.response),
              })
              .pipe(Effect.catch(() => Effect.succeed(undefined)));

            if (assertion === undefined) return undefined;

            const receipt = yield* passkeyPersistence
              .consume({ access, ceremony, credential, assertion }, (value, journal) =>
                journal.prepare(value),
              )
              .pipe(Effect.catch(() => Effect.succeed(undefined)));

            if (receipt === undefined) return undefined;

            const decision = yield* receipt.read.pipe(
              Effect.catch(() => Effect.succeed("Rejected" as const)),
            );

            return decision === "Verified" ? credential.credentialId : undefined;
          }),
      });
    }),
  );
