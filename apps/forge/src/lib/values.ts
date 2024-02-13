import { UserProvider } from "@mattrax/api";
import { match } from "ts-pattern";

export const authProviderDisplayName = (providerName: UserProvider) =>
  match(providerName)
    .with("entraId", () => "Microsoft Entra ID")
    .with("gsuite", () => "Google Workspaces")
    .exhaustive();

export const authProviderUrl = (
  providerName: UserProvider,
  providerId: string
) =>
  match(providerName)
    .with(
      "entraId",
      () =>
        `https://portal.azure.com/${encodeURIComponent(
          providerId
        )}#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/Overview`
    )
    .with("gsuite", () => undefined)
    .exhaustive();
