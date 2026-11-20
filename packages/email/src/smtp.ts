import { randomUUID } from "node:crypto";
import { Schema } from "effect";
import { hostname } from "node:os";
import { connect as connectNet } from "node:net";
import type { Socket } from "node:net";
import { connect as connectTls } from "node:tls";

import type { OutboundEmailMessage } from "./email.ts";

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
    this.socket = socket;
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
  }

  fail(error: Error): void {
    this.failure ??= error;

    const pending = this.pending;

    if (!pending) return;

    this.pending = null;
    clearTimeout(pending.timer);
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
      pending.resolve({
        code: Number(line.slice(0, 3)),
        text: lines.map((item) => item.slice(4)).join("\n"),
      });

      return;
    }
  }

  read(): Promise<SmtpResponse> {
    if (this.failure) return Promise.reject(this.failure);

    if (this.pending) return Promise.reject(new Error("SMTP command already in flight"));

    return new Promise<SmtpResponse>((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new Error("SMTP server did not respond")),
        this.timeoutMs,
      );

      timer.unref();
      this.pending = { resolve, reject, timer };
      this.pump();
    });
  }

  write(line: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.socket.write(line + CRLF, (error) => (error ? reject(error) : resolve()));
    });
  }

  async command(line: string, expected: number[]): Promise<SmtpResponse> {
    await this.write(line);

    const response = await this.read();

    if (!expected.includes(response.code))
      throw new Error(`SMTP ${line.split(" ")[0]} failed with status ${response.code}`);

    return response;
  }
}

const connect = (options: SmtpTransportOptions): Socket => {
  const port = options.port ?? (options.secure ? 465 : 587);
  const rejectUnauthorized = options.rejectUnauthorized !== false;

  if (options.secure)
    return connectTls({
      host: options.host,
      port,
      servername: options.host,
      rejectUnauthorized,
    });

  return connectNet({ host: options.host, port });
};

const greeting = async (channel: Channel, options: SmtpTransportOptions): Promise<SmtpResponse> => {
  const response = await channel.read();

  if (response.code !== 220) throw new Error(`SMTP greeting failed with status ${response.code}`);

  const name = options.helo ?? hostname();
  const ehlo = await channel.command(`EHLO ${name}`, [250, 502, 500]);

  if (ehlo.code === 250) return ehlo;

  const helo = await channel.command(`HELO ${name}`, [250]);

  return helo;
};

const authenticate = async (
  channel: Channel,
  options: SmtpTransportOptions,
  capabilities: SmtpResponse,
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

    await channel.command(`AUTH PLAIN ${token}`, [235]);

    return;
  }

  if (mechanisms.includes("LOGIN")) {
    await channel.command("AUTH LOGIN", [334]);
    await channel.command(Buffer.from(options.user, "utf8").toString("base64"), [334]);
    await channel.command(Buffer.from(password, "utf8").toString("base64"), [235]);

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

  return `"${name.replaceAll(/(["\\])/g, "\\$1")}" <${email}>`;
};

const encodeSubject = (value: string | undefined): string => {
  const subject = sanitizeHeader(value);

  if (/^[\x20-\x7e]*$/.test(subject)) return subject;

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

  if (attachments.length === 0)
    return [...headers, "", bodyEntity()].join(CRLF);

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

const sendBody = async (channel: Channel, message: string): Promise<void> => {
  await channel.write(dotStuff(message) + CRLF + ".");

  const response = await channel.read();

  if (response.code !== 250) throw new Error(`SMTP DATA failed with status ${response.code}`);
};

/**
 * Deliver one message. Throws on any protocol or transport failure; the caller
 * turns that into a 502 without echoing the recipient.
 */
export const sendSmtpMail = async (
  options: SmtpTransportOptions,
  message: OutboundEmailMessage,
): Promise<{ recipients: number }> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Validate the envelope and render the body before opening a connection, so a
  // malformed request cannot leave SMTP in the middle of a transaction.
  const payload = buildMimeMessage(message);
  const socket = connect(options);
  const channel = new Channel(socket, timeoutMs);

  let current: Socket = socket;

  try {
    let capabilities = await greeting(channel, options);

    if (!options.secure && /STARTTLS/i.test(capabilities.text)) {
      await channel.command("STARTTLS", [220]);

      channel.detach();

      const secure = connectTls({
        socket: current,
        servername: options.host,
        rejectUnauthorized: options.rejectUnauthorized !== false,
      });

      current = secure;
      channel.attach(secure);
      capabilities = await channel.command(`EHLO ${options.helo ?? hostname()}`, [250]);
    }

    await authenticate(channel, options, capabilities);
    await channel.command(`MAIL FROM:<${sanitizeHeader(message.from?.email)}>`, [250]);

    for (const recipient of recipientsOf(message.to))
      await channel.command(`RCPT TO:<${sanitizeHeader(recipient)}>`, [250, 251]);

    await channel.command("DATA", [354]);
    await sendBody(channel, payload);

    // QUIT failing must not turn a delivered message into a failure.
    await channel.command("QUIT", [221]).catch(() => undefined);

    return { recipients: recipientsOf(message.to).length };
  } finally {
    channel.detach();
    current.destroy();
  }
};
