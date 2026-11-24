import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { deserializeSoapElement, serializeSoapElement } from "../src/index.js";

const runPromise = <E, A>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

describe("SOAP Serializer", () => {
  it("should serialize a simple struct with annotations", async () => {
    const Person = Schema.Struct({
      name: Schema.String.pipe(Schema.annotateKey({ soapElementName: "Name" })),
      age: Schema.Number.pipe(Schema.annotateKey({ soapElementName: "Age" })),
    }).pipe(Schema.annotate({ identifier: "Person" }));

    const xml = await runPromise(serializeSoapElement(Person, { name: "Alice", age: 30 }));
    expect(xml).toContain("<Person>");
    expect(xml).toContain("<Name>Alice</Name>");
    expect(xml).toContain("<Age>30</Age>");
  });

  it("should serialize with namespaces", async () => {
    const Person = Schema.Struct({
      name: Schema.String,
    }).pipe(
      Schema.annotate({
        identifier: "Person",
        soapNamespace: "http://example.com/ns",
        soapNamespacePrefix: "ex",
      }),
    );

    const xml = await runPromise(serializeSoapElement(Person, { name: "Bob" }));
    expect(xml).toContain('xmlns:ex="http://example.com/ns"');
    expect(xml).toContain("<ex:Person");
  });

  it("should serialize XML attributes", async () => {
    const Item = Schema.Struct({
      id: Schema.Number.pipe(Schema.annotateKey({ soapAttribute: true, soapAttributeName: "ID" })),
      name: Schema.String,
    }).pipe(Schema.annotate({ identifier: "Item" }));

    const xml = await runPromise(serializeSoapElement(Item, { id: 42, name: "Widget" }));
    expect(xml).toContain('<Item ID="42">');
    expect(xml).toContain("<name>Widget</name>");
  });

  it("should serialize arrays with custom item names", async () => {
    const List = Schema.Struct({
      items: Schema.Array(Schema.String.pipe(Schema.annotateKey({ soapElementName: "Item" }))).pipe(
        Schema.annotateKey({ soapElementName: "Items" }),
      ),
    }).pipe(Schema.annotate({ identifier: "List" }));

    const xml = await runPromise(serializeSoapElement(List, { items: ["a", "b"] }));
    expect(xml).toContain("<Items>");
    expect(xml).toContain("<Item>a</Item>");
    expect(xml).toContain("<Item>b</Item>");
  });

  it("should skip optional fields when undefined", async () => {
    const Config = Schema.Struct({
      required: Schema.String,
      optional: Schema.optional(Schema.String).pipe(
        Schema.annotateKey({ soapElementName: "Optional" }),
      ),
    }).pipe(Schema.annotate({ identifier: "Config" }));

    const xml = await runPromise(serializeSoapElement(Config, { required: "yes" }));
    expect(xml).toContain("<required>yes</required>");
    expect(xml).not.toContain("Optional");
  });

  it("should render xsi:nil for optional nil fields", async () => {
    const Config = Schema.Struct({
      required: Schema.String,
      optional: Schema.optional(Schema.String).pipe(
        Schema.annotateKey({ soapElementName: "Optional", soapOptionalNil: true }),
      ),
    }).pipe(Schema.annotate({ identifier: "Config" }));

    const xml = await runPromise(serializeSoapElement(Config, { required: "yes" }));
    expect(xml).toContain('xsi:nil="true"');
    expect(xml).toContain('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');

    const reparsed = await runPromise(deserializeSoapElement(xml, Config));
    expect(reparsed).toEqual({ required: "yes", optional: undefined });
  });

  it("should escape XML special characters", async () => {
    const Message = Schema.Struct({
      text: Schema.String,
    }).pipe(Schema.annotate({ identifier: "Message" }));

    const xml = await runPromise(serializeSoapElement(Message, { text: '<hello> & "world"' }));
    expect(xml).toContain('&lt;hello&gt; &amp; "world"');
  });

  it("should serialize nested structures", async () => {
    const Address = Schema.Struct({
      city: Schema.String,
      zip: Schema.String,
    }).pipe(Schema.annotate({ identifier: "Address" }));

    const Person = Schema.Struct({
      name: Schema.String,
      address: Address.pipe(Schema.annotateKey({ soapElementName: "Address" })),
    }).pipe(Schema.annotate({ identifier: "Person" }));

    const xml = await runPromise(
      serializeSoapElement(Person, { name: "Alice", address: { city: "NYC", zip: "10001" } }),
    );

    expect(xml).toContain("<Person>");
    expect(xml).toContain("<Address>");
    expect(xml).toContain("<city>NYC</city>");
  });

  it("should serialize with pretty: false", async () => {
    const Simple = Schema.Struct({
      a: Schema.String,
    }).pipe(Schema.annotate({ identifier: "Simple" }));

    const xml = await runPromise(serializeSoapElement(Simple, { a: "test" }, { pretty: false }));
    expect(xml).toBe("<Simple><a>test</a></Simple>");
  });

  it("should handle BigInt values", async () => {
    const Data = Schema.Struct({
      count: Schema.BigInt.pipe(Schema.annotateKey({ soapElementName: "Count" })),
    }).pipe(Schema.annotate({ identifier: "Data" }));

    const xml = await runPromise(serializeSoapElement(Data, { count: 9007199254740993n }));
    expect(xml).toContain("<Count>9007199254740993</Count>");
  });

  it("should handle null values", async () => {
    const Data = Schema.Struct({
      value: Schema.Null.pipe(Schema.annotateKey({ soapElementName: "Value" })),
    }).pipe(Schema.annotate({ identifier: "Data" }));

    const xml = await runPromise(serializeSoapElement(Data, { value: null }));
    expect(xml).toContain("<Data>");
    expect(xml).toContain("<Value/>");
  });
});
