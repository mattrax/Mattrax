import { Output, number, object, safeParse, string } from "valibot";
import { env } from "~/env";

const authenticateResponse = object({
  token_type: string(),
  expires_in: number(),
  ext_expires_in: number(),
  access_token: string(),
});
type AuthenticateResponse = Output<typeof authenticateResponse>;

async function authenticate() {
  const params = new URLSearchParams();
  params.set("client_id", env.MSFT_CLIENT_ID);
  params.set("scope", "https://graph.microsoft.com/.default");
  params.set("client_secret", env.MSFT_CLIENT_SECRET);
  params.set("grant_type", "client_credentials");
  const resp = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(
      env.MSFT_ADMIN_TENANT
    )}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: new Headers({
        // This is implied by `URLSearchParams` but Vercel Edge Runtime is stupid
        "Content-Type": "application/x-www-form-urlencoded",
      }),
      body: params,
    }
  );
  if (!resp.ok)
    throw new Error(
      `Failed to get access token from Microsoft with status '${
        resp.status
      }': ${await resp.text()}`
    );
  const result = safeParse(authenticateResponse, await resp.json());
  if (!result.success)
    throw new Error(
      `Failed to parse Microsoft authenticate response: ${result.issues}`
    );
  return result.output;
}

// TODO: On unauthorised refresh token

// let cachedAuthentication: AuthenticateResponse | undefined = undefined;
async function authenticatedFetchInner<T>(
  url: string,
  init?: RequestInit,
  retrying = false
) {
  let cachedAuthentication: AuthenticateResponse | undefined = undefined;

  if (!cachedAuthentication) cachedAuthentication = await authenticate();

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${cachedAuthentication.access_token}`);

  const resp = await fetch(
    `https://graph.microsoft.com/v1.0${url}`,
    Object.assign({}, init, { headers })
  );
  if (resp.status === 401) {
    if (retrying)
      throw new Error(
        "Failed to authenticate with Microsoft after attempting to reauthenticate"
      );
    cachedAuthentication = await authenticate();
    return await authenticatedFetchInner(url, init, true);
  }

  if (!resp.ok)
    throw new Error(
      `Failed to fetch ${url} with status '${
        resp.status
      }': ${await resp.text()}`
    );

  return (await resp.json()) as T; // TODO: Doing proper validation
}

export const authenticatedFetch = <T>(url: string, init?: RequestInit) =>
  authenticatedFetchInner<T>(url, init);
