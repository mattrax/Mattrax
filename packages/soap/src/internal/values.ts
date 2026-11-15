import { Schema } from "effect";

/** A JSON-like value produced or consumed by the SOAP codec. */
export type SoapValue =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | ReadonlyArray<SoapValue>
  | SoapObject;

/** A mutable SOAP object while a value tree is being assembled. */
export interface SoapObject {
  [key: string]: SoapValue;
}

/** Runtime contract for {@link SoapValue}; also used to narrow schema-decoded input. */
export const SoapValueSchema: Schema.Codec<SoapValue> = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.BigInt,
  Schema.Null,
  Schema.Undefined,
  Schema.Array(Schema.suspend(() => SoapValueSchema)),
  Schema.Record(
    Schema.String,
    Schema.suspend(() => SoapValueSchema),
  ),
]);

/** Return whether a value tree node is a non-array object. */
export function isSoapObject(value: SoapValue): value is SoapObject {
  return (
    value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
  );
}

/** Return whether a value tree node is an array. */
export function isSoapArray(value: SoapValue): value is ReadonlyArray<SoapValue> {
  return Array.isArray(value);
}
