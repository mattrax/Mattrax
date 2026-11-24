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
 * - cross-tab invalidation reaches the same key;
 * - a stale entry still refetches on the next mount or window focus, so a
 *   change made elsewhere is picked up within the window without a poll.
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
