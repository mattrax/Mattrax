import { Effect, Option, Schema } from "effect";
import { eq } from "drizzle-orm";
import type * as pkijs from "pkijs";
import { connect } from "node:tls";
import { loadPkijs } from "@mattrax/scep";
import { schema as s } from "@mattrax/enterprise-core";
import type { ServerCertificateInfo } from "@mattrax/enterprise-domain";
import { serverCertificateInfo } from "../Device/credentialHealth.ts";
import type { EnterpriseDb } from "../schema.ts";

/**
 * Origin TLS certificate review.
 *
 * Apple devices only enrol and check in over a trusted HTTPS origin, so an
 * expired, mismatched or untrusted origin certificate silently breaks the
 * fleet. A frequent probe records the leaf certificate, classifies its expiry
 * with the same thresholds as every other credential, and logs a warning as it
 * approaches expiry.
 *
 * The probe uses `node:tls` (available in Workers through `nodejs_compat`) and
 * asks for the peer chain without rejecting an invalid certificate: an expired
 * or untrusted certificate must be *observed and reported*, not turned into a
 * probe error that hides why.
 */

/** Default interval between probes. The hourly cron calls it, so one hour. */
export const SERVER_CERTIFICATE_CHECK_INTERVAL_MINUTES = 60;

/** Warn once the origin certificate is inside this window. */
export const SERVER_CERTIFICATE_WARNING_DAYS = 30;

/** Escalate once the origin certificate is inside this window. */
export const SERVER_CERTIFICATE_CRITICAL_DAYS = 7;

/** Bound the handshake so a black-holed origin cannot stall maintenance. */
export const SERVER_CERTIFICATE_PROBE_TIMEOUT_MS = 10_000;

/** The row id for the deployment origin; one probe target per deployment. */
const OBSERVATION_ID = "origin";

export type ServerCertificatePeer = {
  readonly hostname: string;
  readonly port: number;
  readonly subject: string | null;
  readonly issuer: string | null;
  readonly serialNumber: string | null;
  readonly fingerprintSha256: string | null;
  readonly notBefore: Date | null;
  readonly notAfter: Date | null;
  readonly authorized: boolean;
  readonly authorizationError: string | null;
  readonly chainLength: number;
};

export type ServerCertificateProbeOptions = {
  readonly origin: string;
  readonly timeoutMs?: number;
};

export type ServerCertificateProbe = (
  options: ServerCertificateProbeOptions,
) => Effect.Effect<ServerCertificatePeer, Error>;

const shortNames = new Map<string, string>([
  ["2.5.4.3", "CN"],
  ["2.5.4.6", "C"],
  ["2.5.4.7", "L"],
  ["2.5.4.8", "ST"],
  ["2.5.4.10", "O"],
  ["2.5.4.11", "OU"],
  ["0.9.2342.19200300.100.1.25", "DC"],
  ["1.2.840.113549.1.9.1", "emailAddress"],
]);

const AttributeValueBlock = Schema.Struct({
  valueBlock: Schema.optional(Schema.Struct({ value: Schema.optional(Schema.String) })),
});

const attributeValue = (value: pkijs.AttributeValueType): string => {
  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(AttributeValueBlock)(value));

  return decoded?.valueBlock?.value ?? "";
};

const formatName = (name: pkijs.RelativeDistinguishedNames): string =>
  name.typesAndValues
    .map((attribute) => {
      const label = shortNames.get(attribute.type) ?? attribute.type;
      const value = attributeValue(attribute.value);

      return value ? `${label}=${value}` : label;
    })
    .filter(Boolean)
    .join(", ");

const fingerprintHex = async (der: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(der).buffer);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** Parse a DER leaf certificate into the metadata the dashboard and alerts use. */
export const serverCertificatePeerFromDer = async (input: {
  readonly der: Uint8Array;
  readonly hostname: string;
  readonly port: number;
  readonly authorized: boolean;
  readonly authorizationError: string | null;
  readonly chainLength: number;
}): Promise<ServerCertificatePeer> => {
  const { Certificate } = await loadPkijs();
  const certificate = Certificate.fromBER(new Uint8Array(input.der).buffer);
  const serial = certificate.serialNumber.valueBlock.valueHexView;

  return {
    hostname: input.hostname,
    port: input.port,
    subject: formatName(certificate.subject),
    issuer: formatName(certificate.issuer),
    serialNumber: serial
      ? Array.from(serial, (byte) => byte.toString(16).padStart(2, "0")).join("")
      : null,
    fingerprintSha256: await fingerprintHex(input.der),
    notBefore: certificate.notBefore?.value ?? null,
    notAfter: certificate.notAfter?.value ?? null,
    authorized: input.authorized,
    authorizationError: input.authorizationError,
    chainLength: input.chainLength,
  };
};

const isIpAddress = (hostname: string) => /^[0-9.]+$/.test(hostname) || hostname.includes(":");

/** Depth of the presented chain, following issuer certificates exactly once. */
const countChain = (peer: import("node:tls").DetailedPeerCertificate): number => {
  let depth = 1;
  const seen = new Set<string>([peer.fingerprint256]);
  let issuer = peer.issuerCertificate;

  while (issuer && issuer.raw && issuer.raw.length > 0 && !seen.has(issuer.fingerprint256)) {
    depth += 1;
    seen.add(issuer.fingerprint256);
    issuer = issuer.issuerCertificate;
  }

  return depth;
};

/**
 * Perform a real TLS handshake with the deployment origin and read the leaf
 * certificate. `rejectUnauthorized: false` is deliberate: the point is to
 * observe a bad certificate and warn about it.
 */
export const probeServerCertificate: ServerCertificateProbe = (options) =>
  Effect.tryPromise({
    try: () =>
      new Promise<ServerCertificatePeer>((resolve, reject) => {
        const url = new URL(options.origin);

        if (url.protocol !== "https:")
          throw new Error(`The origin uses ${url.protocol}, not https`);

        const hostname = url.hostname.replaceAll(/^\[|\]$/g, "");
        const port = url.port ? Number(url.port) : 443;
        const timeoutMs = options.timeoutMs ?? SERVER_CERTIFICATE_PROBE_TIMEOUT_MS;

        let settled = false;
        // Assigned once, after the callbacks that read it are defined, so it
        // cannot be a \`const\` declaration.
        // oxlint-disable-next-line prefer-const -- assigned after the closures that capture it.
        let timer: ReturnType<typeof setTimeout> | undefined;

        const finish = (error: Error | null, peer?: ServerCertificatePeer) => {
          if (settled) return;

          settled = true;

          if (timer !== undefined) clearTimeout(timer);
          socket.destroy();

          if (error || !peer) {
            reject(error ?? new Error("The TLS handshake returned no certificate"));

            return;
          }

          resolve(peer);
        };

        const socket = connect({
          host: hostname,
          port,
          // SNI is required for a virtual-hosted edge certificate; an IP literal
          // has no name to send.
          servername: isIpAddress(hostname) ? undefined : hostname,
          rejectUnauthorized: false,
        });

        timer = setTimeout(
          () => finish(new Error(`TLS probe timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );

        socket.once("error", (cause) =>
          finish(cause instanceof Error ? cause : new Error(String(cause))),
        );

        socket.once("secureConnect", () => {
          void (async () => {
            try {
              const peer = socket.getPeerCertificate(true);

              if (!peer || !peer.raw || peer.raw.length === 0) {
                finish(new Error("The TLS handshake returned no peer certificate"));

                return;
              }

              finish(
                null,
                await serverCertificatePeerFromDer({
                  der: new Uint8Array(peer.raw),
                  hostname,
                  port,
                  authorized: socket.authorized,
                  authorizationError: socket.authorizationError
                    ? String(socket.authorizationError)
                    : null,
                  chainLength: countChain(peer),
                }),
              );
            } catch (error) {
              finish(error instanceof Error ? error : new Error(String(error)));
            }
          })();
        });
      }),
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(`TLS probe failed: ${String(cause)}`),
  });

export type ServerCertificateCheckResult = {
  /** False when the previous observation is still fresh enough to reuse. */
  readonly checked: boolean;
  readonly state: ServerCertificateInfo;
};

/**
 * Read the latest observation without probing.
 */
export const loadServerCertificateInfo = (
  db: EnterpriseDb,
  now: Date = new Date(),
): Effect.Effect<ServerCertificateInfo, unknown> =>
  Effect.gen(function* () {
    const [row] = yield* db
      .select()
      .from(s.serverCertificateHealth)
      .where(eq(s.serverCertificateHealth.id, OBSERVATION_ID))
      .limit(1);

    return serverCertificateInfo(row ?? null, now);
  });

/**
 * Probe the origin certificate and record the result.
 *
 * Throttled by `intervalMinutes` so the hourly cron can call it unconditionally
 * and a manual maintenance run does not hammer the origin. A failed probe is
 * recorded (never swallowed) so operators see that the certificate was not
 * verified instead of reading a stale "ok".
 */
export const runServerCertificateCheck = (
  db: EnterpriseDb,
  options: {
    readonly origin: string;
    readonly now?: Date;
    readonly intervalMinutes?: number;
    readonly timeoutMs?: number;
    readonly probe?: ServerCertificateProbe;
    /** Probe even when the previous observation is fresh. */
    readonly force?: boolean;
  },
): Effect.Effect<ServerCertificateCheckResult, unknown> =>
  Effect.gen(function* () {
    const now = options.now ?? new Date();

    const intervalMs =
      (options.intervalMinutes ?? SERVER_CERTIFICATE_CHECK_INTERVAL_MINUTES) * 60 * 1000;

    const [existing] = yield* db
      .select()
      .from(s.serverCertificateHealth)
      .where(eq(s.serverCertificateHealth.id, OBSERVATION_ID))
      .limit(1);

    if (!options.force && existing && now.getTime() - existing.checkedAt.getTime() < intervalMs) {
      return { checked: false, state: serverCertificateInfo(existing, now) };
    }

    const probe = options.probe ?? probeServerCertificate;

    const outcome: {
      readonly peer: ServerCertificatePeer | null;
      readonly error: string | null;
    } = yield* probe({ origin: options.origin, timeoutMs: options.timeoutMs }).pipe(
      Effect.map((peer) => ({ peer, error: null })),
      Effect.catch((error: Error) =>
        Effect.succeed({ peer: null, error: error.message || "TLS probe failed" }),
      ),
    );

    if (outcome.error)
      yield* Effect.logWarning(
        "Origin TLS certificate probe failed",
        options.origin,
        outcome.error,
      );

    const hostname = outcome.peer?.hostname ?? new URL(options.origin).hostname;

    const values = {
      id: OBSERVATION_ID,
      origin: options.origin,
      hostname,
      checkedAt: now,
      notBefore: outcome.peer?.notBefore ?? null,
      notAfter: outcome.peer?.notAfter ?? null,
      subject: outcome.peer?.subject ?? null,
      issuer: outcome.peer?.issuer ?? null,
      serialNumber: outcome.peer?.serialNumber ?? null,
      fingerprintSha256: outcome.peer?.fingerprintSha256 ?? null,
      authorized: outcome.peer?.authorized ?? false,
      authorizationError: outcome.peer?.authorizationError ?? null,
      chainLength: outcome.peer?.chainLength ?? 0,
      error: outcome.error,
    };

    yield* Effect.gen(function* () {
      const updated = yield* db
        .update(s.serverCertificateHealth)
        .set(values)
        .where(eq(s.serverCertificateHealth.id, OBSERVATION_ID));

      if (updated.affectedRows > 0) return;

      yield* db.insert(s.serverCertificateHealth).values(values);
    });

    const state = serverCertificateInfo(values, now);

    if (state.level === "expired")
      yield* Effect.logError(
        "Origin TLS certificate has expired; devices cannot enrol or check in",
        options.origin,
        state.expiresAt,
      );
    else if (state.level === "critical" || state.level === "warning")
      yield* Effect.logWarning(
        "Origin TLS certificate is approaching expiry",
        options.origin,
        state.expiresAt,
        `${state.daysLeft} days left`,
      );
    else if (state.authorized === false && state.checkedAt !== null)
      yield* Effect.logWarning(
        "Origin TLS certificate did not validate against the host trust store",
        options.origin,
        state.authorizationError ?? "certificate chain rejected",
      );

    return { checked: true, state };
  });
