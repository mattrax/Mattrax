import { Schema } from "effect";
import { createSignal } from "solid-js";

export const STEP_UP_METHODS = ["totp", "passkey"] as const;

export type StepUpMethod = (typeof STEP_UP_METHODS)[number];

export const StepUpMethodSchema = Schema.Literals(STEP_UP_METHODS);

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
  "device-handover",
  "backup-download",
  "backup-pin",
  "backup-delete",
  "backup-restore",
  "cutover-export",
  "cutover-import",
  "device-command",
  "android-disconnect",
  "script-change",
  "script-run",
  "restricted-software-change",
  "billing-portal",
  "sso-policy",
  "tenant-mfa-policy",
  "scep-ca-rotate",
  "scep-ca-import",
  "passkey-enroll",
  "passkey-remove",
] as const;

export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];

export const StepUpActionSchema = Schema.Literals(STEP_UP_ACTIONS);

export type StepUpRequest = {
  readonly action: StepUpAction;
  readonly methods: ReadonlyArray<StepUpMethod>;
  readonly resolve: (grant: string) => void;
  readonly reject: (error: Error) => void;
};

/**
 * Grants are short-lived and bound to one action. Keeping them in memory (never
 * in localStorage) means closing the tab discards them.
 */
const grants = new Map<StepUpAction, { grant: string; expiresAtMillis: number }>();

export const stepUpGrant = (action: StepUpAction | undefined) => {
  if (!action) return undefined;
  const current = grants.get(action);

  if (!current) return undefined;

  if (current.expiresAtMillis <= Date.now() + 5_000) {
    grants.delete(action);

    return undefined;
  }

  return current.grant;
};

export const rememberStepUpGrant = (
  action: StepUpAction,
  grant: string,
  expiresAtMillis: number,
) => {
  grants.set(action, { grant, expiresAtMillis });
};

export const forgetStepUpGrants = () => grants.clear();

const [pending, setPending] = createSignal<StepUpRequest | null>(null);

let pendingAction: StepUpAction | null = null;

let waiters: Array<{ resolve: (grant: string) => void; reject: (error: Error) => void }> = [];

export const pendingStepUp = pending;

/**
 * Ask the UI to collect a step-up. Resolves with a grant once the user
 * completes a factor; rejects when they cancel. Concurrent requests for the
 * same action share one dialog and all resolve with the resulting grant, so a
 * bulk device action cannot hang on a single waiter slot.
 */
export const requestStepUp = (
  action: StepUpAction,
  methods: ReadonlyArray<StepUpMethod> = ["passkey", "totp"],
) =>
  new Promise<string>((resolve, reject) => {
    const existing = stepUpGrant(action);

    if (existing) {
      resolve(existing);

      return;
    }

    if (pendingAction === action) {
      waiters.push({ resolve, reject });

      return;
    }

    if (pendingAction !== null) {
      reject(new Error("Another confirmation is already open"));

      return;
    }

    pendingAction = action;
    waiters = [{ resolve, reject }];
    setPending({ action, methods, resolve, reject });
  });

export const completeStepUp = (grant: string) => {
  const current = pending();

  if (!current) return;
  const pendingWaiters = waiters;
  waiters = [];
  pendingAction = null;
  setPending(null);

  for (const waiter of pendingWaiters) waiter.resolve(grant);
};

export const cancelStepUp = (error: Error = new Error("Confirmation cancelled")) => {
  const current = pending();

  if (!current) return;
  const pendingWaiters = waiters;
  waiters = [];
  pendingAction = null;
  setPending(null);

  for (const waiter of pendingWaiters) waiter.reject(error);
};

export const stepUpActionLabel = (action: StepUpAction): string => {
  switch (action) {
    case "tenant-delete":
      return "delete this tenant";
    case "api-token-create":
      return "create an API token";
    case "api-token-revoke":
      return "revoke this API token";
    case "scim-token-create":
      return "create a SCIM provisioning token";
    case "mfa-enroll":
      return "set up an authenticator app";
    case "mfa-disable":
      return "turn off multi-factor authentication";
    case "mfa-regenerate":
      return "replace your recovery codes";
    case "email-change":
      return "change your email address";
    case "sessions-revoke-all":
      return "sign out everywhere";
    case "recovery-approve":
      return "approve this account recovery";
    case "recovery-key-reveal":
      return "reveal this recovery key";
    case "device-handover":
      return "export this device handover archive";
    case "backup-download":
      return "download this tenant backup";
    case "backup-pin":
      return "change this backup's retention";
    case "backup-delete":
      return "delete this backup";
    case "backup-restore":
      return "restore this tenant from a backup";
    case "cutover-export":
      return "export this deployment with private keys";
    case "cutover-import":
      return "import devices and credentials from another deployment";
    case "device-command":
      return "run this device action";
    case "android-disconnect":
      return "disconnect Android Enterprise";
    case "script-change":
      return "change this script";
    case "script-run":
      return "run this script on your devices";
    case "restricted-software-change":
      return "change this restricted software rule";
    case "billing-portal":
      return "open the billing portal";
    case "sso-policy":
      return "change the tenant sign-in policy";
    case "tenant-mfa-policy":
      return "change the tenant MFA requirement";
    case "scep-ca-rotate":
      return "rotate the tenant SCEP identity";
    case "scep-ca-import":
      return "replace the tenant SCEP identity";
    case "passkey-enroll":
      return "add a passkey";
    case "passkey-remove":
      return "remove this passkey";
  }
};
