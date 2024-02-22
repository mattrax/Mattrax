import { Hono } from "hono";

export type EnrollmentProfileDescription = {
  data: string;
  createdAt: number;
};

export const enrollmentRouter = new Hono()
  .get("/login", async (c) => {
    // `appru` and `login_hint` are parameters set by Windows MDM client
    const appru = c.req.query("appru");
    const accesstoken = c.req.query("accesstoken"); // The access token from the `ms-device-enrollment:?` link
    const email = c.req.query("email") ?? c.req.query("login_hint");
    if (!email) {
      // TODO: Pretty error page
      c.status(400);
      return c.text("Email is required");
    }

    // The user did the login flow in their browser, so we can skip doing it again in within the Windows Federated enrollment flow.
    if (appru && accesstoken) {
      return c.html(renderMdmCallback(appru, accesstoken));
    }

    // TODO: Look up user to tenant ID

    if (email === "404@otbeaumont.me") {
      // TODO: Pretty error page
      return c.text(
        "Your account was not found. Please contact your administrator."
      );
    }

    // TODO: Work out oauth provider for that specific user (remember tenant can have multiple) and send user to it.
    // This is to mock the OAuth provider's callback
    const searchParams = new URLSearchParams();
    if (appru) searchParams.set("appru", appru);
    searchParams.set("email", email);
    return c.redirect(`/api/enrollment/callback?${searchParams.toString()}`);
  })
  .get("/callback", async (c) => {
    const appru = c.req.query("appru");
    const email = c.req.query("email");
    if (!email) {
      // TODO: Pretty error page
      return c.text("Email is required");
    }

    const authToken = "TODOSpecialTokenWhichVerifiesAuth"; // TODO: Get this back from OAuth provider. This needs to hold the ID of Mattrax tenant.

    if (appru) {
      return c.html(renderMdmCallback(appru, authToken));
    } else {
      // TODO: Can we use cookies for this cause I don't trust non-tech people to not accidentally copy it out. - We would wanna render `/enroll` with Solid on the server for that.
      const searchParams = new URLSearchParams();
      searchParams.set("token", authToken);
      searchParams.set("email", email);
      return c.redirect(`/enroll?${searchParams.toString()}`);
    }
  });

const renderMdmCallback = (appru: string, authToken: string) =>
  `<h3>Mattrax Login</h3><form id="loginForm" method="post" action="${appru}"><p><input type="hidden" name="wresult" value="${authToken}" /></p><input type="submit" value="Login" /></form><script>document.getElementById('loginForm').submit()</script>`;
