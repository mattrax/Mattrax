/** The pkijs module, as returned by {@link loadPkijs}. */
export type PkijsModule = typeof import("pkijs");

/** The asn1js module. pkijs needs it too, but this is the direct copy. */
export type Asn1jsModule = typeof import("asn1js");

let loading: Promise<PkijsModule> | undefined;

/**
 * Load pkijs on first use instead of at module evaluation.
 *
 * pkijs is a large dependency that only the SCEP, APNs and Apple signing paths
 * need, so a static import would put it in every Worker's startup closure even
 * for a request that never touches a certificate. Every operation that needs
 * pkijs awaits this first; the promise is shared, so the module is evaluated
 * once per isolate and only when a certificate operation actually runs.
 *
 * The WebCrypto engine is installed here rather than at the top level because
 * pkijs resolves digests and signatures through it.
 */
export const loadPkijs = (): Promise<PkijsModule> => {
  loading ??= import("pkijs").then((pkijs) => {
    if (typeof crypto !== "undefined" && crypto.subtle !== undefined) {
      try {
        pkijs.getEngine();
      } catch {
        pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
      }
    }

    return pkijs;
  });

  return loading;
};
