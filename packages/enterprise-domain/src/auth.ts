import type { AnyAuthContract } from "@yielded/auth/AuthContract";
import type { StrategyDefinition, StrategyTypeLambda } from "@yielded/auth/Auth";
import {
  Auth,
  AuthContract,
  Operations,
  Passkey,
  PasskeyContract,
  Schema as AuthSchema,
  Sessions,
  Totp,
  TotpContract,
} from "@yielded/auth";
import type { Effect } from "effect";
import { Match, Schema } from "effect";

/** Stable TOTP module namespace. It is also the persistence scope for secrets. */
export const TOTP_MODULE_ID = "mattrax/auth/totp";

/**
 * Stable passkey module namespace. Sign-in, pending, step-up and management
 * share it so one credential list serves every ceremony; the library scopes
 * in-flight challenges by module id and flow id.
 */
export const PASSKEY_MODULE_ID = "mattrax/auth/passkey";

/**
 * The profile created by `PasskeyConfig.layer({ id, name, origins })`. The RP
 * id and origin allowlist are deployment configuration, never request input.
 */
export const PASSKEY_PROFILE_ID = "default";

/**
 * Ceremony policy. Challenges live for five minutes, matching the admission
 * window used by the rest of the auth surface.
 */
export const PASSKEY_POLICY = {
  lifetimeMillis: 5 * 60 * 1000,
} as const;

/**
 * Passkey management policy. Enrollment and removal require evidence from the
 * last five minutes (the app also gates both behind a step-up), removal
 * invalidates other sessions immediately, and one account may hold ten keys.
 */
export const PASSKEY_MANAGEMENT_POLICY = {
  maximumCredentials: 10,
  maximumEvidenceAgeMillis: 5 * 60 * 1000,
  requireImmediateInvalidation: true,
} as const;

/**
 * Longest window a step-up grant is valid for. Sensitive actions require a
 * grant no older than this, bound to the session that created it.
 */
export const STEP_UP_WINDOW_MILLIS = 5 * 60 * 1000;

/**
 * TOTP policy. Recovery codes and enrollment material stay visible long enough
 * for a person to write them down, and management actions require a current
 * code plus a recent sign-in.
 */
export const TOTP_POLICY = {
  issuer: "Mattrax",
  enrollmentLifetimeMillis: 10 * 60 * 1000,
  revealLifetimeMillis: 5 * 60 * 1000,
  clockSkewSteps: 1,
  attemptLimit: 5,
  attemptWindowMillis: 5 * 60 * 1000,
  maximumEvidenceAgeMillis: 5 * 60 * 1000,
  allowRecoveryCodeForPending: true,
  lostFactorRecovery: "deny",
  requireImmediateInvalidation: true,
} as const;

/**
 * Public session claims. Authoritative user and organization data is still read
 * from the application database by the `/me` and tenant endpoints.
 */
export const AuthClaims = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
});

export type AuthClaims = typeof AuthClaims.Type;

const AUTH_REQUIREMENT_MAX_AGE_MILLIS = 365 * 24 * 60 * 60 * 1000;

/**
 * Assurance required to complete sign-in. Passkeys are the primary credential,
 * so a user-verified phishing-resistant passkey is enough on its own. SSO
 * assertions are possession-only and are accepted as an enterprise alternative.
 *
 * When an authenticator app is enabled it becomes an additional layer: sign-in
 * then needs the passkey or SSO credential *and* a current authenticator code,
 * which is why the requirement asks for two distinct credentials.
 */
export const authenticationRequirement = (
  totpEnabled: boolean,
): Sessions.AuthenticationRequirement => ({
  alternatives: totpEnabled
    ? [
        {
          // Passkey plus authenticator code. The passkey carries the
          // phishing-resistant, user-verified flag; the code is a second
          // possession credential.
          factors: ["possession"],
          userVerified: true,
          phishingResistant: true,
          minimumCredentials: 2,
        },
        {
          // SSO plus authenticator code. OIDC assertions are possession-only,
          // so they cannot satisfy the passkey alternative, but they must still
          // be combined with the second factor. `userVerified` distinguishes an
          // SSO assertion from a bare authenticator code.
          factors: ["possession"],
          userVerified: true,
          phishingResistant: false,
          minimumCredentials: 2,
        },
      ]
    : [
        {
          factors: ["possession"],
          userVerified: true,
          phishingResistant: true,
          minimumCredentials: 1,
        },
        {
          // SSO for accounts that sign in through their organisation instead
          // of a passkey. Email codes are not a sign-in method, and a bare
          // authenticator code never satisfies this alternative.
          factors: ["possession"],
          userVerified: true,
          phishingResistant: false,
          minimumCredentials: 1,
        },
      ],
  maximumAgeMillis: AUTH_REQUIREMENT_MAX_AGE_MILLIS,
});

export const Registration = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  email: Schema.String.check(Schema.isMaxLength(320)).pipe(Schema.decodeTo(AuthSchema.Email)),
  /**
   * Proof that the address completed the guest verification code. The created
   * subject starts with a verified email when it matches a live challenge.
   */
  grant: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
});

export type Registration = typeof Registration.Type;

export class SsoRejected extends Schema.TaggedError<SsoRejected>()("SsoRejected", {
  message: Schema.String,
}) {}

/**
 * A break-glass recovery link was rejected. The ceremony is single use, so an
 * expired, consumed, unapproved or cancelled token all land here with the same
 * message: the caller never learns which check failed.
 */
export class RecoveryRejected extends Schema.TaggedError<RecoveryRejected>()("RecoveryRejected", {
  message: Schema.String,
}) {}

export const AuthApi: AnyAuthContract = AuthContract.make("mattrax/auth", {
  basePath: "/api/v1",
  claims: AuthClaims,
  actions: (sessions) => {
    const totp = TotpContract.make(TOTP_MODULE_ID, {
      Session: sessions.Session,
      CompletionResult: sessions.CompletionResult,
    });

    const passkey = PasskeyContract.make(PASSKEY_MODULE_ID, {
      Session: sessions.Session,
      CompletionResult: sessions.CompletionResult,
    });

    const passkeyManagement = PasskeyContract.makeManagement(PASSKEY_MODULE_ID);

    const passkeyRegistration = PasskeyContract.makeRegistration(PASSKEY_MODULE_ID, Registration);

    /**
     * Private credentials injected by the HTTP boundary from their cookies.
     * They never appear in a public payload or a success value.
     */
    const passkeyCredential = Schema.RedactedFromValue(
      Schema.NonEmptyString.check(Schema.isMaxLength(16384)),
    );

    return {
      // ---- Registration ---------------------------------------------------
      // An account is created by registering its first passkey. The library
      // provisions the subject and credential; the browser then signs in with
      // that same passkey.
      beginPasskeyRegistration: AuthContract.fromOperation(passkeyRegistration.operations.Begin, {
        strategy: "registration",
        method: "register",
      }),

      completePasskeyRegistration: AuthContract.fromOperation(
        passkeyRegistration.operations.Complete,
        {
          strategy: "registration",
          method: "completeRegistration",
          requestFields: { bindingCredential: "request-binding" },
        },
      ),

      ssoSignIn: AuthContract.action({
        payload: Schema.Struct({ token: Schema.String }),
        success: sessions.CompletionResult,
        error: SsoRejected,
        mode: "mutation",
        credentials: true,
        replay: "single-use",
        method: "signIn",
        strategy: "sso",
      }),

      /**
       * Break-glass recovery. The token is minted by the recovery ceremony only
       * after the account proved control of its verified address (and, for a
       * shared tenant, another owner approved). It signs the account in so a new
       * passkey can be enrolled; it never removes or replaces an existing
       * credential.
       */
      recoverySignIn: AuthContract.action({
        payload: Schema.Struct({ token: Schema.String }),
        success: sessions.CompletionResult,
        error: RecoveryRejected,
        mode: "mutation",
        credentials: true,
        replay: "single-use",
        method: "signIn",
        strategy: "recovery",
      }),

      beginTotpEnrollment: AuthContract.fromOperation(totp.operations.Begin, {
        method: "beginEnrollment",
        strategy: "totp",
      }),

      confirmTotpEnrollment: AuthContract.fromOperation(totp.operations.Confirm, {
        method: "confirmEnrollment",
        strategy: "totp",
      }),

      disableTotp: AuthContract.fromOperation(totp.operations.Disable, {
        method: "disable",
        strategy: "totp",
      }),

      regenerateTotpRecoveryCodes: AuthContract.fromOperation(totp.operations.Regenerate, {
        method: "regenerateRecoveryCodes",
        strategy: "totp",
      }),

      verifyTotpPending: AuthContract.fromOperation(totp.operations.VerifyPending, {
        method: "verifyPending",
        strategy: "totp",
        requestFields: { pendingCredential: "pending-proof" },
      }),

      recoverTotpPending: AuthContract.fromOperation(totp.operations.RecoverPending, {
        method: "recoverPending",
        strategy: "totp",
        requestFields: { pendingCredential: "pending-proof" },
      }),

      // ---- Passkeys -------------------------------------------------------
      // Sign-in is a discoverable-credential ceremony: begin returns WebAuthn
      // options, complete verifies the assertion and issues the session.
      beginPasskeySignIn: AuthContract.fromOperation(passkey.operations.Begin, {
        method: "signIn",
        strategy: "passkey",
      }),

      completePasskeySignIn: AuthContract.fromOperation(passkey.operations.Complete, {
        method: "completeSignIn",
        strategy: "passkey",
        requestFields: { bindingCredential: "request-binding" },
        subject: {
          fromSuccess: (value) =>
            Match.value(value).pipe(
              Match.tag("Authenticated", (completion) => completion.session.subjectId),
              Match.orElse(() => undefined),
            ),
          sessionFromSuccess: (value) =>
            Match.value(value).pipe(
              Match.tag("Authenticated", (completion) => completion.session),
              Match.orElse(() => undefined),
            ),
        },
      }),

      // The possession factor for a pending password/email/SSO sign-in.
      beginPasskeyPending: AuthContract.action({
        payload: Schema.Struct({
          ...Passkey.PasskeyBegin.fields,
          pendingCredential: passkeyCredential,
        }),
        success: Passkey.PasskeyAuthenticationStarted,
        error: Passkey.PasskeyFailure,
        mode: "mutation",
        replay: "single-use",
        credentials: true,
        method: "beginPending",
        strategy: "passkeyPending",
        requestFields: { pendingCredential: "pending-proof" },
      }),

      completePasskeyPending: AuthContract.action({
        payload: Schema.Struct({
          flowId: Operations.RequestBindingFlowId,
          bindingCredential: passkeyCredential,
          response: Passkey.PasskeyAssertion,
          pendingCredential: passkeyCredential,
        }),
        success: sessions.CompletionResult,
        error: Passkey.PasskeyFailure,
        mode: "mutation",
        replay: "single-use",
        credentials: true,
        method: "completePending",
        strategy: "passkeyPending",
        requestFields: {
          bindingCredential: "request-binding",
          pendingCredential: "pending-proof",
        },
        subject: {
          fromSuccess: (value) =>
            Match.value(value).pipe(
              Match.tag("Authenticated", (completion) => completion.session.subjectId),
              Match.orElse(() => undefined),
            ),
          sessionFromSuccess: (value) =>
            Match.value(value).pipe(
              Match.tag("Authenticated", (completion) => completion.session),
              Match.orElse(() => undefined),
            ),
        },
      }),

      // Step-up ceremonies. The app also issues a short-lived grant cookie so
      // non-auth handlers can require recent proof; see `stepUp.ts`.
      beginPasskeyStepUp: AuthContract.action({
        payload: Schema.Struct({
          ...Passkey.PasskeyBegin.fields,
          stepUpCredential: passkeyCredential,
        }),
        success: Passkey.PasskeyAuthenticationStarted,
        error: Passkey.PasskeyFailure,
        mode: "mutation",
        replay: "single-use",
        credentials: true,
        method: "beginStepUp",
        strategy: "passkeyStepUp",
        requestFields: { stepUpCredential: "session-step-up" },
      }),

      completePasskeyStepUp: AuthContract.action({
        payload: Schema.Struct({
          flowId: Operations.RequestBindingFlowId,
          bindingCredential: passkeyCredential,
          response: Passkey.PasskeyAssertion,
          stepUpCredential: passkeyCredential,
          sourceCredential: passkeyCredential,
        }),
        success: sessions.Session,
        error: Passkey.PasskeyFailure,
        mode: "mutation",
        replay: "single-use",
        credentials: true,
        method: "completeStepUp",
        strategy: "passkeyStepUp",
        requestFields: {
          bindingCredential: "request-binding",
          stepUpCredential: "session-step-up",
          sourceCredential: "session",
        },
      }),

      // Account security: enroll, list, rename and remove this account's keys.
      beginPasskeyEnrollment: AuthContract.fromOperation(passkeyManagement.operations.Begin, {
        method: "enrollPasskey",
        strategy: "passkeyManagement",
      }),

      completePasskeyEnrollment: AuthContract.fromOperation(passkeyManagement.operations.Complete, {
        method: "completePasskeyEnrollment",
        strategy: "passkeyManagement",
        requestFields: { bindingCredential: "request-binding" },
      }),

      listPasskeys: AuthContract.fromOperation(passkeyManagement.operations.List, {
        method: "listPasskeys",
        strategy: "passkeyManagement",
        mode: "query",
      }),

      renamePasskey: AuthContract.fromOperation(passkeyManagement.operations.Rename, {
        method: "renamePasskey",
        strategy: "passkeyManagement",
      }),
    };
  },
});

/**
 * Session policy shared by the auth definition and the server Layers. Pending
 * MFA is configured separately in the server layer so password, email and SSO
 * sign-in can all return `PendingAuthentication`.
 */
export const appSessionConfiguration = Sessions.stateful({
  maxAge: "30 days",
  idleTimeout: "30 days",
  renewAfter: "1 day",
});

/**
 * A strategy that has already been built by its module, mirroring the
 * `BuiltStrategy` contract `@yielded/auth` accepts in its selection (the type
 * itself is not re-exported from the package root).
 */
type BuiltAuthStrategy = {
  readonly completion?: boolean;
  readonly make: Effect.Effect<Readonly<Record<string, Auth.AuthMethod>>, unknown, unknown>;
};

/** Strategy overrides merged into the definition, keyed by strategy name. */
type ExtraAuthStrategies = Readonly<
  Record<string, StrategyDefinition<StrategyTypeLambda, string | undefined> | BuiltAuthStrategy>
>;

/**
 * The auth definition used by server Layers. Passkeys are the only primary
 * credential; TOTP is an optional second factor and SSO is an enterprise
 * alternative. `origin` remains part of the signature because callers build
 * the relying-party profile from the same deployment origin.
 *
 * Sessions are deliberately not passed here: when any strategy completes
 * authentication the library only enables pending MFA when the application
 * supplies its own `completionLayer` with a pending lifetime. The server layer
 * provides both the strategy and completion layers from `appSessionConfiguration`.
 */
/* oxlint-disable-next-line typescript/no-explicit-any -- The service class that
 * `Auth.make` returns mentions dozens of the library's internal strategy type
 * lambdas, none of which are exported; TypeScript cannot name it in a
 * declaration file, so callers see the service shape through this boundary. */
export const makeAppAuth = (_origin: string, extraStrategies: ExtraAuthStrategies = {}): any =>
  Auth.make(AuthApi, {
    strategies: {
      totp: Totp.make(TOTP_POLICY),
      // One namespace, five facets. Registration, sign-in, pending MFA,
      // step-up and account management each need their own strategy entry
      // because the auth API dispatches by method name, but they share
      // credentials and challenges.
      registration: Passkey.makeRegistration({
        namespace: PASSKEY_MODULE_ID,
        policy: PASSKEY_POLICY,
        registration: Registration,
      }),
      passkey: Passkey.make({
        namespace: PASSKEY_MODULE_ID,
        policy: PASSKEY_POLICY,
      }),
      passkeyManagement: Passkey.makeManagement({
        namespace: PASSKEY_MODULE_ID,
        policy: PASSKEY_POLICY,
        management: PASSKEY_MANAGEMENT_POLICY,
      }),
      passkeyPending: Passkey.makePending({
        namespace: PASSKEY_MODULE_ID,
        policy: PASSKEY_POLICY,
      }),
      passkeyStepUp: Passkey.makeStepUp({
        namespace: PASSKEY_MODULE_ID,
        policy: PASSKEY_POLICY,
      }),
      ...extraStrategies,
    },
    defaultStrategy: "passkey",
  });

export const AuthDefinition = Object.freeze({
  ...makeAppAuth("https://mattrax.invalid"),
  // Persistence roles are selected from the session mode even though the
  // runtime layers are supplied by the server.
  sessionMode: "stateful" as const,
});
