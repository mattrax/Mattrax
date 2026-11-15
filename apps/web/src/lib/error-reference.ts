/**
 * Error references shown to users and attached to PostHog exception events.
 *
 * A reference only correlates a support report with an analytics event; it is
 * not a secret and must not be used for authentication.
 */
export type ErrorReference = string;

export const newErrorReference = (): ErrorReference => {
  const uuid = globalThis.crypto?.randomUUID?.();

  const random = uuid
    ? uuid.replaceAll("-", "").slice(0, 8)
    : Math.random().toString(16).slice(2, 10);

  return `ERR-${random.toUpperCase()}`;
};
