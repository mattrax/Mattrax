import { Option, Result } from "effect";
import { NetAddress } from "effect/net";

/** Canonical numeric form, including IPv4-mapped IPv6 peers from dual-stack sockets. */
const canonicalIp = (value: string): string | undefined => {
  const parsed = NetAddress.ipFromString(value);

  if (Result.isFailure(parsed)) return undefined;

  const mapped = NetAddress.isIpv6Address(parsed.success)
    ? Option.getOrUndefined(NetAddress.fromIpv4Mapped(parsed.success))
    : undefined;
  const address = mapped ?? parsed.success;

  if (NetAddress.isUnspecified(address)) return undefined;

  return NetAddress.formatIp(address);
};

/**
 * Parse the explicitly configured immediate proxy peers. Hostnames, ranges and
 * unspecified addresses are rejected: the comparison must use the numeric
 * address of the socket that connected to this process, never a forwarded
 * header or a DNS name controlled by the deployment's request path.
 */
export const parseTrustedPeerAddresses = (value: string | undefined): ReadonlySet<string> => {
  const peers = new Set<string>();

  for (const entry of (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)) {
    const address = canonicalIp(entry);

    if (!address)
      throw new Error(
        `TRUSTED_DEVICE_IDENTITY_PEERS contains an invalid IPv4 or IPv6 peer: ${entry}`,
      );

    peers.add(address);
  }

  return peers;
};

export const isTrustedPeerAddress = (
  peer: string | undefined,
  trustedPeers: ReadonlySet<string>,
): boolean => {
  const address = peer?.trim();
  const canonical = address === undefined ? undefined : canonicalIp(address);

  return canonical !== undefined && trustedPeers.has(canonical);
};
