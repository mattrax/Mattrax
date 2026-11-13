export type DevEmail = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly sentAt: string;
};

// Local development and browser tests need to read verification codes without
// a real transactional email provider. This module is only wired up when
// DEV_MAILBOX=true; production deployments leave it disabled.
const inbox: Array<DevEmail> = [];

export const recordDevEmail = (message: Omit<DevEmail, "sentAt">) => {
  inbox.unshift({ ...message, sentAt: new Date().toISOString() });

  if (inbox.length > 50) inbox.length = 50;
};

export const listDevEmails = (): ReadonlyArray<DevEmail> => inbox;

export const isLoopbackHost = (hostname: string) => {
  const host = hostname.toLowerCase();

  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".localhost")
  );
};

export const isLoopbackOrigin = (origin: string) => {
  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
};

export const timingSafeStringEqual = (left: string, right: string) => {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);

  if (a.length !== b.length) return false;
  let difference = 0;

  for (let index = 0; index < a.length; index++) difference |= a[index]! ^ b[index]!;

  return difference === 0;
};

export type DevMailboxConfig = {
  readonly DEV_MAILBOX?: string;
  readonly DEV_MAILBOX_ALLOW_REMOTE?: string;
  readonly DEV_MAILBOX_SECRET?: string;
};

/**
 * The debug mailbox captures live verification/reset links, so it is only
 * available on an explicitly local deployment. `DEV_MAILBOX=true` alone must
 * never enable it in production; a non-loopback origin also requires the
 * separate `DEV_MAILBOX_ALLOW_REMOTE=true` opt-in **and** a non-empty
 * `DEV_MAILBOX_SECRET`, otherwise the endpoint would be unauthenticated.
 */
export const isDevMailboxEnabled = (
  config: DevMailboxConfig,
  origin: string,
  requestUrl: string,
) => {
  if (config.DEV_MAILBOX !== "true") return false;

  if (config.DEV_MAILBOX_ALLOW_REMOTE === "true") return Boolean(config.DEV_MAILBOX_SECRET?.trim());
  let requestHost: string;

  try {
    requestHost = new URL(requestUrl).hostname;
  } catch {
    return false;
  }

  return isLoopbackOrigin(origin) && isLoopbackHost(requestHost);
};
