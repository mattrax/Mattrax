import { describe, it, expect, vi } from "vitest";
import { Effect, Exit, Schema } from "effect";
import {
  parsePlist,
  PlistParseError,
  PlistSerializeError,
  PlistValue,
  serializePlist,
  serializePlistTrusted,
} from "../index.js";

const PlistDictionary = Schema.Record(Schema.String, PlistValue);

const plistDocument = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">${body}</plist>`;

const serializers = [
  ["serializePlist", serializePlist],
  ["serializePlistTrusted", serializePlistTrusted],
] as const;

describe("plist", () => {
  describe("parsePlist", () => {
    it("parses a simple string value", async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><string>hello</string></plist>`;

      const result = await parsePlist(xml).pipe(Effect.runPromise);
      expect(result).toBe("hello");
    });

    it("parses a dictionary with multiple types", async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>name</key>
  <string>Test</string>
  <key>count</key>
  <integer>42</integer>
  <key>active</key>
  <true/>
  <key>ratio</key>
  <real>3.14</real>
</dict>
</plist>`;

      const result = Schema.decodeUnknownSync(PlistDictionary)(
        await parsePlist(xml).pipe(Effect.runPromise),
      );

      expect(result.name).toBe("Test");
      expect(result.count).toBe(42);
      expect(result.active).toBe(true);
      expect(result.ratio).toBe(3.14);
    });

    it("fails on invalid XML", async () => {
      const result = await parsePlist("not xml").pipe(Effect.runPromiseExit);
      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result)) {
        expect(String(result.cause)).toContain("PlistParseError");
      }
    });
  });

  describe("serializePlist", () => {
    it("serializes a dictionary", async () => {
      const result = await serializePlist({ name: "Test", count: 1 }).pipe(Effect.runPromise);
      expect(result).toContain("<key>name</key>");
      expect(result).toContain("<string>Test</string>");
      expect(result).toContain("<integer>1</integer>");
    });

    it("escapes XML entities in strings and keys", async () => {
      const result = await serializePlist({ "x<y": `<script>alert("xss'or'1'='1")</script>` }).pipe(
        Effect.runPromise,
      );

      expect(result).not.toContain("<script>");
      expect(result).toContain("<key>x&lt;y</key>");
      expect(result).toContain("&apos;or&apos;");
      expect(result).toContain("&quot;");
    });

    it("round-trips parse serialize parse for a complex dict", async () => {
      const original = {
        MessageType: "Authenticate",
        UDID: "abc-123",
        Tokens: ["one", "two"],
        Nested: { key: "value" },
      };

      const plist = await serializePlist(original).pipe(Effect.runPromise);

      const parsed = Schema.decodeUnknownSync(PlistDictionary)(
        await parsePlist(plist).pipe(Effect.runPromise),
      );

      expect(parsed.MessageType).toBe("Authenticate");
      expect(parsed.UDID).toBe("abc-123");
      expect(parsed.Tokens).toEqual(["one", "two"]);
      expect(parsed.Nested).toEqual({ key: "value" });
    });

    it.each([null, undefined])("normalizes root %s to an empty string", async (value) => {
      const result = await serializePlist(value).pipe(Effect.runPromise);

      expect(result).toBe(plistDocument("<string></string>"));
    });

    it("normalizes nested null and undefined to empty strings", async () => {
      // SAFETY: the typed contract excludes nullish descendants; this test probes the legacy runtime fallback.
      const result = await serializePlist({ values: [null, undefined] } as never).pipe(
        Effect.runPromise,
      );

      expect(result).toBe(
        plistDocument(
          "<dict><key>values</key><array><string></string><string></string></array></dict>",
        ),
      );
    });

    it("exposes typed parse errors", async () => {
      const result = await parsePlist("not xml").pipe(Effect.flip, Effect.runPromise);
      expect(result).toBeInstanceOf(PlistParseError);
    });

    it.each(["NaN", "Infinity", "-Infinity"])("rejects a non-finite <%s> real", async (value) => {
      const xml = `<plist version="1.0"><real>${value}</real></plist>`;
      const result = await parsePlist(xml).pipe(Effect.flip, Effect.runPromise);

      expect(result).toBeInstanceOf(PlistParseError);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      "rejects a non-finite number before serialization (%s)",
      async (value) => {
        const result = await serializePlist({ nested: [value] }).pipe(
          Effect.flip,
          Effect.runPromise,
        );

        expect(result).toBeInstanceOf(PlistSerializeError);
      },
    );
  });

  describe.each(serializers)("%s", (_name, serialize) => {
    it("preserves exact XML for every supported value", async () => {
      const bytes = new Uint8Array([0, 1, 127, 128, 255]);
      const value: PlistValue = {
        "key&<>'\"": "value&<>'\"",
        integer: -42,
        real: 1.5,
        negativeZero: -0,
        largeInteger: 1e21,
        smallReal: 1e-7,
        booleans: [true, false],
        emptyString: "",
        emptyArray: [],
        emptyDictionary: {},
        date: new Date("2024-01-15T10:30:00.123Z"),
        bytes,
        buffer: bytes.buffer,
        nested: [{ child: "value" }, ["leaf"]],
      };

      const result = await serialize(value).pipe(Effect.runPromise);

      expect(result).toBe(
        plistDocument(
          [
            "<dict>",
            "<key>key&amp;&lt;&gt;&apos;&quot;</key><string>value&amp;&lt;&gt;&apos;&quot;</string>",
            "<key>integer</key><integer>-42</integer>",
            "<key>real</key><real>1.5</real>",
            "<key>negativeZero</key><integer>0</integer>",
            "<key>largeInteger</key><integer>1e+21</integer>",
            "<key>smallReal</key><real>1e-7</real>",
            "<key>booleans</key><array><true/><false/></array>",
            "<key>emptyString</key><string></string>",
            "<key>emptyArray</key><array></array>",
            "<key>emptyDictionary</key><dict></dict>",
            "<key>date</key><date>2024-01-15T10:30:00Z</date>",
            "<key>bytes</key><data>AAF/gP8=</data>",
            "<key>buffer</key><data>AAF/gP8=</data>",
            "<key>nested</key><array><dict><key>child</key><string>value</string></dict><array><string>leaf</string></array></array>",
            "</dict>",
          ].join(""),
        ),
      );
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      "rejects a nested non-finite number (%s)",
      async (value) => {
        const result = await serialize({ nested: [value] }).pipe(Effect.flip, Effect.runPromise);

        expect(result).toBeInstanceOf(PlistSerializeError);
      },
    );

    it.each([
      ["bigint", 1n],
      ["symbol", Symbol("unsupported")],
      ["function", () => "unsupported"],
    ] as const)("rejects an unsupported %s leaf", async (_kind, value) => {
      const result = await serialize({ nested: [value] } as never).pipe(
        Effect.flip,
        Effect.runPromise,
      );

      expect(result).toBeInstanceOf(PlistSerializeError);
    });

    it("rejects sparse arrays", async () => {
      const result = await serialize(new Array<PlistValue>(2)).pipe(Effect.flip, Effect.runPromise);

      expect(result).toBeInstanceOf(PlistSerializeError);
    });

    it("rejects an invalid root date", async () => {
      const result = await serialize(new Date(Number.NaN)).pipe(Effect.flip, Effect.runPromise);

      expect(result).toBeInstanceOf(PlistSerializeError);
    });

    it("rejects a nested invalid date", async () => {
      const result = await serialize({ nested: [new Date(Number.NaN)] }).pipe(
        Effect.flip,
        Effect.runPromise,
      );

      expect(result).toBeInstanceOf(PlistSerializeError);
    });

    it("visits each dictionary once", () => {
      const value: PlistValue = {
        first: [{ second: ["value"] }],
        third: { fourth: true },
      };
      const objectEntries = vi.spyOn(Object, "entries");
      let entryCount = 0;
      let result = "";

      try {
        result = Effect.runSync(serialize(value));
        entryCount = objectEntries.mock.calls.length;
      } finally {
        objectEntries.mockRestore();
      }

      expect(entryCount).toBe(3);
      expect(result).toBe(
        plistDocument(
          "<dict><key>first</key><array><dict><key>second</key><array><string>value</string></array></dict></array><key>third</key><dict><key>fourth</key><true/></dict></dict>",
        ),
      );
    });

    it("serializes a large nested tree", async () => {
      const size = 5_000;
      const value: PlistValue = Object.fromEntries(
        Array.from(
          { length: size },
          (_, index) =>
            [`item-${index}`, { index, values: [`label-${index}`, index % 2 === 0] }] as const,
        ),
      );

      const result = await serialize(value).pipe(Effect.runPromise);

      expect(result.match(/<key>item-\d+<\/key>/g)).toHaveLength(size);
      expect(result).toContain(
        "<key>item-4999</key><dict><key>index</key><integer>4999</integer><key>values</key><array><string>label-4999</string><false/></array></dict>",
      );
    });
  });

  describe("serializePlistTrusted", () => {
    it.each([null, undefined])("does not normalize an unvalidated %s", async (value) => {
      const result = await serializePlistTrusted(value as never).pipe(
        Effect.flip,
        Effect.runPromise,
      );

      expect(result).toBeInstanceOf(PlistSerializeError);
    });
  });
});
