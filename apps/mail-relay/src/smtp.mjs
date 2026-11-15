import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import net from "node:net";
import tls from "node:tls";

/**
 * Minimal SMTP client for the mail relay.
 *
 * It deliberately supports only what transactional mail needs: EHLO, optional
 * STARTTLS, AUTH PLAIN/LOGIN, one envelope with several recipients and a
 * multipart/alternative body. The relay has no dependencies so the container
 * image stays small and there is no supply chain beyond Node itself.
 */

const CRLF = "\r\n";
const DEFAULT_TIMEOUT_MS = 20_000;

/* oxlint-disable anti-slop/no-runtime-typeof -- messages arrive as JSON from the relay's HTTP boundary; the SMTP client validates them before opening a socket. */
const isText = (value) => typeof value === "string";
/* oxlint-enable anti-slop/no-runtime-typeof */

/** SMTP line-oriented reader. One response may span several lines. */
class Channel {
  constructor(socket, timeoutMs) {
    this.buffer = "";
    this.pending = null;
    this.failure = null;
    this.timeoutMs = timeoutMs;

    this.attach(socket);
  }

  attach(socket) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.setTimeout(this.timeoutMs, () => {
      this.fail(new Error("SMTP connection timed out"));
      socket.destroy();
    });

    this.onData = (chunk) => {
      this.buffer += chunk;
      this.pump();
    };

    this.onError = (error) => this.fail(error);
    this.onClose = () => this.fail(new Error("SMTP connection closed"));

    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("close", this.onClose);
  }

  detach() {
    const socket = this.socket;

    if (!socket) return;

    socket.off("data", this.onData);
    socket.off("error", this.onError);
    socket.off("close", this.onClose);
  }

  fail(error) {
    this.failure ??= error;

    const pending = this.pending;

    if (!pending) return;

    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  /** Complete the oldest response once its terminating line has arrived. */
  pump() {
    if (!this.pending) return;

    let offset = 0;
    const lines = [];

    while (true) {
      const end = this.buffer.indexOf(CRLF, offset);

      if (end === -1) return;

      const line = this.buffer.slice(offset, end);

      lines.push(line);
      offset = end + CRLF.length;

      if (!/^\d{3} /.test(line)) continue;

      this.buffer = this.buffer.slice(offset);

      const pending = this.pending;

      this.pending = null;
      clearTimeout(pending.timer);
      pending.resolve({
        code: Number(line.slice(0, 3)),
        text: lines.map((item) => item.slice(4)).join("\n"),
      });

      return;
    }
  }

  read() {
    if (this.failure) return Promise.reject(this.failure);

    if (this.pending) return Promise.reject(new Error("SMTP command already in flight"));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new Error("SMTP server did not respond")),
        this.timeoutMs,
      );

      timer.unref?.();
      this.pending = { resolve, reject, timer };
      this.pump();
    });
  }

  write(line) {
    return new Promise((resolve, reject) => {
      this.socket.write(line + CRLF, (error) => (error ? reject(error) : resolve()));
    });
  }

  async command(line, expected) {
    await this.write(line);

    const response = await this.read();

    if (!expected.includes(response.code))
      throw new Error(`SMTP ${line.split(" ")[0]} failed with status ${response.code}`);

    return response;
  }
}

const connect = (options) => {
  const port = options.port ?? (options.secure ? 465 : 587);
  const rejectUnauthorized = options.rejectUnauthorized !== false;

  if (options.secure)
    return tls.connect({
      host: options.host,
      port,
      servername: options.host,
      rejectUnauthorized,
    });

  return net.connect({ host: options.host, port });
};

const greeting = async (channel, options) => {
  const response = await channel.read();

  if (response.code !== 220) throw new Error(`SMTP greeting failed with status ${response.code}`);

  const name = options.helo ?? hostname();
  const ehlo = await channel.command(`EHLO ${name}`, [250, 502, 500]);

  if (ehlo.code === 250) return ehlo;

  const helo = await channel.command(`HELO ${name}`, [250]);

  return helo;
};

const authenticate = async (channel, options, capabilities) => {
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

const sanitizeHeader = (value) =>
  String(value ?? "")
    .replaceAll(/[\r\n]+/g, " ")
    .trim();

const formatAddress = (address) => {
  const email = sanitizeHeader(address?.email);
  const name = sanitizeHeader(address?.name);

  if (!email.includes("@") || /[<>]/.test(email)) throw new Error("invalid sender address");

  if (!name) return `<${email}>`;

  return `"${name.replaceAll(/(["\\])/g, "\\$1")}" <${email}>`;
};

const encodeSubject = (value) => {
  const subject = sanitizeHeader(value);

  if (/^[\x20-\x7e]*$/.test(subject)) return subject;

  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
};

const base64Body = (value) => {
  const encoded = Buffer.from(String(value), "utf8").toString("base64");
  const lines = [];

  for (let index = 0; index < encoded.length; index += 76)
    lines.push(encoded.slice(index, index + 76));

  return lines.join(CRLF);
};

/**
 * Render the RFC 5322 message. Pure so the relay's wire format is unit-tested
 * without a server.
 */
export const buildMimeMessage = (message, now = new Date()) => {
  const from = formatAddress(message.from);
  const to = message.to.map((address) => sanitizeHeader(address));

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
    const replyTo = isText(message.replyTo)
      ? formatAddress({ name: "", email: message.replyTo })
      : formatAddress(message.replyTo);

    headers.push(`Reply-To: ${replyTo}`);
  }

  const text = message.text?.trim() ? message.text : null;
  const html = message.html?.trim() ? message.html : null;

  if (!text && !html) throw new Error("a text or html body is required");

  if (text && html) {
    const boundary = `mattrax-${randomUUID()}`;

    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

    return [
      ...headers,
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

  headers.push(
    html ? 'Content-Type: text/html; charset="utf-8"' : 'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
  );

  return [...headers, "", base64Body(html ?? text)].join(CRLF);
};

/** RFC 5321 transparency: a body line beginning with `.` is sent with two. */
export const dotStuff = (body) => body.replaceAll(/(^|\r\n)\./g, "$1..");

const sendBody = async (channel, message) => {
  await channel.write(dotStuff(message) + CRLF + ".");

  const response = await channel.read();

  if (response.code !== 250) throw new Error(`SMTP DATA failed with status ${response.code}`);
};

/**
 * Deliver one message. Throws on any protocol or transport failure; the caller
 * turns that into a 502 without echoing the recipient.
 */
export const sendSmtpMail = async (options, message) => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Validate the envelope and render the body before opening a connection, so a
  // malformed request cannot leave SMTP in the middle of a transaction.
  const payload = buildMimeMessage(message);
  const socket = connect(options);
  const channel = new Channel(socket, timeoutMs);

  let current = socket;

  try {
    let capabilities = await greeting(channel, options);

    if (!options.secure && /STARTTLS/i.test(capabilities.text)) {
      await channel.command("STARTTLS", [220]);

      channel.detach();

      const secure = tls.connect({
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

    for (const recipient of message.to)
      await channel.command(`RCPT TO:<${sanitizeHeader(recipient)}>`, [250, 251]);

    await channel.command("DATA", [354]);
    await sendBody(channel, payload);

    // QUIT failing must not turn a delivered message into a failure.
    await channel.command("QUIT", [221]).catch(() => undefined);

    return { recipients: message.to.length };
  } finally {
    channel.detach();
    current.destroy();
  }
};
