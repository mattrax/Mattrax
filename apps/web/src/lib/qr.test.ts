import { encode } from "uqr";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { qrPath } from "./qr";

const decodeModuleGrid = (value: string) => {
  const qr = encode(value, { ecc: "M", border: 4 });
  const scale = 8;
  const width = qr.size * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);

  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.data[y]?.[x]) continue;

      for (let pixelY = y * scale; pixelY < (y + 1) * scale; pixelY++) {
        for (let pixelX = x * scale; pixelX < (x + 1) * scale; pixelX++) {
          const offset = (pixelY * width + pixelX) * 4;
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
        }
      }
    }
  }

  return jsQR(pixels, width, width);
};

describe("QR rendering", () => {
  it("renders a scannable path for an enrollment URL", () => {
    const qr = qrPath("https://mdm.example.com/enroll/abc123");
    expect(qr.size).toBeGreaterThan(20);
    expect(qr.path).toMatch(/^M\d+ \d+h1v1h-1z/);
    expect(qr.path.length).toBeGreaterThan(qr.size);
  });

  it("renders different codes for different enrollment links", () => {
    const first = qrPath("https://mdm.example.com/enroll/first");
    const second = qrPath("https://mdm.example.com/enroll/second");
    expect(first.size).toBe(second.size);
    expect(first.path).not.toBe(second.path);
  });

  it("round-trips an enrollment URL through a real QR decoder", () => {
    const value = "https://mdm.example.com/enroll/abc123";

    expect(decodeModuleGrid(value)?.data).toBe(value);
  });

  it("round-trips an Android enrollment payload through a real QR decoder", () => {
    const value = JSON.stringify({
      "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": { enterpriseName: "enterprises/123" },
      "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME":
        "com.google.android.apps.work.mdm/.Receiver",
      "android.app.extra.PROVISIONING_ADMIN_PACKAGE_CHECKSUM": "checksum",
      "android.app.extra.PROVISIONING_ADMIN_PACKAGE_DOWNLOAD_LOCATION": "https://mdm.test/app.apk",
      "android.app.extra.PROVISIONING_SKIP_ENCRYPTION": false,
      "android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED": true,
    });

    expect(decodeModuleGrid(value)?.data).toBe(value);
  });
});
