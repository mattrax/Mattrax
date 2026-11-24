import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodeAuthEnvelope } from "./auth";
import { PreloadedSession } from "./session-store";

const session = {
  sessionId: "session-1",
  subjectId: "account-1",
  claims: { name: "Ada", email: "ada@example.com", emailVerified: true },
};

describe("auth envelope decoding", () => {
  it("publishes only a schema-valid session payload", () => {
    expect(
      decodeAuthEnvelope(200, { _tag: "Success", value: session }, Schema.NullOr(PreloadedSession)),
    ).toEqual({ value: session, private: undefined });
  });

  it("returns a typed failure for a malformed successful session", () => {
    expect(() =>
      decodeAuthEnvelope(
        200,
        { _tag: "Success", value: { ...session, subjectId: 42 } },
        Schema.NullOr(PreloadedSession),
      ),
    ).toThrow(expect.objectContaining({ _tag: "AuthResponseError" }));
  });

  it("keeps tagged auth failures structured", () => {
    expect(() =>
      decodeAuthEnvelope(
        403,
        {
          _tag: "Failure",
          error: {
            _tag: "StepUpRequired",
            message: "Confirm again",
            action: "backup-download",
            methods: ["totp"],
          },
        },
        Schema.NullOr(PreloadedSession),
      ),
    ).toThrow(
      expect.objectContaining({
        _tag: "StepUpRequired",
        action: "backup-download",
        methods: ["totp"],
      }),
    );
  });
});
