import { describe, expect, it } from "vitest";
import { makeEmailTransport } from "@mattrax/enterprise-backend";
import type { OutboundEmailMessage } from "@mattrax/email";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const makeContext = () => {
  const db = makeDb();
  const sent: OutboundEmailMessage[] = [];

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    // SAFETY: these tests never reach R2 or the auth service.
    storage: {} as any,
    auth: {} as any,
    authSecret: "deployment-branding-test-secret",
    email: makeEmailTransport(async (message) => void sent.push(message), { local: true }),
    branding: {
      brandName: "Acme Device Management",
      brandColor: "#16a34a",
      logoUrl: "/assets/acme.png",
    },
  });

  return { db, service, sent };
};

describe("deployment branding in account email", () => {
  it("brands the guest registration verification code", async () => {
    const { service, sent } = makeContext();

    await runEffect(
      service.requestRegistrationCode(request(), {
        name: "Ada",
        email: "ada@example.com",
      }),
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Your Mattrax verification code");
    expect(sent[0].html).toContain("Acme Device Management</td>");
    expect(sent[0].html).toContain('src="https://enterprise.test/assets/acme.png"');
    expect(sent[0].html).toContain("background:#16a34a;");
    expect(sent[0].html).toContain("color:#1c1917;");
  });
});
