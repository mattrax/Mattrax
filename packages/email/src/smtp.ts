import { randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import { hostname } from "node:os";
import { connect as connectNet, isIP } from "node:net";
import type { Socket } from "node:net";
import { connect as connectTls } from "node:tls";

import type { OutboundEmailMessage } from "./email.ts";
import { describeEmailFailure, EmailFailure } from "./failure.ts";

/**
 * Minimal SMTP client for the self-hosted mailer.
 *
 * Supports only what transactional mail needs: EHLO, optional STARTTLS,
 * AUTH PLAIN/LOGIN, one envelope with several recipients and a
 * multipart/alternative body. It runs on `node:net`/`node:tls`, which work in
 * Node and in Workers with `nodejs_compat`, so the same implementation serves
 * the Node entry point and the Cloudflare Worker.
 */

const CRLF = "\r\n";

const DEFAULT_TIMEOUT_MS = 20_000;

const recipientsOf = (to: string | ReadonlyArray<string>): string[] =>
  Schema.is(Schema.String)(to) ? [to] : [...to];

/** Everything needed to reach and authenticate against the operator's SMTP server. */
export interface SmtpTransportOptions {
  host: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;
  rejectUnauthorized?: boolean;
  /** Trust these certificate authorities when verifying TLS. */
  ca?: string | ReadonlyArray<string>;
  /** Explicit development-only escape hatch for servers without STARTTLS. */
  allowInsecureAuth?: "development-only";
  helo?: string;
  timeoutMs?: number;
}

export interface SmtpResponse {
  code: number;
  text: string;
}

interface PendingResponse {
  resolve: (response: SmtpResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  cleanup: () => void;
}

interface SmtpConnection {
  socket: Socket;
  channel: Channel;
}

/** SMTP line-oriented reader. One response may span several lines. */
class Channel {
  private buffer = "";
  private pending: PendingResponse | null = null;
  private failure: Error | null = null;
  private readonly timeoutMs: number;
  private socket!: Socket;
  private onData!: (chunk: string) => void;
  private onError!: (error: Error) => void;
  private onClose!: () => void;

  constructor(socket: Socket, timeoutMs: number) {
    this.timeoutMs = timeoutMs;
    this.attach(socket);
  }

  attach(socket: Socket): void {
    this.detach();
    this.socket = socket;
    this.buffer = "";
    this.failure = null;
    socket.setEncoding("utf8");
    socket.setTimeout(this.timeoutMs, () => {
      this.fail(new Error("SMTP connection timed out"));
      socket.destroy();
    });

    this.onData = (chunk: string) => {
      this.buffer += chunk;
      this.pump();
    };

    this.onError = (error: Error) => this.fail(error);
    this.onClose = () => this.fail(new Error("SMTP connection closed"));

    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("close", this.onClose);
  }

  detach(): void {
    const socket = this.socket;

    if (!socket) return;

    socket.off("data", this.onData);
    socket.off("error", this.onError);
    socket.off("close", this.onClose);
    socket.setTimeout(0);

    const pending = this.pending;

    if (!pending) return;

    this.pending = null;
    clearTimeout(pending.timer);
    pending.cleanup();
    pending.reject(new Error("SMTP connection detached"));
  }

  fail(error: Error): void {
    this.failure ??= error;

    const pending = this.pending;

    if (!pending) return;

    this.pending = null;
    clearTimeout(pending.timer);
    pending.cleanup();
    pending.reject(error);
  }

  /** Complete the oldest response once its terminating line has arrived. */
  private pump(): void {
    const pending = this.pending;

    if (!pending) return;

    let offset = 0;
    const lines: string[] = [];

    while (true) {
      const end = this.buffer.indexOf(CRLF, offset);

      if (end === -1) return;

      const line = this.buffer.slice(offset, end);

      lines.push(line);
      offset = end + CRLF.length;

      if (!/^\d{3} /.test(line)) continue;

      this.buffer = this.buffer.slice(offset);
      this.pending = null;
      clearTimeout(pending.timer);
      pending.cleanup();
      pending.resolve({
        code: Number(line.slice(0, 3)),
        text: lines.map((item) => item.slice(4)).join("\n"),
      });

      return;
    }
  }

  read(signal: AbortSignal): Promise<SmtpResponse> {
    if (signal.aborted) return Promise.reject(abortError());
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending) return Promise.reject(new Error("SMTP command already in flight"));

    return new Promise<SmtpResponse>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(
        () => this.fail(new Error("SMTP server did not respond")),
        this.timeoutMs,
      );
      const onAbort = () => {
        this.fail(abortError());
        this.socket.destroy();
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.pending = null;
        callback();
      };

      timer.unref();
      signal.addEventListener("abort", onAbort, { once: true });
      this.pending = {
        resolve: (response) => finish(() => resolve(response)),
        reject: (error) => finish(() => reject(error)),
        timer,
        cleanup,
      };
      this.pump();
    });
  }

  write(line: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError());

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        this.socket.destroy();
        finish(() => reject(abortError()));
      };
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };

      signal.addEventListener("abort", onAbort, { once: true });
      this.socket.write(line + CRLF, (error) => finish(() => (error ? reject(error) : resolve())));
    });
  }

  async command(line: string, expected: number[], signal: AbortSignal): Promise<SmtpResponse> {
    await this.write(line, signal);

    const response = await this.read(signal);

    if (!expected.includes(response.code))
      throw new Error(`SMTP ${line.split(" ")[0]} failed with status ${response.code}`);

    return response;
  }
}

const abortError = (): Error => {
  const error = new Error("SMTP connection aborted");
  error.name = "AbortError";
  return error;
};

const toEmailFailure = (cause: unknown): EmailFailure =>
  cause instanceof EmailFailure
    ? cause
    : new EmailFailure({ provider: "SMTP", message: describeEmailFailure(cause) });

const connectSocket = (options: SmtpTransportOptions, socket?: Socket): Socket => {
  const port = options.port ?? (options.secure ? 465 : 587);
  const rejectUnauthorized = options.rejectUnauthorized !== false;
  const ca =
    typeof options.ca === "string"
      ? options.ca
      : options.ca === undefined
        ? undefined
        : [...options.ca];

  if (options.secure || socket)
    return connectTls({
      ...(socket === undefined ? {} : { socket }),
      host: options.host,
      port,
      servername: isIP(options.host) ? undefined : options.host,
      rejectUnauthorized,
      ...(ca === undefined ? {} : { ca }),
    });

  return connectNet({ host: options.host, port });
};

const waitForSocket = (
  socket: Socket,
  event: "connect" | "secureConnect",
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      socket.destroy();
      finish(new Error("SMTP connection timed out"));
    }, timeoutMs);
    const onReady = () => finish();
    const onError = (error: Error) => finish(error);
    const onClose = () => finish(new Error("SMTP connection closed"));
    const onAbort = () => {
      socket.destroy();
      finish(abortError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(event, onReady);
      socket.off("error", onError);
      socket.off("close", onClose);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (error) reject(error);
      else resolve();
    };

    timer.unref();
    socket.once(event, onReady);
    socket.once("error", onError);
    socket.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });

    if (signal.aborted) onAbort();
  });

const connectConnection = (
  options: SmtpTransportOptions,
  timeoutMs: number,
): Effect.Effect<SmtpConnection, EmailFailure> =>
  Effect.callback<SmtpConnection, EmailFailure>((resume, signal) => {
    let socket: Socket;

    try {
      socket = connectSocket(options);
    } catch (error) {
      resume(Effect.fail(toEmailFailure(error)));
      return;
    }

    void waitForSocket(
      socket,
      options.secure ? "secureConnect" : "connect",
      signal,
      timeoutMs,
    ).then(
      () => {
        try {
          resume(Effect.succeed({ socket, channel: new Channel(socket, timeoutMs) }));
        } catch (error) {
          socket.destroy();
          resume(Effect.fail(toEmailFailure(error)));
        }
      },
      (error: unknown) => {
        socket.destroy();
        resume(Effect.fail(toEmailFailure(error)));
      },
    );

    return Effect.sync(() => socket.destroy());
  });

const greeting = async (
  channel: Channel,
  options: SmtpTransportOptions,
  signal: AbortSignal,
): Promise<SmtpResponse> => {
  const response = await channel.read(signal);

  if (response.code !== 220) throw new Error(`SMTP greeting failed with status ${response.code}`);

  const name = options.helo ?? hostname();
  const ehlo = await channel.command(`EHLO ${name}`, [250, 502, 500], signal);

  if (ehlo.code === 250) return ehlo;

  const helo = await channel.command(`HELO ${name}`, [250], signal);

  return helo;
};

const authenticate = async (
  channel: Channel,
  options: SmtpTransportOptions,
  capabilities: SmtpResponse,
  signal: AbortSignal,
): Promise<void> => {
  if (!options.user) return;

  const authLine = capabilities.text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^AUTH\b/i.test(line));

  if (!authLine) throw new Error("SMTP server does not offer AUTH");

  const mechanisms = authLine.toUpperCase();
  const password = options.password ?? "";

  if (mechanisms.includes("PLAIN")) {
    const token = Buffer.from(`\u0000${options.user}\u0000${password}`, "utf8").toString("base64");

    await channel.command(`AUTH PLAIN ${token}`, [235], signal);

    return;
  }

  if (mechanisms.includes("LOGIN")) {
    await channel.command("AUTH LOGIN", [334], signal);
    await channel.command(Buffer.from(options.user, "utf8").toString("base64"), [334], signal);
    await channel.command(Buffer.from(password, "utf8").toString("base64"), [235], signal);

    return;
  }

  throw new Error("SMTP server offers no supported AUTH mechanism");
};

const sanitizeHeader = (value: string | null | undefined): string =>
  String(value ?? "")
    .replaceAll(/[\r\n]+/g, " ")
    .trim();

const formatAddress = (
  address: { readonly name?: string | undefined; readonly email: string } | null | undefined,
): string => {
  const email = sanitizeHeader(address?.email);
  const name = sanitizeHeader(address?.name);

  if (!email.includes("@") || /[<>]/.test(email)) throw new Error("invalid sender address");

  if (!name) return `<${email}>`;

  return `"${name.replaceAll(/(["\\])/g, String.raw`\$1`)}" <${email}>`;
};

const encodeSubject = (value: string | undefined): string => {
  const subject = sanitizeHeader(value);

  if (/^[\u0020-\u007e]*$/.test(subject)) return subject;

  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
};

const wrapBase64 = (encoded: string): string => {
  const lines: string[] = [];

  for (let index = 0; index < encoded.length; index += 76)
    lines.push(encoded.slice(index, index + 76));

  return lines.join(CRLF);
};

const base64Body = (value: string): string =>
  wrapBase64(Buffer.from(String(value), "utf8").toString("base64"));

/** A filename that cannot break out of the Content-Disposition header. */
const attachmentFilename = (value: string): string =>
  sanitizeHeader(value).replaceAll(/["\\]/g, "_").slice(0, 180) || "attachment";

/**
 * Render the RFC 5322 message. Pure so the relay's wire format is unit-tested
 * without a server.
 */
export const buildMimeMessage = (message: OutboundEmailMessage, now: Date = new Date()): string => {
  const from = formatAddress(message.from);
  const to = recipientsOf(message.to).map((address) => sanitizeHeader(address));

  if (to.length === 0) throw new Error("at least one recipient is required");

  for (const address of to)
    if (!address.includes("@") || /[<>,]/.test(address))
      throw new Error("invalid recipient address");

  const subject = encodeSubject(message.subject);

  const domain = sanitizeHeader(message.from?.email).split("@").at(-1) ?? "localhost";

  const headers = [
    `Date: ${now.toUTCString()}`,
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    `Subject: ${subject}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
  ];

  if (message.replyTo) {
    const replyTo = Schema.is(Schema.String)(message.replyTo)
      ? formatAddress({ name: "", email: message.replyTo })
      : formatAddress(message.replyTo);

    headers.push(`Reply-To: ${replyTo}`);
  }

  const text = message.text?.trim() ? message.text : null;
  const html = message.html?.trim() ? message.html : null;

  if (!text && !html) throw new Error("a text or html body is required");

  /** The message body as one MIME entity, without the enclosing headers. */
  const bodyEntity = (): string => {
    if (text && html) {
      const boundary = `mattrax-${randomUUID()}`;

      return [
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        'Content-Type: text/plain; charset="utf-8"',
        "Content-Transfer-Encoding: base64",
        "",
        base64Body(text),
        `--${boundary}`,
        'Content-Type: text/html; charset="utf-8"',
        "Content-Transfer-Encoding: base64",
        "",
        base64Body(html),
        `--${boundary}--`,
      ].join(CRLF);
    }

    return [
      html
        ? 'Content-Type: text/html; charset="utf-8"'
        : 'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      // The check above guarantees one of the two bodies is present; `?? ""`
      // only satisfies the type of the nullable pair.
      base64Body(html ?? text ?? ""),
    ].join(CRLF);
  };

  const attachments = message.attachments ?? [];

  if (attachments.length === 0) return [...headers, "", bodyEntity()].join(CRLF);

  // A report is body + one attachment, so the MIME tree is mixed(alternative,
  // attachment...). Anything that does not understand the attachment still
  // renders the summary body.
  const mixed = `mattrax-${randomUUID()}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${mixed}"`);
  const parts: string[] = [...headers, "", `--${mixed}`, bodyEntity()];

  for (const attachment of attachments) {
    parts.push(
      `--${mixed}`,
      `Content-Type: ${sanitizeHeader(attachment.contentType) || "application/octet-stream"}; name="${attachmentFilename(attachment.filename)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachmentFilename(attachment.filename)}"`,
      "",
      wrapBase64(attachment.contentBase64.replaceAll(/\s+/g, "")),
    );
  }

  parts.push(`--${mixed}--`);

  return parts.join(CRLF);
};

/** RFC 5321 transparency: a body line beginning with `.` is sent with two. */
export const dotStuff = (body: string): string => body.replaceAll(/(^|\r\n)\./g, "$1..");

const sendBody = async (channel: Channel, message: string, signal: AbortSignal): Promise<void> => {
  await channel.write(dotStuff(message) + CRLF + ".", signal);

  const response = await channel.read(signal);

  if (response.code !== 250) throw new Error(`SMTP DATA failed with status ${response.code}`);
};

const runSmtp = async (
  connection: SmtpConnection,
  options: SmtpTransportOptions,
  message: OutboundEmailMessage,
  payload: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> => {
  const channel = connection.channel;
  let capabilities = await greeting(channel, options, signal);
  let encrypted = options.secure === true;

  if (!encrypted && /STARTTLS/i.test(capabilities.text)) {
    await channel.command("STARTTLS", [220], signal);
    channel.detach();

    const secure = connectSocket(options, connection.socket);
    connection.socket = secure;
    await waitForSocket(secure, "secureConnect", signal, timeoutMs);
    channel.attach(secure);
    encrypted = true;
    capabilities = await channel.command(`EHLO ${options.helo ?? hostname()}`, [250], signal);
  }

  if (options.user && !encrypted && options.allowInsecureAuth !== "development-only")
    throw new EmailFailure({
      provider: "SMTP",
      message: "SMTP authentication requires TLS and the server did not advertise STARTTLS",
    });

  await authenticate(channel, options, capabilities, signal);
  await channel.command(`MAIL FROM:<${sanitizeHeader(message.from?.email)}>`, [250], signal);

  for (const recipient of recipientsOf(message.to))
    await channel.command(`RCPT TO:<${sanitizeHeader(recipient)}>`, [250, 251], signal);

  await channel.command("DATA", [354], signal);
  await sendBody(channel, payload, signal);

  // QUIT failing must not turn a delivered message into a failure.
  await channel.command("QUIT", [221], signal).catch(() => undefined);
};

/**
 * Deliver one message. The socket and every protocol timer belong to this
 * Effect's scope, so interruption closes the connection before AUTH or DATA
 * can continue in the background.
 */
export const sendSmtpMail = (
  options: SmtpTransportOptions,
  message: OutboundEmailMessage,
): Effect.Effect<{ recipients: number }, EmailFailure> =>
  Effect.scoped(
    Effect.gen(function* () {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      // Validate the envelope and render the body before opening a connection,
      // so a malformed request cannot leave SMTP in a transaction.
      const payload = yield* Effect.try({
        try: () => buildMimeMessage(message),
        catch: toEmailFailure,
      });

      if (options.user && !options.secure && options.allowInsecureAuth === "development-only")
        yield* Effect.logWarning(
          "Insecure SMTP AUTH development override enabled; credentials will be sent without TLS if STARTTLS is unavailable",
        );

      const connection = yield* Effect.acquireRelease(
        connectConnection(options, timeoutMs),
        (connection) =>
          Effect.sync(() => {
            connection.channel.detach();
            connection.socket.destroy();
          }),
        { interruptible: true },
      );

      yield* Effect.tryPromise({
        try: (signal) => runSmtp(connection, options, message, payload, timeoutMs, signal),
        catch: toEmailFailure,
      });

      return { recipients: recipientsOf(message.to).length };
    }),
  );
