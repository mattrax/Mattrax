import { QueryClient } from "@tanstack/solid-query";
import { describe, expect, it, vi } from "vitest";
import { enterpriseKeys } from "./enterprise";
import { refreshMeAfterEmailVerification } from "./me-refresh";

describe("email verification refresh", () => {
  it("optimistically verifies the cached row and refetches it even when inactive", async () => {
    const client = new QueryClient();
    client.setQueryData(enterpriseKeys.me(), {
      account: { id: "user-1", emailVerified: false },
      tenants: [],
    });

    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
    const refetch = vi.spyOn(client, "refetchQueries").mockResolvedValue(undefined);

    await refreshMeAfterEmailVerification(client);

    expect(client.getQueryData<{ account: { emailVerified: boolean } }>(enterpriseKeys.me())?.account)
      .toMatchObject({ emailVerified: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: enterpriseKeys.me() });
    expect(refetch).toHaveBeenCalledWith({ queryKey: enterpriseKeys.me(), type: "all" });
  });
});
