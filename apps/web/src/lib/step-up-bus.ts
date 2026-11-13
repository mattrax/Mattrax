import { createSignal } from "solid-js";

export type StepUpMethod = "password" | "totp" | "passkey";

export type StepUpAction =
  | "tenant-delete"
  | "api-token-create"
  | "api-token-revoke"
  | "mfa-disable"
  | "mfa-regenerate"
  | "recovery-key-reveal"
  | "backup-download"
  | "device-command"
  | "billing-portal"
  | "sso-policy"
  | "passkey-enroll"
  | "passkey-remove";

export type StepUpRequest = {
  readonly action: StepUpAction;
  readonly methods: ReadonlyArray<StepUpMethod>;
  readonly resolve: (grant: string) => void;
  readonly reject: (error: unknown) => void;
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
let waiters: Array<{ resolve: (grant: string) => void; reject: (error: unknown) => void }> = [];

export const pendingStepUp = pending;

/**
 * Ask the UI to collect a step-up. Resolves with a grant once the user
 * completes a factor; rejects when they cancel. Concurrent requests for the
 * same action share one dialog and all resolve with the resulting grant, so a
 * bulk device action cannot hang on a single waiter slot.
 */
export const requestStepUp = (
  action: StepUpAction,
  methods: ReadonlyArray<StepUpMethod> = ["password", "totp", "passkey"],
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

export const cancelStepUp = (error: unknown = new Error("Confirmation cancelled")) => {
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
    case "mfa-disable":
      return "turn off multi-factor authentication";
    case "mfa-regenerate":
      return "replace your recovery codes";
    case "recovery-key-reveal":
      return "reveal this recovery key";
    case "backup-download":
      return "download this tenant backup";
    case "device-command":
      return "run this device action";
    case "billing-portal":
      return "open the billing portal";
    case "sso-policy":
      return "change the tenant sign-in policy";
    case "passkey-enroll":
      return "add a passkey";
    case "passkey-remove":
      return "remove this passkey";
  }
};
