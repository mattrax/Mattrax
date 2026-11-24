import type { QueryClient } from "@tanstack/solid-query";
import type { MeResponse } from "@mattrax/enterprise-domain/client";
import { enterpriseKeys } from "~/lib/enterprise";

/**
 * Make a completed email verification visible to the shell immediately.
 *
 * The session claim and the `/me` row are refreshed by different requests, and
 * a public verification page may have no active `/me` observer. Optimistically
 * mark the cached row verified, then invalidate and refetch it even when it is
 * inactive, so the dashboard gate does not read the pre-verification snapshot
 * and bounce the account back to `/verify-email`.
 *
 * Call only when the account has a session; an unauthenticated verification
 * link has no `/me` payload to refresh.
 */
export async function refreshMeAfterEmailVerification(client: QueryClient): Promise<void> {
  client.setQueryData<MeResponse>(enterpriseKeys.me(), (current) =>
    current ? { ...current, account: { ...current.account, emailVerified: true } } : current,
  );

  await client.invalidateQueries({ queryKey: enterpriseKeys.me() });
  await client.refetchQueries({ queryKey: enterpriseKeys.me(), type: "all" });
}
