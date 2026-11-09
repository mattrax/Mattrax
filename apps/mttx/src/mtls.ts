import * as pkijs from "pkijs";

/** Convert the base64 DER certificate forwarded by mtls-proxy into a subject DN. */
export const clientCertificateSubject = (value: string | string[] | undefined) => {
  if (!value) return undefined;
  const encoded = Array.isArray(value) ? value[0] : value;
  if (!encoded) return undefined;
  try {
    const bytes = Buffer.from(encoded, "base64");
    const certificate = pkijs.Certificate.fromBER(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const parts = certificate.subject.typesAndValues.flatMap((attribute) => {
      const text = attribute.value.valueBlock as { value?: unknown };
      if (typeof text.value !== "string") return [];
      const key =
        attribute.type === "2.5.4.3"
          ? "CN"
          : attribute.type === "2.5.4.11"
            ? "OU"
            : attribute.type === "2.5.4.10"
              ? "O"
              : undefined;
      return key ? [`${key}=${text.value}`] : [];
    });
    return parts.length > 0 ? parts.join(",") : undefined;
  } catch {
    return undefined;
  }
};
