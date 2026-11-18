/**
 * The full public-suffix trie (~300 KB) is used once at startup to reject a
 * WebAuthn RP ID that is an IP literal or a bare public suffix. `@yielded/auth`
 * only reads `isIp`, `domain !== null` and `publicSuffix === host`, so a compact
 * table satisfies the same contract; the exact registrable domain is never
 * used. Keep the multi-label list in step with the suffixes customers deploy on.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "net.nz",
  "org.nz",
  "co.jp",
  "com.br",
  "com.cn",
  "co.in",
  "com.mx",
  "co.za",
  "github.io",
  "workers.dev",
]);

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export const parse = (hostname: string) => {
  const host = hostname.toLowerCase();
  const isIp = IPV4.test(host) || host.includes(":");
  const labels = host.split(".");
  const lastTwo = labels.slice(-2).join(".");

  const publicSuffix = isIp
    ? null
    : MULTI_LABEL_SUFFIXES.has(lastTwo)
      ? lastTwo
      : (labels.at(-1) ?? null);

  return {
    isIp,
    domain: isIp ? null : host,
    publicSuffix,
    hostname: host,
  };
};

export default { parse };
