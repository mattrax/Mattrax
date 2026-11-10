import { describe, expect, it } from "vitest";
import { qrPath } from "./qr";

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
});
