import { describe, expect, it } from "vitest";
import type { OutboundEmailMessage } from "@mattrax/enterprise-backend";
import { mailerReadiness, selectMailer, type MailerEnv } from "./mailer.js";

const HOSTED_ORIGIN = "https://e.mattrax.app";

const environment = (overrides: Partial<MailerEnv> = {}): MailerEnv => ({
  ORIGIN: HOSTED_ORIGIN,
  ...overrides,
});

const fakeBinding = () => {
  const sent: OutboundEmailMessage[] = [];

  const binding = {
    send: async (message: OutboundEmailMessage) => {
      sent.push(message);

      return { messageId: "test" };
    },
  };

  // SAFETY: the adapter only calls the structured `send` overload, which the fake implements.
  return { sent, binding: binding as SendEmail };
};

describe("mailer selection", () => {
  it("reports skipped when the deployment opts out", () => {
    const selection = selectMailer(environment({ MATTRAX_EMAIL_DISABLED: "1" }));

    expect(selection.state).toBe("skipped");
    expect(selection.transport).toBeUndefined();
    expect(mailerReadiness(selection)).toBe("skipped");
  });

  it("uses the local mailbox on a loopback dev origin", () => {
    const selection = selectMailer(
      environment({ ORIGIN: "http://localhost:9050", DEV_MAILBOX: "true" }),
    );

    expect(selection.state).toBe("ok");
    expect(selection.transport?.local).toBe(true);
    expect(mailerReadiness(selection)).toBe("ok");
  });

  it("defaults to the Cloudflare email binding", async () => {
    const { binding, sent } = fakeBinding();
    const selection = selectMailer(environment({ EMAIL: binding }));

    expect(selection).toMatchObject({ state: "ok", detail: "Cloudflare Email" });
    expect(selection.sender).toEqual({ name: "Mattrax", email: "hello@mattrax.cloud" });
    expect(mailerReadiness(selection)).toBe("ok");

    await selection.transport!.send({
      to: "invitee@example.com",
      from: selection.sender,
      replyTo: { name: "Support", email: "help@mattrax.cloud" },
      subject: "Hello",
      text: "Body",
    });

    expect(sent[0]).toMatchObject({
      to: "invitee@example.com",
      replyTo: { name: "Support", email: "help@mattrax.cloud" },
    });
  });

  it("rejects a malformed MAIL_FROM instead of sending as the built-in address", () => {
    const selection = selectMailer(
      environment({ EMAIL: fakeBinding().binding, MAIL_FROM: "not-an-address" }),
    );

    expect(selection).toMatchObject({ state: "error" });
    expect(() => mailerReadiness(selection)).toThrow(/MAIL_FROM is not a valid email address/);
  });

  it("fails readiness when no transport exists", () => {
    const selection = selectMailer(environment());

    expect(selection.state).toBe("error");
    expect(() => mailerReadiness(selection)).toThrow(/no outbound email transport/);
  });

  it("selects Resend with a verified sender", () => {
    const selection = selectMailer(
      environment({
        MATTRAX_EMAIL_DISABLED: undefined,
        MAIL_TRANSPORT: "resend",
        MAIL_FROM: "Mattrax <notifications@example.com>",
        RESEND_API_KEY: "re_test",
      }),
    );

    expect(selection).toMatchObject({ state: "ok", detail: "Resend" });
    expect(selection.sender).toEqual({ name: "Mattrax", email: "notifications@example.com" });
  });

  it("requires MAIL_FROM and a provider key", () => {
    expect(
      selectMailer(environment({ MAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_test" })),
    ).toMatchObject({ state: "error" });

    expect(
      selectMailer(environment({ MAIL_TRANSPORT: "resend", MAIL_FROM: "a@example.com" })),
    ).toMatchObject({ state: "error" });

    expect(
      selectMailer(
        environment({
          MAIL_TRANSPORT: "postmark",
          MAIL_FROM: "a@example.com",
          POSTMARK_SERVER_TOKEN: "token",
        }),
      ),
    ).toMatchObject({ state: "ok", detail: "Postmark" });
  });

  it("selects the SMTP relay only with a real secret", () => {
    const base = {
      MAIL_TRANSPORT: "smtp",
      MAIL_FROM: "a@example.com",
      MAIL_RELAY_URL: "http://mail-relay:8790",
    };

    expect(selectMailer(environment(base))).toMatchObject({ state: "error" });
    expect(selectMailer(environment({ ...base, MAIL_RELAY_SECRET: "short" }))).toMatchObject({
      state: "error",
    });
    expect(
      selectMailer(environment({ ...base, MAIL_RELAY_SECRET: "a-long-enough-secret" })),
    ).toMatchObject({ state: "ok", detail: "SMTP relay" });
  });

  it("probes the self-hosted relay during readiness", async () => {
    const probed: string[] = [];

    const selection = selectMailer(
      environment({
        MAIL_TRANSPORT: "smtp",
        MAIL_FROM: "a@example.com",
        MAIL_RELAY_URL: "http://mail-relay:8790/",
        MAIL_RELAY_SECRET: "a-long-enough-secret",
      }),
      {
        // SAFETY: the probe only uses the standard fetch signature this fake implements.
        fetch: (async (input: RequestInfo | URL) => {
          probed.push(String(input));

          return new Response("{}", { status: 200 });
        }) as typeof globalThis.fetch,
      },
    );

    expect(selection.probe).toBeDefined();
    await selection.probe!();

    expect(probed).toEqual(["http://mail-relay:8790/health"]);
  });

  it("prefers an explicit provider over the Cloudflare binding", () => {
    const { binding } = fakeBinding();

    const selection = selectMailer(
      environment({
        EMAIL: binding,
        MAIL_TRANSPORT: "resend",
        MAIL_FROM: "a@example.com",
        RESEND_API_KEY: "re_test",
      }),
    );

    expect(selection.detail).toBe("Resend");
  });

  it("rejects an unknown transport and a missing Cloudflare binding", () => {
    expect(
      selectMailer(environment({ MAIL_TRANSPORT: "carrier-pigeon", MAIL_FROM: "a@example.com" })),
    ).toMatchObject({ state: "error" });
    expect(selectMailer(environment({ MAIL_TRANSPORT: "cloudflare" }))).toMatchObject({
      state: "error",
    });
  });
});
