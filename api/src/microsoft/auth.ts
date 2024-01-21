import { z } from "zod";
import { env } from "../env";

const authenticateResponse = z.object({
  token_type: z.string(),
  expires_in: z.number(),
  ext_expires_in: z.number(),
  access_token: z.string(),
});
type AuthenticateResponse = z.infer<typeof authenticateResponse>;

type Init = RequestInit & { skipBodyParse?: boolean };

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
    throw new FetchError(
      resp.status,
      await resp.text(),
      `Failed to get access token from Microsoft`
    );
  const result = authenticateResponse.safeParse(await resp.json());
  if (!result.success)
    throw new Error(
      `Failed to parse Microsoft authenticate response: ${result.error}`
    );
  return result.data;
}

// TODO: On unauthorised refresh token

// let cachedAuthentication: AuthenticateResponse | undefined = undefined;
async function authenticatedFetchInner<T>(
  url: string,
  init?: Init,
  beta = false,
  retrying = false
) {
  let cachedAuthentication: AuthenticateResponse | undefined = undefined;

  if (!cachedAuthentication) cachedAuthentication = await authenticate();

  const headers = new Headers(init?.headers);
  if (!headers.has("Authorization"))
    headers.set("Authorization", `Bearer ${cachedAuthentication.access_token}`);

  const resp = await fetch(
    `https://graph.microsoft.com/${beta ? "beta" : "v1.0"}${url}`,
    Object.assign({}, init, { headers })
  );
  if (resp.status === 401) {
    if (retrying)
      throw new Error(
        "Failed to authenticate with Microsoft after attempting to reauthenticate"
      );
    cachedAuthentication = await authenticate();
    return await authenticatedFetchInner(url, init, beta, true);
  }

  if (!resp.ok)
    throw new FetchError(
      resp.status,
      await resp.text(),
      `Failed to fetch ${url}`
    );

  if (init?.skipBodyParse) return undefined;

  if (resp.status === 204) return undefined;
  return (await resp.json()) as T; // TODO: Doing proper validation
}

export const authenticatedFetch = <T>(url: string, init?: Init) =>
  authenticatedFetchInner<T & { "@odata.context": string }>(url, init);

// TODO: Remove this and remove version prefix from hardcoded URL
export const authenticatedFetchBeta = <T>(url: string, init?: Init) =>
  authenticatedFetchInner<T & { "@odata.context": string }>(url, init, true);

export class FetchError {
  status: number = 0;
  body: string | undefined = undefined;
  msg: string | undefined = undefined;

  constructor(status: number, body: string | undefined, msg?: string) {
    this.status = status;
    this.body = body;
    this.msg = msg;
  }

  toString() {
    return `FetchError: ${this.msg}; status=${
      this.status
    } body='${JSON.stringify(this.body)}'`;
  }
}
