import { parse } from "yaml";
import {
  cleanText,
  downloadTarball,
  listFiles,
  mapLimit,
  readFileText,
  withTempDir,
} from "./util.mjs";

const REPO = "https://codeload.github.com/apple/device-management/tar.gz/refs/heads/release";
const BLOB = "https://github.com/apple/device-management/blob/release";
const CONCURRENCY = 8;

const OS_DISPLAY = {
  ios: "iOS",
  macos: "macOS",
  macosx: "macOS",
  tvos: "tvOS",
  watchos: "watchOS",
  visionos: "visionOS",
  ipados: "iPadOS",
};

const displayOs = (os) => OS_DISPLAY[os.toLowerCase()] ?? os;

const mapType = (raw) => {
  const type = (raw ?? "").replace(/[<>]/g, "").toLowerCase();

  switch (type) {
    case "boolean":
      return "boolean";
    case "integer":
      return "integer";
    case "real":
    case "float":
    case "double":
    case "number":
      return "real";
    case "date":
      return "date";
    case "data":
      return "data";
    case "array":
      return "array";
    case "dictionary":
      return "dictionary";
    case "string":
      return "string";
    default:
      return "unknown";
  }
};

const compareVersions = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);

  for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
    const difference = (pa[index] ?? 0) - (pb[index] ?? 0);

    if (difference !== 0) return difference;
  }

  return 0;
};

/** Earliest `introduced` across OSes, and whether any OS marks it deprecated. */
const osSummary = (inherit, own) => {
  const versions = new Map();
  let deprecated = false;
  let removed = false;

  const add = (os, info) => {
    if (info?.introduced && info.introduced !== "n/a") {
      versions.set(displayOs(os), info.introduced);
    }

    if (info?.deprecated) deprecated = true;

    if (info?.removed) removed = true;
  };

  for (const [os, info] of Object.entries(inherit ?? {})) add(os, info);

  for (const [os, info] of Object.entries(own ?? {})) add(os, info);

  let best;

  for (const [os, version] of versions) {
    if (!best || compareVersions(version, best.version) < 0) {
      best = { label: os, version };
    }
  }

  return {
    minOs: best?.version,
    introducedIn: best ? `${best.label} ${best.version}` : undefined,
    osVersions: versions.size ? [...versions.keys()] : undefined,
    deprecated,
    removed,
  };
};

const appleEnum = (values) => {
  if (!values?.length) return undefined;

  return values.map((value) => ({ value: String(value) }));
};

const toProperty = (key, inheritOS, category, depth = 0, seen = new Set()) => {
  if (!key.key) return undefined;

  if (seen.has(key) || depth > 10) return undefined;

  const nextSeen = new Set(seen).add(key);
  const os = osSummary(inheritOS, key.supportedOS);

  const number = (value) => (value === undefined ? undefined : Number(value));

  return {
    key: key.key,
    name: cleanText(key.title, 200) || key.key,
    type: mapType(key.type),
    description: cleanText(key.content),
    defaultValue: key.default,
    required: key.presence === "required",
    enum: appleEnum(key.rangelist),
    deprecated: os.deprecated || undefined,
    minOs: os.minOs,
    introducedIn: os.introducedIn,
    pattern: key.format || undefined,
    min: number(key.range?.min),
    max: number(key.range?.max),
    category,
    children: key.subkeys?.length
      ? key.subkeys
          .map((child) => toProperty(child, inheritOS, undefined, depth + 1, nextSeen))
          .filter((child) => child !== undefined)
      : undefined,
  };
};

const payloadCollection = (doc, surface, envelope, file) => {
  const isDdm = surface === "ddm";
  const identifier = isDdm ? doc.payload?.declarationtype : doc.payload?.payloadtype;

  if (!identifier) return undefined;

  const inheritOS = doc.payload?.supportedOS;
  const os = osSummary(inheritOS, undefined);

  const properties = (doc.payloadkeys ?? [])
    .map((key) => toProperty(key, inheritOS))
    .filter((property) => property !== undefined);

  return {
    id: `apple/${surface}/${identifier}`,
    platform: "apple",
    kind: isDdm ? "declaration" : "profile",
    surface,
    identifier,
    name: cleanText(doc.title, 200) || identifier,
    description: cleanText(doc.description),
    minOs: os.minOs,
    osVersions: os.osVersions,
    deprecated: os.deprecated || undefined,
    properties: [...envelope, ...properties],
    source: `${BLOB}/${file}`,
  };
};

const relative = (path, root) => path.slice(root.length + 1);

export const loadApple = () =>
  withTempDir(async (dir) => {
    const root = await downloadTarball(REPO, dir, "apple/device-management");

    const profileFiles = await listFiles(
      `${root}/mdm/profiles`,
      (path) => path.endsWith(".yaml") && !path.endsWith("CommonPayloadKeys.yaml"),
    );

    const declarationFiles = await listFiles(
      `${root}/declarative/declarations`,
      (path) => path.endsWith(".yaml") && !path.endsWith("declarationbase.yaml"),
    );

    const commonKeysRaw = await readFileText(`${root}/mdm/profiles/CommonPayloadKeys.yaml`);
    const commonDoc = parse(commonKeysRaw) ?? {};

    const envelope = (commonDoc.payloadkeys ?? [])
      .map((key) => toProperty(key, commonDoc.payload?.supportedOS, "Envelope"))
      .filter((property) => property !== undefined);

    const baseRaw = await readFileText(`${root}/declarative/declarations/declarationbase.yaml`);
    const baseDoc = parse(baseRaw) ?? {};

    const ddmEnvelope = (baseDoc.payloadkeys ?? [])
      .map((key) => toProperty(key, baseDoc.payload?.supportedOS, "Envelope"))
      .filter((property) => property !== undefined);

    const readDoc = async (path) => parse(await readFileText(path));

    const profiles = await mapLimit(profileFiles, CONCURRENCY, async (path) => {
      const doc = await readDoc(path);

      return payloadCollection(doc, "profiles", envelope, relative(path, root));
    });

    const declarations = await mapLimit(declarationFiles, CONCURRENCY, async (path) => {
      const doc = await readDoc(path);

      return payloadCollection(doc, "ddm", ddmEnvelope, relative(path, root));
    });

    return [...profiles, ...declarations].filter((collection) => collection !== undefined);
  });
