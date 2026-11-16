#!/usr/bin/env node
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  sendSmtpMail,
  type MailAddress,
  type MailMessage,
  type SmtpTransportOptions,
} from "./smtp.ts";

/**
 * Self-hosted mail relay.
 *
 * The API Worker has the same transport seam as on Cloudflare, but a container
 * cannot open an SMTP connection from inside workerd. This sidecar accepts one
 * authenticated JSON request and delivers it through the operator's existing
 * SMTP account, following the same pattern as `apps/apns-relay`.
 *
 * Configuration:
 *   MAIL_RELAY_SECRET     shared bearer secret, at least 16 characters (required)
 *   SMTP_HOST             SMTP server hostname (required)
 *   SMTP_PORT             defaults to 465 with SMTP_SECURE, otherwise 587
 *   SMTP_SECURE           "true" for implicit TLS (port 465)
 *   SMTP_USER             optional username for AUTH PLAIN/LOGIN
 *   SMTP_PASSWORD         password for SMTP_USER
 *   SMTP_REJECT_UNAUTHORIZED  "false" to accept a self-signed relay certificate
 *   MAIL_FROM             fallback sender if a request omits `from`
 *   MAIL_RELAY_PORT       listen port, default 8790
 *   MAIL_RELAY_HOST       listen address, default 0.0.0.0
 */

const secret = process.env.MAIL_RELAY_SECRET?.trim();
const host = process.env.SMTP_HOST?.trim();
const secure = process.env.SMTP_SECURE?.trim().toLowerCase() === "true";
const port = Number(process.env.SMTP_PORT ?? (secure ? 465 : 587));
const user = process.env.SMTP_USER?.trim() || undefined;
const password = process.env.SMTP_PASSWORD;
const rejectUnauthorized = process.env.SMTP_REJECT_UNAUTHORIZED?.trim().toLowerCase() !== "false";
const fallbackFrom = process.env.MAIL_FROM?.trim();
const listenPort = Number(process.env.MAIL_RELAY_PORT ?? 8790);
const listenHost = process.env.MAIL_RELAY_HOST ?? "0.0.0.0";

function fail(message: string): never {
  console.error(`mattrax mail-relay: ${message}`);

  process.exit(1);
}

if (!secret || secret.length < 16) fail("MAIL_RELAY_SECRET must be at least 16 characters");

if (!host) fail("SMTP_HOST is required");

if (!Number.isInteger(port) || port < 1 || port > 65535) fail("SMTP_PORT must be a valid port");

if (user && password === undefined) fail("SMTP_PASSWORD is required when SMTP_USER is set");

const maxBodyBytes = 256 * 1024;
const maxRecipients = 50;
const maxFieldLength = 200_000;

const transport: SmtpTransportOptions = {
  host,
  port,
  secure,
  user,
  password,
  rejectUnauthorized,
};

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;

      if (size > maxBodyBytes) {
        reject(new Error("request body too large"));
        request.destroy();

        return;
      }

      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });

/** The untrusted JSON the API posts; every field is validated below. */
interface RawAddress {
  readonly name?: unknown;
  readonly email?: unknown;
}

interface RawMessage {
  readonly to?: unknown;
  readonly from?: unknown;
  readonly replyTo?: unknown;
  readonly subject?: unknown;
  readonly text?: unknown;
  readonly html?: unknown;
}

/** The only shapes this sidecar writes back. */
interface RelayResponse {
  status: "ok" | "not_found" | "unauthorized" | "invalid_request" | "sent" | "delivery_failed";
  transport?: "smtp";
  secure?: boolean;
  message?: string;
}

/* oxlint-disable anti-slop/no-runtime-typeof -- JSON from the API is untrusted input; this dependency-free sidecar validates it at the HTTP boundary. */
const isText = (value: unknown): value is string => typeof value === "string";

const isObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/* oxlint-enable anti-slop/no-runtime-typeof */

const isRawAddress = (value: unknown): value is RawAddress => isObject(value);

const isRawMessage = (value: unknown): value is RawMessage => isObject(value);

const equal = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);

  return a.length === b.length && timingSafeEqual(a, b);
};

/* oxlint-disable anti-slop/no-unknown-parameters -- `text` and `sender` are the decode boundary for the untrusted request body; they validate and narrow each field before anything else sees it. */
/**
 * A single opaque JSON value from the request, validated into the string the SMTP
 * client expects. `unknown` is the honest input type: this is the HTTP boundary.
 */
function text(value: unknown, field: string): string;
function text(value: unknown, field: string, required: false): string | undefined;
function text(value: unknown, field: string, required = true): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} is required`);

    return undefined;
  }

  if (!isText(value) || value.length > maxFieldLength) throw new Error(`${field} must be a string`);

  const trimmed = value.trim();

  if (required && !trimmed) throw new Error(`${field} is required`);

  return trimmed || undefined;
}

const sender = (value: unknown): MailAddress => {
  if (value === undefined) {
    if (!fallbackFrom) throw new Error("from is required");

    return { name: "", email: fallbackFrom };
  }

  if (isText(value)) return { name: "", email: text(value, "from.email") };

  const address = isRawAddress(value) ? value : {};

  return {
    name: text(address.name, "from.name", false) ?? "",
    email: text(address.email, "from.email"),
  };
};
/* oxlint-enable anti-slop/no-unknown-parameters */

/** Parse the JSON body, keeping the untyped value out of everything downstream. */
const parseJson = (value: string): RawMessage => {
  const parsed: unknown = JSON.parse(value);

  if (!isRawMessage(parsed)) throw new Error("request body must be an object");

  return parsed;
};

/** Normalise the API payload into the strict shape the SMTP client expects. */
const parseMessage = (body: RawMessage): MailMessage => {
  const recipients: unknown = isText(body.to) ? [body.to] : body.to;

  if (!Array.isArray(recipients) || recipients.length === 0)
    throw new Error("to must contain at least one recipient");

  if (recipients.length > maxRecipients) throw new Error("too many recipients");

  const list: unknown[] = recipients;
  const replyTo = body.replyTo;

  return {
    to: list.map((recipient) => text(recipient, "to")),
    from: sender(body.from),
    replyTo:
      replyTo === undefined
        ? undefined
        : isText(replyTo)
          ? text(replyTo, "replyTo")
          : {
              name:
                text(isRawAddress(replyTo) ? replyTo.name : undefined, "replyTo.name", false) ?? "",
              email: text(isRawAddress(replyTo) ? replyTo.email : undefined, "replyTo.email"),
            },
    subject: text(body.subject, "subject"),
    text: text(body.text, "text", false),
    html: text(body.html, "html", false),
  };
};

const json = (response: ServerResponse, status: number, body: RelayResponse): void => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    json(response, 200, { status: "ok", transport: "smtp", secure });

    return;
  }

  if (request.method !== "POST" || request.url !== "/send") {
    json(response, 404, { status: "not_found" });

    return;
  }

  const authorization = request.headers.authorization ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

  if (!equal(supplied, secret)) {
    json(response, 401, { status: "unauthorized" });

    return;
  }

  let message: MailMessage;

  try {
    message = parseMessage(parseJson(await readBody(request)));
  } catch (cause) {
    json(response, 400, {
      status: "invalid_request",
      message: cause instanceof Error ? cause.message : "invalid request",
    });

    return;
  }

  try {
    await sendSmtpMail(transport, message);

    json(response, 202, { status: "sent" });
  } catch (cause) {
    // The recipient and the provider response are deliberately not logged.
    console.error(
      "mattrax mail-relay: SMTP delivery failed",
      cause instanceof Error ? cause.message : "unknown error",
    );
    json(response, 502, { status: "delivery_failed" });
  }
});

server.listen(listenPort, listenHost, () => {
  console.log(
    `mattrax mail-relay: listening on ${listenHost}:${listenPort} (${host}:${port}, ${secure ? "implicit TLS" : "STARTTLS if offered"})`,
  );
});
