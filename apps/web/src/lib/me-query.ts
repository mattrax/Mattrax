/**
 * Cache policy for the signed-in account's shell payload (`/me`).
 *
 * `/me` supplies the account, memberships and permissions the whole dashboard
 * renders from. Every page mounts at least one observer for it (the shell, the
 * tenant guard and `useCan`), so a zero stale window made each navigation look
 * like a fresh load: the first observer to mount after the route changed
 * immediately re-fetched a payload that had arrived with the previous page.
 *
 * The shell is only allowed to go stale, not be fetched again on every mount:
 *
 * - mutations that change memberships or roles invalidate `enterpriseKeys.me()`
 *   explicitly (`settings/administrators`, invitations, tenant create, …);
 * - a stale entry still refetches on the next mount or window focus, so a
 *   change made elsewhere is picked up within the window without a poll.
 *
 * Cross-tab cache messages only invalidate tenant-scoped keys, not the
 * account-wide `/me` payload. A membership change accepted in another tab
 * becomes visible here on the next mount after this window (or the next focus
 * once stale), within 60 seconds. Server-rendered permission data can lag for
 * up to the five-minute SSR token lifetime in the first HTML; `meQueryOptions`
 * marks that preload stale once so the client revalidates after hydration.
 *
 * Keep this a plain data object: it is spread into `meQueryOptions` and asserted
 * by `me-query.test.ts`, which is the regression guard against a future change
 * reintroducing the per-navigation fetch.
 */
export const ME_QUERY_STALE_TIME = 60_000;

/** Keep the shell warm through a long working session without leaking memory. */
export const ME_QUERY_GC_TIME = 30 * 60_000;

export const meQueryCachePolicy = () => ({
  staleTime: ME_QUERY_STALE_TIME,
  gcTime: ME_QUERY_GC_TIME,
});

export type EmailVerificationGateInput = {
  /** `/me` may be the stale pre-verification row while a refresh is in flight. */
  readonly meVerified: boolean | undefined;
  /** Session claims are refreshed by the verification flow itself. */
  readonly sessionVerified: boolean | undefined;
  readonly meFetching: boolean;
};

export type EmailVerificationGate = "allow" | "wait" | "verify";

/**
 * Decide whether the dashboard gate may render, should wait for a refresh, or
 * must send the account to `/verify-email`. A fresh session claim wins over a
 * stale `/me` row: verification would otherwise bounce the user back until the
 * cache window expires.
 */
export function emailVerificationGate(input: EmailVerificationGateInput): EmailVerificationGate {
  if (input.meVerified === true || input.sessionVerified === true) return "allow";

  // The verification flow invalidates and refetches /me. Do not redirect while
  // that request can still turn a false row into the verified one.
  if (input.meFetching) return "wait";

  if (input.meVerified === false || input.sessionVerified === false) return "verify";

  return "wait";
}
