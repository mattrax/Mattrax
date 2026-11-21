import { Effect, Schema } from "effect";
import { parse as fastPlistParse } from "fast-plist";
import { PlistParseError, PlistSerializeError, PlistValue } from "./schema.js";
import type { PlistValue as PlistValueType } from "./schema.js";

export * from "./schema.js";

const PlistArray = Schema.Array(PlistValue);

const PlistDictionary = Schema.Record(Schema.String, PlistValue);

const PlistBytes = Schema.instanceOf(Uint8Array);

const PlistDate = Schema.instanceOf(Date);

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

  if (Schema.is(Schema.Number)(value)) {
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
      const body = serializeValue(value);

      return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">${body}</plist>`;
    },
    catch: (cause) => new PlistSerializeError({ message: String(cause), cause }),
  });
