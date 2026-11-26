import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import {
  serializeSoapElement,
  deserializeSoapElement,
  serializeSoapEnvelope,
  extractSoapBody,
} from "../src/index.js";

const runPromise = <E, A>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

/** A minimal namespaced document, standing in for a transport consumer. */
const DiscoverRequest = Schema.Struct({
  request: Schema.Struct({
    requestVersion: Schema.String.pipe(Schema.annotateKey({ soapElementName: "RequestVersion" })),
    authPolicies: Schema.Array(
      Schema.String.pipe(Schema.annotateKey({ soapElementName: "AuthPolicy" })),
    ).pipe(Schema.annotateKey({ soapElementName: "AuthPolicies" })),
  }),
}).pipe(
  Schema.annotate({
    identifier: "Discover",
    soapNamespace: "urn:example:discover",
  }),
);

describe("Round-trip tests", () => {
  it("should round-trip a complex nested structure", async () => {
    const Inner = Schema.Struct({
      id: Schema.Number,
      label: Schema.String.pipe(Schema.annotateKey({ soapElementName: "Label" })),
    }).pipe(Schema.annotate({ identifier: "Inner" }));

    const Outer = Schema.Struct({
      name: Schema.String,
      inners: Schema.Array(Inner.pipe(Schema.annotateKey({ soapElementName: "Inner" }))).pipe(
        Schema.annotateKey({ soapElementName: "Inners" }),
      ),
      meta: Schema.Struct({
        version: Schema.String.pipe(Schema.annotateKey({ soapElementName: "Version" })),
        count: Schema.optional(Schema.Number).pipe(
          Schema.annotateKey({ soapElementName: "Count" }),
        ),
      }).pipe(Schema.annotate({ identifier: "Meta" })),
    }).pipe(Schema.annotate({ identifier: "Outer" }));

    const original = {
      name: "test",
      inners: [
        { id: 1, label: "a" },
        { id: 2, label: "b" },
      ],
      meta: { version: "1.0", count: undefined },
    };

    const xml = await runPromise(serializeSoapElement(Outer, original));
    const result = await runPromise(deserializeSoapElement(xml, Outer));
    expect(result).toEqual(original);
  });

  it("should round-trip through a SOAP envelope", async () => {
    const body = await runPromise(
      serializeSoapElement(DiscoverRequest, {
        request: {
          requestVersion: "5.0",
          authPolicies: ["OnPremise"],
        },
      }),
    );

    const envelope = serializeSoapEnvelope({
      header: {
        action: "http://example.com/Discover",
        messageId: "urn:uuid:test",
        to: "https://example.com",
      },
      body,
    });

    const extractedBody = extractSoapBody(envelope);
    const result = await runPromise(deserializeSoapElement(extractedBody, DiscoverRequest));
    expect(result.request.requestVersion).toBe("5.0");
    expect(result.request.authPolicies).toEqual(["OnPremise"]);
  });

  it("round-trips records without losing namespaces", async () => {
    const RecordValue = Schema.Record(Schema.String, Schema.String).pipe(
      Schema.annotate({ identifier: "RecordValue" }),
    );
    const original = {
      alpha: "a",
      "{urn:beta}beta": "b",
      "{urn:left}item": "left",
      "{urn:right}item": "right",
    };
    const xml = await runPromise(serializeSoapElement(RecordValue, original));

    expect(xml).toContain('<beta xmlns="urn:beta">b</beta>');
    await expect(runPromise(deserializeSoapElement(xml, RecordValue))).resolves.toEqual(original);
  });

  it("round-trips array-valued records whose key matches the item name", async () => {
    const RecordValue = Schema.Record(Schema.String, Schema.Array(Schema.String)).pipe(
      Schema.annotate({ identifier: "RecordValue" }),
    );
    const original = { item: ["a", "b"] };
    const xml = await runPromise(serializeSoapElement(RecordValue, original));

    await expect(runPromise(deserializeSoapElement(xml, RecordValue))).resolves.toEqual(original);
  });

  it("round-trips namespaced attributes with unambiguous prefixes", async () => {
    const Item = Schema.Struct({
      left: Schema.String.pipe(
        Schema.annotateKey({ soapAttribute: true, soapAttributeName: "{urn:left}value" }),
      ),
      right: Schema.String.pipe(
        Schema.annotateKey({ soapAttribute: true, soapAttributeName: "{urn:right}value" }),
      ),
      otherLeft: Schema.String.pipe(
        Schema.annotateKey({ soapAttribute: true, soapAttributeName: "{urn:left}other" }),
      ),
    }).pipe(Schema.annotate({ identifier: "Item" }));
    const original = { left: "a", right: "b", otherLeft: "c" };
    const xml = await runPromise(serializeSoapElement(Item, original));

    await expect(runPromise(deserializeSoapElement(xml, Item))).resolves.toEqual(original);
  });

  it("round-trips a discriminated object union", async () => {
    const Choice = Schema.Union([
      Schema.Struct({ kind: Schema.Literal("text"), value: Schema.String }).pipe(
        Schema.annotate({ identifier: "TextChoice" }),
      ),
      Schema.Struct({ kind: Schema.Literal("count"), value: Schema.Number }).pipe(
        Schema.annotate({ identifier: "CountChoice" }),
      ),
    ]);
    const original = { kind: "count" as const, value: 2 };
    const xml = await runPromise(serializeSoapElement(Choice, original));

    await expect(runPromise(deserializeSoapElement(xml, Choice))).resolves.toEqual(original);
  });

  it("round-trips primitive unions without coercing the selected branch", async () => {
    const Scalar = Schema.Union([Schema.Boolean, Schema.String]);

    for (const original of [true, false, "hello"] as const) {
      const xml = await runPromise(serializeSoapElement(Scalar, original));

      await expect(runPromise(deserializeSoapElement(xml, Scalar))).resolves.toBe(original);
    }
  });
});

describe("Error handling", () => {
  it("should return SoapSerializeError on invalid input", async () => {
    const Strict = Schema.Struct({
      required: Schema.String,
    }).pipe(Schema.annotate({ identifier: "Strict" }));

    // @ts-expect-error -- deliberately invalid input exercises the serializer error path.
    const effect = serializeSoapElement(Strict, {});
    const result = await Effect.runPromise(effect.pipe(Effect.result));

    expect(result._tag).toBe("Failure");
  });

  it("should return SoapParseError on malformed XML", async () => {
    const Simple = Schema.Struct({ a: Schema.String }).pipe(
      Schema.annotate({ identifier: "Simple" }),
    );

    const result = await Effect.runPromise(
      deserializeSoapElement("<<<not xml>>>", Simple).pipe(Effect.result),
    );

    expect(result._tag).toBe("Failure");
  });
});
