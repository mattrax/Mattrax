import { describe, expect, it } from "vitest";
import { isPasskeyCancellation } from "./step-up";

describe("passkey cancellation", () => {
  it("recognises a native NotAllowedError", () => {
    expect(isPasskeyCancellation(new DOMException("Cancelled", "NotAllowedError"))).toBe(true);
  });

  it("recognises the native error wrapped by the browser helper", () => {
    const cause = new DOMException("Cancelled", "NotAllowedError");

    expect(isPasskeyCancellation(new Error("Passkey confirmation cancelled.", { cause }))).toBe(
      true,
    );
  });

  it("does not treat other ceremony failures as cancellation", () => {
    expect(isPasskeyCancellation(new Error("Authenticator failed"))).toBe(false);
    expect(isPasskeyCancellation(new DOMException("Invalid domain", "SecurityError"))).toBe(false);
  });
});
