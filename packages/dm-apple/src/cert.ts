import { parseCertificateMetadata } from "@mattrax/apns";

/**
 * Read the APNs topic from the same X.509 parser used by certificate uploads.
 * Apple MDM vendor certificates normally carry the topic in UID; older
 * certificates carry it in CN, so retain that compatibility fallback.
 */
export async function extractTopicFromCertPem(pem: string): Promise<string | null> {
  try {
    const metadata = await parseCertificateMetadata(pem);

    return metadata.topic ?? metadata.commonName;
  } catch {
    return null;
  }
}
