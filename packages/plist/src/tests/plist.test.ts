import { describe, it, expect } from "vitest";
import { Effect, Exit, Schema } from "effect";
import {
  parsePlist,
  PlistParseError,
  PlistSerializeError,
  PlistValue,
  serializePlist,
} from "../index.js";

const PlistDictionary = Schema.Record(Schema.String, PlistValue);

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
});
