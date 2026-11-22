/** The pkijs module, as returned by {@link loadPkijs}. */
export type PkijsModule = typeof import("pkijs");

/** The asn1js module, used to build the ASN.1 values pkijs is given. */
export type Asn1jsModule = typeof import("asn1js");

let loading: Promise<PkijsModule> | undefined;

/**
 * Load pkijs on first use instead of at module evaluation.
 *
 * Only the CMS verification and profile-signing paths need pkijs, and they run
 * when a signed message arrives or a profile is signed — not on every request.
 * Awaiting this keeps pkijs out of the Worker's startup closure; the promise is
 * shared, so the module is evaluated once per isolate.
 *
 * The WebCrypto engine is installed here because pkijs resolves digests and
 * signatures through it.
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
