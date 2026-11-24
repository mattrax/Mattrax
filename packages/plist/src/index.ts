import { Effect, Schema } from "effect";
import { parse as fastPlistParse } from "fast-plist";
import { PlistParseError, PlistSerializeError, PlistValue } from "./schema.js";
import type { PlistValue as PlistValueType } from "./schema.js";

export * from "./schema.js";

type PlistSerializationInput = PlistValueType | null | undefined;

const plistPrefix = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">`;

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

function serializeValue(value: unknown, allowNullish: boolean): string {
  if (value === null || value === undefined) {
    if (allowNullish) return "<string></string>";
    throw new TypeError("Expected a plist value");
  }

  if (typeof value === "string") {
    return `<string>${escapeXml(value)}</string>`;
  }

  if (typeof value === "boolean") {
    return value ? "<true/>" : "<false/>";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Expected a finite number");

    if (Number.isInteger(value)) {
      return `<integer>${value}</integer>`;
    }

    return `<real>${value}</real>`;
  }

  if (typeof value === "object") {
    if (value instanceof Uint8Array) {
      return `<data>${btoa(String.fromCharCode(...value))}</data>`;
    }

    if (value instanceof ArrayBuffer) {
      return `<data>${btoa(String.fromCharCode(...new Uint8Array(value)))}</data>`;
    }

    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return `<date>${value.toISOString().replace(/\.\d{3}Z$/, "Z")}</date>`;
    }

    if (Array.isArray(value)) {
      const items: string[] = [];

      for (let index = 0; index < value.length; index++) {
        if (allowNullish && !(index in value)) throw new TypeError("Expected a dense plist array");
        items.push(serializeValue(value[index], allowNullish));
      }

      return `<array>${items.join("")}</array>`;
    }

    const entries = Object.entries(value).map(
      ([key, item]) => `<key>${escapeXml(key)}</key>${serializeValue(item, allowNullish)}`,
    );

    return `<dict>${entries.join("")}</dict>`;
  }

  throw new TypeError(`Unsupported plist value of type ${typeof value}`);
}

const serialize = (
  value: unknown,
  allowNullish: boolean,
): Effect.Effect<string, PlistSerializeError> =>
  Effect.try({
    try: () => `${plistPrefix}${serializeValue(value, allowNullish)}</plist>`,
    catch: (cause) => new PlistSerializeError({ message: String(cause), cause }),
  });

/**
 * Validate and serialize a plist in one traversal, without cloning the tree.
 * Null and undefined retain their historical empty-string representation.
 */
export const serializePlist = (
  value: PlistSerializationInput,
): Effect.Effect<string, PlistSerializeError> => serialize(value, true);

/**
 * Serialize an already validated plist in one traversal.
 *
 * Callers must provide a value that satisfies PlistValue. Non-finite numbers
 * and unsupported leaves still fail closed, but null/undefined are not
 * normalized as they are by serializePlist.
 */
export const serializePlistTrusted = (
  value: PlistValueType,
): Effect.Effect<string, PlistSerializeError> => serialize(value, false);
