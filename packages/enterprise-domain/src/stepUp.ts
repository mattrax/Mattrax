import { Passkey, Sessions } from "@yielded/auth";
import { Context, Schema, type Effect } from "effect";

/**
 * Actions that require recent proof of possession. The list is intentionally
 * closed: a grant names one of these values, so a stolen grant cannot be
 * replayed against a different operation.
 */
export const STEP_UP_ACTIONS = [
  "tenant-delete",
  "api-token-create",
  "api-token-revoke",
  "mfa-disable",
  "mfa-regenerate",
  "recovery-key-reveal",
  "backup-download",
  "device-command",
  "billing-portal",
  "sso-policy",
  "passkey-enroll",
  "passkey-remove",
] as const;

export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];

export const STEP_UP_METHODS = ["password", "totp", "passkey"] as const;

export type StepUpMethod = (typeof STEP_UP_METHODS)[number];

export const StepUpMethods = Schema.Struct({
  password: Schema.Boolean,
  totp: Schema.Boolean,
  passkey: Schema.Boolean,
});

export type StepUpMethods = typeof StepUpMethods.Type;

/**
 * Typed failure returned by a sensitive endpoint when the caller has no recent
 * step-up. Clients use `action` and `methods` to prompt for the right factor and
 * then retry the original request with the issued grant.
 */
export class StepUpRequired extends Schema.TaggedError<StepUpRequired>()("StepUpRequired", {
  message: Schema.String,
  action: Schema.String,
  methods: Schema.Array(Schema.Literals(STEP_UP_METHODS)),
}) {}

/** A step-up factor could not be started (for example, no passkey is enrolled). */
export class StepUpUnavailable extends Schema.TaggedError<StepUpUnavailable>()(
  "StepUpUnavailable",
  {
    message: Schema.String,
  },
) {}

/**
 * WebAuthn options for a step-up ceremony plus the signed token that binds the
 * flow to this session. The token is returned to the caller and sent back on
 * completion; it carries no credential material.
 */
export const StepUpPasskeyStarted = Schema.Struct({
  stepUpToken: Schema.String,
  expiresAtMillis: Schema.Int,
  options: Passkey.PasskeyAuthenticationOptions,
});

export type StepUpPasskeyStarted = typeof StepUpPasskeyStarted.Type;

/**
 * Server-side result of starting a step-up ceremony. The runtime keeps the
 * challenge in the passkey flow table; the caller signs these fields into the
 * token it hands back to the browser.
 */
export const StepUpPasskeyChallenge = Schema.Struct({
  flowId: Schema.String,
  requestBindingVerifier: Schema.String,
  requestBindingExpiresAtMillis: Schema.Int,
  expiresAtMillis: Schema.Int,
  options: Passkey.PasskeyAuthenticationOptions,
});

export type StepUpPasskeyChallenge = typeof StepUpPasskeyChallenge.Type;

/** Short-lived grant returned after a successful step-up. */
export const StepUpGrantResponse = Schema.Struct({
  grant: Schema.String,
  expiresAtMillis: Schema.Int,
  method: Schema.Literals(STEP_UP_METHODS),
});

export type StepUpGrantResponse = typeof StepUpGrantResponse.Type;

/**
 * Factor verification owned by the auth runtime. It is implemented beside the
 * auth Layers because password, TOTP and passkey storage are private to them.
 * It never issues a grant: that is a pure signature over the verified result.
 */
export class StepUpService extends Context.Service<
  StepUpService,
  {
    readonly methods: (subjectId: string) => Effect.Effect<StepUpMethods, never>;
    readonly verifyPassword: (subjectId: string, password: string) => Effect.Effect<boolean, never>;
    readonly verifyTotp: (subjectId: string, code: string) => Effect.Effect<boolean, never>;
    readonly beginPasskey: (
      subjectId: string,
    ) => Effect.Effect<StepUpPasskeyChallenge, StepUpUnavailable>;
    readonly completePasskey: (input: {
      readonly subjectId: string;
      readonly flowId: string;
      readonly requestBindingVerifier: string;
      readonly requestBindingExpiresAtMillis: number;
      readonly response: string;
    }) => Effect.Effect<boolean, never>;
  }
>()("@mattrax/enterprise-domain/StepUpService") {}

/** Session-level assurance shape used when a grant is treated as fresh evidence. */
export const stepUpEvidenceRequirement = (): Sessions.AuthenticationRequirement => ({
  alternatives: [
    {
      factors: ["knowledge", "possession"],
      userVerified: false,
      phishingResistant: false,
      minimumCredentials: 2,
    },
    {
      factors: ["possession"],
      userVerified: true,
      phishingResistant: true,
      minimumCredentials: 1,
    },
  ],
  maximumAgeMillis: 24 * 60 * 60 * 1000,
});
