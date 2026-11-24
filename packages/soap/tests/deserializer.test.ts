import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { deserializeSoapElement } from "../src/index.js";

const runPromise = <E, A>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

describe("SOAP Deserializer", () => {
  it("should deserialize a simple struct", async () => {
    const Person = Schema.Struct({
      name: Schema.String.pipe(Schema.annotateKey({ soapElementName: "Name" })),
      age: Schema.Number.pipe(Schema.annotateKey({ soapElementName: "Age" })),
    }).pipe(Schema.annotate({ identifier: "Person" }));

    const xml = `<Person><Name>Bob</Name><Age>25</Age></Person>`;
    const result = await runPromise(deserializeSoapElement(xml, Person));
    expect(result).toEqual({ name: "Bob", age: 25 });
  });

  it("should deserialize with attributes", async () => {
    const Item = Schema.Struct({
      id: Schema.Number.pipe(Schema.annotateKey({ soapAttribute: true, soapAttributeName: "ID" })),
      name: Schema.String,
    }).pipe(Schema.annotate({ identifier: "Item" }));

    const xml = `<Item ID="99"><name>Gadget</name></Item>`;
    const result = await runPromise(deserializeSoapElement(xml, Item));
    expect(result).toEqual({ id: 99, name: "Gadget" });
  });

  it("should deserialize arrays", async () => {
    const List = Schema.Struct({
      items: Schema.Array(Schema.String.pipe(Schema.annotateKey({ soapElementName: "Item" }))).pipe(
        Schema.annotateKey({ soapElementName: "Items" }),
      ),
    }).pipe(Schema.annotate({ identifier: "List" }));

    const xml = `<List><Items><Item>x</Item><Item>y</Item></Items></List>`;
    const result = await runPromise(deserializeSoapElement(xml, List));
    expect(result).toEqual({ items: ["x", "y"] });
  });

  it("should deserialize optional missing fields as undefined", async () => {
    const Config = Schema.Struct({
      required: Schema.String,
      optional: Schema.optional(Schema.String).pipe(
        Schema.annotateKey({ soapElementName: "Optional" }),
      ),
    }).pipe(Schema.annotate({ identifier: "Config" }));

    const xml = `<Config><required>yes</required></Config>`;
    const result = await runPromise(deserializeSoapElement(xml, Config));
    expect(result).toEqual({ required: "yes", optional: undefined });
  });

  it("should deserialize xsi:nil as undefined", async () => {
    const Config = Schema.Struct({
      required: Schema.String,
      optional: Schema.optional(Schema.String).pipe(
        Schema.annotateKey({ soapElementName: "Optional", soapOptionalNil: true }),
      ),
    }).pipe(Schema.annotate({ identifier: "Config" }));

    const xml = `<Config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><required>yes</required><Optional xsi:nil="true"/></Config>`;
    const result = await runPromise(deserializeSoapElement(xml, Config));
    expect(result).toEqual({ required: "yes", optional: undefined });
  });

  it("should deserialize BigInt from string", async () => {
    const Data = Schema.Struct({
      count: Schema.BigInt.pipe(Schema.annotateKey({ soapElementName: "Count" })),
    }).pipe(Schema.annotate({ identifier: "Data" }));

    const xml = `<Data><Count>123456789012345</Count></Data>`;
    const result = await runPromise(deserializeSoapElement(xml, Data));
    expect(result).toEqual({ count: 123456789012345n });
  });

  it("should handle special numbers", async () => {
    const Data = Schema.Struct({
      inf: Schema.Number,
      negInf: Schema.Number,
      nan: Schema.Number,
    }).pipe(Schema.annotate({ identifier: "Data" }));

    const xml = `<Data><inf>Infinity</inf><negInf>-Infinity</negInf><nan>NaN</nan></Data>`;
    const result = await runPromise(deserializeSoapElement(xml, Data));
    expect(result.inf).toBe(Infinity);
    expect(result.negInf).toBe(-Infinity);
    expect(Number.isNaN(result.nan)).toBe(true);
  });

  it("should fail on invalid XML", async () => {
    const Simple = Schema.Struct({ a: Schema.String }).pipe(
      Schema.annotate({ identifier: "Simple" }),
    );

    const result = await Effect.runPromise(
      deserializeSoapElement("<invalid", Simple).pipe(Effect.result),
    );

    expect(result._tag).toBe("Failure");
  });

  it("should fail on missing required element", async () => {
    const Strict = Schema.Struct({
      required: Schema.String,
    }).pipe(Schema.annotate({ identifier: "Strict" }));

    const result = await Effect.runPromise(
      deserializeSoapElement("<Strict></Strict>", Strict).pipe(Effect.result),
    );

    expect(result._tag).toBe("Failure");
  });

  it("lets Schema choose the matching union branch", async () => {
    const Choice = Schema.Union([
      Schema.Struct({
        kind: Schema.Literal("text"),
        value: Schema.String,
      }).pipe(Schema.annotate({ identifier: "TextChoice" })),
      Schema.Struct({
        kind: Schema.Literal("count"),
        value: Schema.Number,
      }).pipe(Schema.annotate({ identifier: "CountChoice" })),
    ]);

    const result = await runPromise(
      deserializeSoapElement(
        "<CountChoice><kind>count</kind><value>2</value></CountChoice>",
        Choice,
      ),
    );

    expect(result).toEqual({ kind: "count", value: 2 });
  });

  it("accepts the complete XML Schema boolean lexical space", async () => {
    const Value = Schema.Struct({ value: Schema.Boolean }).pipe(
      Schema.annotate({ identifier: "Value" }),
    );

    await expect(
      runPromise(deserializeSoapElement("<Value><value>1</value></Value>", Value)),
    ).resolves.toEqual({ value: true });
    await expect(
      runPromise(deserializeSoapElement("<Value><value>0</value></Value>", Value)),
    ).resolves.toEqual({ value: false });
    await expect(
      runPromise(
        deserializeSoapElement("<Value><value>yes</value></Value>", Value).pipe(Effect.result),
      ),
    ).resolves.toMatchObject({ _tag: "Failure" });
  });

  it("matches struct children by namespace instead of local name alone", async () => {
    const Root = Schema.Struct({
      value: Schema.String.pipe(
        Schema.annotateKey({ soapElementName: "Value", soapNamespace: "urn:right" }),
      ),
    }).pipe(Schema.annotate({ identifier: "Root", soapNamespace: "urn:root" }));

    const result = await runPromise(
      deserializeSoapElement(
        '<Root xmlns="urn:root" xmlns:wrong="urn:wrong"><wrong:Value>bad</wrong:Value><Value xmlns="urn:right">good</Value></Root>',
        Root,
      ),
    );

    expect(result).toEqual({ value: "good" });
  });
});
