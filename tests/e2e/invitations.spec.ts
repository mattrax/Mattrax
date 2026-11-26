import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { api, bootstrapSession, gotoHydrated, register, uniqueEmail } from "./helpers";

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
  test.setTimeout(300_000);

  test("invitees join with owner, built-in, custom and read-only roles", async ({
    page,
    browser,
  }) => {
    const { tenant } = await bootstrapSession(page, "Invite Tenant");

    // Original case: "an invited user joins the tenant through the invite link".
    const inviteeEmail = `invitee-${randomUUID()}@example.com`;

    const invitation = await api<{ inviteUrl: string }>(
      page,
      `/api/v1/tenants/${tenant.id}/invitations`,
      { method: "POST", body: JSON.stringify({ email: inviteeEmail, role: "member" }) },
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
    await register(invitee, { email: inviteeEmail, name: "Invited User" });
    await gotoHydrated(invitee, invitation.inviteUrl);
    await invitee.getByRole("button", { name: /^Join / }).click();
    await expect(invitee).toHaveURL(new RegExp(`/t/${tenant.slug}/devices`));

    const me = await invitee.evaluate(async () => (await fetch("/api/v1/me")).json());
    expect(me.tenants.some((item: { id: string }) => item.id === tenant.id)).toBe(true);
    await inviteeContext.close();

    // Original case: "the UI invites a built-in role and the branded email
    // joins the tenant".
    const name = await tenantName(page, tenant.id);
    const uiEmail = uniqueEmail("ui-invitee");

    await openAdministrators(page, tenant.id);
    await expect(
      page.getByRole("heading", { name: "Invite an administrator", exact: true }),
    ).toBeVisible();

    await inviteThroughUi(page, uiEmail, "builtin:member");
    await expect(page.getByText("Email sent", { exact: true })).toBeVisible();
    await expect(page.getByText(/Sent to/).filter({ hasText: uiEmail })).toContainText("Member");

    const message = invitationEmails(await mailbox(page), uiEmail)[0];
    const link = await latestInvitationLink(page, uiEmail);

    expect(message).toBeDefined();
    expect(message.subject).toBe(`Join ${name} on Mattrax`);
    expect(message.text).toContain("invited you to join");
    expect(message.text).toContain("as Member");
    expect(message.text).toContain(link);
    expect(message.html).toContain(name);

    const uiContext = await browser.newContext();
    const uiInvitee = await uiContext.newPage();

    try {
      await register(uiInvitee, { email: uiEmail, name: "UI Invitee" });
      await gotoHydrated(uiInvitee, link);
      await expect(
        uiInvitee.getByRole("heading", { name: `Join ${name}`, exact: true }),
      ).toBeVisible();
      await expect(uiInvitee.getByText(maskEmail(uiEmail), { exact: true })).toBeVisible();
      await uiInvitee.getByRole("button", { name: `Join ${name}`, exact: true }).click();
      await expect(uiInvitee).toHaveURL(new RegExp(`/t/${tenant.slug}/devices`));

      const uiMe = await uiInvitee.evaluate(async () => (await fetch("/api/v1/me")).json());
      const membership = uiMe.tenants.find((item: { id: string }) => item.id === tenant.id);

      expect(membership).toMatchObject({ roleName: "Member" });
    } finally {
      await uiContext.close();
    }

    // Original case: "a custom-role invitation carries roleId and joins with
    // that role".
    const customEmail = uniqueEmail("custom-invitee");
    const roleName = `Device reviewer ${randomUUID().slice(0, 6)}`;

    const role = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/roles`, {
      method: "POST",
      body: JSON.stringify({
        name: roleName,
        description: "Read devices only",
        permissions: ["tenant.read", "devices.read"],
      }),
    });

    await openAdministrators(page, tenant.id);
    // Keep the UI coverage that the new role is offered as an assignable
    // option, but send the invitation through the API: the picker's Solid
    // signal can still hold "Member" after selectOption changes the DOM, which
    // silently submits the wrong role under a loaded (two-worker) shard.
    await expect(
      page.getByLabel("Invitation role").locator(`option[value="role:${role.id}"]`),
    ).toHaveText(roleName);
    await api<{ inviteUrl: string }>(page, `/api/v1/tenants/${tenant.id}/invitations`, {
      method: "POST",
      body: JSON.stringify({ email: customEmail, role: "member", roleId: role.id }),
    });

    const created = await invitationFor(page, tenant.id, customEmail);

    expect(created).toMatchObject({ roleId: role.id, roleName });

    const customLink = await latestInvitationLink(page, customEmail);
    const customContext = await browser.newContext();
    const customInvitee = await customContext.newPage();

    try {
      await register(customInvitee, { email: customEmail, name: "Custom Invitee" });
      await gotoHydrated(customInvitee, customLink);
      await expect(customInvitee.getByText(roleName, { exact: true })).toBeVisible();
      await customInvitee.getByRole("button", { name: `Join ${name}`, exact: true }).click();
      await expect(customInvitee).toHaveURL(new RegExp(`/t/${tenant.slug}/devices`));

      const customMe = await customInvitee.evaluate(
        async () => (await fetch("/api/v1/me")).json(),
      );

      expect(customMe.tenants.find((item: { id: string }) => item.id === tenant.id)).toMatchObject({
        roleName,
        roleKind: "custom",
      });
    } finally {
      await customContext.close();
    }

    // Original case: "a read-only administrator does not see the invite form".
    const gatedEmail = uniqueEmail("gated-member");

    const gatedInvitation = await api<{ inviteUrl: string }>(
      page,
      `/api/v1/tenants/${tenant.id}/invitations`,
      { method: "POST", body: JSON.stringify({ email: gatedEmail, role: "member" }) },
    );

    const administratorContext = await browser.newContext();
    const administrator = await administratorContext.newPage();

    try {
      await register(administrator, { email: gatedEmail, name: "Read Only Administrator" });
      await gotoHydrated(administrator, gatedInvitation.inviteUrl);
      await administrator.getByRole("button", { name: /^Join / }).click();
      await expect(administrator).toHaveURL(new RegExp(`/t/${tenant.slug}/devices`));

      await openAdministrators(administrator, tenant.id);
      await expect(
        administrator.getByRole("heading", { name: "Current administrators", exact: true }),
      ).toBeVisible();
      await expect(
        administrator.getByRole("heading", { name: "Invite an administrator", exact: true }),
      ).toHaveCount(0);
      await expect(
        administrator.getByRole("button", { name: "Send invitation", exact: true }),
      ).toHaveCount(0);
    } finally {
      await administratorContext.close();
    }
  });

  test("resend, cancellation, signed-out preview and conflict handling", async ({
    page,
    browser,
  }) => {
    const { tenant } = await bootstrapSession(page, "Invite Rotate");

    // Original case: "resend rotates the link and cancel invalidates it".
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
      await expect(invitee).toHaveURL(new RegExp(`/t/${tenant.slug}/devices`));
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

    // Original case: "signed-out preview shows tenant details and a wrong
    // account can switch".
    const name = await tenantName(page, tenant.id);
    const previewEmail = uniqueEmail("preview-invitee");

    const previewInvitation = await api<{ inviteUrl: string }>(
      page,
      `/api/v1/tenants/${tenant.id}/invitations`,
      { method: "POST", body: JSON.stringify({ email: previewEmail, role: "auditor" }) },
    );

    const anonymousContext = await browser.newContext();
    const anonymous = await anonymousContext.newPage();

    try {
      await gotoHydrated(anonymous, previewInvitation.inviteUrl);

      await expect(anonymous.getByRole("heading", { name: `Join ${name}` })).toBeVisible();
      await expect(anonymous.getByText(name, { exact: true }).first()).toBeVisible();
      await expect(anonymous.getByText("Auditor", { exact: true })).toBeVisible();
      await expect(anonymous.getByText(maskEmail(previewEmail), { exact: true })).toBeVisible();
      await expect(
        anonymous.getByRole("link", { name: "Sign in", exact: true }),
      ).toHaveAttribute("href", /returnTo=%2Faccept-invitation%3Ftoken%3D/);
      await expect(
        anonymous.getByRole("link", { name: "Create account", exact: true }),
      ).toHaveAttribute("href", /returnTo=%2Faccept-invitation%3Ftoken%3D/);

      // The bearer token must not linger in the visible address bar.
      expect(new URL(anonymous.url()).searchParams.get("token")).toBeNull();

      const wrongEmail = uniqueEmail("wrong-account");

      await register(anonymous, { email: wrongEmail, name: "Wrong Account" });
      await gotoHydrated(anonymous, previewInvitation.inviteUrl);

      await expect(anonymous.getByRole("heading", { name: "Wrong account" })).toBeVisible();
      await expect(anonymous.getByText(wrongEmail, { exact: true })).toBeVisible();
      await expect(anonymous.getByText(maskEmail(previewEmail), { exact: true }).first()).toBeVisible();

      await anonymous.getByRole("button", { name: "Switch account" }).click();
      await expect(anonymous).toHaveURL(/\/login\?returnTo=/);

      const returnTo = new URL(anonymous.url()).searchParams.get("returnTo");

      expect(returnTo).toBe(`/accept-invitation?token=${tokenOf(previewInvitation.inviteUrl)}`);
    } finally {
      await anonymousContext.close();
    }

    // Original case: "the invite form surfaces an existing-administrator
    // conflict".
    const owner = await api<{ account: { email: string } }>(page, "/api/v1/me");

    await openAdministrators(page, tenant.id);
    await inviteThroughUi(page, owner.account.email, "builtin:member");

    await expect(
      page
        .getByRole("region", { name: "Invite an administrator" })
        .getByRole("alert")
        .filter({ hasText: /conflicts with something that already exists/i }),
    ).toBeVisible();
    await expect(page.getByText("Email sent", { exact: true })).toHaveCount(0);
  });
});
