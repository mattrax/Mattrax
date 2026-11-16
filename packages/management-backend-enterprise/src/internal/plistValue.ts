import { Schema } from "effect";
import type { PlistValue } from "@mattrax/plist";

/** A plist dictionary as produced by the plist decoder. */
export type PlistObject = { readonly [key: string]: PlistValue };

/** Values accepted from device payloads, including a missing value. */
export type PlistInput = PlistValue | null | undefined;

const APPLICATION_TRUE = new Set(["true", "yes", "1", "on"]);

const APPLICATION_FALSE = new Set(["false", "no", "0", "off"]);

const STATUS_TRUE = new Set(["enabled", "true", "yes", "on", "1"]);

const STATUS_FALSE = new Set(["disabled", "false", "no", "off", "0"]);

export function isPlistObject(value: PlistInput): value is PlistObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array) &&
    !(value instanceof ArrayBuffer) &&
    !(value instanceof Date)
  );
}

export function isPlistArray(value: PlistInput): value is ReadonlyArray<PlistValue> {
  return Array.isArray(value);
}

/** Normalise a plist scalar that carries text, including integer values. */
export function plistText(value: PlistInput): string | undefined {
  if (Schema.is(Schema.String)(value)) {
    const trimmed = value.trim();

    return trimmed === "" ? undefined : trimmed;
  }

  if (Schema.is(Schema.Number)(value) && Number.isFinite(value)) return String(value);

  return undefined;
}

function booleanFromSets(
  value: PlistInput,
  trueValues: ReadonlySet<string>,
  falseValues: ReadonlySet<string>,
): boolean | undefined {
  if (Schema.is(Schema.Boolean)(value)) return value;

  if (Schema.is(Schema.Number)(value)) {
    if (value === 1) return true;

    if (value === 0) return false;

    return undefined;
  }

  if (Schema.is(Schema.String)(value)) {
    const normalised = value.trim().toLowerCase();

    if (trueValues.has(normalised)) return true;

    if (falseValues.has(normalised)) return false;
  }

  return undefined;
}

/** Normalise the booleans reported in application inventories. */
export function plistBoolean(value: PlistInput): boolean | undefined {
  return booleanFromSets(value, APPLICATION_TRUE, APPLICATION_FALSE);
}

/** Normalise the enabled/disabled vocabulary reported by security status. */
export function plistStatusBoolean(value: PlistInput): boolean | undefined {
  return booleanFromSets(value, STATUS_TRUE, STATUS_FALSE);
}
