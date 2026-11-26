import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { createSecureContext, createServer as createTlsServer, TLSSocket } from "node:tls";
import { Effect, Fiber, Logger } from "effect";
import { describe, expect, it } from "vitest";
import type { OutboundEmailMessage } from "./email.ts";
import { EmailFailure } from "./failure.ts";
import { buildMimeMessage, dotStuff, sendSmtpMail } from "./smtp.ts";
import { smtpTestCert as cert, smtpTestKey as key } from "./test-fixtures/smtp.ts";
const secureContext = createSecureContext({ key, cert });

interface SmtpServerOptions {
  advertiseStartTls?: boolean;
  startTlsStatus?: 220 | 454;
  /** Send plaintext after STARTTLS to model a failed TLS upgrade. */
  plaintextAfterStartTls?: boolean;
  implicitTls?: boolean;
  rejectAuth?: boolean;
  stallAfterEhlo?: boolean;
  onEhlo?: () => void;
  onSocketClose?: () => void;
}

interface CapturedTransaction {
  lines: string[];
  auth: string[];
  commands: string[];
  encryptedAuth: boolean;
}

interface RunningSmtpServer {
  server: Server;
  port: number;
  captured: CapturedTransaction;
  close: () => Promise<void>;
}

/**
 * Minimal SMTP server for protocol tests. It can strip STARTTLS, refuse the
 * upgrade, or complete a real TLS handshake so the client's security boundary
 * is exercised over a socket rather than mocked.
 */
const startSmtpServer = async (options: SmtpServerOptions = {}): Promise<RunningSmtpServer> => {
  const captured: CapturedTransaction = {
    lines: [],
    auth: [],
    commands: [],
    encryptedAuth: false,
  };
  const sockets = new Set<Socket>();

  const handleConnection = (initial: Socket) => {
    let socket = initial;
    let buffer = "";
    let inData = false;
    let loginStep: "username" | "password" | null = null;

    const attach = (next: Socket) => {
      socket = next;
      sockets.add(next);
      next.setEncoding("utf8");
      next.on("data", onData);
      next.on("error", () => undefined);
      next.on("close", () => {
        sockets.delete(next);
        options.onSocketClose?.();
      });
    };

    const onData = (chunk: string) => {
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
        captured.commands.push(line);

        if (upper.startsWith("EHLO")) {
          options.onEhlo?.();

          if (options.stallAfterEhlo) continue;

          const capabilities = ["250-test.example"];

          if (options.advertiseStartTls !== false) capabilities.push("250-STARTTLS");

          capabilities.push("250-AUTH PLAIN LOGIN", "250 SIZE 102400");
          socket.write(`${capabilities.join("\r\n")}\r\n`);
        } else if (upper === "STARTTLS") {
          if ((options.startTlsStatus ?? 220) !== 220) {
            socket.write("454 TLS unavailable\r\n");
            continue;
          }

          if (options.plaintextAfterStartTls) {
            socket.write("220 Ready to start TLS\r\n250-AUTH PLAIN LOGIN\r\n");
            continue;
          }

          socket.write("220 Ready to start TLS\r\n", () => {
            socket.off("data", onData);
            const secure = new TLSSocket(socket, { isServer: true, secureContext });
            attach(secure);
          });
        } else if (upper.startsWith("AUTH PLAIN")) {
          captured.auth.push(line.slice("AUTH PLAIN ".length));
          captured.encryptedAuth = socket instanceof TLSSocket;
          socket.write(
            `${options.rejectAuth ? 535 : 235} authentication ${options.rejectAuth ? "failed" : "ok"}\r\n`,
          );
        } else if (upper === "AUTH LOGIN") {
          loginStep = "username";
          captured.encryptedAuth = socket instanceof TLSSocket;
          socket.write("334 VXNlcm5hbWU6\r\n");
        } else if (loginStep === "username") {
          loginStep = "password";
          captured.auth.push(line);
          socket.write("334 UGFzc3dvcmQ6\r\n");
        } else if (loginStep === "password") {
          loginStep = null;
          captured.auth.push(line);
          socket.write("235 authentication ok\r\n");
        } else if (upper.startsWith("MAIL FROM")) socket.write("250 ok\r\n");
        else if (upper.startsWith("RCPT TO")) socket.write("250 ok\r\n");
        else if (upper === "DATA") {
          inData = true;
          socket.write("354 end with a line containing a single dot\r\n");
        } else if (upper === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else socket.write("502 command not implemented\r\n");
      }
    };

    attach(initial);
    socket.write("220 test.example ESMTP\r\n");
  };

  const server = options.implicitTls
    ? createTlsServer({ key, cert }, handleConnection)
    : createServer(handleConnection);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (address === null || typeof address === "string")
    throw new Error("expected the test server to listen on a TCP port");

  return {
    server,
    port: address.port,
    captured,
    close: () => {
      for (const socket of sockets) socket.destroy();

      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
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

const transportOptions = (
  smtp: RunningSmtpServer,
  overrides: Partial<Parameters<typeof sendSmtpMail>[0]> = {},
): Parameters<typeof sendSmtpMail>[0] => ({
  host: "127.0.0.1",
  port: smtp.port,
  user: "relay",
  password: "hunter2",
  rejectUnauthorized: false,
  timeoutMs: 2_000,
  ...overrides,
});

describe("mail relay SMTP client", () => {
  it("upgrades with STARTTLS before delivering a multipart message with AUTH PLAIN", async () => {
    const smtp = await startSmtpServer();

    try {
      const result = await Effect.runPromise(sendSmtpMail(transportOptions(smtp), message));

      expect(result).toEqual({ recipients: 2 });
      expect(smtp.captured.encryptedAuth).toBe(true);
      expect(smtp.captured.commands).toContain("STARTTLS");

      const lines = smtp.captured.lines.join("\n");
      expect(lines).toContain('From: "Mattrax" <hello@example.com>');
      expect(lines).toContain("To: newhire@example.com, owner@example.com");
      expect(lines).toContain('Reply-To: "Support" <support@example.com>');
      expect(lines).toContain("Subject: Join Acme on Mattrax");
      expect(lines).toContain('Content-Type: multipart/alternative; boundary="mattrax-');
      // Bodies are base64 so the wire stays 7-bit; the text survives intact.
      expect(lines).toContain(Buffer.from(message.text, "utf8").toString("base64").slice(0, 24));
      expect(Buffer.from(smtp.captured.auth[0]!, "base64").toString("utf8")).toBe(
        "\u0000relay\u0000hunter2",
      );
    } finally {
      await smtp.close();
    }
  });

  it("fails closed before AUTH when the server strips STARTTLS", async () => {
    const smtp = await startSmtpServer({ advertiseStartTls: false });

    try {
      const error = await Effect.runPromise(
        Effect.flip(sendSmtpMail(transportOptions(smtp), message)),
      );

      expect(error).toBeInstanceOf(EmailFailure);
      expect(error).toMatchObject({
        _tag: "EmailFailure",
        provider: "SMTP",
        message: expect.stringContaining("requires TLS"),
      });
      expect(smtp.captured.auth).toEqual([]);
      expect(smtp.captured.commands.some((line) => line.startsWith("AUTH"))).toBe(false);
      expect(smtp.captured.commands.some((line) => line.startsWith("MAIL FROM"))).toBe(false);
    } finally {
      await smtp.close();
    }
  });

  it("does not authenticate when STARTTLS is rejected", async () => {
    const smtp = await startSmtpServer({ startTlsStatus: 454 });

    try {
      await expect(
        Effect.runPromise(sendSmtpMail(transportOptions(smtp), message)),
      ).rejects.toMatchObject({
        _tag: "EmailFailure",
        message: "SMTP STARTTLS failed with status 454",
      });
      expect(smtp.captured.auth).toEqual([]);
    } finally {
      await smtp.close();
    }
  });

  it("does not authenticate when a STARTTLS handshake is replaced with plaintext", async () => {
    const smtp = await startSmtpServer({ plaintextAfterStartTls: true });

    try {
      await expect(
        Effect.runPromise(sendSmtpMail(transportOptions(smtp), message)),
      ).rejects.toMatchObject({ _tag: "EmailFailure" });
      expect(smtp.captured.auth).toEqual([]);
      expect(smtp.captured.commands.some((line) => line.startsWith("AUTH"))).toBe(false);
    } finally {
      await smtp.close();
    }
  });

  it("authenticates over implicit TLS", async () => {
    const smtp = await startSmtpServer({ implicitTls: true, advertiseStartTls: false });

    try {
      await Effect.runPromise(sendSmtpMail(transportOptions(smtp, { secure: true }), message));

      expect(smtp.captured.encryptedAuth).toBe(true);
      expect(smtp.captured.commands).not.toContain("STARTTLS");
    } finally {
      await smtp.close();
    }
  });

  it.each([
    { name: "implicit TLS", implicitTls: true, secure: true },
    { name: "STARTTLS", implicitTls: false, secure: false },
  ])("verifies certificates by default for $name", async ({ implicitTls, secure }) => {
    const smtp = await startSmtpServer({ implicitTls, advertiseStartTls: !implicitTls });

    try {
      await expect(
        Effect.runPromise(
          sendSmtpMail(transportOptions(smtp, { secure, rejectUnauthorized: undefined }), message),
        ),
      ).rejects.toMatchObject({
        _tag: "EmailFailure",
        message: expect.stringMatching(/self-signed certificate|unable to verify/i),
      });
      expect(smtp.captured.auth).toEqual([]);
    } finally {
      await smtp.close();
    }
  });

  it("allows unauthenticated plaintext delivery", async () => {
    const smtp = await startSmtpServer({ advertiseStartTls: false });

    try {
      await Effect.runPromise(
        sendSmtpMail(transportOptions(smtp, { user: undefined, password: undefined }), message),
      );

      expect(smtp.captured.auth).toEqual([]);
      expect(smtp.captured.commands).toContain("MAIL FROM:<hello@example.com>");
    } finally {
      await smtp.close();
    }
  });

  it("requires the explicit development override and logs a warning", async () => {
    const smtp = await startSmtpServer({ advertiseStartTls: false });
    const logs: string[] = [];
    const logger = Logger.make((options) => {
      logs.push(String(options.message));
    });

    try {
      await Effect.runPromise(
        sendSmtpMail(
          transportOptions(smtp, { allowInsecureAuth: "development-only" }),
          message,
        ).pipe(Effect.provide(Logger.layer([logger]))),
      );

      expect(smtp.captured.auth).toHaveLength(1);
      expect(logs.some((line) => line.includes("Insecure SMTP AUTH development override"))).toBe(
        true,
      );
    } finally {
      await smtp.close();
    }
  });

  it("rejects a response that is not a delivery acknowledgement", async () => {
    const smtp = await startSmtpServer({ rejectAuth: true });

    try {
      await expect(
        Effect.runPromise(sendSmtpMail(transportOptions(smtp), message)),
      ).rejects.toMatchObject({
        _tag: "EmailFailure",
        message: "SMTP AUTH failed with status 535",
      });
    } finally {
      await smtp.close();
    }
  });

  it("destroys the socket and cancels a pending response when interrupted", async () => {
    let sawEhlo!: () => void;
    let socketClosed!: () => void;
    const ehlo = new Promise<void>((resolve) => {
      sawEhlo = resolve;
    });
    const closed = new Promise<void>((resolve) => {
      socketClosed = resolve;
    });
    const smtp = await startSmtpServer({
      stallAfterEhlo: true,
      onEhlo: sawEhlo,
      onSocketClose: socketClosed,
    });

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(sendSmtpMail(transportOptions(smtp), message));
          yield* Effect.promise(() => ehlo);
          yield* Fiber.interrupt(fiber);
          yield* Fiber.await(fiber);
          yield* Effect.promise(() => closed);
        }),
      );

      expect(smtp.captured.auth).toEqual([]);
      expect(smtp.captured.commands.some((line) => line.startsWith("AUTH"))).toBe(false);
    } finally {
      await smtp.close();
    }
  });

  it("destroys the socket after a failed STARTTLS exchange", async () => {
    let socketClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      socketClosed = resolve;
    });
    const smtp = await startSmtpServer({ startTlsStatus: 454, onSocketClose: socketClosed });

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* Effect.flip(sendSmtpMail(transportOptions(smtp), message));
          yield* Effect.promise(() => closed);
        }),
      );
    } finally {
      await smtp.close();
    }
  });

  it("does not open a connection for an invalid address", async () => {
    await expect(
      Effect.runPromise(
        sendSmtpMail(
          { host: "127.0.0.1", port: 1, timeoutMs: 1_000 },
          { ...message, to: ["not-an-address"] },
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "EmailFailure",
      message: "invalid recipient address",
    });
  });
});

describe("mail relay MIME rendering", () => {
  it("encodes a non-ASCII subject and base64 bodies", () => {
    const rendered = buildMimeMessage({ ...message, subject: "Grüße", html: undefined });

    expect(rendered).toContain("Subject: =?UTF-8?B?R3LDvMOfZQ==?=");
    expect(rendered).toContain('Content-Type: text/plain; charset="utf-8"');
    expect(rendered).toContain(Buffer.from(message.text, "utf8").toString("base64").slice(0, 24));
  });

  it("writes an OTP-Token header so mail clients can offer the code", () => {
    const rendered = buildMimeMessage({ ...message, headers: { "OTP-Token": "123456" } });

    expect(rendered).toContain("\r\nOTP-Token: 123456\r\n");
    expect(rendered.indexOf("OTP-Token: 123456")).toBeLessThan(rendered.indexOf("\r\n\r\n"));
  });

  it("cannot inject a header name or value through custom headers", () => {
    const rendered = buildMimeMessage({
      ...message,
      headers: {
        "OTP-Token": "123456\r\nBcc: evil@example.com",
        "X-Test: Bcc": "evil@example.com",
        Subject: "Hijacked",
      },
    });

    expect(rendered).not.toMatch(/\r\nBcc:/);
    expect(rendered).not.toContain("X-Test: Bcc");
    expect(rendered).toContain("OTP-Token: 123456 Bcc: evil@example.com");
    // The caller may not replace the real Subject (or any builder-owned field).
    expect(rendered.match(/^Subject:/gm)).toHaveLength(1);
    expect(rendered).toContain("Subject: Join Acme on Mattrax");
  });

  it("wraps a report attachment in multipart/mixed", () => {
    const contentBase64 = Buffer.from("Report,Fleet digest\r\n", "utf8").toString("base64");

    const rendered = buildMimeMessage({
      ...message,
      attachments: [
        { filename: "fleet-digest.csv", contentType: "text/csv; charset=utf-8", contentBase64 },
      ],
    });

    expect(rendered).toContain('Content-Type: multipart/mixed; boundary="mattrax-');
    expect(rendered).toContain('Content-Type: multipart/alternative; boundary="mattrax-');
    expect(rendered).toContain('Content-Disposition: attachment; filename="fleet-digest.csv"');
    expect(rendered).toContain('Content-Type: text/csv; charset=utf-8; name="fleet-digest.csv"');
    expect(rendered).toContain(contentBase64);
  });

  it("cannot inject a header through an attachment filename", () => {
    const rendered = buildMimeMessage({
      ...message,
      attachments: [
        {
          filename: "report\r\nBcc: evil@example.com.csv",
          contentType: "application/octet-stream",
          contentBase64: "eA==",
        },
      ],
    });

    // The newline is flattened, so the value stays inside the filename header
    // instead of becoming a second header.
    expect(rendered).not.toMatch(/\r\nBcc:/);
    expect(rendered).toContain('filename="report Bcc: evil@example.com.csv"');
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
