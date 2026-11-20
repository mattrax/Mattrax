/**
 * ADMX import: parse a vendor or in-box Administrative Template and translate
 * its policies into Policy CSP settings.
 *
 * This module has no UI dependency and no I/O; callers read files (or a zip)
 * and pass text in. See `docs/reference/policy-catalogue.md`.
 */
export * from "./types.js";

export { ADMX_LIMITS, AdmxImportError, parseXml, type XmlElement } from "./xml.js";

export { parseAdmxFile, textByteLength, type ParseAdmxOptions } from "./parse.js";

export {
  ADMX_DEVICE_ROOT,
  ADMX_USER_ROOT,
  admxAppName,
  admxDataValue,
  admxFileId,
  admxInboxPolicyOmaUri,
  admxInstallOmaUri,
  admxSegment,
  admxVendorArea,
  admxVendorPolicyOmaUri,
  translateAdmxPolicy,
  type AdmxPolicySpec,
} from "./translate.js";

export {
  ADMX_CATALOGUE_INDEX_VERSION,
  buildAdmxCatalogueIndex,
  matchAdmxCataloguePolicy,
  type AdmxCatalogueCollection,
} from "./catalogue.js";

export { admxPairKey, crc32, decodeText, readAdmxZip, type ReadAdmxZipOptions } from "./zip.js";

export { parseAdmxBundle, type ParseAdmxBundleOptions } from "./bundle.js";
