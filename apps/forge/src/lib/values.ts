import { UserProvider } from "@mattrax/api";

export const AUTH_PROVIDER_DISPLAY = {
  entraId: "Microsoft Entra ID",
  // gsuite: "Google Workspaces",
} satisfies Record<UserProvider, string>;

export function authProviderUrl(
  providerName: UserProvider,
  providerId: string
): string {
  switch (providerName) {
    case "entraId":
      return `https://portal.azure.com/${encodeURIComponent(
        providerId
      )}#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/Overview`;
  }
}

export function userAuthProviderUrl(
  providerName: UserProvider,
  providerId: string,
  userId: string
): string {
  switch (providerName) {
    case "entraId": {
      return `https://portal.azure.com/${encodeURIComponent(
        providerId
      )}#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/~/overview/userId/${encodeURIComponent(
        userId
      )}`;
    }
  }
}
