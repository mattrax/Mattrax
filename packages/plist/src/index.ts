import { Effect, Schema } from "effect";
import { parse as fastPlistParse } from "fast-plist";
import { PlistParseError, PlistSerializeError, PlistValue } from "./schema.js";

export * from "./schema.js";

export const parsePlist = (content: string): Effect.Effect<PlistValue, PlistParseError> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(PlistValue)(fastPlistParse(content)),
    catch: (cause) => new PlistParseError({ message: String(cause), cause }),
  });

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function serializeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "<string></string>";
  }

  if (typeof value === "boolean") {
    return value ? "<true/>" : "<false/>";
  }

  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return `<integer>${value}</integer>`;
    }

    return `<real>${value}</real>`;
  }

  if (typeof value === "string") {
    return `<string>${escapeXml(value)}</string>`;
  }

  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
    const base64 = btoa(String.fromCharCode(...bytes));

    return `<data>${base64}</data>`;
  }

  if (value instanceof Date) {
    return `<date>${value.toISOString().replace(/\.\d{3}Z$/, "Z")}</date>`;
  }

  if (Array.isArray(value)) {
    const items = value.map((v) => serializeValue(v)).join("");

    return `<array>${items}</array>`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `<key>${escapeXml(k)}</key>${serializeValue(v)}`)
      .join("");

    return `<dict>${entries}</dict>`;
  }

  return `<string>${escapeXml(String(value))}</string>`;
}

export const serializePlist = (value: unknown): Effect.Effect<string, PlistSerializeError> =>
  Effect.try({
    try: () => {
      const body = serializeValue(value);

      return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">${body}</plist>`;
    },
    catch: (cause) => new PlistSerializeError({ message: String(cause), cause }),
  });
