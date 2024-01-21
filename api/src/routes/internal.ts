import { db, kvStore } from "../db";
import { env } from "../env";
import { eq } from "drizzle-orm";
import { getSubscription, subscribe } from "../microsoft/graph";
import { newAuthedApp } from "../utils";
import { FetchError } from "../microsoft";

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
    reqBody.set("code", code);
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
  })
  .post("/setup", async (c) => {
    const subscriptionId = (
      await db
        .select()
        .from(kvStore)
        .where(eq(kvStore.key, "devices_subscription_id"))
    )?.[0];

    if (subscriptionId) {
      try {
        await getSubscription(subscriptionId.value);
        return c.json({});
      } catch (err) {
        // If the subscription has expired we wanna recreate it, regardless of if it's in the DB.
        if (!(err instanceof FetchError && err.status === 404)) {
          throw err;
        }
      }
    }

    try {
      const result = await subscribe(
        "/devices",
        ["created", "updated", "deleted"],
        env.INTERNAL_SECRET
      );

      await db
        .insert(kvStore)
        .values({
          key: "devices_subscription_id",
          value: result!.id,
        })
        .onDuplicateKeyUpdate({
          set: {
            value: result!.id,
          },
        });

      return c.json({});
    } catch (err) {
      console.error(err);
      return c.json({ error: (err as any).toString() }, 500);
    }
  });
