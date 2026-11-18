import { describe, expect, test } from "vitest";
import { decode, encode, getDecoder, getEncoder } from "../iconv-lite.stub.ts";

/**
 * MySQL decodes the server greeting with `cesu8` and column values with the
 * connection charset (`utf8mb4`). Both must round-trip without the legacy
 * encoding tables, or the very first connection fails.
 */
describe("iconv-lite stub", () => {
  test("decodes the CESU-8 handshake strings MySQL sends", () => {
    expect(decode(Buffer.from("8.0.43"), "cesu8")).toBe("8.0.43");
  });

  test("decodes utf8mb4 multibyte text", () => {
    const value = "Mattrax — café 👋";

    expect(decode(Buffer.from(value, "utf8"), "utf8mb4")).toBe(value);
  });

  test("keeps Node-native encodings on the Buffer path", () => {
    expect(decode(Buffer.from([0xe9]), "latin1")).toBe("é");
    expect(encode("é", "latin1")).toEqual(Buffer.from([0xe9]));
  });

  test("round-trips through the streaming decoder/encoder interface", () => {
    const decoder = getDecoder("utf8mb4");
    const encoder = getEncoder("utf8mb4");

    expect(decoder.write(encoder.write("device")) + decoder.end()).toBe("device");
  });

  test("reports the encodings it can serve", () => {
    expect(decode(Buffer.from("ok"), "gbk")).toBe("ok");
  });
});
