/** The pkijs module, loaded once per isolate on first use. */
export type PkijsModule = typeof import("pkijs");

/** The asn1js module used to build ASN.1 values for pkijs. */
export type Asn1jsModule = typeof import("asn1js");

let loading: Promise<PkijsModule> | undefined;

/**
 * Load pkijs lazily and install its WebCrypto engine once. Keeping this adapter
 * in a small internal package lets APNs, Apple MDM and SCEP share the loader
 * without adding pkijs to the portable crypto root or duplicating engine setup.
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
