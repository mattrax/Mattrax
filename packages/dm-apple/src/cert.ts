import { parseCertificateMetadata } from "@mattrax/apns";

/**
 * Parsed topics are keyed by the certificate PEM itself. A rotated certificate
 * is a different key, so rotation takes effect immediately without a TTL, while
 * repeated runtimes in the same isolate reuse one PKIjs parse/import.
 */
const topicCache = new Map<string, Promise<string | null>>();
const MAX_CACHED_CERTIFICATES = 8;

/** Test hook: drop parsed topics so tests observe a fresh parse. */
export const resetAppleTopicCache = (): void => {
  topicCache.clear();
};

/**
 * Read the APNs topic from the same X.509 parser used by certificate uploads.
 * Apple MDM vendor certificates normally carry the topic in UID; older
 * certificates carry it in CN, so retain that compatibility fallback.
 *
 * The cache is module-wide (configuration scope), not service-instance scope:
 * the hosted Worker rebuilds its Effect graph per request.
 */
export function extractTopicFromCertPem(pem: string): Promise<string | null> {
  const key = pem.trim();
  const cached = topicCache.get(key);

  if (cached) {
    // Refresh insertion order so eviction drops the least-recently used PEM.
    topicCache.delete(key);
    topicCache.set(key, cached);

    return cached;
  }

  const parsed = parseTopic(pem);
  topicCache.set(key, parsed);

  while (topicCache.size > MAX_CACHED_CERTIFICATES) {
    const oldest = topicCache.keys().next().value;

    if (oldest === undefined) break;
    topicCache.delete(oldest);
  }

  return parsed;
}

async function parseTopic(pem: string): Promise<string | null> {
  try {
    const metadata = await parseCertificateMetadata(pem);

    return metadata.topic ?? metadata.commonName;
  } catch {
    return null;
  }
}
