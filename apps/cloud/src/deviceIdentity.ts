import { Option, Schema } from "effect";
import { boundedClientAddress } from "@mattrax/cloud-services";
import { parseSubjectDn } from "@mattrax/dm-apple";
import { isTrustedPeerAddress } from "./trustedPeer.js";

/** Set only by the Node HTTP adapter from the connected socket, then removed here. */
export const NODE_PEER_ADDRESS_HEADER = "x-mattrax-peer-address";

const identityHeaderNames = [
  "x-device-identity-certificate",
  "x-device-identity-certificate-serial",
  "x-device-identity-certificate-sha256",
] as const;

const TlsClientAuth = Schema.Struct({
  certVerified: Schema.optional(Schema.String),
  certRevoked: Schema.optional(Schema.Union([Schema.String, Schema.Boolean])),
  certSubjectDN: Schema.optional(Schema.String),
  certSerial: Schema.optional(Schema.String),
  certFingerprintSHA256: Schema.optional(Schema.String),
});

const RequestCfProperties = Schema.Struct({
  tlsClientAuth: Schema.optional(TlsClientAuth),
});

const decodeSubjectHeader = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export type DeviceIdentityOptions = {
  readonly trustIdentityHeaders: boolean;
  readonly trustedPeers: ReadonlySet<string>;
  readonly trustForwarded: boolean;
};

/**
 * Device identity must come from a verified mTLS handshake, never directly from
 * a caller. Cloudflare exposes the certificate subject on `request.cf`; a
 * self-hosted proxy terminates mTLS itself and forwards verified fields only
 * when its actual socket peer was explicitly configured as trusted.
 */
export const deviceIdentityHeaders = (
  request: Request,
  { trustIdentityHeaders, trustedPeers, trustForwarded }: DeviceIdentityOptions,
): Headers => {
  const headers = new Headers(request.headers);
  const peerAddress = headers.get(NODE_PEER_ADDRESS_HEADER)?.trim();
  const certificate = headers.get("x-device-identity-certificate")?.trim();
  const serial = headers.get("x-device-identity-certificate-serial")?.trim();
  const fingerprint = headers.get("x-device-identity-certificate-sha256")?.trim();

  // Every value in this group is untrusted until the branch below rebuilds it.
  // In particular, never leave a caller's certificate behind when its serial or
  // common name is missing: the Windows backend can otherwise route by OU.
  headers.delete(NODE_PEER_ADDRESS_HEADER);
  headers.delete("x-mattrax-client-address");
  for (const name of identityHeaderNames) headers.delete(name);

  // The client address keeps the existing deployment-wide forwarded-header
  // policy. The internal peer header is separate and is never caller-controlled.
  // SAFETY: Workers requests expose the platform's `cf` object; Node requests do not.
  const requestCf = (request as { cf?: unknown }).cf;
  const cloudflare = requestCf !== undefined;
  const address = boundedClientAddress(request.headers, { trustForwarded, cloudflare });

  if (address) headers.set("x-mattrax-client-address", address);

  if (
    trustIdentityHeaders &&
    !cloudflare &&
    isTrustedPeerAddress(peerAddress, trustedPeers) &&
    certificate &&
    serial &&
    parseSubjectDn(decodeSubjectHeader(certificate)).some(
      (attribute) => attribute.type === "CN" && attribute.value.trim().length > 0,
    )
  ) {
    headers.set("x-device-identity-certificate", certificate);
    headers.set("x-device-identity-certificate-serial", serial);
    if (fingerprint) headers.set("x-device-identity-certificate-sha256", fingerprint);

    return headers;
  }

  const cf = Option.getOrUndefined(Schema.decodeUnknownOption(RequestCfProperties)(requestCf));
  const tls = cf?.tlsClientAuth;

  if (tls?.certVerified === "SUCCESS" && tls.certRevoked !== "1" && tls.certRevoked !== true) {
    if (tls.certSubjectDN) headers.set("x-device-identity-certificate", tls.certSubjectDN);
    if (tls.certSerial) headers.set("x-device-identity-certificate-serial", tls.certSerial);
    if (tls.certFingerprintSHA256)
      headers.set("x-device-identity-certificate-sha256", tls.certFingerprintSHA256);
  }

  return headers;
};
