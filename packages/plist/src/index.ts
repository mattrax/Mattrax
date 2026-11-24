import { Effect, Predicate, Schema } from "effect";
import { parse as fastPlistParse } from "fast-plist";
import { PlistParseError, PlistSerializeError, PlistValue } from "./schema.js";
import type { PlistValue as PlistValueType } from "./schema.js";

export * from "./schema.js";

const PlistArray = Schema.Array(PlistValue);

const PlistDictionary = Schema.Record(Schema.String, PlistValue);

const PlistBytes = Schema.instanceOf(Uint8Array);

const PlistDate = Schema.instanceOf(Date);

type PlistSerializationInput = PlistValueType | null | undefined;

const normalizeForSerialization = (value: PlistSerializationInput): PlistValueType => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(normalizeForSerialization);

  if (
    Predicate.isObject(value) &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array) &&
    !(value instanceof ArrayBuffer)
  )
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeForSerialization(item as PlistSerializationInput),
      ]),
    );

  return value as PlistValueType;
};

export const parsePlist = (content: string): Effect.Effect<PlistValue, PlistParseError> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(PlistValue)(fastPlistParse(content)),
    catch: (cause) => new PlistParseError({ message: String(cause), cause }),
  });

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function serializeValue(value: PlistValueType): string {
  if (value === null || value === undefined) {
    return "<string></string>";
  }

  if (Schema.is(Schema.Boolean)(value)) {
    return value ? "<true/>" : "<false/>";
  }

  if (Schema.is(Schema.Finite)(value)) {
    if (Number.isInteger(value)) {
      return `<integer>${value}</integer>`;
    }

    return `<real>${value}</real>`;
  }

  if (Schema.is(Schema.String)(value)) {
    return `<string>${escapeXml(value)}</string>`;
  }

  if (Schema.is(PlistBytes)(value)) {
    return `<data>${btoa(String.fromCharCode(...value))}</data>`;
  }

  if (Schema.is(Schema.instanceOf(ArrayBuffer))(value)) {
    return `<data>${btoa(String.fromCharCode(...new Uint8Array(value)))}</data>`;
  }

  if (Schema.is(PlistDate)(value)) {
    return `<date>${value.toISOString().replace(/\.\d{3}Z$/, "Z")}</date>`;
  }

  if (Schema.is(PlistArray)(value)) {
    const items = value.map((item) => serializeValue(item)).join("");

    return `<array>${items}</array>`;
  }

  if (Schema.is(PlistDictionary)(value)) {
    const entries = Object.entries(value)
      .map(([key, item]) => `<key>${escapeXml(key)}</key>${serializeValue(item)}`)
      .join("");

    return `<dict>${entries}</dict>`;
  }

  return `<string>${escapeXml(String(value))}</string>`;
}

export const serializePlist = (value: PlistValueType): Effect.Effect<string, PlistSerializeError> =>
  Effect.try({
    try: () => {
      // Validate before emitting XML. In particular, NaN and infinities are
      // valid JavaScript numbers but not valid plist <real> values.
      const body = serializeValue(
        Schema.decodeUnknownSync(PlistValue)(normalizeForSerialization(value)),
      );

      return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">${body}</plist>`;
    },
    catch: (cause) => new PlistSerializeError({ message: String(cause), cause }),
  });
