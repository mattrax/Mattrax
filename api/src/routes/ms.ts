import { Hono } from "hono";
import { HonoEnv } from "../types";
import { db, tenantUserProvider } from "../db";
import { encodeId } from "../utils";
import { env } from "../env";
import { z } from "zod";

const tokenEndpointResponse = z.object({ access_token: z.string() });
const organizationResponse = z.object({
  value: z
    .array(
      z.object({
        id: z.string(),
      })
    )
    .min(1)
    .max(1),
});

export const msRouter = new Hono<HonoEnv>()
  // We can't trust the result of the admin consent flow so we first authorise with an administrator to prove ownership, then we ask for consent.
  .get("/link", async (c) => {
    const error = c.req.query("error");
    if (error) return new Response(`Error from Microsoft: ${error}`); // TODO: Proper error UI as the user may land here

    const code = c.req.query("code");
    if (!code) return new Response(`No code!`); // TODO: Proper error UI as the user may land here

    if (!c.env.session.data?.id) return new Response(`Unauthorised!`); // TODO: Proper error UI as the user may land here
    if (!c.env.session.data.oauthData) return new Response(`Conflict!`); // TODO: Proper error UI as the user may land here

    const body = new URLSearchParams();
    body.set("client_id", env.ENTRA_CLIENT_ID);
    body.set("client_secret", env.ENTRA_CLIENT_SECRET);
    body.set("scope", "https://graph.microsoft.com/.default");
    body.set("code", code);
    body.set("redirect_uri", `${env.PROD_URL}/api/ms/link`);
    body.set("grant_type", "authorization_code");

    const tokenReq = await fetch(
      `https://login.microsoftonline.com/organizations/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      }
    );
    if (!tokenReq.ok) return new Response(`Failed to get token from Microsoft`); // TODO: Proper error UI as the user may land here

    const tokenData = tokenEndpointResponse.safeParse(await tokenReq.json());
    if (!tokenData.success)
      return new Response(`Failed to parse token response from Microsoft`); // TODO: Proper error UI as the user may land here

    // > returns a 200 OK response code and a collection of one organization object in the response body.
    const tenantReq = await fetch(
      `https://graph.microsoft.com/v1.0/organization?$select=id`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.data.access_token}`,
        },
      }
    );
    if (!tenantReq.ok)
      return new Response(`Failed to get tenant ID from Microsoft`); // TODO: Proper error UI as the user may land here
    const tenantData = organizationResponse.safeParse(await tenantReq.json());
    if (!tenantData.success)
      return new Response(`Failed to parse tenant response from Microsoft`); // TODO: Proper error UI as the user may land here
    const tenant = tenantData.data.value[0]!; // We valid the length in the Zod schema

    await c.env.session.update({
      ...c.env.session.data,
      oauthData: {
        ...c.env.session.data.oauthData,
        entraIdTenant: tenant.id,
      },
    });

    const params = new URLSearchParams();
    params.set("client_id", env.ENTRA_CLIENT_ID);
    params.set("scope", "https://graph.microsoft.com/.default");
    params.set("redirect_uri", `${env.PROD_URL}/api/ms/permissions`);
    // params.set("response_type", "code");
    // params.set("response_mode", "query");
    params.set("state", c.env.session.data.oauthData.state);
    return c.redirect(
      `https://login.microsoftonline.com/organizations/v2.0/adminconsent?${params.toString()}`
    );
  })
  .get("/permissions", async (c) => {
    const error = c.req.query("error");
    if (error) return new Response(`Error from Microsoft: ${error}`); // TODO: Proper error UI as the user may land here

    if (!c.env.session.data?.id) return new Response(`Unauthorised!`); // TODO: Proper error UI as the user may land here
    if (!c.env.session.data.oauthData) return new Response(`Conflict!`); // TODO: Proper error UI as the user may land here
    if (!c.env.session.data.oauthData.entraIdTenant)
      return new Response(`Conflict!`); // TODO: Proper error UI as the user may land here
    const mttxTenantId = c.env.session.data.oauthData.tenant;
    const entraTenantId = c.env.session.data.oauthData.entraIdTenant;

    await db
      .insert(tenantUserProvider)
      .values({
        name: "entraId",
        resourceId: entraTenantId,
        tenantId: mttxTenantId,
      })
      // We don't care if it already exists so no need for that to cause an error.
      .onDuplicateKeyUpdate({
        // Drizzle requires at least one item or it will error.
        set: {
          name: "entraId",
        },
      });

    await c.env.session.update({
      ...c.env.session.data,
      oauthData: undefined,
    });

    // TODO: Trigger an initial user sync out-of-band (event.waitUtil?)

    return c.redirect(`/${encodeId("tenant", mttxTenantId)}/settings`);
  });
