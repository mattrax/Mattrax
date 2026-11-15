import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_FROM,
  formatEmailAddress,
  mailRelayTransport,
  parseEmailSender,
  postmarkEmailTransport,
  resendEmailTransport,
} from "../src/email.js";

const message = {
  to: ["invitee@example.com", "owner@example.com"],
  from: { name: "Acme Corp", email: "notifications@acme.test" },
  replyTo: { name: "Acme Support", email: "help@acme.test" },
  subject: "Join Acme on Mattrax",
  text: "Accept the invitation",
  html: "<p>Accept the invitation</p>",
};

type Captured = {
  url: string;
  init: RequestInit;
  body: unknown;
};

const capture = (status = 200) => {
  const requests: Captured[] = [];

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      init: init ?? {},
      body: JSON.parse(String(init?.body ?? "{}")),
    });

    return new Response("{}", { status });
  };

  // SAFETY: the adapters only use the standard fetch signature this fake implements.
  return { requests, fetch: fetchImpl as typeof globalThis.fetch };
};

describe("sender parsing", () => {
  it("accepts a bare address, an angled name and a quoted name", () => {
    expect(parseEmailSender("hello@example.com")).toEqual({
      name: "Mattrax",
      email: "hello@example.com",
    });
    expect(parseEmailSender("Mattrax <hello@example.com>")).toEqual({
      name: "Mattrax",
      email: "hello@example.com",
    });
    expect(parseEmailSender('"Acme, Inc." <hello@example.com>')).toEqual({
      name: "Acme, Inc.",
      email: "hello@example.com",
    });
    expect(parseEmailSender("  hello@example.com  ")).toEqual({
      name: DEFAULT_EMAIL_FROM.name,
      email: "hello@example.com",
    });
  });

  it("rejects values that would break an envelope", () => {
    expect(parseEmailSender(undefined)).toBeNull();
    expect(parseEmailSender("")).toBeNull();
    expect(parseEmailSender("not-an-address")).toBeNull();
    expect(parseEmailSender("A <not-an-address>")).toBeNull();
    // Newlines are collapsed so a display name cannot inject a header.
    expect(parseEmailSender("Acme\r\nBcc: victim@example.com <hello@example.com>")).toEqual({
      name: "Acme Bcc: victim@example.com",
      email: "hello@example.com",
    });
  });

  it("formats an address for a provider API", () => {
    expect(formatEmailAddress({ name: "Acme", email: "a@b.test" })).toBe('"Acme" <a@b.test>');
    // Tenant branding can contain commas; quoting keeps it one mailbox.
    expect(formatEmailAddress({ name: "Acme, Inc.", email: "a@b.test" })).toBe(
      '"Acme, Inc." <a@b.test>',
    );
  });
});

describe("Resend transport", () => {
  it("posts the rendered message and keeps Reply-To structured", async () => {
    const remote = capture();
    const transport = resendEmailTransport({ apiKey: "re_test", fetch: remote.fetch });

    await transport.send(message);

    expect(remote.requests).toHaveLength(1);
    expect(remote.requests[0]!.url).toBe("https://api.resend.com/emails");
    expect(remote.requests[0]!.init.headers).toMatchObject({
      authorization: "Bearer re_test",
      "content-type": "application/json",
    });
    expect(remote.requests[0]!.body).toMatchObject({
      from: '"Acme Corp" <notifications@acme.test>',
      to: ["invitee@example.com", "owner@example.com"],
      subject: "Join Acme on Mattrax",
      text: "Accept the invitation",
      html: "<p>Accept the invitation</p>",
      reply_to: '"Acme Support" <help@acme.test>',
    });
  });

  it("throws a status-only error that cannot leak the key or recipient", async () => {
    const remote = capture(503);
    const transport = resendEmailTransport({ apiKey: "re_secret", fetch: remote.fetch });

    await expect(transport.send(message)).rejects.toThrow(
      "Resend rejected the message with status 503",
    );
  });
});

describe("Postmark transport", () => {
  it("posts the message with the server token header", async () => {
    const remote = capture();

    const transport = postmarkEmailTransport({
      apiKey: "postmark-token",
      fetch: remote.fetch,
      messageStream: "broadcast",
    });

    await transport.send(message);

    expect(remote.requests[0]!.url).toBe("https://api.postmarkapp.com/email");
    expect(remote.requests[0]!.init.headers).toMatchObject({
      "x-postmark-server-token": "postmark-token",
    });
    expect(remote.requests[0]!.body).toMatchObject({
      From: '"Acme Corp" <notifications@acme.test>',
      To: "invitee@example.com, owner@example.com",
      Subject: "Join Acme on Mattrax",
      TextBody: "Accept the invitation",
      HtmlBody: "<p>Accept the invitation</p>",
      ReplyTo: '"Acme Support" <help@acme.test>',
      MessageStream: "broadcast",
    });
  });
});

describe("self-hosted mail relay transport", () => {
  it("posts to /send with a bearer secret and normalises the base URL", async () => {
    const remote = capture();

    const transport = mailRelayTransport({
      url: "http://mail-relay:8790/",
      secret: "a-very-long-shared-secret",
      fetch: remote.fetch,
    });

    await transport.send(message);

    expect(remote.requests[0]!.url).toBe("http://mail-relay:8790/send");
    expect(remote.requests[0]!.init.headers).toMatchObject({
      authorization: "Bearer a-very-long-shared-secret",
    });
    expect(remote.requests[0]!.body).toEqual({
      to: ["invitee@example.com", "owner@example.com"],
      from: { name: "Acme Corp", email: "notifications@acme.test" },
      replyTo: { name: "Acme Support", email: "help@acme.test" },
      subject: "Join Acme on Mattrax",
      text: "Accept the invitation",
      html: "<p>Accept the invitation</p>",
    });

    const rejected = mailRelayTransport({
      url: "http://mail-relay:8790",
      secret: "a-very-long-shared-secret",
      fetch: capture(502).fetch,
    });

    await expect(rejected.send(message)).rejects.toThrow(
      "Mail relay rejected the message with status 502",
    );
  });
});
