import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import * as jose from "jose";
import { renderToString } from "solid-js/web";

import { domains, getDb, identityProviders } from "~/db";
import { env } from "~/env";
import { getEmailDomain } from "../utils";
import { upsertEntraIdUser } from "../trpc/routers/tenant/identityProvider";
import { decryptJWT, encryptJWT, signJWT } from "../jwt";

export type EnrollmentProfileDescription = {
  data: string;
  createdAt: number;
};

const MINUTE = 60 * 1000;

type State = {
  // MDM webview special callback URL
  appru: string | undefined;
  // Microsoft tenantID
  tenantId: string;
  // Mattrax id's
  tid: number;
  providerId: number;
};

export const enrollmentRouter = new Hono()
  .get("/login", async (c) => {
    // `appru` and `login_hint` are parameters set by Windows MDM client
    const appru = c.req.query("appru");
    // The access token from the `ms-device-enrollment:?` link.
    // This won't be set if the enrollment is started on the device but will be set if the user started in their browser through `/enroll`.
    const accesstoken = c.req.query("accesstoken");
    // `email` is set when coming from the form in `/enroll`, `login_hint` is set by the MDM browser.
    const email = c.req.query("email") ?? c.req.query("login_hint");
    if (!email) {
      // TODO: Pretty error page
      c.status(400);
      return c.text("Email is required");
    }

    // The user did the login flow in their browser, so we can skip doing it again in within the Windows Federated enrollment flow.
    if (appru && accesstoken) {
      // It seems like Microsoft's MDM client is caching the `accesstoken` prop (as least that's the only explanation for what i'm seeing)
      // This will trigger a new login flow if the token is expired (hence was probs cached).
      try {
        await jose.jwtVerify(
          accesstoken,
          new TextEncoder().encode(env.INTERNAL_SECRET),
          {
            audience: "mdm.mattrax.app",
            algorithms: ["ES256"],
          },
        );

        return c.html(renderMdmCallback(appru, accesstoken));
      } catch (err) {}
    }

    const domain = getEmailDomain(email);
    if (domain === undefined) return c.text("Invalid email address");

    const [domainRecord] = await getDb()
      .select({
        identityProvider: {
          remoteId: identityProviders.remoteId,
          tenantPk: identityProviders.tenantPk,
          pk: identityProviders.pk,
        },
      })
      .from(domains)
      .where(and(eq(domains.domain, domain)))
      .innerJoin(
        identityProviders,
        eq(domains.identityProviderPk, identityProviders.pk),
      );

    if (domainRecord === undefined) return c.text("Domain not found");

    const params = new URLSearchParams({
      client_id: env.ENTRA_CLIENT_ID,
      scope: "https://graph.microsoft.com/.default",
      redirect_uri: `${env.VITE_PROD_URL}/api/enrollment/callback`,
      response_type: "code",
      response_mode: "query",
      login_hint: email,
      state: await encryptJWT<State>(
        {
          appru,
          tenantId: domainRecord.identityProvider.remoteId,
          tid: domainRecord.identityProvider.tenantPk,
          providerId: domainRecord.identityProvider.pk,
        },
        {
          expirationTime: new Date(Date.now() + 10 * MINUTE),
          audience: "enroll",
        },
      ),
    });

    return c.redirect(
      `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?${params.toString()}`,
    );
  })
  .get("/callback", async (c) => {
    const stateStr = c.req.query("state");
    if (!stateStr) return c.text("Missing OAuth state");

    const code = c.req.query("code");
    if (!code) return c.text("Missing OAuth code");

    const stateJwt = await decryptJWT(stateStr, {
      audience: "enroll",
    });
    const { appru, tenantId, tid, providerId } = stateJwt.payload as State;

    const { access_token } = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        body: new URLSearchParams({
          client_id: env.ENTRA_CLIENT_ID,
          client_secret: env.ENTRA_CLIENT_SECRET,
          scope: "https://graph.microsoft.com/.default",
          redirect_uri: `${env.VITE_PROD_URL}/api/enrollment/callback`,
          grant_type: "authorization_code",
          code,
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    ).then(async (r) => {
      if (!r.ok)
        throw new Error(
          `Failed to get access token '${r.status}': ${await r.text()}`,
        );
      return await r.json();
    });

    const user = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    }).then(async (r) => {
      if (!r.ok)
        throw new Error(`Failed to get user '${r.status}': ${await r.text()}`);
      return await r.json();
    });
    const { userPrincipalName } = user;

    const dbUser = await upsertEntraIdUser(user, tid, providerId);

    // TODO: Upsert if the user doesn't exist already

    const jwt = await signJWT(
      { tid, uid: dbUser.pk, upn: userPrincipalName },
      {
        expirationTime: new Date(Date.now() + 10 * MINUTE),
        audience: "mdm.mattrax.app",
      },
    );

    if (appru) return c.html(renderMdmCallback(appru, jwt));

    // TODO: Can we use cookies for this cause I don't trust non-tech people to not accidentally copy it out. - We would wanna render `/enroll` with Solid on the server for that.
    const searchParams = new URLSearchParams({
      token: jwt,
      email: userPrincipalName,
    });
    return c.redirect(`/enroll?${searchParams.toString()}`);
  });

const renderMdmCallback = (appru: string, authToken: string) =>
  renderToString(() => (
    <>
      <h3>Mattrax Login</h3>
      <form id="loginForm" method="post" action={appru}>
        <p>
          <input type="hidden" name="wresult" value={authToken} />
        </p>
        <input type="submit" value="Login" />
      </form>
      <script>document.getElementById('loginForm').submit()</script>
    </>
  ));
