type PostHogReader = () => {
  readonly distinctId?: string;
  readonly sessionId?: string;
};

let reader: PostHogReader | undefined;

/** Install the live PostHog reader after the browser SDK initialises. */
export const registerPostHogReader = (next: PostHogReader): void => {
  reader = next;
};

/**
 * Correlation headers attached to same-origin API calls.
 *
 * The API trusts its authenticated session for authorization; these headers are
 * analytics context only and let server events join the browser session.
 */
export const analyticsHeaders = () => {
  const context = reader?.();

  if (!context) return {};
  const headers: Record<string, string> = {};

  if (context.distinctId) headers["x-posthog-distinct-id"] = context.distinctId;

  if (context.sessionId) headers["x-posthog-session-id"] = context.sessionId;

  return headers;
};
