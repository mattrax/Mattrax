import type { QueryClient } from "@tanstack/solid-query";
import type { MeResponse } from "@mattrax/enterprise-domain/client";
import { ME_QUERY_KEY } from "~/lib/me-keys";

export type EmailVerificationRefresh = {
  /**
   * Only session-bound flows (code, email change) may mark the signed-in row
   * verified. A token link is account-bound and can belong to someone else who
   * opened it in this browser session.
   */
  readonly optimistic?: boolean;
};

/**
 * Make a completed email verification visible to the shell immediately.
 *
 * The session claim and the `/me` row are refreshed by different requests, and
 * a public verification page may have no active `/me` observer. One
 * `invalidateQueries({ refetchType: "all" })` marks the row stale and fetches it
 * even when inactive; callers that know the verification belongs to the current
 * session also seed `emailVerified: true` so the gate cannot bounce before the
 * response lands.
 *
 * Call only when the account has a session; an unauthenticated verification
 * link has no `/me` payload to refresh.
 */
export async function refreshMeAfterEmailVerification(
  client: QueryClient,
  options: EmailVerificationRefresh = {},
): Promise<void> {
  if (options.optimistic) {
    client.setQueryData<MeResponse>(ME_QUERY_KEY, (current) =>
      current ? { ...current, account: { ...current.account, emailVerified: true } } : current,
    );
  }

  await client.invalidateQueries({ queryKey: ME_QUERY_KEY, refetchType: "all" });
}
