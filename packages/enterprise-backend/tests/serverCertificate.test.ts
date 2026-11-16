import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { generateCaKeyPair, pemEncode } from "@mattrax/crypto";
import {
  probeServerCertificate,
  runServerCertificateCheck,
  serverCertificatePeerFromDer,
} from "../src/serverCertificate.js";
import { serverCertificateInfo } from "../src/credentialHealth.js";
import { makeDb, runEffect } from "./helpers.js";

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
  }
}

const DAY = 24 * 60 * 60 * 1000;

const now = new Date("2026-11-10T12:00:00.000Z");

const daysFromNow = (days: number) => new Date(now.getTime() + days * DAY);

/** A self-signed certificate plus the PEM key that matches it. */
const makeServerCertificate = async (notAfter: Date) => {
  const keys = await generateCaKeyPair();

  const attribute = (type: string, value: string) =>
    new pkijs.AttributeTypeAndValue({ type, value: new asn1js.Utf8String({ value }) });

  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ value: 42 });

  const name = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [attribute("2.5.4.3", "e.mattrax.app"), attribute("2.5.4.10", "Mattrax")],
  });

  certificate.issuer = name;
  certificate.subject = name;
  certificate.notBefore.value = new Date(notAfter.getTime() - 365 * DAY);
  certificate.notAfter.value = notAfter;
  await certificate.subjectPublicKeyInfo.importKey(keys.publicKey);
  await certificate.sign(keys.privateKey, "SHA-256");

  return {
    certificate,
    certPem: pemEncode("CERTIFICATE", certificate.toSchema(true).toBER(false)),
    keyPem: pemEncode("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", keys.privateKey)),
  };
};

describe("serverCertificateInfo", () => {
  it("reports a missing observation as missing rather than healthy", () => {
    expect(serverCertificateInfo(null, now)).toMatchObject({
      configured: false,
      level: "missing",
      origin: null,
      authorized: null,
    });
  });

  it("classifies expiry with the shared credential thresholds", () => {
    const row = (notAfter: Date) => ({
      origin: "https://e.mattrax.app",
      hostname: "e.mattrax.app",
      checkedAt: now,
      notBefore: daysFromNow(-300),
      notAfter,
      subject: "CN=e.mattrax.app",
      issuer: "CN=Test CA",
      authorized: true,
      authorizationError: null,
      error: null,
    });

    expect(serverCertificateInfo(row(daysFromNow(60)), now).level).toBe("ok");
    expect(serverCertificateInfo(row(daysFromNow(30)), now).level).toBe("warning");
    expect(serverCertificateInfo(row(daysFromNow(7)), now).level).toBe("critical");
    expect(serverCertificateInfo(row(daysFromNow(-1)), now).level).toBe("expired");
  });

  it("escalates an untrusted chain and an incomplete probe", () => {
    const base = {
      origin: "https://e.mattrax.app",
      hostname: "e.mattrax.app",
      checkedAt: now,
      notBefore: daysFromNow(-300),
      notAfter: daysFromNow(60),
      subject: "CN=e.mattrax.app",
      issuer: "CN=Test CA",
      error: null,
    };

    expect(
      serverCertificateInfo(
        { ...base, authorized: false, authorizationError: "SELF_SIGNED_CERT_IN_CHAIN" },
        now,
      ),
    ).toMatchObject({ level: "critical", authorized: false });

    expect(
      serverCertificateInfo(
        {
          ...base,
          authorized: false,
          authorizationError: null,
          notAfter: null,
          error: "TLS probe timed out after 10000ms",
        },
        now,
      ),
    ).toMatchObject({ level: "unknown", error: expect.stringContaining("timed out") });
  });
});

describe("serverCertificatePeerFromDer", () => {
  it("reads subject, issuer, serial and expiry from DER", async () => {
    const { certificate } = await makeServerCertificate(daysFromNow(90));
    const der = new Uint8Array(certificate.toSchema().toBER(false));

    const peer = await serverCertificatePeerFromDer({
      der,
      hostname: "e.mattrax.app",
      port: 443,
      authorized: true,
      authorizationError: null,
      chainLength: 2,
    });

    expect(peer).toMatchObject({
      hostname: "e.mattrax.app",
      port: 443,
      subject: "CN=e.mattrax.app, O=Mattrax",
      issuer: "CN=e.mattrax.app, O=Mattrax",
      serialNumber: "2a",
      authorized: true,
      chainLength: 2,
    });
    expect(peer.notAfter?.toISOString()).toBe(daysFromNow(90).toISOString());
    expect(peer.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("runServerCertificateCheck", () => {
  it("records an observation and throttles the next run", async () => {
    const db = makeDb();

    const peer = {
      hostname: "e.mattrax.app",
      port: 443,
      subject: "CN=e.mattrax.app",
      issuer: "CN=Test CA",
      serialNumber: "2a",
      fingerprintSha256: "a".repeat(64),
      notBefore: daysFromNow(-300),
      notAfter: daysFromNow(60),
      authorized: true,
      authorizationError: null,
      chainLength: 2,
    };

    let probes = 0;

    const probe = () =>
      Effect.sync(() => {
        probes += 1;

        return peer;
      });

    const first = await runEffect(
      runServerCertificateCheck(db, { origin: "https://e.mattrax.app", now, probe }),
    );

    expect(first.checked).toBe(true);
    expect(first.state.level).toBe("ok");
    expect(db.store.server_certificate_health).toHaveLength(1);
    expect(db.store.server_certificate_health[0]).toMatchObject({
      origin: "https://e.mattrax.app",
      hostname: "e.mattrax.app",
      checkedAt: now,
      authorized: true,
      chainLength: 2,
    });

    // One hour later the observation is still fresh, so nothing is probed.
    const second = await runEffect(
      runServerCertificateCheck(db, {
        origin: "https://e.mattrax.app",
        now: new Date(now.getTime() + 30 * 60 * 1000),
        probe,
      }),
    );

    expect(second.checked).toBe(false);
    expect(probes).toBe(1);

    // After the interval it probes again and updates the same row.
    const third = await runEffect(
      runServerCertificateCheck(db, {
        origin: "https://e.mattrax.app",
        now: new Date(now.getTime() + 61 * 60 * 1000),
        probe,
      }),
    );

    expect(third.checked).toBe(true);
    expect(probes).toBe(2);
    expect(db.store.server_certificate_health).toHaveLength(1);
  });

  it("records a failed probe instead of leaving a stale healthy row", async () => {
    const db = makeDb();

    const result = await runEffect(
      runServerCertificateCheck(db, {
        origin: "https://e.mattrax.app",
        now,
        force: true,
        probe: () => Effect.fail(new Error("getaddrinfo ENOTFOUND e.mattrax.app")),
      }),
    );

    expect(result.checked).toBe(true);
    expect(result.state).toMatchObject({
      configured: true,
      level: "unknown",
      authorized: false,
      error: expect.stringContaining("ENOTFOUND"),
    });
    expect(db.store.server_certificate_health[0]).toMatchObject({
      notAfter: null,
      authorized: false,
      error: expect.stringContaining("ENOTFOUND"),
    });
  });

  it("refuses to probe a non-https origin", async () => {
    const db = makeDb();

    const result = await runEffect(
      runServerCertificateCheck(db, {
        origin: "http://localhost:8080",
        now,
        force: true,
      }),
    );

    expect(result.state).toMatchObject({
      level: "unknown",
      error: expect.stringContaining("not https"),
    });
  });
});

describe("probeServerCertificate", () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  const serve = async (notAfter: Date) => {
    const material = await makeServerCertificate(notAfter);

    server = createServer({ key: material.keyPem, cert: material.certPem }, (_request, response) =>
      response.end("ok"),
    );

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    // SAFETY: a listening Node server always reports a bound socket address.
    const port = (server.address() as AddressInfo).port;

    return `https://127.0.0.1:${port}`;
  };

  it("performs a real TLS handshake and reports the served certificate", async () => {
    const origin = await serve(daysFromNow(60));

    const peer = await runEffect(probeServerCertificate({ origin, timeoutMs: 5_000 }));

    expect(peer.hostname).toBe("127.0.0.1");
    expect(peer.subject).toContain("CN=e.mattrax.app");
    expect(peer.chainLength).toBeGreaterThanOrEqual(1);
    expect(peer.notAfter?.toISOString()).toBe(daysFromNow(60).toISOString());
    // A self-signed certificate is deliberately observed, not rejected.
    expect(peer.authorized).toBe(false);
    expect(peer.authorizationError).toBeTruthy();
  });

  it("observes an expired certificate rather than failing the probe", async () => {
    const origin = await serve(daysFromNow(-5));

    const peer = await runEffect(probeServerCertificate({ origin, timeoutMs: 5_000 }));

    expect(peer.notAfter?.getTime()).toBeLessThan(now.getTime());
  });

  it("fails when the peer cannot be reached", async () => {
    // Port 1 is reserved and closed, so the TCP connection is refused.
    await expect(
      runEffect(probeServerCertificate({ origin: "https://127.0.0.1:1", timeoutMs: 2_000 })),
    ).rejects.toBeInstanceOf(Error);
  });
});
