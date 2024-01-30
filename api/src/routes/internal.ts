import { db, kvStore } from "../db";
import { env } from "../env";
import { isSuperAdmin } from "../trpc";
import { Hono } from "hono";
import { HonoEnv } from "../types";

export const franksScopes =
  "offline_access DeviceManagementServiceConfig.Read.All DeviceManagementServiceConfig.ReadWrite.All DeviceManagementConfiguration.Read.All DeviceManagementConfiguration.ReadWrite.All";

export const internalRouter = new Hono<HonoEnv>()
  .use("*", async (c, next) => {
    if (c.env.session.data?.id === undefined)
      return c.json({ error: "UNAUTHORISED" }, 401);

    if (isSuperAdmin(c.env.session.data)) {
      return c.json({ error: "FORBIDDEN" }, 403);
    }
    await next();
  })
  .get("/authorisefrank", async (c) => {
    // TODO: Require being superadmin

    const params = new URLSearchParams();
    params.set("client_id", env.MSFT_CLIENT_ID);
    params.set("response_type", "code");
    // TODO: Implement the callback for this
    params.set(
      "redirect_uri",
      `${env.PROD_URL}/api/internal/authorisefrank/callback`
    );
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
    reqBody.set("code", code!);
    reqBody.set(
      "redirect_uri",
      `${env.PROD_URL}/api/internal/authorisefrank/callback`
    );
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
      .insert(kvStore)
      .values({
        key: "intune_refresh_token",
        value: body.refresh_token,
      })
      .onDuplicateKeyUpdate({
        set: {
          value: body.refresh_token,
        },
      });

    return c.redirect("/internal");
  });
