import { Passkey, Password, Totp } from "@yielded/auth";
import {
  PASSKEY_MODULE_ID,
  STEP_UP_ACTIONS,
  STEP_UP_WINDOW_MILLIS,
  StepUpService,
  StepUpUnavailable,
  TOTP_MODULE_ID,
  TOTP_POLICY,
  type StepUpAction,
} from "@mattrax/enterprise-domain";
import { Db, schema } from "@mattrax/enterprise-core";
import { DateTime, Effect, Layer, Redacted, Schema } from "effect";
import { Schema as AuthSchema } from "@yielded/auth";
import { eq } from "drizzle-orm";
import { signToken, verifyToken } from "./tokens.ts";

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const randomBytes = (length: number) => base64Url(crypto.getRandomValues(new Uint8Array(length)));

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
    readonly expiresAtMillis: number;
  },
) =>
  signToken(secret, {
    sub: input.subjectId,
    email: input.email,
    sid: input.sessionId,
    action: input.action,
    exp: input.expiresAtMillis,
    purpose: "step-up-grant",
  });

/** Verify a grant for this exact account, session and action. */
export const verifyStepUpGrant = (
  secret: string,
  token: string,
  expected: {
    readonly subjectId: string;
    readonly sessionId: string;
    readonly action: StepUpAction;
  },
) =>
  verifyToken(secret, token).pipe(
    Effect.map(
      (payload) =>
        payload.purpose === "step-up-grant" &&
        payload.sub === expected.subjectId &&
        payload.sid === expected.sessionId &&
        payload.action === expected.action &&
        payload.exp > Date.now(),
    ),
    Effect.catch(() => Effect.succeed(false)),
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
        typeof payload.flowId !== "string" ||
        typeof payload.verifier !== "string" ||
        typeof payload.requestBindingExpiresAtMillis !== "number"
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
export const makeStepUpServiceLive = (options: {
  readonly appAuth: any;
  readonly authSecret?: string;
}) =>
  Layer.effect(
    StepUpService,
    Effect.gen(function* () {
      const db = yield* Db;
      const passwords = yield* Password.PasswordPersistence;
      const passwordHashing = yield* Password.PasswordHashing;
      const passwordModuleId = options.appAuth.strategies.password.persistence.moduleId as string;
      const totpPersistence = yield* Totp.TotpPersistence;
      const totpCryptography = yield* Totp.TotpCryptography;
      const passkeyConfig = yield* Passkey.PasskeyConfig;
      const passkeyCredentials = yield* Passkey.PasskeyCredentials;
      const passkeyPersistence = yield* Passkey.PasskeyPersistence;
      const passkeyProtocol = yield* Passkey.PasskeyProtocol;

      const profile = passkeyConfig.profiles[0];

      const subject = (subjectId: string) => AuthSchema.SubjectId.make(subjectId);

      const hasPassword = (subjectId: string) =>
        db
          .select({ credentialId: schema.authPasswords.credentialId })
          .from(schema.authPasswords)
          .where(eq(schema.authPasswords.subjectId, subjectId))
          .limit(1)
          .pipe(
            Effect.map((rows) => rows.length > 0),
            Effect.catch(() => Effect.succeed(false)),
          );

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
              password: yield* hasPassword(subjectId),
              totp: yield* hasTotp(subjectId),
              passkey: (yield* passkeyCount(subjectId)) > 0,
            };
          }),

        verifyPassword: (subjectId, password) =>
          Effect.gen(function* () {
            if (password.length === 0 || password.length > 4096) return false;

            const candidate = yield* passwords
              .readForSubject({ moduleId: passwordModuleId, subjectId: subject(subjectId) })
              .pipe(Effect.catch(() => Effect.succeed({ _tag: "None" as const })));

            if (candidate._tag === "None") return false;

            const verified = yield* passwordHashing
              .verify(Redacted.make(password), candidate.value.verifier)
              .pipe(Effect.catch(() => Effect.succeed({ matches: false })));

            return verified.matches;
          }),

        verifyTotp: (subjectId, code) =>
          Effect.gen(function* () {
            if (!/^[0-9]{6}$/.test(code.trim())) return false;

            const snapshot = yield* totpPersistence
              .snapshot({ moduleId: TOTP_MODULE_ID, subjectId: subject(subjectId) })
              .pipe(Effect.catch(() => Effect.succeed(undefined)));

            const record = snapshot?.record;

            if (!record?.secret) return false;
            const nowMillis = DateTime.toEpochMillis(yield* DateTime.now);

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
            ).pipe(Effect.catch(() => Effect.succeed(false)));

            return step !== null;
          }),

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
              context: {
                _tag: "StepUp",
                target: {
                  moduleId: PASSKEY_MODULE_ID,
                  kind: "step-up",
                  commandId: flowId,
                  flowId,
                  bindingDigest: verifier,
                  revision: snapshot.revision,
                  expiresAtMillis,
                },
              },
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

            if (decision._tag !== "Issued")
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
            if (profile === undefined) return false;

            const access = yield* Schema.decodeUnknownEffect(Passkey.PasskeyAccess)({
              moduleId: PASSKEY_MODULE_ID,
              purpose: "step-up",
              flowId: input.flowId,
              requestBindingVerifier: input.requestBindingVerifier,
              requestBindingExpiresAtMillis: input.requestBindingExpiresAtMillis,
            }).pipe(Effect.catch(() => Effect.succeed(undefined)));

            if (access === undefined) return false;

            const ceremony = yield* passkeyPersistence
              .context(access)
              .pipe(Effect.catch(() => Effect.succeed(undefined)));

            if (ceremony === undefined || ceremony.purpose !== "step-up") return false;

            // The assertion's `rawId` is the base64url protocol credential id.
            const rawId = yield* Effect.sync(() => {
              try {
                const parsed = JSON.parse(input.response) as { rawId?: unknown };

                return typeof parsed.rawId === "string" ? parsed.rawId : undefined;
              } catch {
                return undefined;
              }
            });

            if (rawId === undefined) return false;

            const credential = yield* passkeyCredentials
              .lookup({
                rpId: ceremony.profile.rpId,
                protocolCredentialId: rawId as unknown as Passkey.PasskeyProtocolCredentialId,
              })
              .pipe(Effect.catch(() => Effect.succeed(undefined)));

            if (!credential || !credential.active) return false;

            if (credential.revision.subjectId !== input.subjectId) return false;

            const assertion = yield* passkeyProtocol
              .verifyAuthentication({
                ceremony,
                credential,
                response: Redacted.make(input.response),
              })
              .pipe(Effect.catch(() => Effect.succeed(undefined)));

            if (assertion === undefined) return false;

            const receipt = yield* passkeyPersistence
              .consume({ access, ceremony, credential, assertion }, (value, journal) =>
                journal.prepare(value),
              )
              .pipe(Effect.catch(() => Effect.succeed(undefined)));

            if (receipt === undefined) return false;

            const decision = yield* receipt.read.pipe(
              Effect.catch(() => Effect.succeed("Rejected" as const)),
            );

            return decision === "Verified";
          }),
      });
    }),
  );
