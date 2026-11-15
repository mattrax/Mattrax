import { describe, expect, it } from "vitest";
import { appleDeviceArtworkUrl, appleWarrantyUrl, DEVICE_ARTWORK_WIDTH } from "./device-artwork";

describe("appleDeviceArtworkUrl", () => {
  it("resolves Apple identifiers to the generated WebP artwork", () => {
    expect(appleDeviceArtworkUrl("apple", "MacBookPro18,1")).toBe(
      "/device-artwork/apple/MacBookPro18,1.webp",
    );
    expect(appleDeviceArtworkUrl("apple", " iPhone15,2 ")).toBe(
      "/device-artwork/apple/iPhone15,2.webp",
    );
    expect(DEVICE_ARTWORK_WIDTH).toBe(320);
  });

  it("falls back to the platform glyph when there is no artwork", () => {
    expect(appleDeviceArtworkUrl("win", "Surface")).toBeUndefined();
    expect(appleDeviceArtworkUrl("android", "Pixel 8")).toBeUndefined();
    expect(appleDeviceArtworkUrl("apple", null)).toBeUndefined();
    expect(appleDeviceArtworkUrl("apple", "   ")).toBeUndefined();
  });

  it("rejects identifiers that could escape the artwork directory", () => {
    expect(appleDeviceArtworkUrl("apple", "../../secrets")).toBeUndefined();
    expect(appleDeviceArtworkUrl("apple", "..")).toBeUndefined();
    expect(appleDeviceArtworkUrl("apple", "nested/model")).toBeUndefined();
    expect(appleDeviceArtworkUrl("apple", "MacBook%2C1")).toBeUndefined();
  });
});

describe("appleWarrantyUrl", () => {
  it("links only Apple serials and encodes them", () => {
    expect(appleWarrantyUrl("apple", "C02X YZ")).toBe(
      "https://checkcoverage.apple.com/?sn=C02X%20YZ",
    );
    expect(appleWarrantyUrl("win", "1234")).toBeUndefined();
    expect(appleWarrantyUrl("apple", " ")).toBeUndefined();
  });
});
