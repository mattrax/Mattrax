/** The pkijs module, as returned by {@link loadPkijs}. */
export type PkijsModule = typeof import("pkijs");

/** The asn1js module, used to build the ASN.1 values pkijs is given. */
export type Asn1jsModule = typeof import("asn1js");

let loading: Promise<PkijsModule> | undefined;

/**
 * Load pkijs on first use instead of at module evaluation.
 *
 * APNs certificate parsing is the only part of this package that needs pkijs,
 * and a deployment without an APNs certificate never runs it. Awaiting this in
 * the parsing helpers keeps ~0.5 MB out of the Worker's startup closure; the
 * promise is shared, so the module is evaluated once per isolate.
 *
 * The WebCrypto engine is installed here because pkijs resolves signatures
 * through it.
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
