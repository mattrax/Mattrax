import { db, intuneAccessToken } from "../db";
import { env } from "../env";
import { newAuthedApp } from "../utils";

export const franksScopes =
  "offline_access DeviceManagementServiceConfig.Read.All DeviceManagementServiceConfig.ReadWrite.All DeviceManagementConfiguration.Read.All DeviceManagementConfiguration.ReadWrite.All";

export const app = newAuthedApp()
  .use("*", async (c, next) => {
    if (c.env.session.data.email !== "oscar@otbeaumont.me") {
      return c.json({ error: "Unauthorised", reason: "Not superadmin!" }, 401);
    }
    await next();
  })
  .get("/stats", async (c) => {
    return c.json({
      tenants: 0,
      devices: 0,
      users: 0,
      policies: 0,
      applications: 0,
    });
  })
  .get("/authorisefrank", async (c) => {
    // TODO: Require being superadmin

    const params = new URLSearchParams();
    params.set("client_id", env.MSFT_CLIENT_ID);
    params.set("response_type", "code");
    // TODO: Implement the callback for this
    params.set("redirect_uri", "https://mattrax-forge.vercel.app"); // TODO: Use incoming URL
    params.set("response_mode", "query");
    params.set("scope", franksScopes);
    // params.set("state", "12345");

    return c.redirect(
      `https://login.microsoftonline.com/${
        env.MSFT_ADMIN_TENANT
      }/oauth2/v2.0/authorize?${params.toString()}`
    );
  })
  .get("/authorisefrank/callback", async (c) => {
    const code = c.req.query("code");

    const reqBody = new URLSearchParams();
    reqBody.set("client_id", env.MSFT_CLIENT_ID);
    reqBody.set("scope", franksScopes);
    reqBody.set("code", code);
    reqBody.set("redirect_uri", "https://mattrax-forge.vercel.app"); // TODO: Use incoming URL
    reqBody.set("grant_type", "authorization_code");
    reqBody.set("client_secret", env.MSFT_CLIENT_SECRET);

    const resp = await fetch(
      `https://login.microsoftonline.com/${env.MSFT_ADMIN_TENANT}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: reqBody,
      }
    );
    if (!resp.ok) throw new Error(`Failed to get access token from Microsoft`);

    // TODO: Validate schema
    const body: {
      token_type: string;
      scope: string;
      expires_in: number;
      ext_expires_in: number;
      access_token: string;
      refresh_token: string;
    } = await resp.json();

    await db
      .insert(intuneAccessToken)
      .values({
        id: 1,
        refresh_token: body.refresh_token,
      })
      .onDuplicateKeyUpdate({
        set: {
          refresh_token: body.refresh_token,
        },
      });

    return c.json({}); // TODO: Redirect once we turn this into a proper flow
  });
