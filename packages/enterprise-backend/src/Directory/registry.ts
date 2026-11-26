import { makeDirectoryProviderRegistry } from "@mattrax/directory-sync";
import { entraDirectoryProvider } from "@mattrax/entra-id";
import { googleWorkspaceDirectoryProvider } from "@mattrax/google-workspace";

/**
 * Every directory provider this deployment can sync from.
 *
 * Each provider is a separate package; this is the only place that knows the
 * full list. Adding a provider means adding one entry here (and its package),
 * not editing the sync pipeline or another provider.
 */
export const directoryProviderRegistry = makeDirectoryProviderRegistry([
  entraDirectoryProvider,
  googleWorkspaceDirectoryProvider,
]);
