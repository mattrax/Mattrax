import { createServer, type Server } from "node:net";
import { describe, expect, it } from "vitest";
import type { OutboundEmailMessage } from "../src/email.ts";
import { buildMimeMessage, dotStuff, sendSmtpMail } from "../src/smtp.ts";

interface SmtpServerOptions {
  rejectAuth?: boolean;
  user?: string;
  password?: string;
}

interface CapturedTransaction {
  lines: string[];
  auth: string[];
}

interface RunningSmtpServer {
  server: Server;
  port: number;
  captured: CapturedTransaction;
  close: () => Promise<void>;
}

/**
 * Minimal SMTP server for the relay's protocol tests. It advertises AUTH PLAIN
 * and records the DATA section so the test can assert dot-stuffing, headers and
 * the base64 bodies.
 */
const startSmtpServer = async (options: SmtpServerOptions = {}): Promise<RunningSmtpServer> => {
  const captured: CapturedTransaction = { lines: [], auth: [] };

  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    let inData = false;

    socket.write("220 test.example ESMTP\r\n");

    socket.on("data", (chunk: string) => {
      buffer += chunk;

      let index = buffer.indexOf("\r\n");

      while (index !== -1) {
        const line = buffer.slice(0, index);

        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\r\n");

        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write("250 queued\r\n");
          } else {
            captured.lines.push(line);
          }

          continue;
        }

        const upper = line.toUpperCase();

        if (upper.startsWith("EHLO"))
          socket.write("250-test.example\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 102400\r\n");
        else if (upper.startsWith("AUTH PLAIN")) {
          captured.auth.push(line.slice("AUTH PLAIN ".length));
          socket.write(
            `${options.rejectAuth ? 535 : 235} authentication ${options.rejectAuth ? "failed" : "ok"}\r\n`,
          );
        } else if (upper.startsWith("AUTH LOGIN")) socket.write("334 VXNlcm5hbWU6\r\n");
        else if (options.user && line === Buffer.from(options.user).toString("base64"))
          socket.write("334 UGFzc3dvcmQ6\r\n");
        else if (options.password && line === Buffer.from(options.password).toString("base64"))
          socket.write("235 authentication ok\r\n");
        else if (upper.startsWith("MAIL FROM")) socket.write("250 ok\r\n");
        else if (upper.startsWith("RCPT TO")) socket.write("250 ok\r\n");
        else if (upper === "DATA") {
          inData = true;
          socket.write("354 end with a line containing a single dot\r\n");
        } else if (upper === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else socket.write("502 command not implemented\r\n");
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- address() returns a string only for pipe/net servers; this test always listens on TCP.
  if (address === null || typeof address === "string")
    throw new Error("expected the test server to listen on a TCP port");

  return {
    server,
    port: address.port,
    captured,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

const message = {
  to: ["newhire@example.com", "owner@example.com"],
  from: { name: "Mattrax", email: "hello@example.com" },
  replyTo: { name: "Support", email: "support@example.com" },
  subject: "Join Acme on Mattrax",
  text: "Hello,\n\n.leading dot is preserved",
  html: "<p>Hello</p>",
} satisfies OutboundEmailMessage;

describe("mail relay SMTP client", () => {
  it("delivers a multipart message with dot-stuffing and AUTH PLAIN", async () => {
    const smtp = await startSmtpServer();

    try {
      const result = await sendSmtpMail(
        { host: "127.0.0.1", port: smtp.port, user: "relay", password: "hunter2" },
        message,
      );

      expect(result).toEqual({ recipients: 2 });

      const lines = smtp.captured.lines.join("\n");
      expect(lines).toContain('From: "Mattrax" <hello@example.com>');
      expect(lines).toContain("To: newhire@example.com, owner@example.com");
      expect(lines).toContain('Reply-To: "Support" <support@example.com>');
      expect(lines).toContain("Subject: Join Acme on Mattrax");
      expect(lines).toContain('Content-Type: multipart/alternative; boundary="mattrax-');
      // Bodies are base64 so the wire stays 7-bit; the text survives intact.
      expect(lines).toContain(Buffer.from(message.text, "utf8").toString("base64").slice(0, 24));
      expect(Buffer.from(smtp.captured.auth[0], "base64").toString("utf8")).toBe(
        "\u0000relay\u0000hunter2",
      );
    } finally {
      await smtp.close();
    }
  });

  it("rejects a response that is not a delivery acknowledgement", async () => {
    const smtp = await startSmtpServer({ rejectAuth: true });

    try {
      await expect(
        sendSmtpMail(
          { host: "127.0.0.1", port: smtp.port, user: "relay", password: "wrong" },
          message,
        ),
      ).rejects.toThrow("SMTP AUTH failed with status 535");
    } finally {
      await smtp.close();
    }
  });

  it("does not open a connection for an invalid address", async () => {
    await expect(
      sendSmtpMail(
        { host: "127.0.0.1", port: 1, timeoutMs: 1_000 },
        { ...message, to: ["not-an-address"] },
      ),
    ).rejects.toThrow("invalid recipient address");
  });
});

describe("mail relay MIME rendering", () => {
  it("encodes a non-ASCII subject and base64 bodies", () => {
    const rendered = buildMimeMessage({ ...message, subject: "Grüße", html: undefined });

    expect(rendered).toContain("Subject: =?UTF-8?B?R3LDvMOfZQ==?=");
    expect(rendered).toContain('Content-Type: text/plain; charset="utf-8"');
    expect(rendered).toContain(Buffer.from(message.text, "utf8").toString("base64").slice(0, 24));
  });

  it("stuffs a leading dot so the terminator cannot be forged", () => {
    expect(dotStuff("first\r\n.\r\nsecond")).toBe("first\r\n..\r\nsecond");
    expect(dotStuff("no dots")).toBe("no dots");
  });

  it("refuses a message with no body", () => {
    expect(() => buildMimeMessage({ ...message, text: undefined, html: undefined })).toThrow(
      "a text or html body is required",
    );
  });
});
