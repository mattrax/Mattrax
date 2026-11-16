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
