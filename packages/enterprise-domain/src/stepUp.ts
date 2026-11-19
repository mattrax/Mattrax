import { Schema } from "effect";

/**
 * Actions that require recent proof of possession. The list is intentionally
 * closed: a grant names one of these values, so a stolen grant cannot be
 * replayed against a different operation.
 */
export const STEP_UP_ACTIONS = [
  "tenant-delete",
  "api-token-create",
  "api-token-revoke",
  "scim-token-create",
  "mfa-enroll",
  "mfa-disable",
  "mfa-regenerate",
  "email-change",
  "sessions-revoke-all",
  "recovery-approve",
  "recovery-key-reveal",
  "backup-download",
  "backup-pin",
  "backup-delete",
  "backup-restore",
  "device-command",
  "android-disconnect",
  "script-change",
  "script-run",
  "billing-portal",
  "sso-policy",
  "tenant-mfa-policy",
  "scep-ca-rotate",
  "scep-ca-import",
  "passkey-enroll",
  "passkey-remove",
] as const;

export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];

export const STEP_UP_METHODS = ["totp", "passkey"] as const;

export type StepUpMethod = (typeof STEP_UP_METHODS)[number];

export const StepUpMethods = Schema.Struct({
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
 *
 * `options` is kept as generic JSON here so the browser bundle does not pull
 * the passkey implementation. The server builds it from the precise schema in
 * `stepUpServer.ts`, and the browser hands it straight to WebAuthn.
 */
export const StepUpPasskeyStarted = Schema.Struct({
  stepUpToken: Schema.String,
  expiresAtMillis: Schema.Int,
  options: Schema.Json,
});

export type StepUpPasskeyStarted = typeof StepUpPasskeyStarted.Type;

/** Short-lived grant returned after a successful step-up. */
export const StepUpGrantResponse = Schema.Struct({
  grant: Schema.String,
  expiresAtMillis: Schema.Int,
  method: Schema.Literals(STEP_UP_METHODS),
});

export type StepUpGrantResponse = typeof StepUpGrantResponse.Type;
