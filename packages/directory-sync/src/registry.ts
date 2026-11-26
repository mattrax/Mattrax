import type {
  DirectoryProviderDefinition,
  DirectoryProviderGroupSource,
  DirectoryProviderId,
  DirectoryProviderUserSource,
} from "./provider.js";

/**
 * The provider registry.
 *
 * The core package owns the registry shape and lookup rules; each provider
 * package owns its definition, so adding a provider never edits another
 * provider's code. Lookups are by provider id or by the persisted source column
 * so the dashboard can resolve a directory row back to the provider that
 * imported it.
 */
export type DirectoryProviderRegistry = {
  readonly list: () => ReadonlyArray<DirectoryProviderDefinition>;
  readonly get: (id: DirectoryProviderId) => DirectoryProviderDefinition | undefined;
  readonly byUserSource: (
    source: DirectoryProviderUserSource | string | null | undefined,
  ) => DirectoryProviderDefinition | undefined;
  readonly byGroupSource: (
    source: DirectoryProviderGroupSource | string | null | undefined,
  ) => DirectoryProviderDefinition | undefined;
};

export const makeDirectoryProviderRegistry = (
  providers: ReadonlyArray<DirectoryProviderDefinition>,
): DirectoryProviderRegistry => {
  const byId = new Map<DirectoryProviderId, DirectoryProviderDefinition>();
  const byUser = new Map<string, DirectoryProviderDefinition>();
  const byGroup = new Map<string, DirectoryProviderDefinition>();

  for (const provider of providers) {
    if (byId.has(provider.id)) throw new Error(`Duplicate directory provider id: ${provider.id}`);

    const userOwner = byUser.get(provider.userSource);
    const groupOwner = byGroup.get(provider.groupSource);

    // Two providers writing the same source column would make a directory row
    // ambiguous, and sync reconciliation would disable the other provider's
    // people. Reject it at boot instead of in production.
    if (userOwner)
      throw new Error(
        `Directory user source ${provider.userSource} is claimed by ${userOwner.id} and ${provider.id}`,
      );

    if (groupOwner)
      throw new Error(
        `Directory group source ${provider.groupSource} is claimed by ${groupOwner.id} and ${provider.id}`,
      );

    byId.set(provider.id, provider);
    byUser.set(provider.userSource, provider);
    byGroup.set(provider.groupSource, provider);
  }

  return {
    list: () => providers,
    get: (id) => byId.get(id),
    byUserSource: (source) => (source ? byUser.get(source) : undefined),
    byGroupSource: (source) => (source ? byGroup.get(source) : undefined),
  };
};
