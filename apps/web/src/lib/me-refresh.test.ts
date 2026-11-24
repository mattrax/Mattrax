import { QueryClient } from "@tanstack/solid-query";
import { describe, expect, it, vi } from "vitest";
import { ME_QUERY_KEY } from "./me-keys";
import { refreshMeAfterEmailVerification } from "./me-refresh";

type CachedMe = { account: { id: string; emailVerified: boolean }; tenants: [] };

const seed = (client: QueryClient) => {
  client.setQueryData<CachedMe>(ME_QUERY_KEY, {
    account: { id: "user-1", emailVerified: false },
    tenants: [],
  });
};

describe("email verification refresh", () => {
  it("optimistically verifies the cached row and refetches it even when inactive", async () => {
    const client = new QueryClient();
    seed(client);

    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    await refreshMeAfterEmailVerification(client, { optimistic: true });

    expect(client.getQueryData<CachedMe>(ME_QUERY_KEY)?.account).toMatchObject({
      emailVerified: true,
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ME_QUERY_KEY, refetchType: "all" });
  });

  it("does not mark a different account verified when only a token link was used", async () => {
    const client = new QueryClient();
    seed(client);

    vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    await refreshMeAfterEmailVerification(client);

    // The token is account-bound, not session-bound: the signed-in row may be
    // someone else's, so only the session claim and the refetched /me decide.
    expect(client.getQueryData<CachedMe>(ME_QUERY_KEY)?.account.emailVerified).toBe(false);
  });
});
