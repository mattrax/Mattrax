import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit } from "effect";
import type { OutboundEmailMessage } from "@mattrax/email";
import { mailerReadiness, selectMailer } from "./mailer.js";
import type { MailerEnv, SendEmail } from "./mailer.js";

const HOSTED_ORIGIN = "https://e.mattrax.app";

const environment = (overrides: Partial<MailerEnv> = {}): MailerEnv => ({
  ORIGIN: HOSTED_ORIGIN,
  ...overrides,
});

const asEmailBinding = (binding: {
  send(message: OutboundEmailMessage): Promise<{ messageId: string }>;
}): SendEmail =>
  // SAFETY: the adapter only calls the structured `send` overload, which the binding implements.
  binding as SendEmail;

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

    await Effect.runPromise(
      selection.transport!.send({
        to: "invitee@example.com",
        from: selection.sender,
        replyTo: { name: "Support", email: "help@mattrax.cloud" },
        subject: "Hello",
        text: "Body",
      }),
    );

    expect(sent[0]).toMatchObject({
      to: "invitee@example.com",
      replyTo: { name: "Support", email: "help@mattrax.cloud" },
    });
  });

  it("reports a binding failure as an EmailFailure", async () => {
    const binding = {
      send: async () => {
        throw new Error("binding rejected the message");
      },
    };

    const selection = selectMailer(environment({ EMAIL: asEmailBinding(binding) }));

    const result = await Effect.runPromiseExit(
      selection.transport!.send({
        to: "invitee@example.com",
        from: selection.sender,
        subject: "Hello",
        text: "Body",
      }),
    );

    const failure = Exit.match(result, {
      onFailure: (cause) => Cause.squash(cause),
      onSuccess: () => undefined,
    });

    expect(failure).toMatchObject({
      _tag: "EmailFailure",
      provider: "Cloudflare Email",
      message: "binding rejected the message",
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

  it("selects SMTP with a server and a verified sender", () => {
    const selection = selectMailer(
      environment({
        MAIL_TRANSPORT: "smtp",
        MAIL_FROM: "Mattrax <notifications@example.com>",
        MAIL_SMTP_HOST: "smtp.example.com",
        MAIL_SMTP_USER: "notifications@example.com",
        MAIL_SMTP_PASSWORD: "secret",
      }),
    );

    expect(selection).toMatchObject({ state: "ok", detail: "SMTP" });
    expect(selection.sender).toEqual({ name: "Mattrax", email: "notifications@example.com" });
  });

  it("requires the SMTP host and a sender", () => {
    expect(
      selectMailer(environment({ MAIL_TRANSPORT: "smtp", MAIL_FROM: "a@example.com" })),
    ).toMatchObject({ state: "error" });

    expect(
      selectMailer(environment({ MAIL_TRANSPORT: "smtp", MAIL_SMTP_HOST: "smtp.example.com" })),
    ).toMatchObject({ state: "error" });

    expect(
      selectMailer(
        environment({
          MAIL_TRANSPORT: "smtp",
          MAIL_FROM: "a@example.com",
          MAIL_SMTP_HOST: "smtp.example.com",
          MAIL_SMTP_PORT: "not-a-port",
        }),
      ),
    ).toMatchObject({ state: "error" });
  });

  it("prefers an explicit transport over the Cloudflare binding", () => {
    const { binding } = fakeBinding();

    const selection = selectMailer(
      environment({
        EMAIL: binding,
        MAIL_TRANSPORT: "smtp",
        MAIL_FROM: "a@example.com",
        MAIL_SMTP_HOST: "smtp.example.com",
      }),
    );

    expect(selection.detail).toBe("SMTP");
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
