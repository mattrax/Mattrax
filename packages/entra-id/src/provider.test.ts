import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { AzureGraphInvalidResponse } from "@mattrax/azure-graph";
import type { AzureGraphService } from "@mattrax/azure-graph";
import { entraDirectoryUserDirectory } from "../src/provider.js";

const tenantId = "11111111-1111-1111-1111-111111111111";

function fakeGraph(overrides: Partial<AzureGraphService> = {}): AzureGraphService {
  const unused = () => Effect.die("Graph method is not used by this test");

  return {
    get: <_T>() => Effect.die("Graph get is not used by this test"),
    usersDelta: unused,
    groupsDelta: unused,
    domains: unused,
    revokeDelegatedConsent: unused,
    consentUrl: () => "",
    listAutopilotDevices: unused,
    getAutopilotDevice: unused,
    importAutopilotDevices: unused,
    deleteAutopilotDevice: unused,
    listAutopilotProfiles: unused,
    createAutopilotProfile: unused,
    updateAutopilotProfile: unused,
    assignAutopilotProfile: unused,
    ...overrides,
  };
}

describe("Entra directory provider", () => {
  it("forwards delta cursors and does not mark a resumed page authoritative", async () => {
    const cursor = "https://graph.microsoft.com/v1.0/users/delta?$skiptoken=page-2";
    const deltaLink = "https://graph.microsoft.com/v1.0/users/delta?$deltatoken=final";
    const usersDelta = vi.fn(() =>
      Effect.succeed({
        items: [
          {
            id: "user-1",
            displayName: "Ada Lovelace",
            userPrincipalName: "ada@contoso.com",
          },
        ],
        nextLink: null,
        deltaLink,
      }),
    );
    const graph = fakeGraph({ usersDelta });
    const directory = entraDirectoryUserDirectory({ graph, azureTenantId: tenantId });

    const page = await Effect.runPromise(directory.discoverUsers(cursor));

    expect(usersDelta).toHaveBeenCalledWith(tenantId, cursor);
    expect(page).toEqual({
      users: [
        {
          externalId: "user-1",
          email: "ada@contoso.com",
          name: "Ada Lovelace",
          disabled: false,
          removed: undefined,
        },
      ],
      nextCursor: null,
      deltaCursor: deltaLink,
      authoritative: false,
    });
  });

  it("preserves the next cursor while a delta listing is still in progress", async () => {
    const nextLink = "https://graph.microsoft.com/v1.0/groups/delta?$skiptoken=page-2";
    const groupsDelta = vi.fn(() =>
      Effect.succeed({
        items: [{ id: "group-1", displayName: "Engineering", members: [] }],
        nextLink,
        deltaLink: null,
      }),
    );
    const graph = fakeGraph({ groupsDelta });
    const directory = entraDirectoryUserDirectory({ graph, azureTenantId: tenantId });

    const page = await Effect.runPromise(directory.discoverGroups(undefined));

    expect(groupsDelta).toHaveBeenCalledWith(tenantId, undefined);
    expect(page.nextCursor).toBe(nextLink);
    expect(page.deltaCursor).toBeUndefined();
    expect(page.authoritative).toBe(true);
  });

  it.each(["users", "groups"])(
    "propagates malformed %s pages instead of fabricating an empty authoritative page",
    async (kind) => {
      const error = new AzureGraphInvalidResponse({ message: "Missing value array" });
      const graph = fakeGraph({
        usersDelta: () => Effect.fail(error),
        groupsDelta: () => Effect.fail(error),
      });
      const directory = entraDirectoryUserDirectory({ graph, azureTenantId: tenantId });

      if (kind === "users") {
        await expect(Effect.runPromise(directory.discoverUsers(undefined))).rejects.toBe(error);

        return;
      }

      await expect(Effect.runPromise(directory.discoverGroups(undefined))).rejects.toBe(error);
    },
  );
});
