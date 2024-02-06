import {
  Client,
  AuthenticationProvider,
} from "@microsoft/microsoft-graph-client";
import { env } from ".";
import { z } from "zod";

const authenticateResponse = z.object({
  token_type: z.string(),
  expires_in: z.number(),
  ext_expires_in: z.number(),
  access_token: z.string(),
});

// A really simple in-memory cache.
// This will amortise the cost of constructing the same client multiple times in a single request.
// Also in my testing global variables can be shared between requests in Cloudflare Workers.
const cached: Record<string, any> = {};
function cache<T>(key: string, fn: () => T): T {
  if (cached[key]) return cached[key];
  const result = fn();
  cached[key] = result;
  return result;
}

// We don't use `@azure/identity` because it pulls in Node.js only dependencies which are not supported on Edge Function's :(
class AuthProvider implements AuthenticationProvider {
  tenant: string;
  clientId: string;
  clientSecret: string;

  constructor(tenant: string, clientId: string, clientSecret: string) {
    this.tenant = tenant;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  // TODO: Properly implement refresh when the token expires
  public async getAccessToken(): Promise<string> {
    const params = new URLSearchParams();
    params.set("client_id", this.clientId);
    params.set("client_secret", this.clientSecret);
    params.set("scope", "https://graph.microsoft.com/.default");
    params.set("grant_type", "client_credentials");
    const resp = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(
        this.tenant
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
    if (!resp.ok) {
      const body = await resp.text();
      console.error(resp.status, body);
      throw new FetchError(
        resp.status,
        body,
        `Failed to get access token from Microsoft`
      );
    }
    const result = authenticateResponse.safeParse(await resp.json());
    if (!result.success) {
      console.error(
        `Failed to parse Microsoft authenticate response: ${result.error}`
      );
      throw new Error(
        `Failed to parse Microsoft authenticate response: ${result.error}`
      );
    }

    return result.data.access_token;
  }
}

// The MS Graph client for communicating with Mattrax's Intune tenant
// This uses the "Forge MDM" application.
export const graphClient = cache("intuneGraphClient", () =>
  Client.initWithMiddleware({
    authProvider: new AuthProvider(
      env.INTUNE_TENANT,
      env.INTUNE_CLIENT_ID,
      env.INTUNE_CLIENT_SECRET
    ),
  })
);

// The MS Graph client for Entra ID sync within the user's tenant
// This uses the "Forge" application.
export const msGraphClient = (tenantId: string) =>
  cache(`tenantGraphClient|${tenantId}`, () =>
    Client.initWithMiddleware({
      authProvider: new AuthProvider(
        tenantId,
        env.ENTRA_CLIENT_ID,
        env.ENTRA_CLIENT_SECRET
      ),
    })
  );

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
