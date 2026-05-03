import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { parsePlist, serializePlist } from "@mattrax/plist";

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
      const result = (await parsePlist(xml).pipe(Effect.runPromise)) as Record<string, unknown>;
      expect(result.name).toBe("Test");
      expect(result.count).toBe(42);
      expect(result.active).toBe(true);
      expect(result.ratio).toBe(3.14);
    });

    it("parses nested arrays and dictionaries", async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <string>one</string>
    <string>two</string>
  </array>
</dict>
</plist>`;
      const result = (await parsePlist(xml).pipe(Effect.runPromise)) as Record<string, unknown>;
      expect(result.items).toEqual(["one", "two"]);
    });

    it("fails on invalid XML", async () => {
      const result = await parsePlist("not xml").pipe(Effect.runPromiseExit);
      expect(result._tag).toBe("Failure");
    });

    it("parses data elements as base64 strings", async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><data>SGVsbG8=</data></plist>`;
      const result = await parsePlist(xml).pipe(Effect.runPromise);
      expect(result).toBe("SGVsbG8=");
    });

    it("parses date elements", async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><date>2024-01-15T10:30:00Z</date></plist>`;
      const result = await parsePlist(xml).pipe(Effect.runPromise);
      expect(result).toBeInstanceOf(Date);
      expect((result as Date).toISOString()).toBe("2024-01-15T10:30:00.000Z");
    });
  });

  describe("serializePlist", () => {
    it("serializes a string", async () => {
      const result = await serializePlist("hello").pipe(Effect.runPromise);
      expect(result).toContain("<string>hello</string>");
    });

    it("serializes an integer", async () => {
      const result = await serializePlist(42).pipe(Effect.runPromise);
      expect(result).toContain("<integer>42</integer>");
    });

    it("serializes a real number", async () => {
      const result = await serializePlist(3.14).pipe(Effect.runPromise);
      expect(result).toContain("<real>3.14</real>");
    });

    it("serializes booleans", async () => {
      const t = await serializePlist(true).pipe(Effect.runPromise);
      const f = await serializePlist(false).pipe(Effect.runPromise);
      expect(t).toContain("<true/>");
      expect(f).toContain("<false/>");
    });

    it("serializes a dictionary", async () => {
      const result = await serializePlist({ name: "Test", count: 1 }).pipe(Effect.runPromise);
      expect(result).toContain("<key>name</key>");
      expect(result).toContain("<string>Test</string>");
      expect(result).toContain("<integer>1</integer>");
    });

    it("serializes an array", async () => {
      const result = await serializePlist(["a", "b"]).pipe(Effect.runPromise);
      expect(result).toContain("<array>");
      expect(result).toContain("<string>a</string>");
      expect(result).toContain("<string>b</string>");
    });

    it("escapes XML entities in strings", async () => {
      const result = await serializePlist(`<script>alert("xss'or'1'='1")</script>`).pipe(Effect.runPromise);
      expect(result).not.toContain("<script>");
      expect(result).toContain("&apos;or&apos;");
      expect(result).toContain("&quot;");
    });

    it("serializes null/undefined as empty string", async () => {
      const n = await serializePlist(null).pipe(Effect.runPromise);
      const u = await serializePlist(undefined).pipe(Effect.runPromise);
      expect(n).toContain("<string></string>");
      expect(u).toContain("<string></string>");
    });

    it("serializes Uint8Array as base64 data", async () => {
      const result = await serializePlist(new Uint8Array([72, 101, 108, 108, 111])).pipe(Effect.runPromise);
      expect(result).toContain("<data>SGVsbG8=</data>");
    });

    it("serializes Date in ISO format", async () => {
      const result = await serializePlist(new Date("2024-01-15T10:30:00.000Z")).pipe(Effect.runPromise);
      expect(result).toContain("<date>2024-01-15T10:30:00Z</date>");
    });

    it("produces a well-formed plist document", async () => {
      const result = await serializePlist({}).pipe(Effect.runPromise);
      expect(result).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(result).toContain('<!DOCTYPE plist');
      expect(result).toContain('<plist version="1.0">');
    });

    it("round-trips parse → serialize → parse for a complex dict", async () => {
      const original = {
        MessageType: "Authenticate",
        UDID: "abc-123",
        Tokens: ["one", "two"],
        Nested: { key: "value" },
      };
      const plist = await serializePlist(original).pipe(Effect.runPromise);
      const parsed = await parsePlist(plist).pipe(Effect.runPromise) as Record<string, unknown>;
      expect(parsed.MessageType).toBe("Authenticate");
      expect(parsed.UDID).toBe("abc-123");
      expect(parsed.Tokens).toEqual(["one", "two"]);
      expect(parsed.Nested).toEqual({ key: "value" });
    });
  });
});
