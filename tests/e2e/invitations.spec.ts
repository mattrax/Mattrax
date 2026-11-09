import { expect, test } from "@playwright/test";
import { api, bootstrapTenant, PASSWORD, register } from "./helpers";

test.describe("invitations", () => {
  test("an invited user joins the tenant through the invite link", async ({ page, context }) => {
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

    const invitee = await context.newPage();
    await register(invitee, { email, name: "Invited User" });
    await invitee.goto(invitation.inviteUrl, { waitUntil: "networkidle" });
    await expect(invitee).toHaveURL(new RegExp(`/t/${tenant.id}/devices`));

    const me = await invitee.evaluate(async () => (await fetch("/api/v1/me")).json());
    expect(me.tenants.some((item: { id: string }) => item.id === tenant.id)).toBe(true);
    await invitee.close();
  });
});
