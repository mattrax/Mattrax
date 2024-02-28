import { Hono } from "hono";
import { getCookie } from "vinxi/server";
import { z } from "zod";

import { db, identityProviders } from "~/db";
import { env } from "~/env";
import { lucia } from "../auth";
import { HonoEnv } from "../types";
import { msGraphClient } from "../microsoft";
import { syncAllUsersWithEntra } from "../trpc/routers/tenant/identityProvider";

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

    const sessionId = getCookie(c.env.h3Event, lucia.sessionCookieName) ?? null;
    if (sessionId === null) return new Response(`Unauthorised!`); // TODO: Proper error UI as the user may land here

    const { session } = await lucia.validateSession(sessionId);

    if (!session) return new Response(`Unauthorised!`); // TODO: Proper error UI as the user may land here
    if (c.env.session.data?.oauthData === undefined)
      return new Response(`Conflict!`); // TODO: Proper error UI as the user may land here

    const body = new URLSearchParams({
      client_id: env.ENTRA_CLIENT_ID,
      client_secret: env.ENTRA_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      code: code,
      redirect_uri: `${env.PROD_URL}/api/ms/link`,
      grant_type: "authorization_code",
    });

    const tokenReq = await fetch(
      `https://login.microsoftonline.com/organizations/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
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
      { headers: { Authorization: `Bearer ${tokenData.data.access_token}` } }
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

    const params = new URLSearchParams({
      client_id: env.ENTRA_CLIENT_ID,
      scope: "https://graph.microsoft.com/.default",
      redirect_uri: `${env.PROD_URL}/api/ms/permissions`,
      state: c.env.session.data.oauthData.state,
      // params.set("response_type", "code");
      // params.set("response_mode", "query");
    });

    return c.redirect(
      `https://login.microsoftonline.com/organizations/v2.0/adminconsent?${params.toString()}`
    );
  })
  .get("/permissions", async (c) => {
    const error = c.req.query("error");
    if (error) return new Response(`Error from Microsoft: ${error}`); // TODO: Proper error UI as the user may land here

    const sessionId = getCookie(c.env.h3Event, lucia.sessionCookieName) ?? null;
    if (sessionId === null) return new Response(`Unauthorised!`); // TODO: Proper error UI as the user may land here

    const { session } = await lucia.validateSession(sessionId);

    if (!session) return new Response(`Unauthorised!`); // TODO: Proper error UI as the user may land here
    if (!c.env.session.data?.oauthData) return new Response(`Conflict!`); // TODO: Proper error UI as the user may land here
    if (!c.env.session.data?.oauthData.entraIdTenant)
      return new Response(`Conflict!`); // TODO: Proper error UI as the user may land here

    const { tenant, entraIdTenant } = c.env.session.data.oauthData;

    await db
      .insert(identityProviders)
      .values({
        variant: "entraId",
        remoteId: entraIdTenant,
        tenantPk: tenant,
      })
      // We don't care if it already exists so no need for that to cause an error.
      .onDuplicateKeyUpdate({
        // Drizzle requires at least one item or it will error.
        set: {
          variant: "entraId",
        },
      });

    await msGraphClient(entraIdTenant)
      .api("/subscriptions")
      .post({
        changeType: "created,updated,deleted",
        notificationUrl: `${env.PROD_URL}/api/webhook/ms`,
        // TODO: Automatically renew the subscription when we get the expiration notification
        // lifecycleNotificationUrl: `${env.PROD_URL}/api/webhook/ms/lifecycle`,
        resource: "/users",
        expirationDateTime: new Date(
          new Date().getTime() + 1000 * 60 * 60 * 24 * 25
        ).toISOString(),
        clientState: env.INTERNAL_SECRET,
      });

    await c.env.session.update({
      ...c.env.session.data,
      oauthData: undefined,
    });

    return c.redirect(`/${tenant}/settings`);
  });
