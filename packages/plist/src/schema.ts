import { Data, Schema } from "effect";

export class PlistParseError extends Data.TaggedError("PlistParseError")<{
  message: string;
  cause?: unknown;
}> {}

export class PlistSerializeError extends Data.TaggedError("PlistSerializeError")<{
  message: string;
  cause?: unknown;
}> {}

export type PlistValue =
  | string
  | number
  | boolean
  | Date
  | Uint8Array
  | ArrayBuffer
  | readonly PlistValue[]
  | { readonly [key: string]: PlistValue };

export const PlistValue: Schema.Decoder<PlistValue> = Schema.suspend(() =>
  Schema.Union([
    Schema.String,
    Schema.Finite,
    Schema.Boolean,
    Schema.Date,
    Schema.instanceOf(Uint8Array),
    Schema.instanceOf(ArrayBuffer),
    Schema.Array(PlistValue),
    Schema.Record(Schema.String, PlistValue),
  ]),
);
