import { expect, test, type Page } from "@playwright/test";
import { api, bootstrapTenant, gotoHydrated, register, uniqueEmail } from "./helpers";

type DebugEmail = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly sentAt: string;
};

const mailbox = async (page: Page): Promise<ReadonlyArray<DebugEmail>> => {
  const response = await page.request.get("/api/debug/emails");

  expect(response.ok()).toBe(true);

  // SAFETY: the dev mailbox route returns its own JSON array of messages.
  return (await response.json()) as ReadonlyArray<DebugEmail>;
};

const invitationEmails = (messages: ReadonlyArray<DebugEmail>, email: string) =>
  messages.filter((message) => message.to === email && message.subject.startsWith("Join "));

const invitationLinks = (messages: ReadonlyArray<DebugEmail>, email: string) =>
  invitationEmails(messages, email).flatMap((message) => {
    const link = message.text.match(/https?:\/\/\S+\/accept-invitation\?token=\S+/)?.[0];

    return link ? [link] : [];
  });

/** Newest first: the inbox prepends, so index zero is the latest message. */
const latestInvitationLink = async (page: Page, email: string, minimum = 1) => {
  let link = "";

  await expect
    .poll(
      async () => {
        const links = invitationLinks(await mailbox(page), email);

        link = links[0] ?? "";

        return links.length >= minimum ? link : "";
      },
      { timeout: 20_000 },
    )
    .not.toBe("");

  return link;
};

const tokenOf = (link: string) => {
  const token = new URL(link).searchParams.get("token");

  expect(token, "invitation link must carry a token").toBeTruthy();

  return token!;
};

const preview = (page: Page, token: string) =>
  api<{ state: string }>(page, `/api/v1/invitations/preview?token=${encodeURIComponent(token)}`);

const expectPreviewState = async (page: Page, token: string, state: string) => {
  await expect
    .poll(async () => (await preview(page, token)).state, { timeout: 10_000 })
    .toBe(state);
};

type ListedInvitation = {
  email: string;
  roleId?: string | null;
  roleName: string;
  status: string;
};

/** Reads can hit a replica shortly after a write; poll until the row appears. */
const invitationFor = async (page: Page, tenantId: string, email: string) => {
  let match: ListedInvitation | undefined;

  await expect
    .poll(
      async () => {
        const list = await api<{ invitations: ListedInvitation[] }>(
          page,
          `/api/v1/tenants/${tenantId}/invitations`,
        );

        match = list.invitations.find((item) => item.email === email);

        return match?.email ?? "";
      },
      { timeout: 10_000 },
    )
    .not.toBe("");

  return match!;
};

const maskEmail = (email: string) => {
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");

  return `${local[0]}***@${domain[0]}***${dot > 0 ? domain.slice(dot) : ""}`;
};

const tenantName = async (page: Page, tenantId: string) =>
  (await api<{ name: string }>(page, `/api/v1/tenants/${tenantId}`)).name;

const openAdministrators = (page: Page, tenantId: string) =>
  gotoHydrated(page, `/t/${tenantId}/settings/administrators`);

const inviteThroughUi = async (page: Page, email: string, roleValue: string) => {
  await page.getByLabel("Invitee email address").fill(email);
  await page.getByLabel("Invitation role").selectOption(roleValue);
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
};

test.describe("invitations", () => {
  test("an invited user joins the tenant through the invite link", async ({ page, browser }) => {
    const tenant = await bootstrapTenant(page, "Invite Tenant");
    const email = `invitee-${Date.now()}@example.com`;

    const invitation = await api<{ inviteUrl: string }>(
      page,
      `/api/v1/tenants/${tenant.id}/invitations`,
      { method: "POST", body: JSON.stringify({ email, role: "member" }) },
    );

    expect(invitation.inviteUrl).toContain("/accept-invitation?token=");

    // The owner's session must not accept the invitee's token.
    const wrong = await page.evaluate(
      async ({ token }) => {
        const response = await fetch("/api/v1/invitations/accept", {
          method: "POST",
          headers: { "content-type": "application/json", "x-effect-auth-csrf": "1" },
          body: JSON.stringify({ token }),
        });

        return response.status;
      },
      { token: new URL(invitation.inviteUrl).searchParams.get("token") },
    );

    expect(wrong).toBe(403);

    // A different person in a different browser: registration only starts from
    // a guest session, so the invitee must not inherit the owner's cookies.
    const inviteeContext = await browser.newContext();
    const invitee = await inviteeContext.newPage();
    await register(invitee, { email, name: "Invited User" });
    await gotoHydrated(invitee, invitation.inviteUrl);
    await invitee.getByRole("button", { name: /^Join / }).click();
    await expect(invitee).toHaveURL(new RegExp(`/t/${tenant.id}/devices`));

    const me = await invitee.evaluate(async () => (await fetch("/api/v1/me")).json());
    expect(me.tenants.some((item: { id: string }) => item.id === tenant.id)).toBe(true);
    await inviteeContext.close();
  });

  test("the UI invites a built-in role and the branded email joins the tenant", async ({
    page,
    browser,
  }) => {
    const tenant = await bootstrapTenant(page, "Invite UI");
    const name = await tenantName(page, tenant.id);
    const email = uniqueEmail("ui-invitee");

    await openAdministrators(page, tenant.id);
    await expect(
      page.getByRole("heading", { name: "Invite a member", exact: true }),
    ).toBeVisible();

    await inviteThroughUi(page, email, "builtin:member");
    await expect(page.getByText("Email sent", { exact: true })).toBeVisible();
    await expect(page.getByText(/Sent to/).filter({ hasText: email })).toContainText("Member");

    const message = invitationEmails(await mailbox(page), email)[0];
    const link = await latestInvitationLink(page, email);

    expect(message).toBeDefined();
    expect(message!.subject).toBe(`Join ${name} on Mattrax`);
    expect(message!.text).toContain("invited you to join");
    expect(message!.text).toContain("as Member");
    expect(message!.text).toContain(link);
    expect(message!.html).toContain(name);

    const inviteeContext = await browser.newContext();
    const invitee = await inviteeContext.newPage();

    try {
      await register(invitee, { email, name: "UI Invitee" });
      await gotoHydrated(invitee, link);
      await expect(
        invitee.getByRole("heading", { name: `Join ${name}`, exact: true }),
      ).toBeVisible();
      await expect(invitee.getByText(maskEmail(email), { exact: true })).toBeVisible();
      await invitee.getByRole("button", { name: `Join ${name}`, exact: true }).click();
      await expect(invitee).toHaveURL(new RegExp(`/t/${tenant.id}/devices`));

      const me = await invitee.evaluate(async () => (await fetch("/api/v1/me")).json());
      const membership = me.tenants.find((item: { id: string }) => item.id === tenant.id);

      expect(membership).toMatchObject({ roleName: "Member" });
    } finally {
      await inviteeContext.close();
    }
  });

  test("a custom-role invitation carries roleId and joins with that role", async ({
    page,
    browser,
  }) => {
    const tenant = await bootstrapTenant(page, "Invite Custom");
    const name = await tenantName(page, tenant.id);
    const email = uniqueEmail("custom-invitee");
    const roleName = `Device reviewer ${Math.random().toString(36).slice(2, 6)}`;

    const role = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/roles`, {
      method: "POST",
      body: JSON.stringify({
        name: roleName,
        description: "Read devices only",
        permissions: ["tenant.read", "devices.read"],
      }),
    });

    await openAdministrators(page, tenant.id);
    await inviteThroughUi(page, email, `role:${role.id}`);
    await expect(page.getByText("Email sent", { exact: true })).toBeVisible();

    const created = await invitationFor(page, tenant.id, email);

    expect(created).toMatchObject({ roleId: role.id, roleName });

    const link = await latestInvitationLink(page, email);
    const inviteeContext = await browser.newContext();
    const invitee = await inviteeContext.newPage();

    try {
      await register(invitee, { email, name: "Custom Invitee" });
      await gotoHydrated(invitee, link);
      await expect(invitee.getByText(roleName, { exact: true })).toBeVisible();
      await invitee.getByRole("button", { name: `Join ${name}`, exact: true }).click();
      await expect(invitee).toHaveURL(new RegExp(`/t/${tenant.id}/devices`));

      const me = await invitee.evaluate(async () => (await fetch("/api/v1/me")).json());

      expect(me.tenants.find((item: { id: string }) => item.id === tenant.id)).toMatchObject({
        roleName,
        roleKind: "custom",
      });
    } finally {
      await inviteeContext.close();
    }
  });

  test("resend rotates the link and cancel invalidates it", async ({ page, browser }) => {
    const tenant = await bootstrapTenant(page, "Invite Rotate");
    const email = uniqueEmail("rotate");

    const created = await api<{ inviteUrl: string }>(
      page,
      `/api/v1/tenants/${tenant.id}/invitations`,
      { method: "POST", body: JSON.stringify({ email, role: "member" }) },
    );

    const oldToken = tokenOf(created.inviteUrl);

    await openAdministrators(page, tenant.id);

    const row = page.getByRole("listitem").filter({ hasText: email });

    await row.getByRole("button", { name: `Resend invitation for ${email}` }).click();

    const resendDialog = page.getByRole("dialog", { name: /resend invitation/i });
    await expect(resendDialog).toBeVisible();
    await resendDialog.getByRole("button", { name: "Resend invitation", exact: true }).click();
    await expect(page.getByText(/A new invitation link was created/)).toBeVisible();
    await expect(page.getByText(/previous link no longer works/)).toBeVisible();

    const newLink = await latestInvitationLink(page, email, 2);

    expect(newLink).not.toBe(created.inviteUrl);
    await expectPreviewState(page, oldToken, "unknown");
    await expectPreviewState(page, tokenOf(newLink), "valid");
    await expect(
      row.getByRole("button", { name: `Copy invitation link for ${email}` }),
    ).toBeVisible();

    // The rotated link is the one that works end to end.
    const inviteeContext = await browser.newContext();
    const invitee = await inviteeContext.newPage();

    try {
      await register(invitee, { email, name: "Rotated Invitee" });
      await gotoHydrated(invitee, newLink);
      await invitee.getByRole("button", { name: /^Join / }).click();
      await expect(invitee).toHaveURL(new RegExp(`/t/${tenant.id}/devices`));
    } finally {
      await inviteeContext.close();
    }

    // Cancel is exercised on a second invite so the first one stays accepted.
    const cancelEmail = uniqueEmail("cancel");

    const cancellable = await api<{ inviteUrl: string }>(
      page,
      `/api/v1/tenants/${tenant.id}/invitations`,
      { method: "POST", body: JSON.stringify({ email: cancelEmail, role: "member" }) },
    );

    await openAdministrators(page, tenant.id);
    const cancelRow = page.getByRole("listitem").filter({ hasText: cancelEmail });

    await cancelRow.getByRole("button", { name: `Cancel invitation for ${cancelEmail}` }).click();

    const cancelDialog = page.getByRole("dialog", { name: /cancel invitation/i });
    await expect(cancelDialog).toBeVisible();
    await cancelDialog.getByRole("button", { name: "Cancel invitation", exact: true }).click();
    await expect(cancelRow).toHaveCount(0);
    await expectPreviewState(page, tokenOf(cancellable.inviteUrl), "unknown");

    const canceled = await invitationFor(page, tenant.id, cancelEmail);

    expect(canceled.status).toBe("canceled");
  });

  test("signed-out preview shows tenant details and a wrong account can switch", async ({
    page,
    browser,
  }) => {
    const tenant = await bootstrapTenant(page, "Invite Preview");
    const name = await tenantName(page, tenant.id);
    const email = uniqueEmail("preview-invitee");

    const created = await api<{ inviteUrl: string }>(
      page,
      `/api/v1/tenants/${tenant.id}/invitations`,
      { method: "POST", body: JSON.stringify({ email, role: "auditor" }) },
    );

    const anonymousContext = await browser.newContext();
    const anonymous = await anonymousContext.newPage();

    try {
      await gotoHydrated(anonymous, created.inviteUrl);

      await expect(anonymous.getByRole("heading", { name: `Join ${name}` })).toBeVisible();
      await expect(anonymous.getByText(name, { exact: true }).first()).toBeVisible();
      await expect(anonymous.getByText("Auditor", { exact: true })).toBeVisible();
      await expect(anonymous.getByText(maskEmail(email), { exact: true })).toBeVisible();
      await expect(anonymous.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute(
        "href",
        /returnTo=%2Faccept-invitation%3Ftoken%3D/,
      );
      await expect(
        anonymous.getByRole("link", { name: "Create account", exact: true }),
      ).toHaveAttribute("href", /returnTo=%2Faccept-invitation%3Ftoken%3D/);

      // The bearer token must not linger in the visible address bar.
      expect(new URL(anonymous.url()).searchParams.get("token")).toBeNull();

      const wrongEmail = uniqueEmail("wrong-account");

      await register(anonymous, { email: wrongEmail, name: "Wrong Account" });
      await gotoHydrated(anonymous, created.inviteUrl);

      await expect(anonymous.getByRole("heading", { name: "Wrong account" })).toBeVisible();
      await expect(anonymous.getByText(wrongEmail, { exact: true })).toBeVisible();
      await expect(anonymous.getByText(maskEmail(email), { exact: true }).first()).toBeVisible();

      await anonymous.getByRole("button", { name: "Switch account" }).click();
      await expect(anonymous).toHaveURL(/\/login\?returnTo=/);

      const returnTo = new URL(anonymous.url()).searchParams.get("returnTo");

      expect(returnTo).toBe(`/accept-invitation?token=${tokenOf(created.inviteUrl)}`);
    } finally {
      await anonymousContext.close();
    }
  });

  test("the invite form surfaces an existing-member conflict", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Invite Duplicate");
    const me = await api<{ user: { email: string } }>(page, "/api/v1/me");

    await openAdministrators(page, tenant.id);
    await inviteThroughUi(page, me.user.email, "builtin:member");

    await expect(
      page
        .getByRole("region", { name: "Invite a member" })
        .getByRole("alert")
        .filter({ hasText: /conflicts with something that already exists/i }),
    ).toBeVisible();
    await expect(page.getByText("Email sent", { exact: true })).toHaveCount(0);
  });

  test("a read-only member does not see the invite form", async ({ page, browser }) => {
    const tenant = await bootstrapTenant(page, "Invite Gated");
    const email = uniqueEmail("gated-member");

    const invitation = await api<{ inviteUrl: string }>(
      page,
      `/api/v1/tenants/${tenant.id}/invitations`,
      { method: "POST", body: JSON.stringify({ email, role: "member" }) },
    );

    const memberContext = await browser.newContext();
    const member = await memberContext.newPage();

    try {
      await register(member, { email, name: "Read Only Member" });
      await gotoHydrated(member, invitation.inviteUrl);
      await member.getByRole("button", { name: /^Join / }).click();
      await expect(member).toHaveURL(new RegExp(`/t/${tenant.id}/devices`));

      await openAdministrators(member, tenant.id);
      await expect(member.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
      await expect(
        member.getByRole("heading", { name: "Invite a member", exact: true }),
      ).toHaveCount(0);
      await expect(
        member.getByRole("button", { name: "Send invitation", exact: true }),
      ).toHaveCount(0);
    } finally {
      await memberContext.close();
    }
  });
});
