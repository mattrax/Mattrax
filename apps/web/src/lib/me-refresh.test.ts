import { QueryClient } from "@tanstack/solid-query";
import { describe, expect, it } from "vitest";
import { ME_QUERY_KEY } from "./me-keys";
import { refreshMeAfterEmailVerification } from "./me-refresh";

type CachedMe = { account: { id: string; emailVerified: boolean }; tenants: [] };

const seed = (client: QueryClient) => {
  client.setQueryData<CachedMe>(ME_QUERY_KEY, {
    account: { id: "user-1", emailVerified: false },
    tenants: [],
  });
};

/** An injected invalidation port: records filters without starting a refetch. */
const recordingInvalidator = () => {
  const calls: unknown[] = [];

  return {
    calls,
    invalidate: async (filter: unknown) => {
      calls.push(filter);
    },
  };
};

describe("email verification refresh", () => {
  it("optimistically verifies the cached row and refetches it even when inactive", async () => {
    const client = new QueryClient();
    seed(client);
    const invalidator = recordingInvalidator();

    await refreshMeAfterEmailVerification(client, { optimistic: true }, invalidator);

    expect(client.getQueryData<CachedMe>(ME_QUERY_KEY)?.account).toMatchObject({
      emailVerified: true,
    });
    expect(invalidator.calls).toEqual([{ queryKey: ME_QUERY_KEY, refetchType: "all" }]);
  });

  it("does not mark a different account verified when only a token link was used", async () => {
    const client = new QueryClient();
    seed(client);
    const invalidator = recordingInvalidator();

    await refreshMeAfterEmailVerification(client, {}, invalidator);

    // The token is account-bound, not session-bound: the signed-in row may be
    // someone else's, so only the session claim and the refetched /me decide.
    expect(client.getQueryData<CachedMe>(ME_QUERY_KEY)?.account.emailVerified).toBe(false);
    expect(invalidator.calls).toEqual([{ queryKey: ME_QUERY_KEY, refetchType: "all" }]);
  });
});
